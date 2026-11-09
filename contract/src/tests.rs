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
pub(crate) fn leader_key() -> SigningKey {
    SigningKey::from_bytes(&[5u8; 32])
}
pub(crate) fn mpc_key() -> SigningKey {
    SigningKey::from_bytes(&[11u8; 32])
}
pub(crate) fn pk_str(k: &SigningKey) -> String {
    format!("ed25519:{}", near_sdk::bs58::encode(k.verifying_key().to_bytes()).into_string())
}
pub(crate) fn sig_str(sig: ed25519_dalek::Signature) -> String {
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
        nav_oracle: None,
        nav_quotes: None,
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
    posted(v.post_nav(epoch, U128(nav), ms, head, sig_str(att_key().sign(m.as_bytes())), None))
}

/// The NavPost of a post applied without an oracle (no promise).
pub(crate) fn posted(r: PromiseOrValue<Option<NavPost>>) -> NavPost {
    match r {
        PromiseOrValue::Value(Some(p)) => p,
        _ => panic!("post was not applied synchronously"),
    }
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
        let got = panics(|| v.post_nav(e, U128(nav), ms, h.clone(), sig.clone(), None));
        assert!(got.contains(want), "{want}: got {got}");
    }
    ctx("op.testnet", t);
    let p = posted(v.post_nav(1, U128(2_000_000), t, head.clone(), good(&v, 1, 2_000_000, t), None));
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
fn withdrawal_is_priced_at_one_nav_and_burned_at_the_lower_of_two() {
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 1_000_000, T0_MS);
    deposit(&mut v, "follower.testnet", 4_000_000, T0_MS);
    ctx("follower.testnet", T0_MS + 10);
    v.request_withdraw(U128(2_000_000), acc("follower.testnet"));
    assert_eq!(v.get_shares(acc("follower.testnet")), (U128(4_000_000), U128(2_000_000)));
    assert!(panics(|| v.request_withdraw(U128(2_000_001), acc("follower.testnet"))).contains("not enough free shares"));
    // post 1: NAV flat at 5,000,000 (price 1.0): priced, nothing burned yet, no longer cancellable
    let p1 = post(&mut v, 1, 5_000_000, T0_MS + 1000);
    assert_eq!(p1.withdrawn.0, 0);
    assert!(v.get_claims(0, 10).is_empty() && v.get_pending().is_empty());
    let m = v.get_maturing();
    assert_eq!((m.len(), m[0].priced_epoch, m[0].priced_at.0), (1, 1, p1.price.0));
    ctx("follower.testnet", T0_MS + 1001);
    assert!(panics(|| v.cancel_withdraw(0)).contains("no such request"));
    // post 2: NAV falls to 4,000,000 (price 0.8) → burned at min(1.0, 0.8) = 0.8 → 1,600,000
    let p2 = post(&mut v, 2, 4_000_000, T0_MS + 2000);
    assert_eq!(p2.withdrawn.0, 1_600_000);
    let c = &v.get_claims(0, 10)[0];
    assert_eq!((c.amount.0, c.epoch), (1_600_000, 2));
    assert_eq!(v.get_shares(acc("follower.testnet")), (U128(2_000_000), U128(0)));
    assert_eq!(v.get_vault().book_nav.0, 2_400_000);
    // the other way: priced low, NAV jumps → still the lower (priced) price
    ctx("follower.testnet", T0_MS + 2001);
    v.request_withdraw(U128(2_000_000), acc("follower.testnet")); // everything left
    let p3 = post(&mut v, 3, 4_000_000, T0_MS + 3000); // priced at 0.8 (pre-fee; no fee below HWM)
    post(&mut v, 4, 8_000_000, T0_MS + 4000); // price would be 1.6
    let c = &v.get_claims(0, 10)[1];
    assert_eq!(c.amount.0, 2_000_000 * p3.price.0 / math::PRICE_SCALE);
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
        (20_000_000, 90_000_000, 9_000_000, true),    // 11M of 101M ≥ 10%
        (20_000_000, 90_000_000, 10_000_000, true),   // 10M of 100M = exactly 10%: ok
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
    assert!(panics(|| v.trigger_emergency(None)).contains("NAV is fresh and no claim is overdue"));
    let late = T0_MS + NAV_STALE_MS + 1;
    ctx("anyone.testnet", late);
    v.trigger_emergency(None);
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
    assert!(panics(|| v.post_nav(1, U128(1), late, "ab".repeat(32), sig_str(att_key().sign(m.as_bytes())), None)).contains("emergency"));
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
        nonce: N1.into(),
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
        message: format!(r#"{{"deadline":"2026-11-09T10:04:00.000Z","intents":[],"signer_id":"{va}"}}"#),
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
        v.trigger_emergency(None);
    } else {
        post(&mut v, 1, 10_000_000, T0_MS + 1); // priced
        post(&mut v, 2, 10_000_000, T0_MS + 2); // burned: claim opens
    }
    v
}

#[test]
fn sign_unshield_table() {
    let p = |amt: u128| payload(DEP, &imt(USDC), amt, "intents.far", DL, &vault_acct());
    let va = vault_acct();
    let q = |over: &[(&str, Value)]| {
        let mut b: Vec<(&str, Value)> = vec![
            ("recipient", json!(va)),
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
    };
    type Case = (bool, &'static str, Vec<(&'static str, Value)>, &'static str);
    let cases: Vec<Case> = vec![
        (false, "op.testnet", vec![], "<no panic>"),
        (false, "anyone.testnet", vec![], "only the operator"),
        (true, "anyone.testnet", vec![], "<no panic>"), // emergency: back into the vault, so anyone
        (false, "op.testnet", vec![("recipient", json!("exit.testnet"))], "pay and refund the vault"),
        (false, "op.testnet", vec![("refundTo", json!("thief.near"))], "pay and refund the vault"),
        (false, "op.testnet", vec![("destinationAsset", json!(WNEAR))], "keep the asset"),
        (
            false,
            "op.testnet",
            vec![("recipientType", json!("CONFIDENTIAL_INTENTS"))],
            "not an unshield quote",
        ),
        (false, "op.testnet", vec![("customRecipientMsg", json!("x"))], "customRecipientMsg"),
        (false, "op.testnet", vec![("appFees", json!([{"recipient": "x", "fee": 100}]))], "appFees"),
    ];
    for (i, (emergency, who, over, want)) in cases.into_iter().enumerate() {
        let mut v = vault_with_claim(4_000_000, emergency);
        let got = sign(&mut v, who, SignKind::Unshield, p(1_000_000), Some(q(&over)));
        assert!(got.contains(want), "case {i} {want}: got {got}");
    }
    // one quote pays one transfer
    let mut v = vault_with_claim(4_000_000, false);
    assert_eq!(sign(&mut v, "op.testnet", SignKind::Unshield, p(1_000_000), Some(q(&[]))), "<no panic>");
    let p2 = Nep413Payload {
        nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".into(),
        ..p(1_000_000)
    };
    assert!(sign(&mut v, "op.testnet", SignKind::Unshield, p2, Some(q(&[]))).contains("quote already used"));
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
        message: format!(r#"{{"deadline":"2026-11-09T10:04:00.000Z","intents":[],"signer_id":"{va}"}}"#),
        nonce: "Vij2xgDhEPMXAKd3B6vG5RhBVeL9AuFIA1IZaLl832U=".into(),
        recipient: "defuse.testnet".into(),
    };
    assert_eq!(sign(&mut v, "op.testnet", SignKind::Login, login, None), "<no panic>");
}

// ---------------- public-leg payouts and cost basis ----------------

fn ppl(amt: u128, nonce: &str) -> Nep413Payload {
    Nep413Payload {
        nonce: nonce.into(),
        ..payload("exit.testnet", USDC, amt, "intents.near", DL, &vault_acct())
    }
}
// Plain (legacy) nonces. (The defuse test-vector nonce happens to be a versioned one.)
const N1: &str = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const N2: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

#[test]
fn public_payout_table() {
    let va = vault_acct();
    let p = |to: &str, token: &str, amt: u128, recipient: &str| payload(to, token, amt, recipient, DL, &va);
    // a versioned nonce: magic prefix 56 28 f6 c6
    let versioned = {
        use near_sdk::base64::Engine;
        let mut n = [0u8; 32];
        n[..4].copy_from_slice(&VERSIONED_NONCE_PREFIX);
        near_sdk::base64::engine::general_purpose::STANDARD.encode(n)
    };
    type Case = (bool, &'static str, Nep413Payload, Option<SignedQuote>, &'static str);
    let cases: Vec<Case> = vec![
        (false, "op.testnet", p("exit.testnet", USDC, 4_000_000, "intents.near"), None, "<no panic>"),
        (
            false,
            "follower.testnet",
            p("exit.testnet", USDC, 1_000_000, "intents.near"),
            None,
            "only the operator",
        ),
        (true, "follower.testnet", p("exit.testnet", USDC, 1_000_000, "intents.near"), None, "<no panic>"), // claimant, in emergency
        (
            true,
            "anyone.testnet",
            p("exit.testnet", USDC, 1_000_000, "intents.near"),
            None,
            "only the operator",
        ), // not the claimant
        (
            true,
            "follower.testnet",
            p("thief.testnet", USDC, 1_000_000, "intents.near"),
            None,
            "exit account",
        ),
        (
            true,
            "follower.testnet",
            p("exit.testnet", WNEAR, 1_000_000, "intents.near"),
            None,
            "base asset",
        ),
        (
            true,
            "follower.testnet",
            p("exit.testnet", &imt(USDC), 1_000_000, "intents.near"),
            None,
            "base asset",
        ),
        (
            true,
            "follower.testnet",
            p("exit.testnet", USDC, 1_000_000, "intents.far"),
            None,
            "public intents contract",
        ),
        (
            true,
            "follower.testnet",
            p("exit.testnet", USDC, 4_000_001, "intents.near"),
            None,
            "exceeds the claim",
        ),
        (
            true,
            "follower.testnet",
            p("exit.testnet", USDC, 1, "intents.near"),
            Some(trade_quote(&[])),
            "takes no quote",
        ),
        (
            false,
            "op.testnet",
            payload("exit.testnet", USDC, 1, "intents.near", "2026-11-09T10:04:00.000Z", &va),
            None,
            "deadline too soon",
        ),
        (
            false,
            "op.testnet",
            Nep413Payload {
                nonce: versioned,
                ..p("exit.testnet", USDC, 1, "intents.near")
            },
            None,
            "plain nonce",
        ),
    ];
    for (i, (emergency, who, pl, q, want)) in cases.into_iter().enumerate() {
        let mut v = vault_with_claim(4_000_000, emergency);
        let got = sign(&mut v, who, SignKind::PublicPayout { claim_id: 0 }, pl, q);
        assert!(got.contains(want), "case {i} {want}: got {got}");
    }
}

/// Settlement is decided by the verifier's nonce record, never by anyone's word:
/// an executed payout can't be released and paid again (the review's critical finding).
#[test]
fn payout_settles_against_the_verifier_nonce_record() {
    let mut v = vault_with_claim(4_000_000, false);
    ctx("op.testnet", T0_MS);
    let _ = v.sign_intent(SignKind::PublicPayout { claim_id: 0 }, ppl(3_000_000, N1), None);
    // reservation blocks overspending, and the same payload can't be reserved twice
    assert!(panics(|| v.sign_intent(SignKind::PublicPayout { claim_id: 0 }, ppl(1_000_001, N2), None)).contains("exceeds the claim"));
    assert!(panics(|| v.sign_intent(SignKind::PublicPayout { claim_id: 0 }, ppl(3_000_000, N1), None)).contains("exceeds the claim"));
    let f = v.get_claims(0, 1)[0].in_flight[0].clone();
    assert_eq!(f.nonce, N1);
    // MPC signs
    let sig = mpc_key().sign(&unhex32(&f.prehash).unwrap()).to_bytes().to_vec();
    ctx("vault.testnet", T0_MS);
    assert!(v
        .on_signed(f.prehash.clone(), Some((0, U128(3_000_000), U64(0))), true, Ok(json!({"signature": sig})))
        .unwrap()
        .starts_with("ed25519:"));
    // settle: anyone may ask; only the verifier's answer counts
    ctx("anyone.testnet", T0_MS);
    let _ = v.settle_payout(0, f.prehash.clone());
    ctx("vault.testnet", T0_MS);
    assert_eq!(v.on_settle(0, f.prehash.clone(), Ok(false)), "pending"); // not used, deadline not passed
    assert_eq!(v.on_settle(0, f.prehash.clone(), Err(PromiseError::Failed)), "verifier unavailable");
    // executed (nonce used): paid, even after the deadline — it can never be released
    ctx("vault.testnet", T0_MS + 11 * 60_000);
    assert_eq!(v.on_settle(0, f.prehash.clone(), Ok(true)), "paid");
    let c = v.get_claims(0, 1)[0].clone();
    assert_eq!((c.paid.0, c.in_flight.len()), (3_000_000, 0));
    // a payload that never executed is released after its deadline, and the amount is open again
    ctx("op.testnet", T0_MS);
    let _ = v.sign_intent(SignKind::PublicPayout { claim_id: 0 }, ppl(1_000_000, N2), None);
    let pre = v.get_claims(0, 1)[0].in_flight[0].prehash.clone();
    ctx("vault.testnet", T0_MS + 11 * 60_000);
    assert_eq!(v.on_settle(0, pre.clone(), Ok(false)), "released");
    assert_eq!(v.on_settle(0, pre, Ok(true)), "already settled");
    assert_eq!(open_of(&v.get_claims(0, 1)[0]), 1_000_000);
}

#[test]
fn failed_sign_removes_only_its_own_reservation() {
    let mut v = vault_with_claim(4_000_000, false);
    ctx("op.testnet", T0_MS);
    let _ = v.sign_intent(SignKind::PublicPayout { claim_id: 0 }, ppl(1_000_000, N1), None);
    let _ = v.sign_intent(SignKind::PublicPayout { claim_id: 0 }, ppl(1_000_000, N2), None);
    let fs = v.get_claims(0, 1)[0].in_flight.clone();
    ctx("vault.testnet", T0_MS);
    let sig = mpc_key().sign(&unhex32(&fs[0].prehash).unwrap()).to_bytes().to_vec();
    v.on_signed(fs[0].prehash.clone(), Some((0, U128(1_000_000), U64(0))), true, Ok(json!({"signature": sig})));
    assert_eq!(
        v.on_signed(fs[1].prehash.clone(), Some((0, U128(1_000_000), U64(0))), true, Err(PromiseError::Failed)),
        None
    );
    // a late failure for the first (already signed) payload must not drop it
    assert_eq!(
        v.on_signed(fs[0].prehash.clone(), Some((0, U128(1_000_000), U64(0))), true, Err(PromiseError::Failed)),
        None
    );
    let left = v.get_claims(0, 1)[0].in_flight.clone();
    assert_eq!(left.len(), 1);
    assert!(left[0].signed && left[0].prehash == fs[0].prehash);
}

/// An operator that keeps posting NAV but never pays a claim can't censor it:
/// after the grace period anyone triggers emergency and the claimant pays themselves.
#[test]
fn overdue_claim_opens_emergency() {
    let mut v = vault_with_claim(4_000_000, false);
    let opened = v.get_claims(0, 1)[0].opened_ms;
    ctx("anyone.testnet", opened + CLAIM_GRACE_MS);
    assert!(panics(|| v.trigger_emergency(Some(0))).contains("no claim is overdue"));
    // NAV is kept fresh
    v.last_nav_ms = opened + CLAIM_GRACE_MS;
    ctx("anyone.testnet", opened + CLAIM_GRACE_MS + 1);
    v.trigger_emergency(Some(0));
    assert!(v.emergency);
    // the (non-emergency) claim is now payable by its claimant
    let d = "2026-11-10T10:10:00.000Z";
    let pl = payload("exit.testnet", USDC, 4_000_000, "intents.near", d, &vault_acct());
    ctx("follower.testnet", parse_ms(d) - 10 * 60_000);
    let _ = v.sign_intent(SignKind::PublicPayout { claim_id: 0 }, pl, None);
    assert_eq!(v.get_claims(0, 1)[0].in_flight.len(), 1);
}

fn parse_ms(iso: &str) -> u64 {
    crate::quote::parse_iso_ms(iso).unwrap()
}

#[test]
fn withdrawal_requests_one_per_account_no_dust() {
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 2_000_000, T0_MS);
    deposit(&mut v, "follower.testnet", 8_000_000, T0_MS);
    ctx("follower.testnet", T0_MS);
    assert!(panics(|| v.request_withdraw(U128(1), acc("exit.testnet"))).contains("below the minimum"));
    v.request_withdraw(U128(1_000_000), acc("exit.testnet"));
    assert!(panics(|| v.request_withdraw(U128(1_000_000), acc("exit.testnet"))).contains("one pending"));
    v.cancel_withdraw(0);
    v.request_withdraw(U128(8_000_000), acc("exit.testnet")); // everything: allowed at any size
}

#[test]
fn duplicate_signal_hashes_are_refused() {
    let mut v = vault();
    ctx("leader.testnet", T0_MS);
    v.set_signal_key(pk_str(&leader_key()));
    let h = [9u8; 32];
    let hh = hex(&h);
    ctx("op.testnet", T0_MS);
    v.record_signal(hh.clone(), sig_str(leader_key().sign(&h)), "ab".repeat(32), T0_MS);
    assert!(panics(|| v.record_signal(hh.clone(), sig_str(leader_key().sign(&h)), "ab".repeat(32), T0_MS)).contains("already recorded"));
}

#[test]
fn position_tracks_cost_basis() {
    let mut v = vault();
    deposit(&mut v, "leader.testnet", 2_000_000, T0_MS);
    deposit(&mut v, "follower.testnet", 8_000_000, T0_MS);
    ctx("follower.testnet", T0_MS);
    v.request_withdraw(U128(4_000_000), acc("exit.testnet"));
    post(&mut v, 1, 11_000_000, T0_MS + 1); // +10%, fee to the leader; the request is priced
    post(&mut v, 2, 11_000_000, T0_MS + 2); // flat: burned at min(priced, now)
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

// ---------------- NAV bound from a public price ----------------

pub(crate) const FEED: &str = "c415de8d2eba7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750";

pub(crate) fn oracle_vault() -> Vault {
    ctx("owner.testnet", T0_MS);
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let mut c = cfg();
    c.nav_oracle = Some(NavOracle {
        contract: acc("pyth.testnet"),
        price_id: FEED.into(),
        max_age_s: 60,
        tolerance_bps: 50,
    });
    let mut v = Vault::new(c);
    ctx("vault.testnet", T0_MS);
    v.on_activate(Ok(pk_str(&mpc_key())));
    v
}

pub(crate) fn px(p: i64) -> OraclePrice {
    OraclePrice {
        price: near_sdk::json_types::I64(p),
        conf: U64(0),
        expo: -8,
        publish_time: 0,
    }
}

/// Post `nav` and answer the oracle with `price` (None: no fresh price). Returns whether it applied.
pub(crate) fn post_with_price(v: &mut Vault, nav: u128, price: Option<OraclePrice>, ms: u64) -> bool {
    let epoch = v.epoch + 1;
    let head = "ab".repeat(32);
    ctx("op.testnet", ms);
    let m = v.nav_message(epoch, U128(nav), ms, head.clone());
    let sig = sig_str(att_key().sign(m.as_bytes()));
    assert!(matches!(
        v.post_nav(epoch, U128(nav), ms, head.clone(), sig.clone(), None),
        PromiseOrValue::Promise(_)
    ));
    ctx("vault.testnet", ms);
    v.on_nav_price(epoch, U128(nav), ms, head, sig, Ok(price)).is_some()
}

#[test]
fn nav_is_bounded_by_the_risky_assets_move() {
    let mut v = oracle_vault();
    deposit(&mut v, "leader.testnet", 2_000_000, T0_MS);
    deposit(&mut v, "follower.testnet", 8_000_000, T0_MS);
    // first post: nothing to compare against yet; records the oracle price
    assert!(post_with_price(&mut v, 10_000_000, Some(px(400_000_000)), T0_MS + 1));
    // tolerance = slippage 100 + 50 = 150 bps (conf 0)
    // NEAR +10%: anything from −1.5% to +11.5% per share is plausible
    let book = v.book_nav;
    assert!(!post_with_price(&mut v, 11_200_000, Some(px(440_000_000)), T0_MS + 2), "+12% with NEAR +10%");
    assert_eq!((v.epoch, v.book_nav), (1, book), "a rejected post changes nothing");
    assert!(!post_with_price(&mut v, 9_800_000, Some(px(440_000_000)), T0_MS + 3), "−2% with NEAR +10%");
    assert!(
        post_with_price(&mut v, 10_500_000, Some(px(440_000_000)), T0_MS + 4),
        "+5% with NEAR +10%: half exposure"
    );
    // NEAR flat: the vault can only lose costs or gain within tolerance
    assert!(!post_with_price(&mut v, 10_900_000, Some(px(440_000_000)), T0_MS + 5));
    // a missing or stale oracle price rejects the post and unblocks the next one
    assert!(!post_with_price(&mut v, 10_400_000, None, T0_MS + 6));
    assert_eq!(v.posting_since_ms, 0);
    // a wide confidence interval widens the band
    let wide = OraclePrice {
        conf: U64(4_400_000),
        ..px(440_000_000)
    }; // 1%
    let band = v.nav_band(oracle_point(&wide).unwrap()).unwrap();
    assert_eq!(band, (-(100 + 50 + 100), 100 + 50 + 100)); // slippage + tolerance + conf_now (last conf 0)
}

#[test]
fn one_oracle_post_at_a_time() {
    let mut v = oracle_vault();
    deposit(&mut v, "leader.testnet", 2_000_000, T0_MS);
    let head = "ab".repeat(32);
    ctx("op.testnet", T0_MS + 1);
    let m = v.nav_message(1, U128(2_000_000), T0_MS + 1, head.clone());
    let _ = v.post_nav(1, U128(2_000_000), T0_MS + 1, head.clone(), sig_str(att_key().sign(m.as_bytes())), None);
    assert!(panics(|| v.post_nav(1, U128(2_000_000), T0_MS + 1, head.clone(), sig_str(att_key().sign(m.as_bytes())), None)).contains("already waiting"));
    // a callback that never ran stops blocking after the timeout
    ctx("op.testnet", T0_MS + 1 + 10 * 60_000 + 1);
    let m2 = v.nav_message(1, U128(2_000_000), T0_MS + 2, head.clone());
    let _ = v.post_nav(1, U128(2_000_000), T0_MS + 2, head, sig_str(att_key().sign(m2.as_bytes())), None);
}

#[test]
fn oracle_config_is_checked() {
    let bad = |f: &dyn Fn(&mut Config)| {
        let mut c = cfg();
        c.nav_oracle = Some(NavOracle {
            contract: acc("pyth.testnet"),
            price_id: FEED.into(),
            max_age_s: 60,
            tolerance_bps: 50,
        });
        f(&mut c);
        ctx("owner.testnet", T0_MS);
        panics(|| Vault::new(c))
    };
    assert_eq!(bad(&|_| {}), "<no panic>");
    assert!(bad(&|c| c.allowed_assets.push("nep141:third".into())).contains("one risky asset"));
    assert!(bad(&|c| c.nav_oracle.as_mut().unwrap().price_id = "xyz".into()).contains("32-byte hex"));
    assert!(bad(&|c| c.nav_oracle.as_mut().unwrap().max_age_s = 0).contains("max_age_s"));
}

#[test]
fn migrates_season_v1_state() {
    use crate::migrate::{ConfigV1, VaultV1};
    ctx("vault.testnet", T0_MS);
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let c = cfg();
    let mut shares = LookupMap::new(b"s");
    shares.insert(acc("leader.testnet"), 2_000_000u128);
    let mut navs = Vector::new(b"n");
    navs.push(NavPost {
        epoch: 1,
        nav: U128(2_000_000),
        timestamp_ms: T0_MS,
        block_ms: T0_MS,
        price: U128(math::PRICE_SCALE),
        total_shares: U128(2_000_000),
        fee_shares: U128(0),
        withdrawn: U128(0),
        fills_head: "ab".repeat(32),
        signature: "x".into(),
    });
    let mut signals = Vector::new(b"g");
    signals.push(Signal {
        index: 0,
        hash: "cd".repeat(32),
        leader_sig: "s".into(),
        fill_hash: "ef".repeat(32),
        executed_ms: T0_MS,
        recorded_ms: T0_MS,
        epoch: 1,
    });
    let old = VaultV1 {
        cfg: ConfigV1 {
            owner: c.owner.clone(),
            operator: c.operator.clone(),
            leader: c.leader.clone(),
            base_token: c.base_token.clone(),
            base_asset_id: c.base_asset_id.clone(),
            intents_contract: c.intents_contract.clone(),
            mpc_contract: c.mpc_contract.clone(),
            mpc_path: c.mpc_path.clone(),
            oneclick_key: c.oneclick_key.clone(),
            attestation_key: c.attestation_key.clone(),
            perf_fee_bps: c.perf_fee_bps,
            min_leader_bps: c.min_leader_bps,
            max_slippage_bps: c.max_slippage_bps,
            min_deposit: c.min_deposit,
            allowed_assets: c.allowed_assets.clone(),
        },
        vault_account: Some(vault_acct()),
        shares,
        locked: LookupMap::new(b"l"),
        total_shares: 2_000_000,
        book_nav: 2_000_000,
        hwm: math::PRICE_SCALE,
        last_nav_ms: T0_MS,
        epoch: 1,
        emergency: false,
        navs,
        pending: IterableMap::new(b"p"),
        next_request: 0,
        claims: Vector::new(b"c"),
        signals,
        signal_key: Some(pk_str(&leader_key())),
        basis: LookupMap::new(b"b"),
    };
    let mut old = old;
    old.shares.flush();
    old.navs.flush();
    old.signals.flush();
    env::state_write(&old);
    let v = Vault::migrate_v1(Some(NavOracle {
        contract: acc("oracle.testnet"),
        price_id: FEED.into(),
        max_age_s: 120,
        tolerance_bps: 50,
    }));
    assert_eq!((v.epoch, v.total_shares, v.book_nav), (1, 2_000_000, 2_000_000));
    assert_eq!(shares_of(&v, "leader.testnet"), 2_000_000);
    assert_eq!(v.get_navs(0, 10).len(), 1);
    assert_eq!(v.get_config().nav_oracle.unwrap().max_age_s, 120);
    // recorded signal hashes were backfilled: a replay is refused
    ctx("op.testnet", T0_MS + 1);
    assert!(v.signal_hashes.contains(&"cd".repeat(32)));
}

fn shares_of(v: &Vault, who: &str) -> u128 {
    v.get_shares(acc(who)).0 .0
}

// ---------------- NAV price from 1Click-signed quotes ----------------

pub(crate) fn quotes_vault() -> Vault {
    ctx("owner.testnet", T0_MS);
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let mut c = cfg();
    c.nav_quotes = Some(NavQuotes {
        base_id: USDC.into(),
        risk_id: WNEAR.into(),
        max_age_ms: 5 * 60_000,
        tolerance_bps: 50,
        max_spread_bps: 100,
    });
    let mut v = Vault::new(c);
    ctx("vault.testnet", T0_MS);
    v.on_activate(Ok(pk_str(&mpc_key())));
    v
}

/// ISO time for `ms` on 2026-11-09 (T0 is 10:00:00Z).
pub(crate) fn iso(ms: u64) -> String {
    let s = (ms - (T0_MS - 10 * 3_600_000)) / 1000;
    format!("2026-11-09T{:02}:{:02}:{:02}.{:03}Z", s / 3600, (s / 60) % 60, s % 60, ms % 1000)
}

/// Two quotes like 1Click's around a mid price `usd` (USDC per NEAR, micro-dollars) with
/// half-spread `hs_bps`: 10 USDC → wNEAR at the ask, 3 wNEAR → USDC at the bid.
pub(crate) fn price_quotes(usd_micro: u128, hs_bps: u128, at_ms: u64, key: &SigningKey) -> Vec<SignedQuote> {
    let ask = usd_micro * (10_000 + hs_bps) / 10_000; // micro-USDC per NEAR
    let bid = usd_micro * (10_000 - hs_bps) / 10_000;
    let near = 1_000_000_000_000_000_000_000_000u128;
    let buy_out = 10_000_000u128 * near / ask;
    let sell_out = 3 * bid;
    let t = json!(iso(at_ms));
    vec![
        sign_like_oneclick(
            &qmsg(&[
                ("dry", json!(true)),
                ("originAsset", json!(USDC)),
                ("destinationAsset", json!(WNEAR)),
                ("amount", json!("10000000")),
                ("amountIn", json!("10000000")),
                ("amountOut", json!(buy_out.to_string())),
                ("timestamp", t.clone()),
            ]),
            key,
        ),
        sign_like_oneclick(
            &qmsg(&[
                ("dry", json!(true)),
                ("originAsset", json!(WNEAR)),
                ("destinationAsset", json!(USDC)),
                ("amount", json!((3 * near).to_string())),
                ("amountIn", json!((3 * near).to_string())),
                ("amountOut", json!(sell_out.to_string())),
                ("timestamp", t),
            ]),
            key,
        ),
    ]
}

/// Post `nav` with `quotes`; Some(applied?) or the panic message.
pub(crate) fn post_q(v: &mut Vault, nav: u128, quotes: Vec<SignedQuote>, ms: u64) -> Result<bool, String> {
    let epoch = v.epoch + 1;
    let head = "ab".repeat(32);
    ctx("op.testnet", ms);
    let m = v.nav_message(epoch, U128(nav), ms, head.clone());
    let sig = sig_str(att_key().sign(m.as_bytes()));
    let mut out = None;
    let got = panics(|| out = Some(v.post_nav(epoch, U128(nav), ms, head, sig, Some(quotes))));
    match out {
        Some(PromiseOrValue::Value(r)) => Ok(r.is_some()),
        Some(PromiseOrValue::Promise(_)) => Err("unexpected promise".into()),
        None => Err(got),
    }
}

#[test]
fn real_oneclick_quote_gives_price_facts() {
    let vec: Value = near_sdk::serde_json::from_str(include_str!("../tests/vectors/oneclick_dry_quote.json")).unwrap();
    let key = quote::decode_ed25519::<32>("ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc").unwrap();
    let q = SignedQuote {
        message: vec["message"].as_str().unwrap().into(),
        signature: vec["signature"].as_str().unwrap().into(),
    };
    let f = quote::price_facts(&q, &key).unwrap();
    assert!(f.amount_in > 0 && f.amount_out > 0 && f.timestamp_ms > 0);
    let forged = SignedQuote {
        message: q.message.replace(&f.amount_out.to_string(), &(f.amount_out * 2).to_string()),
        ..q
    };
    assert_eq!(quote::price_facts(&forged, &key), Err(quote::QuoteError::BadSignature));
}

#[test]
fn nav_is_bounded_by_signed_quotes() {
    let k = test_key();
    let mut v = quotes_vault();
    deposit(&mut v, "leader.testnet", 2_000_000, T0_MS);
    deposit(&mut v, "follower.testnet", 8_000_000, T0_MS);
    let t = T0_MS + 60_000;
    // first post records the price
    assert_eq!(post_q(&mut v, 10_000_000, price_quotes(4_000_000, 20, t, &k), t), Ok(true));
    // NEAR +10%; tolerance = 100 slippage + 50 + spreads 20 + 20 = 190 bps
    let t2 = t + 60_000;
    let book = v.book_nav;
    assert_eq!(
        post_q(&mut v, 12_000_000, price_quotes(4_400_000, 20, t2, &k), t2),
        Ok(false),
        "+20% with NEAR +10%"
    );
    assert_eq!((v.epoch, v.book_nav), (1, book));
    assert_eq!(post_q(&mut v, 10_500_000, price_quotes(4_400_000, 20, t2, &k), t2 + 1), Ok(true), "+5% honest");
    // refusals (the transaction fails)
    let t3 = t2 + 60_000;
    assert!(post_q(&mut v, 10_500_000, price_quotes(4_400_000, 20, t3 - 6 * 60_000, &k), t3)
        .unwrap_err()
        .contains("too old"));
    assert!(post_q(&mut v, 10_500_000, price_quotes(4_400_000, 20, t3, &att_key()), t3)
        .unwrap_err()
        .contains("BadSignature"));
    assert!(post_q(&mut v, 10_500_000, price_quotes(4_400_000, 150, t3, &k), t3)
        .unwrap_err()
        .contains("too wide"));
    assert!(post_q(&mut v, 10_500_000, vec![], t3).unwrap_err().contains("exactly two"));
    let q = price_quotes(4_400_000, 20, t3, &k);
    assert!(post_q(&mut v, 10_500_000, vec![q[0].clone(), q[0].clone()], t3)
        .unwrap_err()
        .contains("risky → base"));
    // the band view
    let p = v.price_from_quotes(price_quotes(4_400_000, 20, t3, &k));
    assert_eq!(v.nav_band(p), Some((-190, 190)));
}

#[test]
fn bracket_math() {
    // 10 USDC buys 2.5 NEAR (ask 4.0); 3 NEAR sells for 11.4 USDC (bid 3.8)
    let near = 1_000_000_000_000_000_000_000_000u128;
    let (mid, hs) = math::bracket(10_000_000, 25 * near / 10, 3 * near, 11_400_000).unwrap();
    assert_eq!(mid, 39 * math::QUOTE_PRICE_SCALE / 10 / 1_000_000_000_000_000_000);
    assert_eq!(hs, 257); // 0.1 / (2 × 3.9) = 2.56% → rounded up
    assert_eq!(math::bracket(1, 0, 1, 1), None);
}

#[test]
fn one_price_source_at_most() {
    let mut c = cfg();
    c.nav_quotes = Some(NavQuotes {
        base_id: USDC.into(),
        risk_id: WNEAR.into(),
        max_age_ms: 300_000,
        tolerance_bps: 50,
        max_spread_bps: 100,
    });
    c.nav_oracle = Some(NavOracle {
        contract: acc("pyth.testnet"),
        price_id: FEED.into(),
        max_age_s: 60,
        tolerance_bps: 50,
    });
    ctx("owner.testnet", T0_MS);
    assert!(panics(|| Vault::new(c)).contains("one NAV price source"));
}
