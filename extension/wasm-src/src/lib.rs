//! Silent Partner IronClaw extension: two sandboxed WASM tools for a vault's leader.
//!
//! - `silent_partner.signal`: "move the vault to 40% NEAR" → a target-weight
//!   leader signal. Signed with the leader's signal key if it's in the
//!   workspace (`silent-partner/signal-key/<vault>`, hex seed, as the leader
//!   console stores it) and sent to the operator; otherwise a tap-to-sign link
//!   into the leader console. The signal key can't move funds: the contract
//!   and operator bound everything it can do.
//! - `silent_partner.status`: the vault's public state from NEAR RPC.
//!
//! Egress only through the host `http-request` import, allowlisted per tool.

use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// Operator API. For local runs map it with
/// `IRONCLAW_REBORN_TEST_HTTP_REWRITE_MAP="operator.silent-partner.invalid=127.0.0.1:8788"`.
/// `.invalid` never resolves, so without a mapping nothing is sent anywhere.
pub const OPERATOR_API: &str = "https://operator.silent-partner.invalid";
pub const SITE: &str = "https://amityadav0.github.io/silent-partner";

pub fn rpc_for(vault: &str) -> &'static str {
    if vault.ends_with(".testnet") {
        "https://rpc.testnet.fastnear.com"
    } else {
        "https://rpc.mainnet.fastnear.com"
    }
}

/// A target signal: move the weight of `risk` to `target_bps` of NAV (size_bps caps the trade).
pub fn target_signal(vault: &str, base: &str, risk: &str, target_bps: u64, nonce: &str, now_ms: u64) -> Value {
    json!({ "v": 1, "vault": vault, "from": base, "to": risk, "size_bps": 10_000, "type": "target", "target_bps": target_bps, "nonce": nonce, "created_ms": now_ms })
}

/// Canonical JSON (sorted keys, no whitespace) as operator/src/carry/receipt.ts
/// `canonicalJson`: serde_json's map is a BTreeMap without `preserve_order`.
pub fn canonical(v: &Value) -> String {
    serde_json::to_string(v).expect("json")
}

pub fn signal_hash(signal: &Value) -> [u8; 32] {
    Sha256::digest(canonical(signal).as_bytes()).into()
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn unhex32(s: &str) -> Option<[u8; 32]> {
    let s = s.trim();
    if s.len() != 64 {
        return None;
    }
    let v: Option<Vec<u8>> = (0..64).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect();
    v?.try_into().ok()
}

/// The signed envelope the operator's POST /v1/signals takes.
pub fn sign_envelope(signal: Value, seed_hex: &str) -> Option<(Value, String)> {
    let key = SigningKey::from_bytes(&unhex32(seed_hex)?);
    let h = signal_hash(&signal);
    let sig = key.sign(&h);
    let env = json!({
        "signal": signal,
        "signature": format!("ed25519:{}", bs58::encode(sig.to_bytes()).into_string()),
        "public_key": format!("ed25519:{}", bs58::encode(key.verifying_key().to_bytes()).into_string()),
    });
    Some((env, hex(&h)))
}

/// A nonce from the time and the request (the host has no RNG import).
pub fn nonce(now_ms: u64, salt: &str) -> String {
    hex(&Sha256::digest(format!("{now_ms}|{salt}").as_bytes())[..8])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_json_sorts_keys_like_the_operator() {
        let s = target_signal("v.testnet", "nep141:usdc", "nep141:wrap", 4000, "00112233445566778899", 1);
        assert_eq!(
            canonical(&s),
            r#"{"created_ms":1,"from":"nep141:usdc","nonce":"00112233445566778899","size_bps":10000,"target_bps":4000,"to":"nep141:wrap","type":"target","v":1,"vault":"v.testnet"}"#
        );
    }

    #[test]
    fn shared_signal_vector() {
        // web/test/lib.test.ts and operator/test share this vector (market signal)
        let s = json!({ "v": 1, "vault": "sp-vault-60270.testnet", "from": "nep141:usdc.fakes.testnet", "to": "nep141:wrap.testnet", "size_bps": 2500, "type": "limit", "limit_price": "0.27", "nonce": "00112233445566778899", "created_ms": 1794218400000u64 });
        assert_eq!(hex(&signal_hash(&s)), "90ef0a734e151929b54eecf4a846190932dce915b1c82b40cd5f0c20773c4483");
    }

    #[test]
    fn signs_verifiably() {
        let (env, h) = sign_envelope(target_signal("v", "a", "b", 0, "00", 0), &"07".repeat(32)).unwrap();
        let pk = bs58::decode(env["public_key"].as_str().unwrap().trim_start_matches("ed25519:")).into_vec().unwrap();
        let sig = bs58::decode(env["signature"].as_str().unwrap().trim_start_matches("ed25519:")).into_vec().unwrap();
        let vk = ed25519_dalek::VerifyingKey::from_bytes(&pk.try_into().unwrap()).unwrap();
        vk.verify_strict(&unhex32(&h).unwrap(), &ed25519_dalek::Signature::from_bytes(&sig.try_into().unwrap())).unwrap();
        assert!(sign_envelope(json!({}), "zz").is_none());
    }
}

#[cfg(any(target_arch = "wasm32", feature = "typecheck"))]
mod guest {
    wit_bindgen::generate!({ world: "sandboxed-tool", path: "../wit/tool.wit" });
    use exports::near::agent::tool::{ErrorKind, Guest, GuestFailure, Request, Response};
    use near::agent::host::{http_request, now_millis, workspace_read};
    use serde_json::{json, Value};

    fn fail(kind: ErrorKind, code: &str, message: Option<String>) -> Response {
        Response::Failure(GuestFailure { kind, code: Some(code.to_string()), message })
    }

    fn post(url: &str, body: &Value) -> Result<Value, Response> {
        let resp = http_request("POST", url, r#"{"Content-Type":"application/json","Accept":"application/json"}"#, Some(body.to_string().as_bytes()), Some(30_000))
            .map_err(|f| fail(ErrorKind::OperationFailed, f.code.as_deref().unwrap_or("request_failed"), f.message))?;
        serde_json::from_slice(&resp.body).map_err(|_| fail(ErrorKind::OperationFailed, &format!("http_{}", resp.status), None))
    }

    /// A NEAR view call → parsed JSON result.
    fn view(vault: &str, method: &str, args: &Value) -> Result<Value, Response> {
        let b64 = base64(args.to_string().as_bytes());
        let j = post(crate::rpc_for(vault), &json!({ "jsonrpc": "2.0", "id": 1, "method": "query", "params": { "request_type": "call_function", "finality": "optimistic", "account_id": vault, "method_name": method, "args_base64": b64 } }))?;
        let bytes: Vec<u8> = j["result"]["result"].as_array().ok_or_else(|| fail(ErrorKind::OperationFailed, "view_failed", Some(j.to_string().chars().take(200).collect())))?.iter().filter_map(|x| x.as_u64().map(|b| b as u8)).collect();
        serde_json::from_slice(&bytes).map_err(|_| fail(ErrorKind::OperationFailed, "bad_view_json", None))
    }

    fn base64(b: &[u8]) -> String {
        const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for c in b.chunks(3) {
            let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
            for i in 0..4 {
                out.push(if i <= c.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
            }
        }
        out
    }

    fn signal(params: &Value) -> Response {
        let (Some(vault), Some(pct)) = (params["vault"].as_str(), params["target_pct"].as_f64()) else {
            return fail(ErrorKind::Input, "missing_field", Some("vault and target_pct are required".into()));
        };
        if !(0.0..=100.0).contains(&pct) {
            return fail(ErrorKind::Input, "target_out_of_range", None);
        }
        let cfg = match view(vault, "get_config", &json!({})) { Ok(c) => c, Err(r) => return r };
        let base = cfg["base_asset_id"].as_str().unwrap_or_default().to_string();
        let Some(risk) = cfg["allowed_assets"].as_array().and_then(|a| a.iter().filter_map(Value::as_str).find(|x| *x != base)).map(str::to_string) else {
            return fail(ErrorKind::OperationFailed, "no_risky_asset", None);
        };
        let now = now_millis();
        let target_bps = (pct * 100.0).round() as u64;
        let s = crate::target_signal(vault, &base, &risk, target_bps, &crate::nonce(now, &format!("{vault}{target_bps}")), now);
        let link = format!("{}/leader/?id={vault}&target={}", crate::SITE, pct);
        let Some(seed) = workspace_read(&format!("silent-partner/signal-key/{vault}")) else {
            let card = json!({ "card": { "kind": "needs_signature", "title": format!("Move {vault} to {pct}% NEAR"), "link": link, "hash": crate::hex(&crate::signal_hash(&s)), "note": "No signal key in the workspace. Open the link: the leader console signs it with your browser-held key in one tap." } });
            return Response::Success(card.to_string());
        };
        let Some((env, hash)) = crate::sign_envelope(s, &seed) else {
            return fail(ErrorKind::Input, "bad_signal_key", Some("the workspace key must be a 64-char hex seed".into()));
        };
        match post(&format!("{}/v1/signals", crate::OPERATOR_API), &env) {
            Ok(r) => Response::Success(json!({ "card": { "kind": "submitted", "title": format!("{vault} → {pct}% NEAR"), "hash": hash, "ok": r["ok"], "status": r["status"], "error": r["error"], "fill": r["fill"] } }).to_string()),
            Err(r) => r,
        }
    }

    fn status(params: &Value) -> Response {
        let Some(vault) = params["vault"].as_str() else { return fail(ErrorKind::Input, "missing_vault", None) };
        match view(vault, "get_vault", &json!({})) {
            Ok(v) => {
                let price = v["price"].as_str().and_then(|p| p.parse::<f64>().ok()).unwrap_or(0.0) / 1e18;
                let nav = v["book_nav"].as_str().and_then(|p| p.parse::<f64>().ok()).unwrap_or(0.0) / 1e6;
                Response::Success(json!({ "card": { "kind": "status", "vault": vault, "share_price": price, "book_nav_usdc": nav, "epoch": v["epoch"], "signals_recorded": v["signals"], "emergency": v["emergency"], "page": format!("{}/vault/?id={vault}", crate::SITE) } }).to_string())
            }
            Err(r) => r,
        }
    }

    struct SilentPartner;
    impl Guest for SilentPartner {
        fn execute(req: Request) -> Response {
            let params: Value = match serde_json::from_str(&req.params) { Ok(v) => v, Err(_) => return fail(ErrorKind::Input, "invalid_json", None) };
            let cap = req.context.as_deref().and_then(|c| serde_json::from_str::<Value>(c).ok()).and_then(|v| v["capability_id"].as_str().map(str::to_string)).unwrap_or_default();
            match cap.as_str() {
                "silent_partner.signal" => signal(&params),
                "silent_partner.status" => status(&params),
                other => fail(ErrorKind::Input, "unknown_capability", Some(other.to_string())),
            }
        }
        fn schema() -> String {
            include_str!("../../schemas/silent_partner/signal.input.v1.json").to_string()
        }
        fn description() -> String {
            "Silent Partner: move a private copy-trading vault to a target NEAR weight, or read its public state.".to_string()
        }
    }
    export!(SilentPartner);
}
