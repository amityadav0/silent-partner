# More than NEAR: multi-asset vaults (T6)

**Status:** design, Nov 14. Built on testnet in the order of "Build plan" below; the mainnet build is unchanged until Amit approves an upgrade.

## Why

A trader who can only toggle NEAR/USDC won't lead a vault. The leaders worth copying trade the majors. This adds BTC, ETH and SOL next to NEAR, all against USDC, all through 1Click on NEAR Intents. Positions stay private exactly as today. The new work is the price bound: today it bounds one risky asset, and it has to bound a basket without learning what the vault holds.

## Assets

| Asset | 1Click asset id (mainnet) | Decimals | Testnet paper vaults |
|---|---|---|---|
| USDC (base) | `nep141:17208628…36133a1` | 6 | `nep141:usdc.fakes.testnet` (mapped to mainnet USDC for pricing) |
| NEAR | `nep141:wrap.near` | 24 | `nep141:wrap.testnet` (mapped to `wrap.near`) |
| BTC | `nep141:btc.omft.near` | 8 | the mainnet id itself (paper fills only, nothing is deposited) |
| ETH | `nep141:eth.omft.near` | 18 | the mainnet id itself |
| SOL | `nep141:sol.omft.near` | 9 | the mainnet id itself |

All five have live 1Click quotes (checked against `/v0/tokens` on Nov 14). The contract's `allowed_assets` lists them; it already refuses trades into anything else.

## What changes

### Signal

Today a signal is one trade (`from`, `to`, `size_bps`) or one target weight (`target_bps` of one risky asset). New: a **basket target**:

```json
{ "v": 1, "type": "basket", "vault": "…", "targets_bps": { "nep141:btc.omft.near": 3000, "nep141:wrap.near": 2000 }, "nonce": "…", "created_ms": … }
```

- Weights are bps of NAV per risky asset; the rest is USDC. Sum ≤ 10,000, every key in `allowed_assets`, no negative weights (no shorting, no leverage).
- The signal hash and the leader's signature work as today (canonical JSON, ed25519), so `record_signal` on chain is unchanged: the chain stores the hash, never the weights.
- The AI prompt asks for `{"targets": {"BTC": 0.3, "NEAR": 0.2}, "rationale": …}`; the operator clamps each weight and the sum, as it clamps the single weight today. The public log shows only "rebalanced" and the rationale hash. A 20-point bucket per asset, as the single-asset log shows today, would leak which assets the leader picked.

### Operator

- **Execution.** A basket target becomes a list of trades, always through USDC (sell over-weight assets first, then buy under-weight ones), one 1Click quote each, all for the whole vault at one price. The turnover rule applies to the basket as a whole: trade only when Σ|target − current| ≥ 20 pts and ≥ 4 h since the last trade.
- **Valuation.** `nav()` already sums `value(asset, amount)` over every confidential holding via 1Click dry quotes; it needs only the decimals and the testnet asset map for the new ids.
- **Price quotes with each post.** Today 2 signed quotes (USDC → NEAR and NEAR → USDC). New: 2 per allowed risky asset, every post, whether the vault holds it or not, so the set of quotes says nothing about the holdings. 4 risky assets → 8 quotes, all taken within 30 s.

### Contract: the basket bound

The single-asset bound says: with a weight `w ∈ [0, 1]` in one asset whose mid moved `r`, the share return lies in `[min(0, r), max(0, r)]`, plus allowances (tolerance, spread, slippage per trade). For weights `w_k ≥ 0`, `Σ w_k ≤ 1`, the share return is `Σ w_k·r_k`, which lies in

```
[ min(0, min_k r_k) , max(0, max_k r_k) ]
```

over **all allowed** risky assets, not only the held ones. The contract never learns the weights; the envelope is the same whatever they are. Per post:

- 2 signed quotes per risky asset in `risk_ids` order, each pair one observation (≤ 30 s apart, same size both ways ±5%), each half-spread ≤ `max_spread_bps`, every quote ≤ `max_age_ms` old and newer than the last post's.
- `lo = min(0, min_k r_k) − (tolerance + slippage × max(1, trades since the last post) + spread)`, `hi = max(0, max_k r_k) + tolerance + spread`, where `spread` is the widest asset's half-spread now plus at the last post.
- **24 h window.** The per-step envelopes compound since the window's anchor: `up *= 1 + max(0, max_k r_k)`, `down *= 1 + min(0, min_k r_k)`. The window check is the same formula with a fixed `window_up_bps` budget instead of the per-post tolerance, so per-post allowances can't be stacked by posting often.
- No holders: NAV ≤ book NAV. First bounded post: within slippage + tolerance + spread of the book price.

Storage: the basket config and its reference/anchor live under their own storage keys (like the emergency rounds of T5), set once by the owner before the first deposit (`set_nav_basket`), so a vault's stored layout doesn't change.

### UI

- "What it can hold: USDC, NEAR, BTC, ETH and SOL (enforced by the contract)".
- Limits: "Any mix of the four, no leverage, no shorting (enforced by the contract's price bound)".
- The leader console gets a basket form (one weight per asset); the create wizard lets a leader pick assets.
- Holdings stay sealed everywhere. The "vs holding NEAR" benchmark becomes "vs holding the basket" only if we ever publish weights, which we won't; it stays vs NEAR and vs Half & Half.

## Tamper analysis

What can a dishonest **operator** do with the basket bound that it couldn't with the single-asset one?

| Attack | Single asset | Basket | Why it holds (or the residual) |
|---|---|---|---|
| Post a NAV above the truth to dilute exiting holders or mint fees | bounded by `max(0, r)` + allowances | bounded by `max(0, max_k r_k)` + allowances | **Residual widens:** on a day BTC is +5% and NEAR −5%, an all-NEAR vault could be marked up to +5% + allowances. The 24 h window caps the stacked allowance, not this gap. Mitigations: (1) every post is signed over the fill-log head, so a lie is provable after the fact; (2) a vault can declare a **narrower set** (`risk_ids` only lists the assets its mandate allows); (3) the leader, not the operator, signs the weights, so the operator can't claim a basket the leader never chose. Rejected: publishing the held set (leaks the strategy). |
| Post a NAV below the truth to buy cheap / let withdrawals burn low | `min(0, r)` − allowances | `min(0, min_k r_k)` − allowances | Same residual on the downside. Withdrawals burn at the lower of two posts, so a low lie hurts only whoever exits in that window, and the next honest post must recover within the bound. |
| Price quotes from a bad source | 1Click signature, one pair | 1Click signature, every pair | Each quote is verified against `oneclick_key`, the same key every trade's quote is verified against. A forged quote fails like a forged trade. |
| Omit an asset's quotes to dodge its move | n/a | refused | The post needs exactly 2 quotes per `risk_ids` entry, in order. |
| Pick stale or old quotes | `max_age_ms`, newer than last | the same per asset | Every quote must be newer than the last post's observation. |
| Wide quotes to buy a wide band | `max_spread_bps` | per asset | Same cap on each pair. |
| Post often to stack per-post tolerance | `min_interval_ms` + window | the same | Unchanged. |
| Leader churns to harvest the slippage allowance | slippage × trades signed | the same | Trades are counted from on-chain signals, which need the leader's signature. |

What can a dishonest **leader** do? Nothing new: the leader still signs only weights, and the operator still verifies every asset against `allowed_assets` before quoting.

**Net:** the basket bound is as tamper-resistant as today against forged prices, stale prices and allowance stacking. It is weaker against "mark the vault as if it held the best performer", by up to the dispersion of the allowed assets over a post interval (typically < 1% per 15 min, a few % on a volatile day). That is the price of not publishing positions; vaults that want the tight bound list fewer assets.

## Build plan (testnet)

1. Contract: `NavBasket` config + `set_nav_basket` + the bound in `post_nav`, own storage keys; unit tests (envelope, missing quotes, order, staleness, spread) and a property test (honest random baskets pass, lies beyond the envelope fail).
2. Operator: decimals and asset map for BTC/ETH/SOL; basket signal type; execution through USDC; 2 quotes per risky asset per post; turnover rule on Σ|Δw|.
3. One new testnet vault, "Majors" (house bot: equal-weight momentum across the four, top two by 24 h return), in the season.
4. UI: assets line, limits line, leader basket form.
5. Mainnet: only with Amit's OK, as part of the guarded launch (docs/guarded-launch.md).
