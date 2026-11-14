//! Multi-asset price bound (T6, docs/multi-asset.md). A vault that may hold several risky
//! assets bounds each posted NAV by 1Click-signed quotes for **every allowed** risky asset:
//! with weights w_k ≥ 0, Σ w_k ≤ 1, the share return Σ w_k·r_k lies in
//! [min(0, min_k r_k), max(0, max_k r_k)], whatever the (private) weights are.
//! Config and state live under their own storage keys, so the vault's layout is unchanged.

use crate::*;
use near_sdk::borsh;

const CFG_KEY: &[u8] = b"xbc";
const REF_KEY: &[u8] = b"xbr";
const ANCHOR_KEY: &[u8] = b"xba";

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct NavBasket {
    /// 1Click asset id of the base the quotes price against (mainnet USDC, also on testnet paper vaults).
    pub base_id: String,
    /// 1Click asset ids of every risky asset the vault may hold, in the order the quotes come.
    pub risk_ids: Vec<String>,
    pub max_age_ms: u64,
    pub tolerance_bps: u16,
    pub max_spread_bps: u16,
    pub min_interval_ms: u64,
    pub window_up_bps: u16,
}

/// Mids of every risky asset at one post, the widest half-spread, and when observed.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct BasketPoint {
    pub mids: Vec<U128>,
    pub spread_bps: u32,
    pub observed_ms: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct BasketRef {
    pub point: BasketPoint,
    /// Share price after the post's fee and burns.
    pub share_price: U128,
    pub at_ms: u64,
    /// On-chain signal count at the post (trades since are counted from it).
    pub signals: u64,
}

/// The 24 h window: its anchor share price and the compounded per-step envelope since.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct BasketAnchor {
    pub at_ms: u64,
    pub share_price: U128,
    /// PRICE_SCALE multipliers: Π(1 + max(0, max_k r_k)) and Π(1 + min(0, min_k r_k)).
    pub up: U128,
    pub down: U128,
    pub signals: u64,
}

#[near(serializers = [json])]
pub struct BasketView {
    pub cfg: NavBasket,
    pub last: Option<BasketRef>,
    pub anchor: Option<BasketAnchor>,
}

fn read<T: borsh::BorshDeserialize>(k: &[u8]) -> Option<T> {
    env::storage_read(k).and_then(|b| borsh::from_slice(&b).ok())
}
fn write<T: borsh::BorshSerialize>(k: &[u8], v: &T) {
    env::storage_write(k, &borsh::to_vec(v).unwrap());
}
pub fn config() -> Option<NavBasket> {
    read(CFG_KEY)
}

/// (low, high) share return in bps a step allows when the assets moved `rs` (bps each).
pub fn envelope(rs: &[i128]) -> (i128, i128) {
    rs.iter().fold((0, 0), |(lo, hi), &r| (lo.min(r), hi.max(r)))
}

fn apply(m: u128, r: i128) -> u128 {
    math::mul_div(m, (math::BPS as i128 + r).max(0) as u128, math::BPS).unwrap_or(m)
}
fn to_bps(m: u128) -> i128 {
    (m as i128 - math::PRICE_SCALE as i128) * math::BPS as i128 / math::PRICE_SCALE as i128
}

#[near]
impl Vault {
    /// Owner, once, before the first deposit: bound NAV posts by a basket of risky assets.
    /// Exclusive with `nav_oracle` / `nav_quotes`. Every risky id must be an allowed asset
    /// (directly, or the testnet paper vault's own id for it).
    pub fn set_nav_basket(&mut self, basket: NavBasket) {
        require!(env::predecessor_account_id() == self.cfg.owner, "only the owner");
        require!(config().is_none(), "basket already set");
        require!(self.total_shares == 0, "set the basket before the first deposit");
        require!(
            self.cfg.nav_oracle.is_none() && self.cfg.nav_quotes.is_none(),
            "vault already has a price bound"
        );
        let n = basket.risk_ids.len();
        require!((1..=6).contains(&n), "1 to 6 risky assets");
        for (i, id) in basket.risk_ids.iter().enumerate() {
            require!(
                id != &basket.base_id && !basket.risk_ids[..i].contains(id),
                "risky assets must be distinct and not the base"
            );
        }
        require!(
            basket.tolerance_bps <= 500 && basket.max_spread_bps <= 500 && basket.window_up_bps <= 2000,
            "bounds too wide"
        );
        require!(basket.min_interval_ms >= 60_000 && basket.max_age_ms <= 10 * 60_000, "bad timing");
        write(CFG_KEY, &basket);
        env::log_str(&format!("silent-partner.basket risky={}", basket.risk_ids.join(",")));
    }

    pub fn get_nav_basket(&self) -> Option<BasketView> {
        config().map(|cfg| BasketView {
            cfg,
            last: read(REF_KEY),
            anchor: read(ANCHOR_KEY),
        })
    }
}

impl Vault {
    /// Two signed quotes per risky asset, in `risk_ids` order: base → risky, risky → base.
    pub(crate) fn basket_point(&self, b: &NavBasket, quotes: Vec<SignedQuote>) -> BasketPoint {
        require!(quotes.len() == 2 * b.risk_ids.len(), "need two price quotes per risky asset");
        let (mut mids, mut spread, mut observed) = (vec![], 0u32, u64::MAX);
        for (k, risk) in b.risk_ids.iter().enumerate() {
            let p = self.quote_pair(&quotes[2 * k], &quotes[2 * k + 1], &b.base_id, risk, b.max_age_ms, b.max_spread_bps);
            mids.push(p.mid);
            spread = spread.max(p.half_spread_bps);
            observed = observed.min(p.observed_ms);
        }
        BasketPoint {
            mids,
            spread_bps: spread,
            observed_ms: observed,
        }
    }

    pub(crate) fn check_basket(&self, b: &NavBasket, nav: u128, p: &BasketPoint) -> Result<(), String> {
        if self.total_shares == 0 {
            return if nav <= self.book_nav {
                Ok(())
            } else {
                Err(format!("no holders: NAV {nav} above book NAV {}", self.book_nav))
            };
        }
        let (tol, slip, spread_now) = (b.tolerance_bps as i128, self.cfg.max_slippage_bps as i128, p.spread_bps as i128);
        let share = math::price(nav, self.total_shares);
        let out = |what: &str, rv: i128, lo: i128, hi: i128| format!("{what}: share return {rv}bps outside [{lo}, {hi}]bps");
        let Some(r) = read::<BasketRef>(REF_KEY) else {
            let rv = math::share_return_bps(math::price(self.book_nav, self.total_shares), share);
            let t = slip + tol + spread_now;
            return if rv.abs() <= t {
                Ok(())
            } else {
                Err(out("first post vs book price", rv, -t, t))
            };
        };
        if now_ms() < r.at_ms + b.min_interval_ms {
            return Err(format!("too soon: one bounded post per {} ms", b.min_interval_ms));
        }
        if p.observed_ms <= r.point.observed_ms {
            return Err("price not newer than the last post's".into());
        }
        let rs: Vec<i128> = r
            .point
            .mids
            .iter()
            .zip(&p.mids)
            .map(|(a, c)| math::mid_return_bps(a.0, c.0).ok_or("bad price"))
            .collect::<Result<_, _>>()?;
        let (elo, ehi) = envelope(&rs);
        let spread = spread_now + r.point.spread_bps as i128;
        let signals = self.signals.len() as u64;
        let trades = (signals - r.signals).max(1) as i128;
        let rv = math::share_return_bps(r.share_price.0, share);
        let (lo, hi) = (elo - (tol + slip * trades + spread), ehi + tol + spread);
        if rv < lo || rv > hi {
            return Err(out("per post", rv, lo, hi));
        }
        if let Some(a) = read::<BasketAnchor>(ANCHOR_KEY).filter(|a| now_ms() < a.at_ms + BAND_WINDOW_MS) {
            let (up, down) = (to_bps(apply(a.up.0, ehi)), to_bps(apply(a.down.0, elo)));
            let tw = (signals - a.signals).max(1) as i128;
            let w = b.window_up_bps as i128;
            let rvw = math::share_return_bps(a.share_price.0, share);
            let (lo, hi) = (down - (w + slip * tw + spread), up + w + spread);
            if rvw < lo || rvw > hi {
                return Err(out("24h window", rvw, lo, hi));
            }
        }
        Ok(())
    }

    /// After an accepted post: it becomes the reference; the window compounds this step's
    /// envelope, or restarts when it's over.
    pub(crate) fn record_basket(&mut self, p: BasketPoint) {
        let after = math::price(self.book_nav, self.total_shares);
        let signals = self.signals.len() as u64;
        let last: Option<BasketRef> = read(REF_KEY);
        let step = last.as_ref().and_then(|r| {
            let rs: Option<Vec<i128>> = r.point.mids.iter().zip(&p.mids).map(|(a, c)| math::mid_return_bps(a.0, c.0)).collect();
            rs.map(|rs| envelope(&rs))
        });
        let now = now_ms();
        let anchor = match read::<BasketAnchor>(ANCHOR_KEY) {
            Some(mut a) if now < a.at_ms + BAND_WINDOW_MS => {
                if let Some((lo, hi)) = step {
                    a.up = U128(apply(a.up.0, hi));
                    a.down = U128(apply(a.down.0, lo));
                }
                // withdrawals burned below this post's price leave value to those who stay
                let posted = self.navs.get(self.navs.len() - 1).map(|n| n.price.0).unwrap_or(after);
                if after > posted && posted > 0 {
                    a.share_price = U128(math::mul_div(a.share_price.0, after, posted).unwrap_or(a.share_price.0));
                }
                a
            }
            _ => BasketAnchor {
                at_ms: now,
                share_price: U128(after),
                up: U128(math::PRICE_SCALE),
                down: U128(math::PRICE_SCALE),
                signals,
            },
        };
        write(ANCHOR_KEY, &anchor);
        write(
            REF_KEY,
            &BasketRef {
                point: p,
                share_price: U128(after),
                at_ms: now,
                signals,
            },
        );
    }
}
