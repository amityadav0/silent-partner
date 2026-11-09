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
