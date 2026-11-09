//! NEP-413 intent payloads the vault's MPC key may sign.
//!
//! The contract never signs bytes it hasn't parsed. A payload is accepted only
//! if its message is exactly one of two shapes (unknown fields rejected, so no
//! `memo`, no `msg`/notification, no extra intents):
//!
//! * login: `{"deadline", "intents": [], "signer_id": <vault>}` for intents.near,
//!   used for a 1Click user session (balance reads). Moves nothing.
//! * transfer: one `transfer` intent of one token, from the vault to one receiver.
//!
//! Prehash = sha256(borsh((2^31 + 413, message, nonce[32], recipient, callback_url)))
//! as in defuse `crates/signatures/nep413`.

use std::collections::BTreeMap;

use near_sdk::serde::Deserialize;
use near_sdk::{env, near};

pub const NEP413_TAG: u32 = (1 << 31) + 413;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Nep413Payload {
    pub message: String,
    /// base64, 32 bytes.
    pub nonce: String,
    pub recipient: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Message {
    deadline: String,
    intents: Vec<IntentJson>,
    signer_id: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "intent", rename_all = "snake_case", deny_unknown_fields)]
enum IntentJson {
    Transfer { receiver_id: String, tokens: UniqueMap },
}

/// A JSON object of token → amount that refuses repeated keys. serde's map
/// types keep the last value of a repeated key; a verifier that read the first
/// would transfer a different amount than the one checked here.
struct UniqueMap(BTreeMap<String, String>);

impl<'de> Deserialize<'de> for UniqueMap {
    fn deserialize<D: near_sdk::serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> near_sdk::serde::de::Visitor<'de> for V {
            type Value = UniqueMap;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a map of token id to amount")
            }
            fn visit_map<A: near_sdk::serde::de::MapAccess<'de>>(self, mut m: A) -> Result<UniqueMap, A::Error> {
                let mut out = BTreeMap::new();
                while let Some((k, v)) = m.next_entry::<String, String>()? {
                    if out.insert(k, v).is_some() {
                        return Err(near_sdk::serde::de::Error::custom("duplicate token"));
                    }
                }
                Ok(UniqueMap(out))
            }
        }
        d.deserialize_map(V)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Parsed {
    Login,
    Transfer { receiver_id: String, token: String, amount: u128 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedPayload {
    pub kind: Parsed,
    pub signer_id: String,
    pub recipient: String,
    pub deadline_ms: u64,
    pub nonce: [u8; 32],
    pub prehash: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IntentError {
    Malformed(&'static str),
    Shape(&'static str),
}

pub fn decode_nonce(b64: &str) -> Option<[u8; 32]> {
    use near_sdk::base64::Engine;
    near_sdk::base64::engine::general_purpose::STANDARD.decode(b64).ok()?.try_into().ok()
}

pub fn prehash(message: &str, nonce: &[u8; 32], recipient: &str) -> [u8; 32] {
    let bytes = near_sdk::borsh::to_vec(&(NEP413_TAG, message, nonce, recipient, Option::<String>::None)).expect("borsh");
    env::sha256_array(&bytes)
}

pub fn parse(p: &Nep413Payload) -> Result<ParsedPayload, IntentError> {
    let nonce = decode_nonce(&p.nonce).ok_or(IntentError::Malformed("nonce"))?;
    let m: Message = near_sdk::serde_json::from_str(&p.message).map_err(|_| IntentError::Malformed("message"))?;
    let deadline_ms = crate::quote::parse_iso_ms(&m.deadline).ok_or(IntentError::Malformed("deadline"))?;
    let kind = match m.intents.as_slice() {
        [] => Parsed::Login,
        [IntentJson::Transfer { receiver_id, tokens }] => {
            let [(token, amount)] = tokens.0.iter().collect::<Vec<_>>()[..] else {
                return Err(IntentError::Shape("exactly one token"));
            };
            if amount.is_empty() || !amount.bytes().all(|c| c.is_ascii_digit()) {
                return Err(IntentError::Malformed("amount"));
            }
            Parsed::Transfer {
                receiver_id: receiver_id.clone(),
                token: token.clone(),
                amount: amount.parse().map_err(|_| IntentError::Malformed("amount"))?,
            }
        }
        _ => return Err(IntentError::Shape("exactly one intent")),
    };
    Ok(ParsedPayload {
        kind,
        signer_id: m.signer_id,
        recipient: p.recipient.clone(),
        deadline_ms,
        nonce,
        prehash: prehash(&p.message, &nonce, &p.recipient),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const N: &str = "Vij2xgDhEPMXAKd3B6vG5RhBVeL9AuFIA1IZaLl832U=";

    fn p(message: &str) -> Nep413Payload {
        Nep413Payload {
            message: message.into(),
            nonce: N.into(),
            recipient: "intents.far".into(),
        }
    }

    #[test]
    fn defuse_vector() {
        // defuse crates/signatures/nep413 test vector: verifies against our prehash.
        let pk: [u8; 32] = hex_bytes("e2e9cb7ac57cb46d4da1ce1d1cc2c33bdfe17407c517916b522724a8ea2c6c50")
            .try_into()
            .unwrap();
        let sig: [u8; 64] =
            hex_bytes("e2ff6254871a3fec1853c167b42f0f14248c4cf7fef5452dc24d8dbdc5c4bf183ab707322b4d782d5f5a05571bae476c5f7ee41c473f3002e600865e46b75d0f")
                .try_into()
                .unwrap();
        let h = prehash("Hello, world!", &[0u8; 32], "intents.near");
        assert!(env::ed25519_verify(&sig, h, &pk));
    }

    fn hex_bytes(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn real_generate_intent_payload_parses() {
        // From docs/killtests-copyvault.md (1Click generate-intent, never signed).
        let m = r#"{"deadline":"2026-11-07T13:34:24.444Z","intents":[{"intent":"transfer","receiver_id":"a555635c46126bcdf9b19813816426e7cdf71d66ad9721e5bc3a6875e4cd5642","tokens":{"imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1":"1000000"}}],"signer_id":"0d4ac075c623c60efd1102572523a9f9b784885841e90a24864e60dab5e02793"}"#;
        let r = parse(&p(m)).unwrap();
        assert_eq!(
            r.kind,
            Parsed::Transfer {
                receiver_id: "a555635c46126bcdf9b19813816426e7cdf71d66ad9721e5bc3a6875e4cd5642".into(),
                token: "imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1".into(),
                amount: 1_000_000
            }
        );
        assert_eq!(r.signer_id, "0d4ac075c623c60efd1102572523a9f9b784885841e90a24864e60dab5e02793");
        assert_eq!(r.deadline_ms, 1_794_058_464_444);
    }

    #[test]
    fn shape_table() {
        let t = |extra: &str, tokens: &str| {
            format!(
                r#"{{"deadline":"2026-11-07T13:34:24.444Z","intents":[{{"intent":"transfer","receiver_id":"x"{extra},"tokens":{tokens}}}],"signer_id":"v"}}"#
            )
        };
        let cases: Vec<(String, Result<(), IntentError>)> = vec![
            (t("", r#"{"a":"1"}"#), Ok(())),
            (t(r#","memo":"hi""#, r#"{"a":"1"}"#), Err(IntentError::Malformed("message"))),
            (t(r#","msg":"call me""#, r#"{"a":"1"}"#), Err(IntentError::Malformed("message"))),
            (t("", r#"{"a":"1","b":"2"}"#), Err(IntentError::Shape("exactly one token"))),
            (t("", r#"{}"#), Err(IntentError::Shape("exactly one token"))),
            (t("", r#"{"a":"-1"}"#), Err(IntentError::Malformed("amount"))),
            (t("", r#"{"a":"1e6"}"#), Err(IntentError::Malformed("amount"))),
            (r#"{"deadline":"2026-11-07T13:34:24.444Z","intents":[],"signer_id":"v"}"#.into(), Ok(())),
            (
                r#"{"deadline":"2026-11-07T13:34:24.444Z","intents":[],"signer_id":"v","extra":1}"#.into(),
                Err(IntentError::Malformed("message")),
            ),
            (
                r#"{"deadline":"2026-11-07T13:34:24.444Z","intents":[{"intent":"token_diff","diff":{}}],"signer_id":"v"}"#.into(),
                Err(IntentError::Malformed("message")),
            ),
            (
                r#"{"deadline":"soon","intents":[],"signer_id":"v"}"#.into(),
                Err(IntentError::Malformed("deadline")),
            ),
        ];
        for (m, want) in cases {
            assert_eq!(parse(&p(&m)).map(|_| ()), want, "{m}");
        }
        // two transfers
        let two = r#"{"deadline":"2026-11-07T13:34:24.444Z","intents":[{"intent":"transfer","receiver_id":"x","tokens":{"a":"1"}},{"intent":"transfer","receiver_id":"y","tokens":{"a":"1"}}],"signer_id":"v"}"#;
        assert_eq!(parse(&p(two)).map(|_| ()), Err(IntentError::Shape("exactly one intent")));
        // bad nonce
        assert_eq!(
            parse(&Nep413Payload {
                nonce: "AAAA".into(),
                ..p(&t("", r#"{"a":"1"}"#))
            })
            .map(|_| ()),
            Err(IntentError::Malformed("nonce"))
        );
    }
}
