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
- [ ] shares: deposit mints at last NAV; a withdraw request burns at the next NAV
- [ ] leader minimum stake of 10%
- [ ] performance fee with a high-water mark
- [ ] operator-signed NAV per epoch, stored with its timestamp
- [ ] signal registry (hashes posted after execution)
- [ ] emergency mode after 24h with no NAV
- [ ] table tests for every path, clippy clean
- [ ] testnet deploy with faucet accounts

## P3 Operator (Nov 9–10)
- [ ] deposit watcher → mint
- [ ] signed leader signals
- [ ] confidential quote/order execution (dry)
- [ ] append-only hash-chained fill log
- [ ] NAV per epoch → post
- [ ] withdrawals
- [ ] fixture tests

## P4 Web (Nov 10–11)
- [ ] leaderboard
- [ ] vault page
- [ ] leader console
- [ ] share page
- [ ] Playwright smoke tests + docs/screens/

## P5 Mainnet (Nov 12)
- [ ] runbook in NEEDS-AMIT.md
- [ ] Amit OK → run it, record the txs in docs/mainnet.md

## P6 Submission (Nov 13)
- [ ] README, architecture.md, threat-model.md, demo script, X post, application JSON

## P7 Buffer (Nov 14)
- [ ] re-run all tests, final push

## Next
P2 contract: shares, NAV, fee, stake, signals, emergency, MPC-signed intents (D-P1a).

## Blockers
- Waiting on Amit: the $1 round trip (NEEDS-AMIT §1). It doesn't block P2–P4.
