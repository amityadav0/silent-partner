# Status

If restarted: read this file first and continue from the first unchecked item.
Deadline: 2026-11-14 18:00 UTC.

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
- [ ] re-run all tests, final push

## Season (Nov 9–13): items from Amit's list, in order
- [x] 1. Paper season: 4 demo vaults + drill vault on testnet, bots, operator in paper mode at real 1Click dry-quote prices, GitHub Actions cron every 15 min, honest "paper · testnet" labels
- [x] 2. AI leader on NEAR AI Cloud (rationale kept private, hash only). Waiting on `NEARAI_API_KEY` (NEEDS-AMIT §7); it holds until then
- [x] 3. Emergency exit drill: drill build, operator stopped, follower exited pro rata via `PublicPayout` on the real testnet verifier and withdrew to their wallet (docs/testnet.md); emergency banner, Exit button and self-service payout in the UI
- [x] 4. "What the chain sees" page (`/chain/`): observer, follower and leader views of the manual vault, real testnet data, disclosure verified in the browser
- [x] 5. Landing page + GitHub Pages deploy: https://amityadav0.github.io/silent-partner/
- [x] 6. UX: position P&L, withdrawal tracks, create-vault wizard, sparklines and sorting, RPC fallback, docs/screens refreshed
- [ ] 7. Hardening: property tests, fresh-context review, fixes, threat-model list
- [ ] after 7: rebuild the reproducible mainnet wasm and update NEEDS-AMIT §3 (contract changed in D-S-1)

## Next
Season items 2–7 (above), then rebuild the mainnet wasm hash. Mainnet still waits for Amit (§1, §3).

## Blockers
- Waiting on Amit: §7 the NEAR AI key (the AI vault holds meanwhile). §1 the $1 round trip, then §3 the mainnet OK. §4–6 (video, X post, application) are his.
