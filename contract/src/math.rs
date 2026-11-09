//! Share accounting, pure functions. All amounts are base-asset units (USDC: 6
//! decimals) and share units; prices are base units per share scaled by
//! `PRICE_SCALE`. Rounding always favours the vault (floor on mint and payout).

/// Fixed-point scale for price per share.
pub const PRICE_SCALE: u128 = 1_000_000_000_000_000_000; // 1e18
pub const BPS: u128 = 10_000;

/// Price per share × PRICE_SCALE. An empty vault prices at exactly 1.
pub fn price(nav: u128, shares: u128) -> u128 {
    (nav * PRICE_SCALE).checked_div(shares).unwrap_or(PRICE_SCALE)
}

/// Shares minted for `amount` at the book NAV. None if the vault has shares but
/// no value (a total loss): nothing can be priced.
pub fn shares_for_deposit(amount: u128, nav: u128, shares: u128) -> Option<u128> {
    if shares == 0 {
        return Some(amount);
    }
    if nav == 0 {
        return None;
    }
    Some(amount * shares / nav)
}

/// Base units paid for burning `burn` shares at (nav, shares).
pub fn payout_for_shares(burn: u128, nav: u128, shares: u128) -> u128 {
    (burn * nav).checked_div(shares).unwrap_or(0)
}

/// Performance fee against a high-water mark.
///
/// Returns `(fee_shares, new_hwm)`. When the price is above the HWM, the fee is
/// `fee_bps` of the value above the HWM, paid by minting new shares to the
/// leader so that existing holders are diluted by exactly that value. The HWM
/// then moves to the post-fee price. Otherwise there is no fee and the HWM stays.
pub fn performance_fee(nav: u128, shares: u128, hwm: u128, fee_bps: u128) -> (u128, u128) {
    if shares == 0 || nav == 0 {
        return (0, hwm);
    }
    let p = price(nav, shares);
    if p <= hwm || fee_bps == 0 {
        return (0, hwm);
    }
    let value_at_hwm = hwm * shares / PRICE_SCALE;
    let gain = nav - value_at_hwm;
    let fee_value = gain * fee_bps / BPS;
    if fee_value == 0 || fee_value >= nav {
        return (0, hwm);
    }
    let fee_shares = fee_value * shares / (nav - fee_value);
    let new_hwm = price(nav, shares + fee_shares);
    (fee_shares, new_hwm)
}

/// Does `leader` hold at least `min_bps` of `total`? An empty vault passes.
pub fn leader_ok(leader: u128, total: u128, min_bps: u128) -> bool {
    total == 0 || leader * BPS >= min_bps * total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn price_table() {
        for (nav, shares, want) in [
            (0, 0, PRICE_SCALE),
            (100, 100, PRICE_SCALE),
            (150, 100, PRICE_SCALE * 3 / 2),
            (50, 100, PRICE_SCALE / 2),
        ] {
            assert_eq!(price(nav, shares), want, "nav={nav} shares={shares}");
        }
    }

    #[test]
    fn deposit_table() {
        // (amount, nav, shares) -> shares out
        let cases: &[(u128, u128, u128, Option<u128>)] = &[
            (1_000_000, 0, 0, Some(1_000_000)),               // first deposit 1:1
            (1_000_000, 2_000_000, 1_000_000, Some(500_000)), // price 2
            (1_000_000, 500_000, 1_000_000, Some(2_000_000)), // price 0.5
            (1, 3, 1, Some(0)),                               // dust floors to 0
            (1_000_000, 0, 1_000_000, None),                  // total loss
        ];
        for &(a, n, s, want) in cases {
            assert_eq!(shares_for_deposit(a, n, s), want, "a={a} n={n} s={s}");
        }
    }

    #[test]
    fn payout_table() {
        for (burn, nav, shares, want) in [
            (500_000u128, 2_000_000u128, 1_000_000u128, 1_000_000u128),
            (1, 2, 3, 0),
            (10, 10, 0, 0),
            (1_000_000, 1_000_000, 1_000_000, 1_000_000),
        ] {
            assert_eq!(payout_for_shares(burn, nav, shares), want);
        }
    }

    #[test]
    fn fee_table() {
        // price 1.2 vs hwm 1.0, 20% fee: gain 200k, fee 40k value
        let (fs, hwm) = performance_fee(1_200_000, 1_000_000, PRICE_SCALE, 2000);
        assert_eq!(fs, 40_000 * 1_000_000 / 1_160_000);
        // after mint, leader's new shares are worth ≈ 40k
        let worth = payout_for_shares(fs, 1_200_000, 1_000_000 + fs);
        assert!((39_999..=40_000).contains(&worth), "{worth}");
        assert_eq!(hwm, price(1_200_000, 1_000_000 + fs));
        // below / at hwm: no fee, hwm unchanged
        assert_eq!(performance_fee(900_000, 1_000_000, PRICE_SCALE, 2000), (0, PRICE_SCALE));
        assert_eq!(performance_fee(1_000_000, 1_000_000, PRICE_SCALE, 2000), (0, PRICE_SCALE));
        // zero fee bps
        assert_eq!(performance_fee(2_000_000, 1_000_000, PRICE_SCALE, 0), (0, PRICE_SCALE));
        // empty vault
        assert_eq!(performance_fee(0, 0, PRICE_SCALE, 2000), (0, PRICE_SCALE));
    }

    #[test]
    fn fee_not_charged_twice_on_same_gain() {
        let (fs, hwm) = performance_fee(1_200_000, 1_000_000, PRICE_SCALE, 2000);
        let shares = 1_000_000 + fs;
        // same NAV next epoch: price == hwm → no fee
        assert_eq!(performance_fee(1_200_000, shares, hwm, 2000), (0, hwm));
        // drawdown then recovery to the old HWM: no fee
        assert_eq!(performance_fee(1_000_000, shares, hwm, 2000).0, 0);
        assert_eq!(performance_fee(1_200_000, shares, hwm, 2000).0, 0);
    }

    #[test]
    fn leader_stake_table() {
        for (l, t, ok) in [(100u128, 1000u128, true), (99, 1000, false), (0, 0, true), (1000, 1000, true), (0, 1, false)] {
            assert_eq!(leader_ok(l, t, 1000), ok, "l={l} t={t}");
        }
    }
}

#[cfg(test)]
mod props {
    use super::*;
    use proptest::prelude::*;

    // Realistic bounds: up to 10^13 base units (10M USDC) and 10^13 shares.
    const MAX: u128 = 10_000_000_000_000;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(2000))]

        /// A depositor never gets shares worth more than they paid, and the
        /// existing holders' price never falls.
        #[test]
        fn mint_never_extracts_value(amount in 1u128..MAX, nav in 1u128..MAX, shares in 1u128..MAX) {
            let minted = shares_for_deposit(amount, nav, shares).unwrap();
            prop_assert!(minted * nav <= amount * shares);
            prop_assert!(price(nav + amount, shares + minted) >= price(nav, shares));
        }

        /// A burn never pays more than its pro-rata value, and the holders who stay keep their price.
        #[test]
        fn burn_never_overpays(nav in 0u128..MAX, shares in 1u128..MAX, frac in 0u128..=1000) {
            let burn = shares * frac / 1000;
            let pay = payout_for_shares(burn, nav, shares);
            prop_assert!(pay * shares <= burn * nav);
            prop_assert!(pay <= nav);
            if burn < shares {
                prop_assert!(price(nav - pay, shares - burn) >= price(nav, shares));
            }
        }

        /// The fee is charged only above the HWM, never takes holders below it,
        /// and the leader's fee shares are worth at most the fee.
        #[test]
        fn fee_respects_hwm(nav in 1u128..MAX, shares in 1u128..MAX, hwm_milli in 1u128..5000, fee_bps in 0u128..=5000) {
            let hwm = PRICE_SCALE * hwm_milli / 1000;
            let (fee_shares, new_hwm) = performance_fee(nav, shares, hwm, fee_bps);
            let p0 = price(nav, shares);
            if p0 <= hwm || fee_bps == 0 {
                prop_assert_eq!((fee_shares, new_hwm), (0, hwm));
            } else {
                prop_assert!(new_hwm >= hwm || fee_shares == 0);
                prop_assert_eq!(new_hwm, if fee_shares == 0 { hwm } else { price(nav, shares + fee_shares) });
                let gain = nav - hwm * shares / PRICE_SCALE;
                let fee_value = gain * fee_bps / BPS;
                // value of the fee shares at the post-fee price
                prop_assert!(fee_shares * nav <= fee_value * (shares + fee_shares) + nav);
                // holders keep at least their value at the HWM (to rounding)
                let holders_after = nav * shares / (shares + fee_shares);
                prop_assert!(holders_after + 1 >= hwm * shares / PRICE_SCALE);
            }
        }
    }
}
