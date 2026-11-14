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
    /// follower (1..4), drawdown bps
    Stop(usize, u16),
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        5 => (0usize..4, 1u128..2_000_000_000).prop_map(|(w, a)| Op::Deposit(w, a)),
        3 => (0usize..4, 1u32..=1000).prop_map(|(w, p)| Op::Withdraw(w, p)),
        1 => (0usize..4).prop_map(Op::Cancel),
        4 => (-600i32..=600).prop_map(Op::Post),
        1 => Just(Op::Emergency),
        2 => (0usize..4).prop_map(Op::Exit),
        2 => (1usize..4, 100u16..=3000).prop_map(|(w, d)| Op::Stop(w, d)),
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
            Op::Stop(w, d) => {
                if !v.emergency && bal(&v, WHO[w]) > 0 {
                    ctx(WHO[w], t);
                    v.set_stop_loss(d, acc(WHO[w]));
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
        // after a post, no live stop sits at or above the post's price (it would have fired)
        if let (Op::Post(_), Some(p)) = (o, v.navs.get(v.navs.len().saturating_sub(1))) {
            if !v.emergency && !v.navs.is_empty() && p.epoch == v.epoch {
                for (who, s) in v.stops.iter() {
                    prop_assert!(
                        s.trigger_price.0 < p.price.0,
                        "step {}: stop for {} at {} not fired at price {}",
                        i,
                        who,
                        s.trigger_price.0,
                        p.price.0
                    );
                }
            }
        }
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
    fn honest_navs_pass_and_lies_fail(w_milli in 0u32..=1000, steps in prop::collection::vec((-500i64..=500, 0u32..=100, 60u32..3000, any::<bool>()), 1..15)) {
        let mut v = oracle_vault();
        deposit(&mut v, "leader.testnet", 10_000_000, T0_MS);
        let mut t = T0_MS + 1000;
        let mut near: i64 = 400_000_000;
        prop_assert!(post_with_price(&mut v, 10_000_000, Some(px(near)), t));
        for (move_bps, cost_bps, lie_bps, up) in steps {
            t += 1000;
            let next = (near as i128 * (10_000 + move_bps as i128) / 10_000) as i64;
            let r_near = math::oracle_return_bps(near, -8, next, -8).unwrap();
            let p_last = v.band_ref.as_ref().unwrap().share_price.0 as i128;
            let nav_at = |ret: i128, v: &Vault| ((p_last * (10_000 + ret) / 10_000) * v.total_shares as i128 / math::PRICE_SCALE as i128).max(0) as u128;
            // honest: a constant NEAR weight w; costs only when it trades (each trade is a signed Trade)
            let ret = r_near * w_milli as i128 / 1000 - cost_bps as i128;
            if cost_bps > 0 {
                v.trades_since_anchor += 1;
            }
            // a lie past the per-post band: up = tolerance 50 (conf 0), down = slippage 100 + 50
            // (plus the previous post's dip below the envelope, which this post may recover, D-H-8)
            let credit = v.band_dip_for(v.band_ref.as_ref().unwrap());
            let edge = if up { r_near.max(0) + 50 + credit } else { r_near.min(0) - 150 };
            let lie_ret = edge + if up { lie_bps as i128 } else { -(lie_bps as i128) };
            let (epoch, book) = (v.epoch, v.book_nav);
            let (lie_nav, honest_nav) = (nav_at(lie_ret, &v), nav_at(ret, &v));
            prop_assert!(!post_with_price(&mut v, lie_nav, Some(px(next)), t), "lie {} bps accepted (asset {} bps)", lie_ret, r_near);
            prop_assert_eq!((v.epoch, v.book_nav), (epoch, book));
            prop_assert!(post_with_price(&mut v, honest_nav, Some(px(next)), t + 1), "honest {} bps rejected (asset {} bps)", ret, r_near);
            near = next;
            t += 1;
        }
    }

    /// An honest active trader is never blocked by the 24h window: the leader changes
    /// the NEAR weight at random posts (each change is a leader signal and a trade costing
    /// up to the max slippage), dozens of posts land inside one window, and every honest NAV passes.
    #[test]
    fn honest_active_trading_passes_window(w0 in 0u32..=1000, steps in prop::collection::vec((-400i64..=400, prop::option::of(0u32..=1000), 0u32..=100), 5..40)) {
        let mut v = oracle_vault();
        deposit(&mut v, "leader.testnet", 10_000_000, T0_MS);
        let mut t = T0_MS + 1000;
        let mut near: i64 = 400_000_000;
        let mut w = w0;
        prop_assert!(post_with_price(&mut v, 10_000_000, Some(px(near)), t));
        for (move_bps, new_w, cost_bps) in steps {
            t += 1000;
            let mut cost = 0i128;
            if let Some(nw) = new_w {
                // the trade happens at this post's start; the new weight earns this segment
                w = nw;
                cost = cost_bps as i128;
                crate::tests::leader_signal(&mut v);
                v.trades_since_anchor += 1;
            }
            let next = (near as i128 * (10_000 + move_bps as i128) / 10_000) as i64;
            let r_near = math::oracle_return_bps(near, -8, next, -8).unwrap();
            let p_last = v.band_ref.as_ref().unwrap().share_price.0 as i128;
            let ret = r_near * w as i128 / 1000 - cost;
            let nav = ((p_last * (10_000 + ret) / 10_000) * v.total_shares as i128 / math::PRICE_SCALE as i128).max(0) as u128;
            prop_assert!(post_with_price(&mut v, nav, Some(px(next)), t), "honest {} bps at weight {} rejected (asset {} bps)", ret, w, r_near);
            near = next;
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
    fn quotes_bound_honest_pass_lies_fail(w_milli in 0u32..=1000, steps in prop::collection::vec((-500i64..=500, 0u32..=100, 0u32..=95, 60u32..3000, any::<bool>()), 1..12)) {
        let k = crate::quote::tests::test_key();
        let mut v = quotes_vault();
        deposit(&mut v, "leader.testnet", 10_000_000, T0_MS);
        let mut t = T0_MS + 60_000;
        let mut usd: u128 = 4_000_000;
        prop_assert_eq!(post_q(&mut v, 10_000_000, price_quotes(usd, 20, t, &k), t), Ok(true));
        for (move_bps, cost_bps, hs, lie_bps, up) in steps {
            t += 60_000;
            let next = (usd as i128 * (10_000 + move_bps as i128) / 10_000) as u128;
            let qs = price_quotes(next, hs as u128, t, &k);
            let point = v.price_from_quotes(qs.clone());
            let r = v.band_ref.clone().unwrap();
            let ra = math::mid_return_bps(r.point.mid.0, point.mid.0).unwrap();
            let spread = point.half_spread_bps as i128 + r.point.half_spread_bps as i128;
            let p_last = r.share_price.0 as i128;
            let nav_at = |ret: i128, v: &Vault| ((p_last * (10_000 + ret) / 10_000) * v.total_shares as i128 / math::PRICE_SCALE as i128).max(0) as u128;
            let ret = ra * w_milli as i128 / 1000 - cost_bps as i128;
            if cost_bps > 0 {
                v.trades_since_anchor += 1;
            }
            // the previous post's dip below the envelope may be recovered once (D-H-8)
            let credit = v.band_dip_for(&r);
            let edge = if up { ra.max(0) + 50 + spread + credit } else { ra.min(0) - (150 + spread) };
            let lie_ret = edge + if up { lie_bps as i128 } else { -(lie_bps as i128) };
            let (epoch, book) = (v.epoch, v.book_nav);
            let (lie_nav, honest_nav) = (nav_at(lie_ret, &v), nav_at(ret, &v));
            prop_assert_eq!(post_q(&mut v, lie_nav, qs.clone(), t), Ok(false), "lie {} bps accepted (asset {} bps)", lie_ret, ra);
            prop_assert_eq!((v.epoch, v.book_nav), (epoch, book));
            prop_assert_eq!(post_q(&mut v, honest_nav, qs, t + 1), Ok(true), "honest {} bps rejected (asset {} bps)", ret, ra);
            usd = next;
            t += 1;
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]
    /// mul_div agrees with plain u128 arithmetic wherever that doesn't overflow.
    #[test]
    fn mul_div_matches_u128(a in any::<u64>(), b in any::<u64>(), c in 1u128..u64::MAX as u128) {
        prop_assert_eq!(math::mul_div(a as u128, b as u128, c), Some(a as u128 * b as u128 / c));
    }
}

// ---------------- emergency rounds (T5) ----------------

#[derive(Debug, Clone)]
enum RoundOp {
    /// holder 0..4 exits
    Exit(usize),
    /// the unwind brings in this permille of the book's value
    Cash(u32),
    Round,
    /// pay a claim (index among opened claims) its whole current allocation
    Pay(usize),
}

fn round_op() -> impl Strategy<Value = RoundOp> {
    prop_oneof![
        (0usize..4).prop_map(RoundOp::Exit),
        (0u32..400).prop_map(RoundOp::Cash),
        Just(RoundOp::Round),
        (0usize..4).prop_map(RoundOp::Pay)
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 300, ..ProptestConfig::default() })]

    /// Whatever the order of exits, cash arrivals, rounds and payouts: nothing is allocated beyond
    /// the cash that arrived, no claim is allocated beyond what it's owed, and after a final round
    /// with everyone out, every claim holds the same fraction of what it's owed (to rounding).
    #[test]
    fn emergency_rounds_are_pro_rata_in_any_order(
        deposits in prop::collection::vec(1_000_000u128..50_000_000, 4),
        ops in prop::collection::vec(round_op(), 0..40),
        recovered_permille in 0u32..=1000,
    ) {
        let mut v = vault();
        for (i, d) in deposits.iter().enumerate() {
            deposit(&mut v, WHO[i], *d * if i == 0 { 10 } else { 1 }, T0_MS);
        }
        let book = v.book_nav;
        let late = T0_MS + NAV_STALE_MS + 1;
        ctx("anyone.testnet", late);
        v.trigger_emergency(None);
        // total that will ever arrive is capped at `recovered` of the book
        let cap = book * recovered_permille as u128 / 1000;
        let (mut arrived, mut balance, mut paid) = (0u128, 0u128, 0u128);
        let mut claims: Vec<u64> = vec![];
        let round = |v: &mut Vault, bal: u128| {
            ctx("vault.testnet", late);
            v.on_round(Ok(U128(bal)));
        };
        for op in ops {
            match op {
                RoundOp::Exit(i) => {
                    ctx(WHO[i], late);
                    if v.balance(&acc(WHO[i])) > 0 {
                        claims.push(v.emergency_exit(acc(WHO[i])));
                    }
                }
                RoundOp::Cash(p) => {
                    let add = (book * p as u128 / 1000).min(cap - arrived);
                    arrived += add;
                    balance += add;
                }
                RoundOp::Round => round(&mut v, balance),
                RoundOp::Pay(k) => {
                    if let Some(&id) = claims.get(k) {
                        // a payout executes and is settled: it leaves the balance and counts as paid
                        let mut c = v.claims[id as u32].clone();
                        let room = rounds::alloc_of(id).saturating_sub(c.paid.0);
                        c.paid = U128(c.paid.0 + room);
                        v.claims.replace(id as u32, c);
                        balance -= room;
                        paid += room;
                    }
                }
            }
            let allocated: u128 = (0..v.claims.len() as u64).map(rounds::alloc_of).sum::<u128>() + rounds::pool_alloc();
            prop_assert!(allocated <= arrived, "allocated {} > arrived {}", allocated, arrived);
            prop_assert_eq!(balance + paid, arrived);
            for id in &claims {
                prop_assert!(rounds::alloc_of(*id) <= v.claims[*id as u32].amount.0);
            }
        }
        // everyone out, the rest of the unwind arrives, one more round
        for w in WHO {
            ctx(w, late);
            if v.balance(&acc(w)) > 0 {
                claims.push(v.emergency_exit(acc(w)));
            }
        }
        balance += cap - arrived;
        round(&mut v, balance);
        prop_assert_eq!(rounds::pool_alloc(), 0);
        // same fraction for all: alloc_i / amount_i within 1e-6 + rounding of each other
        let fr: Vec<f64> = claims.iter().map(|id| rounds::alloc_of(*id) as f64 / v.claims[*id as u32].amount.0 as f64).collect();
        let (lo, hi) = fr.iter().fold((f64::MAX, 0f64), |(l, h), &x| (l.min(x), h.max(x)));
        prop_assert!(hi - lo < 1e-5, "fractions {:?}", fr);
        prop_assert!((lo - recovered_permille as f64 / 1000.0).abs() < 1e-5 || recovered_permille == 0, "fraction {} vs recovered {}", lo, recovered_permille);
    }
}

// ---------------- multi-asset basket bound (T6) ----------------

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    /// Whatever the private weights (any mix of NEAR, BTC and cash) and moves: honest NAVs pass,
    /// and a NAV past the envelope over all allowed assets (± allowances) is refused.
    #[test]
    fn basket_bound_honest_pass_lies_fail(
        w in (0u32..=1000, 0u32..=1000),
        steps in prop::collection::vec((-400i64..=400, -400i64..=400, 0u32..=60, 0u32..=80, any::<bool>()), 1..10),
    ) {
        use crate::tests::{basket_quotes, basket_vault};
        let k = crate::quote::tests::test_key();
        let (wn, wb) = (w.0.min(1000), w.1.min(1000 - w.0.min(1000)));
        let mut v = basket_vault();
        deposit(&mut v, "leader.testnet", 10_000_000, T0_MS);
        let mut t = T0_MS + 60_000;
        let (mut near, mut btc) = (3_000_000u128, 60_000_000_000u128);
        prop_assert_eq!(crate::tests::post_q(&mut v, 10_000_000, basket_quotes(near, btc, 10, t, &k), t), Ok(true));
        for (mn, mb, hs, lie, up) in steps {
            t += 61_000;
            let (n2, b2) = ((near as i128 * (10_000 + mn as i128) / 10_000) as u128, (btc as i128 * (10_000 + mb as i128) / 10_000) as u128);
            let qs = basket_quotes(n2, b2, hs as u128, t, &k);
            let last = v.get_nav_basket().unwrap().last.unwrap();
            ctx("op.testnet", t);
            let p = v.basket_point(&crate::tests::basket_cfg(), qs.clone());
            let rn = math::mid_return_bps(last.point.mids[0].0, p.mids[0].0).unwrap();
            let rb = math::mid_return_bps(last.point.mids[1].0, p.mids[1].0).unwrap();
            let spread = p.spread_bps as i128 + last.point.spread_bps as i128;
            let p_last = last.share_price.0 as i128;
            let nav_at = |ret: i128, v: &Vault| ((p_last * (10_000 + ret) / 10_000) * v.total_shares as i128 / math::PRICE_SCALE as i128).max(0) as u128;
            // honest: the mix's return (floored a little, as costs only lower NAV)
            let honest = (rn * wn as i128 + rb * wb as i128) / 1000 - 1;
            let (lo, hi) = (rn.min(rb).min(0), rn.max(rb).max(0));
            let lie_ret = if up { hi + 50 + spread + 2 + lie as i128 } else { lo - (50 + 100 + spread) - 2 - lie as i128 };
            let (epoch, book) = (v.epoch, v.book_nav);
            let (lie_nav, honest_nav) = (nav_at(lie_ret, &v), nav_at(honest, &v));
            prop_assert_eq!(crate::tests::post_q(&mut v, lie_nav, qs.clone(), t), Ok(false), "lie {} bps accepted (near {} btc {})", lie_ret, rn, rb);
            prop_assert_eq!((v.epoch, v.book_nav), (epoch, book));
            prop_assert_eq!(crate::tests::post_q(&mut v, honest_nav, qs, t + 1), Ok(true), "honest {} bps refused (near {} btc {})", honest, rn, rb);
            near = n2;
            btc = b2;
            t += 1;
        }
    }
}
