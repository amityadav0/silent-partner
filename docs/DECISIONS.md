# Decisions

Each decision is dated, with its reason.

- **D-P0-1 (2026-11-07) Toolchain.** Rust 1.98.1 with near-sdk 5.30 and cargo-near 0.22.0, the same pin as ~/scope. That keeps the reproducible-build image identical.
- **D-P0-2 (2026-11-07) Carry-over.** Files are copied into `operator/src/carry/`, `operator/scripts/` and `docs/`. Nothing imports from ~/scope. One fix: `receipt.ts` called `require()`, which breaks under ESM, and now uses an import.
- **D-P0-3 (2026-11-07) Dependencies.** Operator dependencies are pinned to the exact versions in scope's lockfile. Web reuses scope's package-lock (Next 15.5, React 19.1, wallet-selector 10.1.4).
- **D-P0-4 (2026-11-07) Branch.** Work happens on `master`, which is the local default, and is pushed to `origin/master`.
- **D-P0-5 (2026-11-07) Safety default.** The operator runs with `DRY_RUN=1` unless it is explicitly set to `0`. Nothing is signed or submitted against mainnet without Amit's OK.
