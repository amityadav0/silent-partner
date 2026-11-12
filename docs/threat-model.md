# Threat model

Assets at risk: depositors' funds in the vault's intents accounts, the fairness of share pricing, the leader's fee, and the confidentiality of positions.

## 1. Operator trust

**What the operator cannot do**

- **Send funds anywhere but the vault or a claimant.** It holds no vault key. The contract signs only quote-bound transfers that pay the vault (shield, trade, unshield) or `PublicPayout`s of a claim to its own exit account. A payout to any other account is refused on-chain (docs/testnet.md, "thief payout refused").
- **Pay a claim twice.** A payout's status is read from the verifier (`is_nonce_used`), not from the operator. The review's critical finding (release an executed payout, then pay again) is closed. See §7 and docs/testnet.md, "settlement check".
- **What it still can do with a false NAV.** It can misprice the withdrawals burned in that post, including those of an account it controls. That is a way to extract value. See the table below and §7, finding 6.
- **Forge quotes.** `oneclick_key` is fixed at init. On mainnet it is 1Click's key, and anyone can check it with `get_config`.
- **Attach side effects.** The payload parser rejects `memo`, `msg`/notifications, extra intents and extra tokens.
- **Mint shares.** Shares are minted only by `ft_on_transfer` from the base token, and by the HWM fee to the leader.
- **Censor a withdrawal forever.** After 24h with no NAV, anyone can trigger emergency mode. Holders then exit at the last NAV, and anyone can submit the payouts.

**What the operator can do, and the mitigations**

| Risk | Impact | Mitigation |
|---|---|---|
| Post a false NAV | Misprices deposits and withdrawals until the next post | **Bounded by 1Click-signed prices (D-H-5):** a post outside the band the risky asset's move allows is rejected on-chain, and exits pay min(NAV_t, NAV_t+1). Inside the band a lie is still possible. It is signed and pins the hash-chained fill log head, so it's provable after the fact by anyone given the log. v2: NAV computed in a TEE (OutLayer). |
| Trade badly | Losses inside allowed assets, bounded by `max_slippage_bps` per trade (1%) and quote binding | The leader chooses trades. The operator only executes signed signals, and every executed signal hash is recorded on-chain with the leader's signature. |
| Execute a signal late | Worse price | Signals expire after 5 minutes. Fill timestamps are in the log. |
| Stop operating | No NAV, deposits frozen | Emergency exit after 24h |
| Leak positions | Loss of privacy | The operator sees positions by design. Run it in a TEE to remove that. |
| Grind the fill log | Rewrite history | The head is posted on-chain each epoch, so rewriting breaks the chain against earlier heads. |

## 2. Shard exit (FAR chain and 1Click availability)

The vault's confidential balance lives on `intents.far`, a permissioned chain with no public RPC. Moving funds in or out goes through 1Click and the PoA bridge (the treasury `51e8f94d…7cbe`).

- **1Click or the bridge is down.** No shield, trade or payout can complete. Funds stay in the vault's confidential account, and nobody can move them out without a 1Click quote. That is a liveness dependency on Defuse.
  - **Mitigation:** the contract could also accept `ft_withdraw`-style intents on FAR if Defuse exposes a direct exit.
  - **Status:** open. It's the main reason the mainnet demo uses $7.
- **Public leg (closed, D-S-1).** Deposits waiting on `intents.near` don't depend on FAR. `sign_intent(PublicPayout{claim})` signs a plain transfer of the base asset from the vault's public intents balance to the claim's exit account, with no quote. That's the operator any time, and anyone for emergency claims. The emergency drill (docs/testnet.md) exits a follower this way, through the real defuse verifier, with no operator and no 1Click.
- **Emergency payouts of shielded funds.** These still need 1Click unshield quotes. In emergency mode anyone may submit them, so the holders themselves can, but 1Click must be up.
- **Settlement without the operator.** Anyone can settle an in-flight payout; the verifier's nonce record decides (paid, or released after its deadline).
- **In-flight payouts in emergency** stay counted as paid. If one was signed but never executed, its claimant is short. That is the safe side for the other holders, because a released payout could otherwise be paid twice.

## 3. Leader manipulation

- **Front-running followers.** This is impossible inside the vault: there is one order for the whole pool, at one price. The leader trading the same pair outside the vault ahead of a signal is still possible. It's the classic problem, reduced by confidentiality: nobody outside sees the vault's positions or the signal before execution, and the signal hash is published only afterwards.
- **Dumping on followers.** The leader can't sell their own position into followers' buys, because all positions are pooled.
- **Leaving the vault.** The leader must keep at least 10% of shares and can't withdraw below that while followers remain. This gives them skin in the game.
- **Pumping NAV for a fee.** The fee is charged only above the high-water mark, so a pump followed by a dump pays once and earns nothing until the HWM is regained. NAV is computed by the operator from 1Click quotes, so the leader can't post it.
- **Signal spam.** Signals need the leader's registered key. Each has a nonce and a 5-minute age limit, and is bounded by `size_bps ≤ 100%` of NAV.

## 4. Fee gaming

| Attack | Effect | Defense |
|---|---|---|
| Deposit right before a NAV post that charges a fee | The newcomer pays part of a fee on gains they didn't share | The fee is computed on the price above the HWM, and all shares are diluted equally. A newcomer who minted at a price above the HWM pays a little fee on gains made before they joined. This is a known pooled-HWM trade-off, accepted for simplicity. Per-holder HWMs (equalisation) are future work. |
| Withdraw just before a fee epoch | Avoid paying the fee | A withdrawal burns at the next post's **post-fee** price, so leavers pay their share. |
| Leader mints fee shares, then withdraws them at once | Normal: the fee is paid | Still subject to the 10% minimum stake |
| Stale NAV, then deposit at an old low price | Buy shares cheap | Deposits are refused when the NAV is more than 24h old. Within 24h, the book NAV is the last attested NAV plus actual deposits. |
| Dust deposits to bloat storage | Storage cost | 1 USDC minimum deposit, and the withdrawal queue is capped at 100 |

## 5. Keys and code

- **Vault account full-access key.** It can redeploy the contract, and so change what the MPC key will sign. For the mainnet demo it's kept so bugs can be fixed (D-P5-1). For production, delete it and publish the reproducible-build hash.
- **Attestation key.** A leak lets someone post false NAV, but only from the operator account (`post_nav` checks the predecessor too). To rotate it, redeploy with a new config.
- **Signal key.** Held in the leader's browser. A leak lets someone send signals, bounded by everything above. To rotate it, call `set_signal_key` from the leader's wallet.
- **MPC network.** Trusted for the key: the NEAR Chain Signatures threshold.

## 6. Confidentiality

- **Public:** NAV, share price, total shares, the leader's shares, the AUM bucket, claim amounts and exit accounts, signal hashes, the fill-log head, deposit amounts (NEP-141 transfers are public), and the vault's public intents balance before shielding.
- **Private:** holdings, trades and fills. Signals stay private until they are executed and hashed. The 1Click history is invite-only.
- **Inference.** NAV moves reveal returns, by design, and with them a hint of exposure. Posting NAV less often (`EPOCH_MS`) reduces it.

## 7. Independent review (2026-11-09)

A fresh-context review of `contract/` and `operator/` (a separate agent given only the code and docs), plus property and fuzz tests. Status after the fixes in D-H-2:

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `settle_payout(executed = false)` let the operator release a payout that had executed, then pay the claim again | critical | **Fixed.** Payouts leave only as `PublicPayout` on the public verifier. Settlement is permissionless and decided by `is_nonce_used`. Direct confidential→exit `Payout` was removed; funds are unshielded into the vault's own public balance first. Checked on testnet against the real verifier. |
| 2 | Claims opened before an emergency could only ever be paid by the operator, so they could be censored forever | high | **Fixed.** A claim unpaid for 24h lets anyone trigger emergency (`trigger_emergency(overdue_claim)`). In emergency every claimant can pay their own claim. |
| 3 | Anyone could freeze an emergency claim with a reservation that can never execute | high | **Fixed.** Only the claimant may sign their payout in emergency. Payout deadlines must be ≥ 5 min ahead. Dead reservations are released by anyone after the deadline. |
| 4 | Withdrawal-queue DoS and unbounded dust claims; the operator read only 1000 claims and stopped at the first failing one | high | **Fixed.** One pending request per account, and a minimum request of `min_deposit` (unless withdrawing everything). The operator paginates claims and isolates failures per claim. |
| 5 | Duplicate token keys in a payload were accepted (last value wins) | medium | **Fixed.** The parser rejects repeated keys. Fuzz test `duplicate_token_keys_are_rejected` (found independently by the fuzzer). |
| 6 | False NAV lets the operator misprice withdrawals, including its own accounts' | high | **Bounded (D-H-3, D-H-5).** Each post must carry two 1Click-signed quotes (base → risky and back, ≤ 5 min old, verified with the vault's immutable `oneclick_key`). The post is rejected unless the per-share return since the last post lies in [min(0, r) − (max slippage + tolerance + spreads), max(0, r) + tolerance + spreads], where r is the quotes' mid return: every return a base + NEAR vault can make at any weight. Costs only lower NAV, so slippage is on the low side only. A 24h window caps the cumulative overstatement with a fixed budget, posts are at least an hour apart, and each needs a strictly newer price (D-H-6). Withdrawals pay min(NAV_t, NAV_t+1), so an inflated NAV can't be cashed out in the same post. **Price trust = 1Click's signature: the same root as every trade.** A forged price needs 1Click's key, which could steal through trades anyway. **Residual:** a lie inside the band (e.g. claiming 100% NEAR when the vault held 0%), at most ≈ 1.85% per post and ≈ 3.6% per 24h with mainnet parameters (row 16); picking the most favourable of the quotes 1Click returns within 5 minutes (bounded by the move in that window); the first post after deploy, which only records the price; and vaults with more than one risky asset, which aren't bounded yet. The testnet season vaults use a mock oracle written by a separate account instead (their quote key is a test key). **v2, full fix:** compute NAV in a TEE (OutLayer) from the real 1Click balances, so the attestation proves the computation. |
| 7 | Emergency claims are fixed amounts at the last NAV, so whoever exits last bears the losses (a bank run) | medium | **Open.** Fix: pro-rata claims on realised proceeds, paid in rounds. |
| 8 | A failed sign removed every reservation with the same prehash, including a signed one | medium | **Fixed.** The same payload can't be reserved twice, and a failure removes only its own unsigned entry. |
| 9 | Settlement trusted the operator both ways (`executed = true` could short a claimant) | medium | **Fixed** with finding 1: no party's word is used. |
| 10 | The quote check ignored routing fields (`customRecipientMsg`, `virtualChain*`, `depositMemo`, `referral`, `appFees`) | medium | **Fixed for signed fields.** Each must be absent. Fields 1Click doesn't sign (e.g. `appFees` in the request) remain a trust in 1Click. Open: bound `minAmountOut` against an independent price. |
| 11 | No limit on trade churn; quote reuse | medium | **Partly fixed.** Each quote's deposit address can be paid only once. Open: tie each Trade to a recorded leader signal; churn is bounded only by `max_slippage_bps` per trade. |
| 12 | Login signatures were public and replayable for 1Click sessions (balance reads) | medium | **Mitigated.** Login deadlines are ≤ 5 min and login signatures aren't logged, though the return value is still on-chain. Open: bind sessions to an operator key if 1Click supports it. |
| 13 | NAV measured before a deposit lands misprices it, and forwarded funds can be in transit | medium | **Open.** Bounded by one epoch's deposits. Fix: sign a deposit counter with the NAV and adjust for deposits since. |
| 14 | The operator's ledger could drift from reality and halt NAV posting | medium | **Partly fixed.** Drift is reported and no longer throws. Open: reconcile against the real 1Click balances each epoch. |
| 15 | Lows: unlogged submit failures; the NAV message fetched from RPC; limit price not rechecked on the live quote; payable `sign_intent`; duplicate signal hashes; view range overflow; `post_nav` gas; 18/24-decimal base overflow; re-seeding an empty vault with value; unused `owner` | low | **Fixed:** submit failures logged, NAV message built locally, live limit recheck, `sign_intent` not payable, duplicate signals refused, saturating view ranges, 300 TGas for `post_nav`. **Open:** base asset decimals are not enforced (use 6-decimal USDC), the re-seed edge case, `owner` unused (config is immutable). |

Price trust for the NAV band is 1Click's signature, the same key as trades (D-H-5). No separate oracle has to be trusted on mainnet.

| # | Finding | Severity | Status |
|---|---|---|---|
| 16 | **The operator can shop for favourable quotes within the spread cap.** It chooses which 1Click quotes to submit: any pair ≤ `max_age_ms` old, legs ≤ 30 s apart and equal in size ±5%, half-spread ≤ `max_spread_bps`. By picking quotes at the cap and mids at the edge of their bracket, it widens the band and shifts r. | medium | **Bounded (D-H-6).** With the mainnet parameters (half-spread cap 40 bps, age 120 s, tolerance 25 bps, one bounded post per hour, window budget 200 bps), the overstatement of the per-share return beyond what NEAR did is at most ≈ 25 + 2·40 (spreads at the cap) + 2·40 (mids at the bracket edges) ≈ **1.85% per post**, plus twice NEAR's move within 2 minutes. Over any 24h window it's capped at ≈ 200 + 2·40 + 2·40 ≈ **3.6%** plus the same 2-minute term, because the window budget doesn't stack per post. Understatement is bounded the same way, plus max slippage per trade the vault actually signed. Honest quotes ran at ~22 bps half-spread on testnet, so the cap leaves room for normal markets. Tightening `max_spread_bps` or `window_up_bps` tightens the bound; v2 removes it by computing NAV in a TEE. |
| 17 | The per-post allowance compounded with frequent posts; the first post, empty vaults and post-burn reference were unbounded or mis-anchored (NAV-price review) | critical/high | **Fixed (D-H-6):** minimum post interval, strictly newer prices, asymmetric band, 24h window budget, first post against the book price, NAV ≤ book with no holders, post-burn reference. |
| 18 | **Active-trading window (D-H-7).** The 24h window used to bound the share return by the asset's return between the window's two ends, so honest vaults that changed weight during the day were rejected. | medium | **Fixed, with a stated residual.** The window envelope now follows the asset's path split into runs at leader signals recorded on chain, which the operator can't add without the leader's signal key. Operator-requested trades don't open runs. **Residual:** at each real signal the operator could report the best weight for the following run instead of the leader's, so over a day the overstatement is at most the best-timing return over the leader's actual signal points minus what the vault did, plus the window budget. Each run boundary's price can also be shopped within the spread cap: ≤ 2·`max_spread_bps` per signal (≈ 0.8% with mainnet parameters). Without signals the old endpoint bound holds. A leader colluding with the operator can sign extra signals, which is bounded by the per-post band at each post. **v2:** the TEE NAV (row 6) removes it. |
| 19 | **Per-post dip credit (D-H-8).** A post that lands below the asset's per-post envelope (a wide sell quote at that tick) lets the next post recover exactly that dip and nothing more. A lying operator can mark low and then high, but the two posts together stay inside the old bound, and the 24h window still caps the cumulative move. The credit lasts one post and is capped at slippage + tolerance + spreads. | Low | Fixed (D-H-8, testnet AI vaults upgraded 2026-11-12; the mainnet vault keeps the reviewed build). Residual: in the post after a dip, the operator can claim up to that dip as gain even if the low mark was honest market noise that never reverted. Bounded by the dip, and by the window. |

Also open, from the fix itself: payouts need the public verifier to accept plain (non-versioned) nonces, because versioned nonces can be cleaned up after expiry. Our testnet verifier (defuse 0.2.10) accepts them. Check this on mainnet `intents.near` before relying on payouts there (NEEDS-AMIT §3).
