# Guarded real-money launch (T7): plan for Amit's OK

**Status:** plan only. Nothing here is deployed. Every step that signs on mainnet or moves funds is Amit's.

## What launches

One new mainnet vault, NEAR/USDC only, with:

| Guard | How it's enforced | Where |
|---|---|---|
| **No one can change the code** | The vault account's full-access key is deleted right after `new` + `activate` + caps. The contract has no upgrade method, so nobody (us included) can redeploy it. | `near account delete-keys`, then `view_access_key_list` shows no full-access key |
| **The code is the reviewed code** | Reproducible build (`cargo near build reproducible-wasm`) at a tagged commit; its sha256/code hash is published in the README before deploy, and the deployed `code_hash` must match. | docs/reproducibility.md, README box |
| **$200 per depositor, $5,000 per vault** | `set_deposit_caps(200_000_000, 5_000_000_000)` (USDC, 6 decimals). Deposits over either cap are refunded in the same transaction. Caps can only be lowered after that. The leader's own money isn't capped per account (it must keep ≥ 10% as the vault grows). | contract `caps` (T7), test `deposit_caps` |
| **Exits pay from what's actually there** | Emergency payouts in rounds, pro rata, the operator's included (T5). | `emergency_round`, threat model #7 |
| **Prices bounded by signed 1Click quotes** | `nav_quotes` (as the Genesis mainnet vault): every post carries 2 signed quotes; per-post and 24 h envelopes. | D-H series, threat model |
| **Operator can't move funds** | Trades only between allowed assets, paying the vault; payouts only to a claim's exit account. | `sign_intent` checks |
| **24 h dead-man switch** | No price post for 24 h, or a claim unpaid for 24 h → anyone opens emergency. | `trigger_emergency` |
| **A real leader** | Amit, or one invited trader who signs their own signals (human, no AI on day one). | leader key on their device only |

Not in the first real-money vault: multi-asset (T6). It widens the price bound by the assets' dispersion; launch with the tight single-asset bound and add assets in a second vault later.

## Before deploy (our side, no funds)

1. Freeze the contract at a commit: `git tag guarded-v1`; CI green on it (contract tests incl. property tests, `--features drill` off).
2. Reproducible build at that tag; record sha256 and the base58 code hash in README and docs/mainnet.md.
3. A fresh-context security review of the diff since the Genesis mainnet build (`624f3ba`): T5 rounds, T7 caps, the keeper path. Findings fixed or listed in the threat model.
4. Testnet dress rehearsal with the exact build and config: deploy, caps, delete the full-access key, deposits at and over the caps, a trade, a withdrawal, an emergency round. Record txs in docs/testnet.md.
5. Site: the vault page shows the caps, "code can't be changed (no full-access key)" with a link to the key list, and the build hash.

## Launch checklist (Amit signs)

All accounts implicit, keys in `~/.near-credentials/mainnet/` on Amit's machine. Commands use near-cli-rs; `$V` is the new vault account, `$OP` the operator, `$L` the leader.

```bash
# 0. fund (from Amit's wallet): vault 5.5 NEAR (code storage ~4.3 NEAR + state), operator 1 NEAR, leader 0.3 NEAR
# 1. deploy + init (config as docs/mainnet-init.live.json with the new leader/owner; docs/guarded-init.json is written at the freeze step)
near contract deploy $V use-file silent_partner.wasm with-init-call new json-args "$(cat docs/guarded-init.json)" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-legacy-keychain send
# 2. check the code hash matches the published build
near account view-account-summary $V network-config mainnet now
# 3. activate (operator) and set the caps (owner)
near contract call-function as-transaction $V activate json-args '{}' prepaid-gas '50 Tgas' attached-deposit '0 NEAR' sign-as $OP network-config mainnet sign-with-legacy-keychain send
near contract call-function as-transaction $V set_deposit_caps json-args '{"per_account":"200000000","vault_total":"5000000000"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as $L network-config mainnet sign-with-legacy-keychain send
# 4. USDC storage for the vault; leader sets its signal key and seeds the vault (≥ $50; ≥ 10% of the vault at all times)
# 5. delete the vault account's full-access key: after this nobody can redeploy
near account delete-keys $V public-keys <vault full-access pk> network-config mainnet sign-with-legacy-keychain send
near account list-keys $V network-config mainnet now   # expect: no keys
# 6. keeper: a post_nav-only function-call key on the operator (as D-P5-12), 0.5 NEAR allowance
```

## Costs

| Item | Amount | Notes |
|---|---|---|
| Vault account storage | ≈ 4.5 NEAR (≈ $15) | 422 KB wasm + state; locked, not spent |
| Operator + keeper gas | ≈ 0.05 NEAR/day | a post every 3 h; MPC signs cost 1 yocto + gas |
| Leader seed | ≥ $50; up to $556 to keep 10% of a full $5k vault | the leader's own money, withdrawable |
| 1Click fees | 0.20% per trade + spread (≈ 0.35% measured) | paid by the vault, pro rata |
| Review | 0 (fresh-context review) | no paid audit at this size; /trust says so |
| Total out of pocket | ≈ 6 NEAR + the leader seed | |

## Rollback

There is no code rollback: that's the point of deleting the key. If something is wrong, the leader stops signalling, the operator stops posting, and after 24 h anyone opens emergency; holders exit pro rata in rounds. The caps limit what can be at stake to $5,000 in total and $200 per person.

## What Amit decides

1. Go / no-go on this plan.
2. Who leads: Amit or an invited trader (name and their NEAR account).
3. When: after the hackathon review (the site says "Real-money vaults open after the hackathon review").
