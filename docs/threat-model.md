# Threat model

Assets at risk: depositors' funds in the vault's intents accounts, the fairness of share pricing, the leader's fee, and the confidentiality of positions.

## 1. Operator trust

**What the operator cannot do**

- **Steal funds.** It holds no vault key. The contract signs only quote-bound transfers that pay the vault (shield, trade) or a claim's own exit account (payout). A payout to any other account is refused on-chain (docs/testnet.md, "thief payout refused").
- **Forge quotes.** `oneclick_key` is fixed at init. On mainnet it is 1Click's key, and anyone can check it with `get_config`.
- **Attach side effects.** The payload parser rejects `memo`, `msg`/notifications, extra intents and extra tokens.
- **Mint shares.** Shares are minted only by `ft_on_transfer` from the base token, and by the HWM fee to the leader.
- **Censor a withdrawal forever.** After 24h with no NAV, anyone can trigger emergency mode. Holders then exit at the last NAV, and anyone can submit the payouts.

**What the operator can do, and the mitigations**

| Risk | Impact | Mitigation |
|---|---|---|
| Post a false NAV | Misprices deposits and withdrawals until the next post. An inflated NAV overpays exits and dilutes depositors; a deflated one does the reverse. | Each NAV is signed and pins the hash-chained fill log head, so a lie is provable after the fact by anyone given the log. The log contents are private, so this deters rather than prevents. Next step: post the NAV computation from a TEE (OutLayer, or NEAR AI Cloud) or a ZK proof of balances × quotes. |
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
- **Public leg.** Deposits waiting on `intents.near` don't depend on FAR. `intents.near` is a public NEAR contract, so the vault could add a direct `ft_withdraw` intent for emergency exits of public funds. That is listed as future work.
- **Emergency payouts.** These still need 1Click unshield quotes. In emergency mode anyone may submit them, so the holders themselves can, but 1Click must be up.
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
