//! Property tests over random sequences of vault operations, run against the
//! real contract code (the near-sdk unit-test VM). After every step:
//!
//! * shares are conserved: Σ balances = total_shares;
//! * no value is created or lost: book_nav = deposits + operator gains − claims, exactly;
//! * rounding dust is bounded and stays in the vault: Σ holder values ≤ book_nav ≤ Σ + holders;
//! * cost basis adds up: Σ deposited = deposits, Σ claimed = claims;
//! * the high-water mark never falls;
//! * outside emergency, the leader keeps the minimum stake whenever anyone else holds shares.

use crate::math;
use crate::tests::{acc, ctx, deposit, panics, post, vault, T0_MS};
use crate::*;
use proptest::prelude::*;

const WHO: [&str; 4] = ["leader.testnet", "follower.testnet", "f2.testnet", "f3.testnet"];
const STEP_MS: u64 = 10_000;

#[derive(Debug, Clone)]
enum Op {
    /// who, amount in base units
    Deposit(usize, u128),
    /// who, permille of their free shares
    Withdraw(usize, u32),
    Cancel(usize),
    /// NAV change in permille of book NAV, −600…+600
    Post(i32),
    Emergency,
    Exit(usize),
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        5 => (0usize..4, 1u128..2_000_000_000).prop_map(|(w, a)| Op::Deposit(w, a)),
        3 => (0usize..4, 1u32..=1000).prop_map(|(w, p)| Op::Withdraw(w, p)),
        1 => (0usize..4).prop_map(Op::Cancel),
        4 => (-600i32..=600).prop_map(Op::Post),
        1 => Just(Op::Emergency),
        2 => (0usize..4).prop_map(Op::Exit),
    ]
}

struct Model {
    deposits: u128,
    gains: i128,
    hwm: u128,
}

fn bal(v: &Vault, w: &str) -> u128 {
    v.get_shares(acc(w)).0 .0
}

fn check(v: &Vault, m: &Model, step: usize, o: &Op) -> Result<(), TestCaseError> {
    let total = v.total_shares;
    let balances: Vec<u128> = WHO.iter().map(|w| bal(v, w)).collect();
    prop_assert_eq!(balances.iter().sum::<u128>(), total, "step {} {:?}: shares not conserved", step, o);

    let claims: u128 = v.get_claims(0, 10_000).iter().map(|c| c.amount.0).sum();
    let expect = m.deposits as i128 + m.gains - claims as i128;
    prop_assert_eq!(v.book_nav as i128, expect, "step {} {:?}: value created or lost", step, o);

    if total > 0 {
        let held: u128 = balances.iter().map(|b| b * v.book_nav / total).sum();
        prop_assert!(
            held <= v.book_nav && v.book_nav - held <= WHO.len() as u128,
            "step {} {:?}: dust {} vs {}",
            step,
            o,
            held,
            v.book_nav
        );
    }

    let (dep, cl) = WHO.iter().fold((0u128, 0u128), |(d, c), w| {
        let p = v.get_position(acc(w));
        (d + p.deposited.0, c + p.claimed.0)
    });
    prop_assert_eq!(dep, m.deposits, "step {} {:?}: basis deposits", step, o);
    prop_assert_eq!(cl, claims, "step {} {:?}: basis claims", step, o);

    prop_assert!(v.hwm >= m.hwm, "step {} {:?}: HWM fell", step, o);

    let leader = balances[0];
    if !v.emergency && total > 0 && leader != total {
        prop_assert!(
            math::leader_ok(leader, total, 1000),
            "step {} {:?}: leader stake {} of {}",
            step,
            o,
            leader,
            total
        );
    }
    Ok(())
}

fn run(ops: Vec<Op>) -> Result<(), TestCaseError> {
    let mut v = vault();
    let mut m = Model {
        deposits: 0,
        gains: 0,
        hwm: v.hwm,
    };
    let mut t = T0_MS;
    for (i, o) in ops.iter().enumerate() {
        t += STEP_MS;
        match *o {
            Op::Deposit(w, a) => {
                if deposit(&mut v, WHO[w], a, t) == 0 {
                    m.deposits += a;
                }
            }
            Op::Withdraw(w, p) => {
                let free = bal(&v, WHO[w]) - v.get_shares(acc(WHO[w])).1 .0;
                let s = free * p as u128 / 1000;
                if s > 0 {
                    ctx(WHO[w], t);
                    let _ = panics(|| v.request_withdraw(U128(s), acc(WHO[w])));
                }
            }
            Op::Cancel(w) => {
                if let Some(r) = v.get_pending().into_iter().find(|r| r.account.as_str() == WHO[w]) {
                    ctx(WHO[w], t);
                    v.cancel_withdraw(r.id);
                }
            }
            Op::Post(change) => {
                if !v.emergency {
                    let before = v.book_nav;
                    let nav = (before as i128 * (1000 + change as i128) / 1000).max(0) as u128;
                    let epoch = v.epoch + 1;
                    post(&mut v, epoch, nav, t);
                    m.gains += nav as i128 - before as i128;
                }
            }
            Op::Emergency => {
                if v.vault_account.is_some() && !v.emergency {
                    t = v.last_nav_ms.max(t) + NAV_STALE_MS + 1;
                    ctx("anyone.testnet", t);
                    v.trigger_emergency(None);
                }
            }
            Op::Exit(w) => {
                if v.emergency && bal(&v, WHO[w]) > 0 {
                    ctx(WHO[w], t);
                    v.emergency_exit(acc(WHO[w]));
                }
            }
        }
        check(&v, &m, i, o)?;
        m.hwm = v.hwm;
    }
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 400, ..ProptestConfig::default() })]

    #[test]
    fn random_sequences_conserve_value(ops in prop::collection::vec(op(), 1..60)) {
        run(ops)?;
    }
}

// ---------------- payload parser fuzz ----------------

use crate::intent::{parse, Nep413Payload, Parsed};

const NONCE: &str = "Vij2xgDhEPMXAKd3B6vG5RhBVeL9AuFIA1IZaLl832U=";

fn pl(message: String) -> Nep413Payload {
    Nep413Payload {
        message,
        nonce: NONCE.into(),
        recipient: "intents.far".into(),
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 3000, ..ProptestConfig::default() })]

    /// Arbitrary bytes never panic the parser.
    #[test]
    fn parser_never_panics(m in ".{0,400}") {
        let _ = parse(&pl(m));
    }

    /// Mutations of a valid transfer are either rejected or parse to exactly
    /// one transfer whose fields are the ones in the message.
    #[test]
    fn mutated_transfers_parse_to_what_they_say(
        receiver in "[a-z0-9]{1,64}",
        token in prop_oneof![Just("nep141:usdc".to_string()), Just("imt:x:nep141:usdc".to_string()), "[a-z:.0-9]{1,30}"],
        amount in prop_oneof!["[0-9]{1,30}", ".{0,8}"],
        extra in prop_oneof![Just(String::new()), Just(r#","memo":"x""#.to_string()), Just(r#","msg":"x""#.to_string()), Just(r#","receiver_id":"thief""#.to_string())],
    ) {
        let m = format!(
            r#"{{"deadline":"2026-11-09T12:00:00.000Z","intents":[{{"intent":"transfer","receiver_id":"{receiver}","tokens":{{"{token}":"{amount}"}}{extra}}}],"signer_id":"vault"}}"#
        );
        if let Ok(p) = parse(&pl(m)) {
                prop_assert!(extra.is_empty(), "accepted an extra field: {}", extra);
                match p.kind {
                    Parsed::Transfer { receiver_id, token: t, amount: a } => {
                        prop_assert_eq!(receiver_id, receiver);
                        prop_assert_eq!(t, token);
                        prop_assert_eq!(Some(a), amount.parse::<u128>().ok());
                    }
                    Parsed::Login => prop_assert!(false, "transfer parsed as login"),
                }
        }
    }

    /// A tokens map with the same token twice must not parse (the verifier might read the other value).
    #[test]
    fn duplicate_token_keys_are_rejected(a in "[0-9]{1,10}", b in "[0-9]{1,10}") {
        let m = format!(
            r#"{{"deadline":"2026-11-09T12:00:00.000Z","intents":[{{"intent":"transfer","receiver_id":"r","tokens":{{"nep141:usdc":"{a}","nep141:usdc":"{b}"}}}}],"signer_id":"vault"}}"#
        );
        prop_assert!(parse(&pl(m)).is_err(), "duplicate token key accepted");
    }
}

// ---------------- NAV bound and two-step withdrawals ----------------

use crate::tests::{oracle_vault, post_with_price, px};

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    /// An honest operator is never blocked: a vault holding any mix w ∈ [0, 1]
    /// of NEAR, paying trading costs within slippage, is always accepted as
    /// NEAR's price walks. A NAV outside the band is always rejected and changes nothing.
    #[test]
    fn honest_navs_pass_and_lies_fail(steps in prop::collection::vec((-1500i64..=1500, 0u32..=1000, 0u32..=100, 200u32..3000, any::<bool>()), 1..25)) {
        let mut v = oracle_vault();
        deposit(&mut v, "leader.testnet", 10_000_000, T0_MS);
        let mut t = T0_MS + 1;
        let mut near: i64 = 400_000_000;
        prop_assert!(post_with_price(&mut v, 10_000_000, Some(px(near)), t));
        for (move_bps, w_milli, cost_bps, lie_bps, up) in steps {
            t += 1000;
            let next = (near as i128 * (10_000 + move_bps as i128) / 10_000) as i64;
            let r_near = math::oracle_return_bps(near, -8, next, -8).unwrap();
            let p_last = v.navs.get(v.navs.len() - 1).unwrap().price.0 as i128;
            // honest: w of NAV moved with NEAR, minus up to the slippage cap in costs
            let ret = r_near * w_milli as i128 / 1000 - cost_bps as i128;
            let honest_price = p_last * (10_000 + ret) / 10_000;
            let honest_nav = (honest_price * v.total_shares as i128 / math::PRICE_SCALE as i128).max(0) as u128;
            // a lie beyond the band (tolerance 150 bps)
            let edge = if up { r_near.max(0) + 150 } else { r_near.min(0) - 150 };
            let lie_ret = edge + if up { lie_bps as i128 } else { -(lie_bps as i128) };
            let lie_nav = ((p_last * (10_000 + lie_ret) / 10_000) * v.total_shares as i128 / math::PRICE_SCALE as i128).max(0) as u128;
            let (epoch, book) = (v.epoch, v.book_nav);
            prop_assert!(!post_with_price(&mut v, lie_nav, Some(px(next)), t), "lie {} bps accepted (asset {} bps)", lie_ret, r_near);
            prop_assert_eq!((v.epoch, v.book_nav), (epoch, book));
            prop_assert!(post_with_price(&mut v, honest_nav, Some(px(next)), t + 1), "honest {} bps rejected (asset {} bps)", ret, r_near);
            near = next;
            t += 1;
        }
    }

    /// A matured withdrawal never pays more than the lower of its two prices,
    /// and never lowers the price of the holders who stay.
    #[test]
    fn matured_payout_takes_the_lower_price(shares in 1u128..1_000_000_000, total_extra in 0u128..1_000_000_000, nav in 0u128..10_000_000_000, priced_milli in 1u128..5000) {
        let total = shares + total_extra;
        let priced_at = math::PRICE_SCALE * priced_milli / 1000;
        let pay = math::matured_payout(shares, nav, total, priced_at);
        prop_assert!(pay * total <= shares * nav);
        prop_assert!(pay <= shares * priced_at / math::PRICE_SCALE);
        if total_extra > 0 {
            prop_assert!(math::price(nav - pay, total - shares) >= math::price(nav, total));
        }
    }
}

use crate::tests::{post_q, price_quotes, quotes_vault};

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    /// Same guarantee with 1Click-signed quotes: honest NAVs at any NEAR weight
    /// pass for any spread under the cap; anything outside the widened band fails.
    #[test]
    fn quotes_bound_honest_pass_lies_fail(steps in prop::collection::vec((-1500i64..=1500, 0u32..=1000, 0u32..=100, 0u32..=95, 200u32..3000, any::<bool>()), 1..15)) {
        let k = crate::quote::tests::test_key();
        let mut v = quotes_vault();
        deposit(&mut v, "leader.testnet", 10_000_000, T0_MS);
        let mut t = T0_MS + 60_000;
        let mut usd: u128 = 4_000_000;
        let mut hs_last = 20u32;
        prop_assert_eq!(post_q(&mut v, 10_000_000, price_quotes(usd, hs_last as u128, t, &k), t), Ok(true));
        for (move_bps, w_milli, cost_bps, hs, lie_bps, up) in steps {
            t += 60_000;
            let next = (usd as i128 * (10_000 + move_bps as i128) / 10_000) as u128;
            let qs = price_quotes(next, hs as u128, t, &k);
            let point = v.price_from_quotes(qs.clone());
            let last = v.last_price.clone().unwrap();
            let r = math::mid_return_bps(last.mid.0, point.mid.0).unwrap();
            let tol = 150 + point.half_spread_bps as i128 + last.half_spread_bps as i128;
            let p_last = v.navs.get(v.navs.len() - 1).unwrap().price.0 as i128;
            let ret = r * w_milli as i128 / 1000 - cost_bps as i128;
            let honest = ((p_last * (10_000 + ret) / 10_000) * v.total_shares as i128 / math::PRICE_SCALE as i128).max(0) as u128;
            let edge = if up { r.max(0) + tol } else { r.min(0) - tol };
            let lie_ret = edge + if up { lie_bps as i128 } else { -(lie_bps as i128) };
            let lie = ((p_last * (10_000 + lie_ret) / 10_000) * v.total_shares as i128 / math::PRICE_SCALE as i128).max(0) as u128;
            let (epoch, book) = (v.epoch, v.book_nav);
            prop_assert_eq!(post_q(&mut v, lie, qs.clone(), t), Ok(false), "lie {} bps accepted (asset {} bps)", lie_ret, r);
            prop_assert_eq!((v.epoch, v.book_nav), (epoch, book));
            prop_assert_eq!(post_q(&mut v, honest, qs, t + 1), Ok(true), "honest {} bps rejected (asset {} bps)", ret, r);
            usd = next;
            hs_last = hs;
            t += 1;
        }
        let _ = hs_last;
    }
}
