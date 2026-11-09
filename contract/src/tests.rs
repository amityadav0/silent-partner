//! Contract-level table tests. Promises are mocked by near-sdk; callbacks are
//! invoked directly with the results the remote contracts would return.

use super::*;
use crate::quote::tests::{msg as qmsg, sign_like_oneclick, test_key};
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::serde_json::{json, Value};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use std::panic::{catch_unwind, AssertUnwindSafe};

pub(crate) const T0_MS: u64 = 1_794_218_400_000; // 2026-11-09T10:00:00Z
const USDC: &str = "nep141:usdc";
const WNEAR: &str = "nep141:wrap.near";

pub(crate) fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
pub(crate) fn att_key() -> SigningKey {
    SigningKey::from_bytes(&[3u8; 32])
}
fn leader_key() -> SigningKey {
    SigningKey::from_bytes(&[5u8; 32])
}
fn mpc_key() -> SigningKey {
    SigningKey::from_bytes(&[11u8; 32])
}
fn pk_str(k: &SigningKey) -> String {
    format!("ed25519:{}", near_sdk::bs58::encode(k.verifying_key().to_bytes()).into_string())
}
fn sig_str(sig: ed25519_dalek::Signature) -> String {
    format!("ed25519:{}", near_sdk::bs58::encode(sig.to_bytes()).into_string())
}
fn vault_acct() -> String {
    hex(&mpc_key().verifying_key().to_bytes())
}

pub(crate) fn ctx(pred: &str, ms: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("vault.testnet"))
        .predecessor_account_id(acc(pred))
        .block_timestamp(ms * 1_000_000)
        .attached_deposit(NearToken::from_yoctonear(0))
        .build());
}

pub(crate) fn cfg() -> Config {
    Config {
        owner: acc("owner.testnet"),
        operator: acc("op.testnet"),
        leader: acc("leader.testnet"),
        base_token: acc("usdc.testnet"),
        base_asset_id: USDC.into(),
        intents_contract: None,
        mpc_contract: acc("v1.signer-prod.testnet"),
        mpc_path: "silent-partner/vault".into(),
        oneclick_key: pk_str(&test_key()),
        attestation_key: pk_str(&att_key()),
        perf_fee_bps: 2000,
        min_leader_bps: 1000,
        max_slippage_bps: 100,
        min_deposit: U128(1_000_000),
        allowed_assets: vec![USDC.into(), WNEAR.into()],
    }
}

/// A fresh, activated vault at T0.
pub(crate) fn vault() -> Vault {
    ctx("owner.testnet", T0_MS);
    // testing_env! carries storage over; start each vault empty.
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let mut v = Vault::new(cfg());
    ctx("vault.testnet", T0_MS);
    v.on_activate(Ok(pk_str(&mpc_key())));
    v
}

pub(crate) fn deposit(v: &mut Vault, who: &str, amount: u128, ms: u64) -> u128 {
    ctx("usdc.testnet", ms);
    match v.ft_on_transfer(acc(who), U128(amount), String::new()) {
        PromiseOrValue::Value(r) => r.0,
        PromiseOrValue::Promise(_) => panic!("unexpected promise"),
    }
}

pub(crate) fn post(v: &mut Vault, epoch: u64, nav: u128, ms: u64) -> NavPost {
    let head = "ab".repeat(32);
    ctx("op.testnet", ms);
    let m = v.nav_message(epoch, U128(nav), ms, head.clone());
    v.post_nav(epoch, U128(nav), ms, head, sig_str(att_key().sign(m.as_bytes())))
}

pub(crate) fn panics<R>(f: impl FnOnce() -> R) -> String {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(_) => "<no panic>".into(),
        Err(e) => e
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default(),
    }
}

pub(crate) fn shares(v: &Vault, who: &str) -> u128 {
    v.get_shares(acc(who)).0 .0
}

// ---------------- activation ----------------

#[test]
fn activation() {
    ctx("owner.testnet", T0_MS);
    let mut v = Vault::new(cfg());
    assert_eq!(deposit(&mut v, "leader.testnet", 5_000_000, T0_MS), 5_000_000, "refused before activation");
    ctx("anyone.testnet", T0_MS);
    let _ = v.activate();
    ctx("vault.testnet", T0_MS);
    v.on_activate(Ok(pk_str(&mpc_key())));
    assert_eq!(v.get_vault().vault_account, Some(vault_acct()));
    ctx("anyone.testnet", T0_MS);
    assert!(panics(|| v.activate()).contains("already active"));
    // a failed MPC view does not activate
    ctx("owner.testnet", T0_MS);
    let mut w = Vault::new(cfg());
    ctx("vault.testnet", T0_MS);
    assert!(panics(|| w.on_activate(Err(PromiseError::Failed))).contains("derived_public_key failed"));
}

#[test]
fn init_rejects_bad_config() {
    ctx("owner.testnet", T0_MS);
    type Mutate = Box<dyn Fn(&mut Config)>;
    let cases: Vec<(Mutate, &str)> = vec![
        (Box::new(|c| c.perf_fee_bps = 6000), "bad bps"),
        (Box::new(|c| c.max_slippage_bps = 1000), "max slippage"),
        (Box::new(|c| c.allowed_assets = vec![WNEAR.into()]), "include the base"),
        (Box::new(|c| c.oneclick_key = "nope".into()), "oneclick_key"),
        (Box::new(|c| c.attestation_key = "ed25519:1".into()), "attestation_key"),
    ];
    for (f, want) in cases {
        let mut c = cfg();
        f(&mut c);
        assert!(panics(|| Vault::new(c)).contains(want), "{want}");
    }
}

// ---------------- deposits ----------------

#[test]
fn deposit_table() {
    // (setup deposits, who, amount, expected refund, expected shares of who after)
    type Case = (&'static [(&'static str, u128)], &'static str, u128, u128, u128);
    let cases: &[Case] = &[
        (&[], "follower.testnet", 5_000_000, 5_000_000, 0),                              // leader seeds first
        (&[], "leader.testnet", 5_000_000, 0, 5_000_000),                                // seed 1:1
        (&[], "leader.testnet", 999_999, 999_999, 0),                                    // below minimum
        (&[("leader.testnet", 1_000_000)], "follower.testnet", 9_000_000, 0, 9_000_000), // exactly 10% leader
        (&[("leader.testnet", 1_000_000)], "follower.testnet", 9_000_001, 9_000_001, 0), // would drop leader below 10%
        (&[("leader.testnet", 1_000_000)], "leader.testnet", 50_000_000, 0, 51_000_000), // leader unconstrained
    ];
    for (i, (setup, who, amount, refund, after)) in cases.iter().enumerate() {
        let mut v = vault();
        for (w, a) in setup.iter() {
            assert_eq!(deposit(&mut v, w, *a, T0_MS), 0);
        }
        assert_eq!(deposit(&mut v, who, *amount, T0_MS + 1), *refund, "case {i} refund");
        assert_eq!(shares(&v, who), *after, "case {i} shares");
    }
}

#[test]
fn deposit_mints_at_last_nav_and_rejects_bad_input() {
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 2_000_000, T0_MS);
    post(&mut v, 1, 3_000_000, T0_MS + 1000); // price 1.5 → fee on 0.5 gain
    let p = v.get_vault();
    let s_before = p.total_shares.0;
    deposit(&mut v, "follower.testnet", 3_000_000, T0_MS + 2000);
    let minted = shares(&v, "follower.testnet");
    assert_eq!(minted, 3_000_000 * s_before / 3_000_000);
    assert_eq!(v.get_vault().book_nav.0, 6_000_000);
    // non-empty msg refunds
    ctx("usdc.testnet", T0_MS + 3000);
    assert!(matches!(
        v.ft_on_transfer(acc("leader.testnet"), U128(1_000_000), "x".into()),
        PromiseOrValue::Value(U128(1_000_000))
    ));
    // wrong token
    ctx("fake.testnet", T0_MS + 3000);
    assert!(panics(|| v.ft_on_transfer(acc("leader.testnet"), U128(1_000_000), String::new())).contains("only the base token"));
}

#[test]
fn deposits_freeze_when_nav_stale() {
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 2_000_000, T0_MS);
    assert_eq!(
        deposit(&mut v, "leader.testnet", 2_000_000, T0_MS + NAV_STALE_MS),
        0,
        "exactly 24h is still fresh"
    );
    assert_eq!(
        deposit(&mut v, "leader.testnet", 2_000_000, T0_MS + NAV_STALE_MS + 1),
        2_000_000,
        "stale refunds"
    );
    assert!(v.get_vault().stale);
}

// ---------------- NAV, fee, withdrawals ----------------

#[test]
fn nav_post_validation_table() {
    let head = "ab".repeat(32);
    let good = |v: &Vault, e: u64, nav: u128, ms: u64| sig_str(att_key().sign(v.nav_message(e, U128(nav), ms, "ab".repeat(32)).as_bytes()));
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 2_000_000, T0_MS);
    let t = T0_MS + 10_000;
    let cases: Vec<(&str, u64, u128, u64, String, String, &str)> = vec![
        ("op.testnet", 2, 1, t, head.clone(), good(&v, 2, 1, t), "epoch must be last + 1"),
        ("op.testnet", 1, 1, T0_MS, head.clone(), good(&v, 1, 1, T0_MS), "bad timestamp"),
        ("op.testnet", 1, 1, t + 120_000, head.clone(), good(&v, 1, 1, t + 120_000), "bad timestamp"),
        ("op.testnet", 1, 1, t, "zz".repeat(32), good(&v, 1, 1, t), "fills_head"),
        ("op.testnet", 1, 2, t, head.clone(), good(&v, 1, 1, t), "does not verify"),
        (
            "op.testnet",
            1,
            1,
            t,
            head.clone(),
            sig_str(leader_key().sign(v.nav_message(1, U128(1), t, head.clone()).as_bytes())),
            "does not verify",
        ),
        ("leader.testnet", 1, 1, t, head.clone(), good(&v, 1, 1, t), "only the operator"),
    ];
    for (who, e, nav, ms, h, sig, want) in cases {
        ctx(who, t);
        let got = panics(|| v.post_nav(e, U128(nav), ms, h.clone(), sig.clone()));
        assert!(got.contains(want), "{want}: got {got}");
    }
    ctx("op.testnet", t);
    let p = v.post_nav(1, U128(2_000_000), t, head.clone(), good(&v, 1, 2_000_000, t));
    assert_eq!((p.epoch, p.fee_shares.0, p.price.0), (1, 0, math::PRICE_SCALE));
    assert_eq!(v.get_navs(0, 10).len(), 1);
}

#[test]
fn fee_and_hwm_across_epochs() {
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 1_000_000, T0_MS);
    deposit(&mut v, "follower.testnet", 9_000_000, T0_MS);
    // epoch 1: +20% → fee on 2,000,000 gain = 400,000 value, as leader shares
    let p1 = post(&mut v, 1, 12_000_000, T0_MS + 1000);
    assert!(p1.fee_shares.0 > 0);
    let leader_value = math::payout_for_shares(shares(&v, "leader.testnet"), 12_000_000, p1.total_shares.0);
    // leader's own 10% bears 10% of the fee dilution: 1.2M − 40k + 400k
    assert!((1_559_999..=1_560_000).contains(&leader_value), "{leader_value}");
    // epoch 2: drawdown, no fee
    let p2 = post(&mut v, 2, 9_000_000, T0_MS + 2000);
    assert_eq!(p2.fee_shares.0, 0);
    // epoch 3: back to the old peak, still no fee
    let p3 = post(&mut v, 3, 12_000_000, T0_MS + 3000);
    assert_eq!(p3.fee_shares.0, 0);
    // epoch 4: new peak, fee only on the part above the HWM
    let p4 = post(&mut v, 4, 13_200_000, T0_MS + 4000);
    assert!(p4.fee_shares.0 > 0 && p4.fee_shares.0 < p1.fee_shares.0);
}

#[test]
fn withdrawal_burns_at_next_nav() {
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 1_000_000, T0_MS);
    deposit(&mut v, "follower.testnet", 4_000_000, T0_MS);
    ctx("follower.testnet", T0_MS + 10);
    let id = v.request_withdraw(U128(2_000_000), acc("follower.testnet"));
    assert_eq!(v.get_shares(acc("follower.testnet")), (U128(4_000_000), U128(2_000_000)));
    // locked shares can't be requested twice
    assert!(panics(|| v.request_withdraw(U128(2_000_001), acc("follower.testnet"))).contains("not enough free shares"));
    // NAV falls to 4,000,000 (price 0.8) → payout 1,600,000
    let p = post(&mut v, 1, 4_000_000, T0_MS + 1000);
    assert_eq!(p.withdrawn.0, 1_600_000);
    let c = &v.get_claims(0, 10)[0];
    assert_eq!((c.id, c.amount.0, c.paid.0, c.emergency), (0, 1_600_000, 0, false));
    assert_eq!(v.get_shares(acc("follower.testnet")), (U128(2_000_000), U128(0)));
    assert_eq!(v.get_vault().book_nav.0, 2_400_000);
    assert!(v.get_pending().is_empty());
    let _ = id;
}

#[test]
fn cancel_withdraw() {
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 1_000_000, T0_MS);
    deposit(&mut v, "follower.testnet", 4_000_000, T0_MS);
    ctx("follower.testnet", T0_MS);
    let id = v.request_withdraw(U128(1_000_000), acc("follower.testnet"));
    ctx("leader.testnet", T0_MS);
    assert!(panics(|| v.cancel_withdraw(id)).contains("not yours"));
    ctx("follower.testnet", T0_MS);
    v.cancel_withdraw(id);
    assert_eq!(v.get_shares(acc("follower.testnet")).1 .0, 0);
}

#[test]
fn leader_withdraw_table() {
    // (leader deposit, follower deposit, leader request, ok?)
    let cases = [
        (1_000_000u128, 9_000_000u128, 1u128, false), // already at exactly 10%
        (2_000_000, 9_000_000, 900_000, true),        // 1.1M of 10.1M ≥ 10%
        (2_000_000, 9_000_000, 1_000_000, true),      // 1.0M of 10M = exactly 10%: ok
        (5_000_000, 0, 5_000_000, true),              // leader alone may leave entirely
    ];
    for (i, (l, f, req, ok)) in cases.iter().enumerate() {
        let mut v = vault();
        deposit(&mut v, "leader.testnet", *l, T0_MS);
        if *f > 0 {
            deposit(&mut v, "follower.testnet", *f, T0_MS);
        }
        ctx("leader.testnet", T0_MS);
        let got = panics(|| v.request_withdraw(U128(*req), acc("leader.testnet")));
        assert_eq!(got == "<no panic>", *ok, "case {i}: {got}");
    }
}

// ---------------- signals ----------------

#[test]
fn signals() {
    let mut v = vault();
    let h = [42u8; 32];
    let hh = hex(&h);
    let fill = "cd".repeat(32);
    ctx("op.testnet", T0_MS);
    assert!(panics(|| v.record_signal(hh.clone(), sig_str(leader_key().sign(&h)), fill.clone(), T0_MS)).contains("no signal key"));
    ctx("follower.testnet", T0_MS);
    assert!(panics(|| v.set_signal_key(pk_str(&leader_key()))).contains("only the leader"));
    ctx("leader.testnet", T0_MS);
    v.set_signal_key(pk_str(&leader_key()));
    ctx("op.testnet", T0_MS);
    assert!(panics(|| v.record_signal(hh.clone(), sig_str(att_key().sign(&h)), fill.clone(), T0_MS)).contains("does not verify"));
    assert!(panics(|| v.record_signal("12".into(), sig_str(leader_key().sign(&h)), fill.clone(), T0_MS)).contains("32-byte hex"));
    assert_eq!(v.record_signal(hh.clone(), sig_str(leader_key().sign(&h)), fill.clone(), T0_MS), 0);
    ctx("leader.testnet", T0_MS);
    assert!(panics(|| v.record_signal(hh.clone(), sig_str(leader_key().sign(&h)), fill.clone(), T0_MS)).contains("only the operator"));
    assert_eq!(v.get_signals(0, 10)[0].hash, hh);
}

// ---------------- emergency ----------------

#[test]
fn emergency_path() {
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 2_000_000, T0_MS);
    deposit(&mut v, "follower.testnet", 8_000_000, T0_MS);
    ctx("follower.testnet", T0_MS);
    v.request_withdraw(U128(4_000_000), acc("follower-exit.testnet"));
    ctx("anyone.testnet", T0_MS + 1000);
    assert!(panics(|| v.trigger_emergency()).contains("NAV is fresh"));
    let late = T0_MS + NAV_STALE_MS + 1;
    ctx("anyone.testnet", late);
    v.trigger_emergency();
    assert!(v.get_vault().emergency);
    // pending request became an emergency claim at last NAV (price 1)
    let c0 = v.get_claims(0, 10)[0].clone();
    assert_eq!(
        (c0.amount.0, c0.emergency, c0.exit_account.as_str()),
        (4_000_000, true, "follower-exit.testnet")
    );
    // deposits refunded, normal withdrawals and NAV closed
    assert_eq!(deposit(&mut v, "leader.testnet", 1_000_000, late), 1_000_000);
    ctx("follower.testnet", late);
    assert!(panics(|| v.request_withdraw(U128(1), acc("follower.testnet"))).contains("emergency"));
    ctx("op.testnet", late);
    let m = v.nav_message(1, U128(1), late, "ab".repeat(32));
    assert!(panics(|| v.post_nav(1, U128(1), late, "ab".repeat(32), sig_str(att_key().sign(m.as_bytes())))).contains("emergency"));
    // everyone else exits pro rata at last NAV
    ctx("follower.testnet", late);
    let id = v.emergency_exit(acc("follower.testnet"));
    ctx("leader.testnet", late);
    let id2 = v.emergency_exit(acc("leader.testnet"));
    let cs = v.get_claims(0, 10);
    assert_eq!((cs[id as usize].amount.0, cs[id2 as usize].amount.0), (4_000_000, 2_000_000));
    assert_eq!(v.get_vault().total_shares.0, 0);
    ctx("nobody.testnet", late);
    assert!(panics(|| v.emergency_exit(acc("nobody.testnet"))).contains("no shares"));
}

// ---------------- sign_intent ----------------

fn payload(receiver: &str, token: &str, amount: u128, recipient: &str, deadline: &str, signer: &str) -> Nep413Payload {
    Nep413Payload {
        message: format!(
            r#"{{"deadline":"{deadline}","intents":[{{"intent":"transfer","receiver_id":"{receiver}","tokens":{{"{token}":"{amount}"}}}}],"signer_id":"{signer}"}}"#
        ),
        nonce: "Vij2xgDhEPMXAKd3B6vG5RhBVeL9AuFIA1IZaLl832U=".into(),
        recipient: recipient.into(),
    }
}

const DEP: &str = "a555635c46126bcdf9b19813816426e7cdf71d66ad9721e5bc3a6875e4cd5642";
const DL: &str = "2026-11-09T10:10:00.000Z"; // T0 + 10 min
const QDL: &str = "2026-11-09T10:20:00.000Z";

fn trade_quote(over: &[(&str, Value)]) -> SignedQuote {
    let v = vault_acct();
    let mut base: Vec<(&str, Value)> = vec![("recipient", json!(v)), ("refundTo", json!(v)), ("deadline", json!(QDL))];
    base.extend(over.iter().cloned());
    sign_like_oneclick(&qmsg(&base), &test_key())
}

fn sign(v: &mut Vault, who: &str, kind: SignKind, p: Nep413Payload, q: Option<SignedQuote>) -> String {
    ctx(who, T0_MS);
    panics(|| v.sign_intent(kind, p, q))
}

#[test]
fn sign_trade_table() {
    let va = vault_acct();
    let good = || payload(DEP, &imt(USDC), 1_000_000, "intents.far", DL, &vault_acct());
    type Case = (&'static str, Box<dyn Fn() -> Nep413Payload>, Vec<(&'static str, Value)>, &'static str);
    let cases: Vec<Case> = vec![
        ("op.testnet", Box::new(good), vec![], "<no panic>"),
        ("leader.testnet", Box::new(good), vec![], "only the operator"),
        ("op.testnet", Box::new(good), vec![("slippageTolerance", json!(101))], "slippage above max"),
        (
            "op.testnet",
            Box::new(good),
            vec![("recipient", json!("thief.near"))],
            "pay and refund the vault",
        ),
        (
            "op.testnet",
            Box::new(good),
            vec![("refundTo", json!("thief.near"))],
            "pay and refund the vault",
        ),
        (
            "op.testnet",
            Box::new(good),
            vec![("destinationAsset", json!("nep141:scam.near"))],
            "asset not allowed",
        ),
        (
            "op.testnet",
            Box::new(good),
            vec![("recipientType", json!("INTENTS"))],
            "not a confidential trade",
        ),
        ("op.testnet", Box::new(good), vec![("dry", json!(true))], "Dry"),
        ("op.testnet", Box::new(good), vec![("depositAddress", json!("b".repeat(64)))], "deposit address"),
        (
            "op.testnet",
            Box::new(good),
            vec![("deadline", json!("2026-11-09T10:05:00.000Z"))],
            "outlives the quote",
        ),
        (
            "op.testnet",
            Box::new(|| payload(DEP, &imt(USDC), 999_999, "intents.far", DL, &vault_acct())),
            vec![],
            "amountIn",
        ),
        (
            "op.testnet",
            Box::new(|| payload(DEP, USDC, 1_000_000, "intents.far", DL, &vault_acct())),
            vec![],
            "origin asset",
        ),
        (
            "op.testnet",
            Box::new(|| payload(DEP, &imt(USDC), 1_000_000, "intents.near", DL, &vault_acct())),
            vec![],
            "depositType",
        ),
        (
            "op.testnet",
            Box::new(|| payload(DEP, &imt(USDC), 1_000_000, "intents.far", DL, "someone")),
            vec![],
            "signer is not the vault",
        ),
        (
            "op.testnet",
            Box::new(|| payload(DEP, &imt(USDC), 1_000_000, "intents.far", "2026-11-09T09:59:00.000Z", &vault_acct())),
            vec![],
            "deadline out of window",
        ),
        (
            "op.testnet",
            Box::new(|| payload(DEP, &imt(USDC), 1_000_000, "intents.far", "2026-11-09T11:00:01.000Z", &vault_acct())),
            vec![],
            "deadline out of window",
        ),
    ];
    for (who, p, over, want) in cases {
        let mut v = vault();
        let got = sign(&mut v, who, SignKind::Trade, p(), Some(trade_quote(&over)));
        assert!(got.contains(want), "{want}: got {got}");
    }
    // forged quote (not 1Click's key)
    let mut v = vault();
    let forged = sign_like_oneclick(
        &qmsg(&[("recipient", json!(va)), ("refundTo", json!(va)), ("deadline", json!(QDL))]),
        &leader_key(),
    );
    assert!(sign(&mut v, "op.testnet", SignKind::Trade, good(), Some(forged)).contains("BadSignature"));
    // no quote
    assert!(sign(&mut v, "op.testnet", SignKind::Trade, good(), None).contains("quote required"));
}

#[test]
fn sign_shield_and_login() {
    let va = vault_acct();
    let shield_q = |over: &[(&str, Value)]| {
        let mut b: Vec<(&str, Value)> = vec![
            ("recipient", json!(va)),
            ("refundTo", json!(va)),
            ("deadline", json!(QDL)),
            ("depositType", json!("INTENTS")),
            ("recipientType", json!("CONFIDENTIAL_INTENTS")),
            ("refundType", json!("INTENTS")),
            ("originAsset", json!(USDC)),
            ("destinationAsset", json!(USDC)),
        ];
        b.extend(over.iter().cloned());
        sign_like_oneclick(&qmsg(&b), &test_key())
    };
    let p = payload(DEP, USDC, 1_000_000, "intents.near", DL, &va);
    let mut v = vault();
    assert_eq!(sign(&mut v, "op.testnet", SignKind::Shield, p.clone(), Some(shield_q(&[]))), "<no panic>");
    assert!(sign(
        &mut v,
        "op.testnet",
        SignKind::Shield,
        p.clone(),
        Some(shield_q(&[("destinationAsset", json!(WNEAR))]))
    )
    .contains("keep the asset"));
    assert!(sign(
        &mut v,
        "op.testnet",
        SignKind::Shield,
        p.clone(),
        Some(shield_q(&[("recipient", json!("x.near"))]))
    )
    .contains("pay and refund the vault"));
    // a shield quote can't be signed as a trade and vice versa
    assert!(sign(&mut v, "op.testnet", SignKind::Trade, p.clone(), Some(shield_q(&[]))).contains("not a confidential trade"));
    // login
    let login = Nep413Payload {
        message: format!(r#"{{"deadline":"{DL}","intents":[],"signer_id":"{va}"}}"#),
        nonce: p.nonce.clone(),
        recipient: "intents.near".into(),
    };
    assert_eq!(sign(&mut v, "op.testnet", SignKind::Login, login.clone(), None), "<no panic>");
    assert!(sign(&mut v, "leader.testnet", SignKind::Login, login.clone(), None).contains("only the operator"));
    assert!(sign(
        &mut v,
        "op.testnet",
        SignKind::Login,
        Nep413Payload {
            recipient: "intents.far".into(),
            ..login.clone()
        },
        None
    )
    .contains("public intents contract"));
    assert!(sign(&mut v, "op.testnet", SignKind::Shield, login.clone(), None).contains("disagree"));
    assert!(sign(&mut v, "op.testnet", SignKind::Login, p.clone(), None).contains("disagree"));
}

fn vault_with_claim(amount: u128, emergency: bool) -> Vault {
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 2_000_000, T0_MS - 1);
    deposit(&mut v, "follower.testnet", 8_000_000, T0_MS - 1);
    ctx("follower.testnet", T0_MS - 1);
    v.request_withdraw(U128(amount), acc("exit.testnet"));
    if emergency {
        // fake staleness by moving last_nav back
        v.last_nav_ms = T0_MS - NAV_STALE_MS - 10;
        ctx("anyone.testnet", T0_MS);
        v.trigger_emergency();
    } else {
        post(&mut v, 1, 10_000_000, T0_MS + 1);
    }
    v
}

fn payout_q(over: &[(&str, Value)]) -> SignedQuote {
    let va = vault_acct();
    let mut b: Vec<(&str, Value)> = vec![
        ("recipient", json!("exit.testnet")),
        ("refundTo", json!(va)),
        ("deadline", json!(QDL)),
        ("depositType", json!("CONFIDENTIAL_INTENTS")),
        ("recipientType", json!("INTENTS")),
        ("refundType", json!("CONFIDENTIAL_INTENTS")),
        ("originAsset", json!(USDC)),
        ("destinationAsset", json!(USDC)),
    ];
    b.extend(over.iter().cloned());
    sign_like_oneclick(&qmsg(&b), &test_key())
}

#[test]
fn sign_payout_table() {
    let p = |amt: u128| payload(DEP, &imt(USDC), amt, "intents.far", DL, &vault_acct());
    let amt = |a: u128| vec![("amount", json!(a.to_string())), ("amountIn", json!(a.to_string()))];
    type Case = (bool, &'static str, u128, Vec<(&'static str, Value)>, &'static str);
    let cases: Vec<Case> = vec![
        (false, "op.testnet", 1_000_000, vec![], "<no panic>"),
        (false, "anyone.testnet", 1_000_000, vec![], "only the operator"),
        (true, "anyone.testnet", 1_000_000, vec![], "<no panic>"), // emergency: permissionless
        (false, "op.testnet", 1_000_000, vec![("recipient", json!("thief.near"))], "exit account"),
        (false, "op.testnet", 1_000_000, vec![("refundTo", json!("thief.near"))], "refund the vault"),
        (false, "op.testnet", 1_000_000, vec![("destinationAsset", json!(WNEAR))], "base asset"),
        (
            false,
            "op.testnet",
            1_000_000,
            vec![("recipientType", json!("CONFIDENTIAL_INTENTS"))],
            "unshield",
        ),
        (false, "op.testnet", 4_000_001, amt(4_000_001), "exceeds the claim"),
        (false, "op.testnet", 4_000_000, amt(4_000_000), "<no panic>"),
    ];
    for (i, (emergency, who, a, over, want)) in cases.into_iter().enumerate() {
        let mut v = vault_with_claim(4_000_000, emergency);
        let mut o = amt(a);
        o.extend(over);
        let got = sign(&mut v, who, SignKind::Payout { claim_id: 0 }, p(a), Some(payout_q(&o)));
        assert!(got.contains(want), "case {i} {want}: got {got}");
    }
}

#[test]
fn payout_reservation_signing_and_settlement() {
    let mut v = vault_with_claim(4_000_000, false);
    let p = |amt: u128, nonce: &str| Nep413Payload {
        nonce: nonce.into(),
        ..payload(DEP, &imt(USDC), amt, "intents.far", DL, &vault_acct())
    };
    let q = |a: u128| payout_q(&[("amount", json!(a.to_string())), ("amountIn", json!(a.to_string()))]);
    let n1 = "Vij2xgDhEPMXAKd3B6vG5RhBVeL9AuFIA1IZaLl832U=";
    let n2 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    ctx("op.testnet", T0_MS);
    let _ = v.sign_intent(SignKind::Payout { claim_id: 0 }, p(3_000_000, n1), Some(q(3_000_000)));
    // reservation blocks overspending while in flight
    assert!(panics(|| v.sign_intent(SignKind::Payout { claim_id: 0 }, p(1_000_001, n2), Some(q(1_000_001)))).contains("exceeds the claim"));
    let c = v.get_claims(0, 1)[0].clone();
    let pre1 = c.in_flight[0].prehash.clone();
    // MPC returns a valid signature from the vault key
    let h = unhex32(&pre1).unwrap();
    let sig = mpc_key().sign(&h).to_bytes().to_vec();
    ctx("vault.testnet", T0_MS);
    let out = v.on_signed(
        pre1.clone(),
        Some((0, U128(3_000_000), U64(0))),
        Ok(json!({"scheme": "Ed25519", "signature": sig})),
    );
    assert!(out.unwrap().starts_with("ed25519:"));
    assert!(v.get_claims(0, 1)[0].in_flight[0].signed);
    // a second payout: MPC returns a wrong signature → released, returns None
    ctx("op.testnet", T0_MS);
    let _ = v.sign_intent(SignKind::Payout { claim_id: 0 }, p(1_000_000, n2), Some(q(1_000_000)));
    let pre2 = v.get_claims(0, 1)[0].in_flight[1].prehash.clone();
    ctx("vault.testnet", T0_MS);
    let bad = att_key().sign(&unhex32(&pre2).unwrap()).to_bytes().to_vec();
    assert_eq!(
        v.on_signed(
            pre2.clone(),
            Some((0, U128(1_000_000), U64(0))),
            Ok(json!({"scheme": "Ed25519", "signature": bad}))
        ),
        None
    );
    assert_eq!(v.get_claims(0, 1)[0].in_flight.len(), 1);
    // MPC failure also releases
    ctx("op.testnet", T0_MS);
    let _ = v.sign_intent(SignKind::Payout { claim_id: 0 }, p(1_000_000, n2), Some(q(1_000_000)));
    ctx("vault.testnet", T0_MS);
    assert_eq!(v.on_signed(pre2.clone(), Some((0, U128(1_000_000), U64(0))), Err(PromiseError::Failed)), None);
    assert_eq!(v.get_claims(0, 1)[0].in_flight.len(), 1);
    // settlement: can't release before the deadline, can confirm anytime
    ctx("op.testnet", T0_MS);
    assert!(panics(|| v.settle_payout(0, pre1.clone(), false)).contains("deadline not passed"));
    ctx("anyone.testnet", T0_MS);
    assert!(panics(|| v.settle_payout(0, pre1.clone(), true)).contains("only the operator"));
    ctx("op.testnet", T0_MS);
    v.settle_payout(0, pre1.clone(), true);
    let c = v.get_claims(0, 1)[0].clone();
    assert_eq!((c.paid.0, c.in_flight.len()), (3_000_000, 0));
    // released after deadline frees the amount again
    let _ = v.sign_intent(SignKind::Payout { claim_id: 0 }, p(1_000_000, n2), Some(q(1_000_000)));
    let pre3 = v.get_claims(0, 1)[0].in_flight[0].prehash.clone();
    ctx("op.testnet", T0_MS + 11 * 60_000);
    v.settle_payout(0, pre3, false);
    assert_eq!(v.get_claims(0, 1)[0].in_flight.len(), 0);
}

#[test]
fn emergency_trades_unwind_only() {
    let mut v = vault_with_claim(1_000_000, true);
    let p = payload(DEP, &imt(USDC), 1_000_000, "intents.far", DL, &vault_acct());
    // USDC → wNEAR is not an unwind
    assert!(sign(&mut v, "anyone.testnet", SignKind::Trade, p.clone(), Some(trade_quote(&[]))).contains("unwind"));
    let p2 = payload(DEP, &imt(WNEAR), 1_000_000, "intents.far", DL, &vault_acct());
    assert_eq!(
        sign(
            &mut v,
            "anyone.testnet",
            SignKind::Trade,
            p2,
            Some(trade_quote(&[("originAsset", json!(WNEAR)), ("destinationAsset", json!(USDC))]))
        ),
        "<no panic>"
    );
}

#[test]
fn public_verifier_follows_intents_contract() {
    ctx("owner.testnet", T0_MS);
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let mut c = cfg();
    c.intents_contract = Some(acc("defuse.testnet"));
    let mut v = Vault::new(c);
    ctx("vault.testnet", T0_MS);
    v.on_activate(Ok(pk_str(&mpc_key())));
    let va = vault_acct();
    let q = sign_like_oneclick(
        &qmsg(&[
            ("recipient", json!(va)),
            ("refundTo", json!(va)),
            ("deadline", json!(QDL)),
            ("depositType", json!("INTENTS")),
            ("recipientType", json!("CONFIDENTIAL_INTENTS")),
            ("refundType", json!("INTENTS")),
            ("originAsset", json!(USDC)),
            ("destinationAsset", json!(USDC)),
        ]),
        &test_key(),
    );
    let ok = payload(DEP, USDC, 1_000_000, "defuse.testnet", DL, &va);
    assert_eq!(sign(&mut v, "op.testnet", SignKind::Shield, ok, Some(q.clone())), "<no panic>");
    let wrong = payload(DEP, USDC, 1_000_000, "intents.near", DL, &va);
    assert!(sign(&mut v, "op.testnet", SignKind::Shield, wrong, Some(q)).contains("does not match depositType"));
    let login = Nep413Payload {
        message: format!(r#"{{"deadline":"{DL}","intents":[],"signer_id":"{va}"}}"#),
        nonce: "Vij2xgDhEPMXAKd3B6vG5RhBVeL9AuFIA1IZaLl832U=".into(),
        recipient: "defuse.testnet".into(),
    };
    assert_eq!(sign(&mut v, "op.testnet", SignKind::Login, login, None), "<no panic>");
}

// ---------------- public-leg payouts and cost basis ----------------

#[test]
fn public_payout_table() {
    let va = vault_acct();
    let p = |to: &str, token: &str, amt: u128, recipient: &str| payload(to, token, amt, recipient, DL, &va);
    type Case = (bool, &'static str, Nep413Payload, Option<SignedQuote>, &'static str);
    let cases: Vec<Case> = vec![
        (false, "op.testnet", p("exit.testnet", USDC, 4_000_000, "intents.near"), None, "<no panic>"),
        (
            false,
            "anyone.testnet",
            p("exit.testnet", USDC, 1_000_000, "intents.near"),
            None,
            "only the operator",
        ),
        (true, "anyone.testnet", p("exit.testnet", USDC, 1_000_000, "intents.near"), None, "<no panic>"),
        (
            true,
            "anyone.testnet",
            p("thief.testnet", USDC, 1_000_000, "intents.near"),
            None,
            "exit account",
        ),
        (true, "anyone.testnet", p("exit.testnet", WNEAR, 1_000_000, "intents.near"), None, "base asset"),
        (
            true,
            "anyone.testnet",
            p("exit.testnet", &imt(USDC), 1_000_000, "intents.near"),
            None,
            "base asset",
        ),
        (
            true,
            "anyone.testnet",
            p("exit.testnet", USDC, 1_000_000, "intents.far"),
            None,
            "public intents contract",
        ),
        (
            true,
            "anyone.testnet",
            p("exit.testnet", USDC, 4_000_001, "intents.near"),
            None,
            "exceeds the claim",
        ),
        (
            true,
            "anyone.testnet",
            p("exit.testnet", USDC, 1, "intents.near"),
            Some(payout_q(&[])),
            "takes no quote",
        ),
    ];
    for (i, (emergency, who, pl, q, want)) in cases.into_iter().enumerate() {
        let mut v = vault_with_claim(4_000_000, emergency);
        let got = sign(&mut v, who, SignKind::PublicPayout { claim_id: 0 }, pl, q);
        assert!(got.contains(want), "case {i} {want}: got {got}");
    }
}

#[test]
fn public_payout_reserves_and_claimant_confirms_in_emergency() {
    let mut v = vault_with_claim(4_000_000, true);
    let pl = payload("exit.testnet", USDC, 4_000_000, "intents.near", DL, &vault_acct());
    ctx("anyone.testnet", T0_MS);
    let _ = v.sign_intent(SignKind::PublicPayout { claim_id: 0 }, pl.clone(), None);
    // fully reserved: a second one is refused
    assert!(panics(|| v.sign_intent(SignKind::PublicPayout { claim_id: 0 }, pl.clone(), None)).contains("exceeds the claim"));
    let pre = v.get_claims(0, 1)[0].in_flight[0].prehash.clone();
    // a stranger can't settle; the claimant can confirm but not release
    ctx("anyone.testnet", T0_MS);
    assert!(panics(|| v.settle_payout(0, pre.clone(), true)).contains("only the operator"));
    ctx("follower.testnet", T0_MS + 2 * MAX_INTENT_AHEAD_MS);
    assert!(panics(|| v.settle_payout(0, pre.clone(), false)).contains("only the operator"));
    v.settle_payout(0, pre, true);
    let c = v.get_claims(0, 1)[0].clone();
    assert_eq!((c.paid.0, c.in_flight.len()), (4_000_000, 0));
}

#[test]
fn position_tracks_cost_basis() {
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 2_000_000, T0_MS);
    deposit(&mut v, "follower.testnet", 8_000_000, T0_MS);
    ctx("follower.testnet", T0_MS);
    v.request_withdraw(U128(4_000_000), acc("exit.testnet"));
    post(&mut v, 1, 11_000_000, T0_MS + 1); // +10%, fee to the leader, then the burn
    let p = v.get_position(acc("follower.testnet"));
    let c = v.get_claims(0, 1)[0].clone();
    assert_eq!(p.deposited.0, 8_000_000);
    assert_eq!(p.claimed, c.amount);
    assert_eq!(p.shares.0, 4_000_000);
    let price = v.get_vault().price.0;
    let value = p.shares.0 * price / math::PRICE_SCALE;
    // follower gained ~8% net of the 20% fee on 10%
    let pnl = (value + p.claimed.0) as i128 - p.deposited.0 as i128;
    assert!(pnl > 600_000 && pnl < 700_000, "pnl {pnl}");
    assert_eq!(v.get_position(acc("nobody.testnet")).deposited.0, 0);
}

#[test]
fn leader_locked_shares_do_not_count_toward_the_stake() {
    // Found by prop_tests: the leader, alone, locks shares for withdrawal; a
    // follower deposit sized against the leader's *total* balance would leave
    // the leader under 10% once the locked shares burn at the next NAV.
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 10_000_000, T0_MS);
    ctx("leader.testnet", T0_MS);
    v.request_withdraw(U128(4_000_000), acc("leader.testnet")); // last holder: allowed
                                                                // 6M free leader shares → at most 54M of follower deposits keep 10%
    assert_eq!(deposit(&mut v, "follower.testnet", 60_000_000, T0_MS), 60_000_000, "refunded");
    assert_eq!(deposit(&mut v, "follower.testnet", 54_000_000, T0_MS), 0);
    let nav = v.book_nav;
    post(&mut v, 1, nav, T0_MS + 1);
    assert!(math::leader_ok(shares(&v, "leader.testnet"), v.total_shares, 1000));
    // and a follower's pending withdrawal doesn't let the leader withdraw past the minimum:
    ctx("follower.testnet", T0_MS + 2);
    let r = v.request_withdraw(U128(27_000_000), acc("follower.testnet"));
    ctx("leader.testnet", T0_MS + 2);
    assert!(panics(|| v.request_withdraw(U128(1_000_000), acc("leader.testnet"))).contains("below minimum"));
    ctx("follower.testnet", T0_MS + 2);
    v.cancel_withdraw(r);
    assert!(math::leader_ok(shares(&v, "leader.testnet"), v.total_shares, 1000));
}
