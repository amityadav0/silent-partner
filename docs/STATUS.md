# Status

If restarted: read this file first and continue from the first unchecked item.
Deadline: 2026-11-14 23:59 UTC (we target 18:00 UTC for buffer). The hosted demo must stay online through 2026-11-25 (D-S-11).

## P0 Scaffold (Nov 7)
- [x] contract/ (near-sdk 5.30, rustc 1.98.1): builds to wasm, `cargo test`, and clippy is clean
- [x] operator/ (TypeScript): typecheck and vitest are green; carry-over copied from ~/scope
- [x] web/ (Next.js 15 static export, wallet-selector with MyNearWallet + Meteor): build and vitest are green
- [x] docs/ skeleton, README skeleton, Makefile
- [x] CI green on GitHub (run 42378666942)

## P1 Probes (Nov 8)
- [x] (a) Can a contract-controlled ed25519 key (Chain Signatures EdDSA) be registered on intents.far and sign transfer intents? Record the answer in DECISIONS.md. **Yes**: D-P1a, probe in docs/probes/
- [x] (b) Exact steps for a $1 public→confidential→public round trip in NEEDS-AMIT.md
- [x] (c) OutLayer price for one run in NEEDS-AMIT.md

## P2 Contract (Nov 8–9)
- [x] shares: deposit mints at last NAV; a withdraw request burns at the next NAV
- [x] leader minimum stake of 10%
- [x] performance fee with a high-water mark
- [x] operator-signed NAV per epoch, stored with its timestamp
- [x] signal registry (hashes posted after execution)
- [x] emergency mode after 24h with no NAV
- [x] table tests for every path, clippy clean (29 tests)
- [x] testnet deploy with faucet accounts: `sp-vault-60270.testnet`, docs/testnet.md (real testnet MPC signatures)

## P3 Operator (Nov 9–10)
- [x] deposit watcher → shield (the contract mints at deposit: D-P3-1)
- [x] signed leader signals
- [x] confidential quote/order execution (dry)
- [x] append-only hash-chained fill log
- [x] NAV per epoch → post
- [x] withdrawals
- [x] fixture tests (24 operator tests with real recorded 1Click quotes; testnet operator run in docs/testnet.md)

## P4 Web (Nov 10–11)
- [x] leaderboard
- [x] vault page
- [x] leader console
- [x] share page
- [x] Playwright smoke tests + docs/screens/ (6 e2e passing on live testnet, including a browser-signed signal executed by the operator and recorded on-chain)

## P5 Mainnet (Nov 12)
- [x] runbook in NEEDS-AMIT.md §3 (op.ts step CLI, init args in docs/mainnet-init.json; the real defuse verifier was exercised on testnet first)
- [ ] Amit OK → run it, record the txs in docs/mainnet.md

## P6 Submission (Nov 13)
- [x] README, architecture.md, threat-model.md, demo script, X post, application JSON (NEEDS-AMIT §4–6)

## P7 Buffer (Nov 14)
- [ ] re-run all tests, final push, then `git tag hackathon-submission && git push origin hackathon-submission` at the final commit (README links the diff) (dry run 2026-11-09: contract 55, operator 47, web 20, oracle-mock 1, Playwright 12 on live testnet: all green)

## Season (Nov 9–13): items from Amit's list, in order
- [x] 1. Paper season: 4 demo vaults + drill vault on testnet, bots, operator in paper mode at real 1Click dry-quote prices, GitHub Actions cron every 15 min, honest "paper · testnet" labels
- [x] 2. AI leader on NEAR AI Cloud (rationale kept private, hash only). Live since 2026-11-09 06:21 UTC (D-AI-2)
- [x] 3. Emergency exit drill: drill build, operator stopped, follower exited pro rata via `PublicPayout` on the real testnet verifier and withdrew to their wallet (docs/testnet.md); emergency banner, Exit button and self-service payout in the UI
- [x] 4. "What the chain sees" page (`/chain/`): observer, follower and leader views of the manual vault, real testnet data, disclosure verified in the browser
- [x] 5. Landing page + GitHub Pages deploy: https://amityadav0.github.io/silent-partner/
- [x] 6. UX: position P&L, withdrawal tracks, create-vault wizard, sparklines and sorting, RPC fallback, docs/screens refreshed
- [x] 7. Hardening: property and fuzz tests (found the leader-stake and duplicate-token bugs), fresh-context review, fixes (D-H-2; critical payout double-pay closed and checked on testnet), the rest listed in threat-model §7
- [x] after 7: reproducible mainnet wasm rebuilt at 9aed265 (D-P5-4), NEEDS-AMIT §3 updated

## Follow-ups (Nov 9, second list)
- [x] 1. Self-sustaining season scheduler (15-min loop for ~5h30m, then re-dispatch; cron backup at :07/:22/:37/:52; sealed manual-signal inbox). D-S-8
- [x] 1b. Loop ticks landed on season-state 15 min apart (05:11:47, 05:26:54 UTC), and a sealed manual signal went inbox → executed (docs/testnet.md)
- [x] 2. NAV bound from a public price (Pyth-compatible oracle), withdrawals at min(NAV_t, NAV_t+1), property tests, threat-model §7; season vaults migrated (D-H-3)
- [x] 2b. Bounded posts verified on the season vaults (honest epoch 7 accepted; a +20% lie rejected on-chain, docs/testnet.md); mainnet wasm rebuilt at 72b9614 (D-P5-5)

## AI leader (Nov 9)
- [x] NEARAI_API_KEY → repo secret; AI leader deciding every tick on NEAR AI Cloud (D-AI-2)
- [x] AI leader is an active allocator: target weight 0–100%, trades on ≥ 5-point moves, public log = bucket + rationale hash (D-AI-3)
- [ ] first AI signal on-chain (rationale hash only, rationale sealed); see docs/testnet.md
- [x] Price source: 1Click-signed dry quotes for the NAV band (replaces Pyth on mainnet, D-H-5); testnet run: honest posts accepted, +20% rejected
- [x] reproducible mainnet wasm rebuilt at 1b1ec1a (D-P5-6), NEEDS-AMIT §3 updated

## NAV price review (Nov 9)
- [x] fresh-context review of the NAV price path; 6 findings fixed (D-H-6); testnet rerun: honest accepted, +20% and reused quotes rejected
- [x] threat-model §7 row 16: quote shopping bounded (≈1.85%/post, ≈3.6%/24h with mainnet params)
- [x] reproducible mainnet wasm rebuilt at f97e5c0 (D-P5-7); NEEDS-AMIT §3 hash

## Next
- Season items 1–7 are done. Watch the season cron: the workflow is active, but GitHub hadn't fired a scheduled run 70 minutes after it landed (2026-11-09 04:16 UTC); both manual runs succeeded. If it stays silent, trigger with `gh workflow run season.yml`.
- Mainnet still waits for Amit (§1 round trip, §3 OK; new artifact hash in §3, plus the plain-nonce check before payouts). P7 on Nov 14.

## Blockers
- Waiting on Amit: §1 the $1 round trip, then §3 the mainnet OK. §4–6 (video, X post, application) are his.
