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
