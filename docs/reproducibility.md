# Reproducibility: fresh-clone run and claim → evidence

This file answers two questions an automated screener asks. Does the repo reproduce from a clean clone? Does every feature the README and the application text claim exist?

## Fresh-clone run (2026-11-10)

`git clone https://github.com/amityadav0/silent-partner` at `0503f7f` into an empty directory with no `.env` and no `operator/data/`, then the README's "Run it" steps, literally, on macOS (arm64).

| Step | Result | Fix made |
|---|---|---|
| `make test` | **Failed**: `tsc: command not found`. Nothing installed the npm dependencies, and the README didn't say to. | The Makefile now runs `npm ci` in `operator/` and `web/` on first use (and `make setup` adds Playwright's Chromium). Rerun: contract 66, operator 53, web 29, all pass. |
| `make build` | Passed. Needs `cargo-near` on the PATH, which the README didn't list. | Prerequisites are now listed in the README. |
| operator on :8788 | Can't run from a clone: it needs the testnet operator's keys (`operator/data/testnet-keys.json`, `~/.near-credentials`), which aren't in git by design. | The README says so. Nothing else depends on it. |
| `npm run build && npm run serve` | Passed; the site reads testnet live. | — |
| `make e2e` | 22 passed, 1 skipped: the leader-signing test, which needs the operator keys and skips itself without them. | The README names the skip. |

Known flake, local only: the leader-signing e2e test (which needs the operator keys) sometimes fails at the end of a full suite run, with the operator returning a FastNEAR 429 or a TypeError from its RPC call path. It passes when run alone. Screeners and CI skip it.

Test counts after this round's changes: contract 66, operator 54, web 29 unit tests; 25 Playwright smoke tests and 16 layout checks.

## Claims → evidence

Every claim in the README and the application `idea` text (`docs/NEEDS-AMIT.md` §6). "Testnet" means a recorded transaction in [docs/testnet.md](testnet.md).

| Claim | Code | Test | On testnet / live |
|---|---|---|---|
| A leader and followers share one vault; each signal is filled once for the whole pool, at one price | `operator/src/operator.ts` | `operator/test/operator.test.ts` "executes one market signal for the whole vault and records it on-chain" | every season tick (`season-state/last-run.json`) |
| Deposits mint shares at book NAV; refused when the NAV is stale or the leader stake would fall below the minimum | `contract/src/lib.rs` `ft_on_transfer` | `contract/src/tests.rs` `deposit_mints_at_last_nav_and_rejects_bad_input`, `deposits_freeze_when_nav_stale`, `deposit_table` | drill: a deposit refused in emergency |
| The vault's intents key is an MPC key derived for the contract (Chain Signatures) | `contract/src/lib.rs` `sign_intent` / `on_signed` | — | P1 probe (`docs/probes/p1-mpc-eddsa.json`); "Real NEAR Intents verifier on testnet" |
| The key signs only quote-bound transfers back into the vault, or a holder's own payout | `contract/src/lib.rs` `sign_intent`, `contract/src/intent.rs` | `contract/src/tests.rs` `public_payout_table` | "What happened" item 6, "Thief payout refused" |
| Payouts are settled against the verifier's nonce record, so a claim can't be paid twice | `contract/src/lib.rs` `settle_payout` | `payout_settles_against_the_verifier_nonce_record`; operator "settles in-flight payouts by the verifier's record" | "Settlement check" |
| NAV is bounded by public prices; an inflated NAV is rejected | `contract/src/lib.rs` `check_band`, `contract/src/quote.rs` | `contract/src/prop_tests.rs` `quotes_bound_honest_pass_lies_fail` | +20% lie rejected: tx `9sSBzqNo…`. Mainnet uses two 1Click-signed quotes; **season vaults use a Pyth-compatible mock feed** (D-H-3, D-H-5) |
| Withdrawals pay the lower of two consecutive NAVs | `contract/src/math.rs` `matured_payout` | `withdrawal_is_priced_at_one_nav_and_burned_at_the_lower_of_two`, `matured_payout_takes_the_lower_price` | — |
| The leader keeps at least 10% of shares | `contract/src/math.rs` | `leader_stake_table`, `leader_locked_shares_do_not_count_toward_the_stake` | — |
| 20% performance fee above a high-water mark | `contract/src/math.rs` `performance_fee` | `fee_table`, `fee_and_hwm_across_epochs`, `fee_respects_hwm`, `fee_not_charged_twice_on_same_gain` | fee shares in the vault page's NAV table |
| Emergency after 24h without a NAV or an unpaid claim; every holder exits pro rata without the operator | `contract/src/lib.rs` `trigger_emergency`, `emergency_exit` | `emergency_path`, `overdue_claim_opens_emergency`, `emergency_trades_unwind_only` | exit drill (5-minute timeout build): payout executed with the operator stopped, tx `DhphuPPK…` |
| Share accounting conserves value under random operation sequences | `contract/src/math.rs` | `random_sequences_conserve_value` | — |
| Leader signals are signed and the contract re-verifies the signature when it records the hash | `contract/src/lib.rs` `record_signal`, `web/lib/signal.ts` | `contract/src/tests.rs` `signals`, `duplicate_signal_hashes_are_refused`; operator "the signal hash signature verifies the way the contract checks it" | browser-signed signal executed (e2e, local operator) |
| Hash-chained, append-only fill log pinned on-chain with each NAV | `operator/src/filllog.ts` | operator "chains, survives reload, and detects tampering"; `web/test/lib.test.ts` "disclosure checks" | `/chain/`: the published log matches every commitment (e2e) |
| Your browser re-verifies every NAV signature | `web/lib/vault.ts` `verifyNavs` | `web/test/lib.test.ts` "attestations"; e2e "vault page" | every vault page ("Verified epochs n / n") |
| 8 house leaders: 5 AI, 2 bots, 1 manual | `web/lib/vaults.ts`, `operator/season/vaults.json` | e2e "every house leader has a badge and a style" | leaderboard |
| AI leaders decide on NEAR AI Cloud; the reasoning stays sealed and is committed on-chain by hash | `operator/src/leaders/ai.ts`, `operator/scripts/season.ts` | `operator/test/season.test.ts` "memo_hash is part of the signed hash", AI leader tests | "First AI signals on-chain"; vault page "AI decisions" matches the latest trade's hash in the browser. **Since 2026-11-09 ~22:30 UTC NEAR AI Cloud inference is paused by NEAR AI (a security incident on their side), so the AI leaders hold; the site and `last-run.json` say so** |
| The model is served from NEAR AI's TEE infrastructure | — | — | NEAR AI's statement; this repo keeps each completion's chat id so its TEE signature can be fetched on disclosure, but doesn't verify the attestation itself |
| The season ticks every 15 minutes, with paper fills at real 1Click dry-quote prices | `.github/workflows/season.yml`, `operator/src/season/tick.ts` | `operator/test/season.test.ts` | `season-state` history: one commit per tick |
| Paper follow, no wallet | `web/app/vault/paper.tsx`, `web/lib/paper.ts` | e2e "paper follow" | vault pages |
| Follow from any chain: a real 1Click quote delivers USDC into the vault, crediting the follower | `web/lib/crosschain.ts`, `contract/src/lib.rs` `ft_on_transfer` (`msg`) | `deposit_can_name_the_account_it_is_for`; e2e "follow from any chain" | "Follow from any chain, and copy stop-loss" |
| Copy stop-loss enforced at each NAV post | `contract/src/lib.rs` `set_stop_loss` | `stop_loss_rules`, `stop_loss_fires_at_the_post_that_reaches_it` | same section |
| Trade from chat (IronClaw) | `extension/` | extension harness | "Trade from chat: IronClaw tool" |
| Bring your track record: EIP-191 proof verified in the browser | `web/app/track/page.tsx`, `web/lib/track-proofs.ts` | e2e "bring your track record" | `/track/` |
| Track-record card per vault, re-rendered each tick | `operator/src/season/card.ts` | `operator/test/season.test.ts` "track-record card" | `season-state/cards/*.png` |
| Positions are never published | `operator/scripts/season.ts` `redact`; the contract stores no holdings | `operator/test/season.test.ts` "seals and unseals a directory; ciphertext holds no plaintext"; e2e "leaderboard … no positions" | The operator sees positions by design (threat model). Deposits and share balances are public NEAR data. In paper mode the testnet funds stay in the vault's public intents balance (`/chain/` says so). |
| Mainnet `intents.near` accepts an MPC-signed intent | `operator/scripts/p1-mpc-eddsa-probe.ts` | — | `docs/probes/` (read-only simulation; mainnet writes still wait for Amit) |
| Two fresh-context security reviews, findings fixed | — | regression tests named in the table | `docs/threat-model.md` §7 |

## Claims softened in this round

- README intro: "nobody sees positions" became "positions are never published; only the operator that executes the trades sees them".
- README: leaders "trade every 15 minutes" became "decide every 15 minutes and trade when their target moves" (a signal is sent only on a move of at least 5 points).
- README: the TEE claim is now attributed to NEAR AI.
- Application `idea`: "nobody can trade ahead of the followers" became "there is no follower order for anyone to trade ahead of". The NAV bound names the mainnet quotes and the season's mock feed. "Holders can always exit" became "if the operator stops for 24 hours, holders exit pro rata without it".
