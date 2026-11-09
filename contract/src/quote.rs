//! 1Click signed quotes, verified on-chain. Signature construction and ISO date
//! parsing are carried over from scope (contract/src/quote.rs); see
//! docs/1click-signature.md.
//!
//! ```text
//! message   = json-stable-stringify({...signedRequestFields, ...signedQuoteFields, timestamp})
//! digest    = base58( sha256( utf8(message) ) )
//! signature = ed25519_sign( utf8(digest), manager_key )
//! ```
//!
//! The contract verifies the signature, then reads every fact it acts on from
//! `message` and nowhere else.

use near_sdk::serde_json::Value;
use near_sdk::{env, near};

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignedQuote {
    /// json-stable-stringify output, byte for byte as hashed.
    pub message: String,
    /// `ed25519:<base58>` (64 bytes).
    pub signature: String,
}

/// The quote facts the contract acts on, all from a verified message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuoteFacts {
    pub origin_asset: String,
    pub destination_asset: String,
    pub amount_in: u128,
    pub min_amount_out: u128,
    pub slippage_bps: u64,
    pub deposit_type: String,
    pub recipient_type: String,
    pub refund_type: String,
    pub recipient: String,
    pub refund_to: String,
    pub deposit_address: String,
    pub deadline_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QuoteError {
    BadSignature,
    Malformed(&'static str),
    Dry,
}

pub fn decode_ed25519<const N: usize>(s: &str) -> Option<[u8; N]> {
    let b58 = s.strip_prefix("ed25519:").unwrap_or(s);
    let bytes = near_sdk::bs58::decode(b58).into_vec().ok()?;
    bytes.try_into().ok()
}

pub fn digest_text(message: &str) -> String {
    near_sdk::bs58::encode(env::sha256(message.as_bytes())).into_string()
}

pub fn signature_ok(message: &str, signature: &str, key: &[u8; 32]) -> bool {
    match decode_ed25519::<64>(signature) {
        Some(sig) => env::ed25519_verify(&sig, digest_text(message).as_bytes(), key),
        None => false,
    }
}

/// ISO-8601 UTC (`YYYY-MM-DDTHH:MM:SS[.fff]Z`) → Unix ms.
pub fn parse_iso_ms(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || *b.last()? != b'Z' {
        return None;
    }
    let num = |r: core::ops::Range<usize>| -> Option<u64> { core::str::from_utf8(&b[r]).ok()?.parse().ok() };
    let (y, mo, d, h, mi, se) = (num(0..4)?, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?, num(17..19)?);
    let ms = match &s[19..s.len() - 1] {
        "" => 0,
        frac if frac.starts_with('.') && frac.len() >= 2 && frac.len() <= 10 && frac[1..].bytes().all(|c| c.is_ascii_digit()) => {
            let digits = &frac[1..];
            let mut v: u64 = digits[..digits.len().min(3)].parse().ok()?;
            for _ in digits.len()..3 {
                v *= 10;
            }
            v
        }
        _ => return None,
    };
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    let (y, mo) = (y as i64, mo as i64);
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    if days < 0 {
        return None;
    }
    Some(days as u64 * 86_400_000 + h * 3_600_000 + mi * 60_000 + se * 1000 + ms)
}

fn s<'a>(v: &'a Value, k: &'static str) -> Result<&'a str, QuoteError> {
    v.get(k).and_then(Value::as_str).ok_or(QuoteError::Malformed(k))
}

fn units(v: &Value, k: &'static str) -> Result<u128, QuoteError> {
    let t = s(v, k)?;
    if t.is_empty() || !t.bytes().all(|c| c.is_ascii_digit()) {
        return Err(QuoteError::Malformed(k));
    }
    t.parse().map_err(|_| QuoteError::Malformed(k))
}

/// What a price quote says: `amount_in` of `origin` buys `amount_out` of `destination`, at `timestamp_ms`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceFacts {
    pub origin_asset: String,
    pub destination_asset: String,
    pub amount_in: u128,
    pub amount_out: u128,
    pub timestamp_ms: u64,
}

/// Verify a 1Click quote under `key` for use as a *price* (dry or not: it moves
/// nothing). The signed message carries the amounts and 1Click's timestamp.
pub fn price_facts(q: &SignedQuote, key: &[u8; 32]) -> Result<PriceFacts, QuoteError> {
    if !signature_ok(&q.message, &q.signature, key) {
        return Err(QuoteError::BadSignature);
    }
    let v: Value = near_sdk::serde_json::from_str(&q.message).map_err(|_| QuoteError::Malformed("json"))?;
    if s(&v, "swapType")? != "EXACT_INPUT" {
        return Err(QuoteError::Malformed("swapType"));
    }
    let amount_in = units(&v, "amountIn")?;
    if units(&v, "amount")? != amount_in {
        return Err(QuoteError::Malformed("amountIn"));
    }
    Ok(PriceFacts {
        origin_asset: s(&v, "originAsset")?.into(),
        destination_asset: s(&v, "destinationAsset")?.into(),
        amount_in,
        amount_out: units(&v, "amountOut")?,
        timestamp_ms: parse_iso_ms(s(&v, "timestamp")?).ok_or(QuoteError::Malformed("timestamp"))?,
    })
}

/// Verify the signature under `key` and extract the facts. Shape checks that
/// depend on what the quote is for live in lib.rs.
pub fn verify(q: &SignedQuote, key: &[u8; 32]) -> Result<QuoteFacts, QuoteError> {
    if !signature_ok(&q.message, &q.signature, key) {
        return Err(QuoteError::BadSignature);
    }
    parse(&q.message)
}

pub fn parse(message: &str) -> Result<QuoteFacts, QuoteError> {
    let v: Value = near_sdk::serde_json::from_str(message).map_err(|_| QuoteError::Malformed("json"))?;
    match v.get("dry").and_then(Value::as_bool) {
        Some(false) => {}
        Some(true) => return Err(QuoteError::Dry),
        None => return Err(QuoteError::Malformed("dry")),
    }
    if s(&v, "swapType")? != "EXACT_INPUT" {
        return Err(QuoteError::Malformed("swapType"));
    }
    // Fields that would redirect funds or attach side effects must be absent.
    for k in [
        "customRecipientMsg",
        "virtualChainRecipient",
        "virtualChainRefundRecipient",
        "depositMemo",
        "referral",
        "appFees",
    ] {
        if !v.get(k).is_none_or(Value::is_null) {
            return Err(QuoteError::Malformed(k));
        }
    }
    let amount = units(&v, "amount")?;
    let amount_in = units(&v, "amountIn")?;
    if amount != amount_in {
        return Err(QuoteError::Malformed("amountIn"));
    }
    Ok(QuoteFacts {
        origin_asset: s(&v, "originAsset")?.into(),
        destination_asset: s(&v, "destinationAsset")?.into(),
        amount_in,
        min_amount_out: units(&v, "minAmountOut")?,
        slippage_bps: v
            .get("slippageTolerance")
            .and_then(Value::as_u64)
            .ok_or(QuoteError::Malformed("slippageTolerance"))?,
        deposit_type: s(&v, "depositType")?.into(),
        recipient_type: s(&v, "recipientType")?.into(),
        refund_type: s(&v, "refundType")?.into(),
        recipient: s(&v, "recipient")?.into(),
        refund_to: s(&v, "refundTo")?.into(),
        deposit_address: s(&v, "depositAddress")?.into(),
        deadline_ms: parse_iso_ms(s(&v, "deadline")?).ok_or(QuoteError::Malformed("deadline"))?,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    pub fn test_key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    /// Sign a message the way 1Click does (over the base58 digest text).
    pub fn sign_like_oneclick(message: &str, k: &SigningKey) -> SignedQuote {
        let digest = near_sdk::bs58::encode(near_sdk::env::sha256(message.as_bytes())).into_string();
        let sig = k.sign(digest.as_bytes());
        SignedQuote {
            message: message.into(),
            signature: format!("ed25519:{}", near_sdk::bs58::encode(sig.to_bytes()).into_string()),
        }
    }

    pub fn msg(over: &[(&str, Value)]) -> String {
        let mut v = near_sdk::serde_json::json!({
            "dry": false, "swapType": "EXACT_INPUT", "slippageTolerance": 50,
            "originAsset": "nep141:usdc", "destinationAsset": "nep141:wrap.near",
            "amount": "1000000", "amountIn": "1000000", "amountOut": "268000000000000000000000", "minAmountOut": "266000000000000000000000",
            "depositType": "CONFIDENTIAL_INTENTS", "recipientType": "CONFIDENTIAL_INTENTS", "refundType": "CONFIDENTIAL_INTENTS",
            "recipient": "aa", "refundTo": "aa",
            "depositAddress": "a555635c46126bcdf9b19813816426e7cdf71d66ad9721e5bc3a6875e4cd5642",
            "deadline": "2026-11-09T10:00:00.000Z", "timestamp": "2026-11-09T09:50:00.000Z"
        });
        for (k, val) in over {
            v[*k] = val.clone();
        }
        near_sdk::serde_json::to_string(&v).unwrap()
    }

    #[test]
    fn real_oneclick_vector_verifies() {
        // Real dry quote signed by 1Click (carried from scope tests/vectors).
        let vec: Value = near_sdk::serde_json::from_str(include_str!("../tests/vectors/oneclick_dry_quote.json")).unwrap();
        let key = decode_ed25519::<32>("ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc").unwrap();
        let q = SignedQuote {
            message: vec["message"].as_str().unwrap().into(),
            signature: vec["signature"].as_str().unwrap().into(),
        };
        assert!(signature_ok(&q.message, &q.signature, &key));
        assert_eq!(verify(&q, &key), Err(QuoteError::Dry)); // genuine, but dry: never acted on
        let mut t = q.clone();
        t.message = t.message.replacen("\"dry\":true", "\"dry\":false", 1);
        assert_eq!(verify(&t, &key), Err(QuoteError::BadSignature));
    }

    #[test]
    fn parse_table() {
        let k = test_key();
        let pk = k.verifying_key().to_bytes();
        let ok = verify(&sign_like_oneclick(&msg(&[]), &k), &pk).unwrap();
        assert_eq!(ok.amount_in, 1_000_000);
        assert_eq!(ok.deadline_ms, 1_794_218_400_000);
        use near_sdk::serde_json::json;
        let cases: Vec<(Vec<(&str, Value)>, QuoteError)> = vec![
            (vec![("dry", json!(true))], QuoteError::Dry),
            (vec![("swapType", json!("EXACT_OUTPUT"))], QuoteError::Malformed("swapType")),
            (vec![("amountIn", json!("999"))], QuoteError::Malformed("amountIn")),
            (vec![("amount", json!("-1"))], QuoteError::Malformed("amount")),
            (vec![("deadline", json!("tomorrow"))], QuoteError::Malformed("deadline")),
            (vec![("depositAddress", Value::Null)], QuoteError::Malformed("depositAddress")),
        ];
        for (over, want) in cases {
            assert_eq!(verify(&sign_like_oneclick(&msg(&over), &k), &pk), Err(want.clone()), "{want:?}");
        }
        // wrong key
        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert_eq!(verify(&sign_like_oneclick(&msg(&[]), &other), &pk), Err(QuoteError::BadSignature));
    }

    #[test]
    fn iso_dates() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_ms("2026-11-09T10:00:00.5Z"), Some(1_794_218_400_500));
        for bad in ["2026-11-09 10:00:00Z", "2026-11-09T10:00:00", "2026-13-01T00:00:00Z", "nope"] {
            assert_eq!(parse_iso_ms(bad), None, "{bad}");
        }
    }
}
