# Decisions

Each decision is dated, with its reason.

- **D-P0-1 (2026-11-07) Toolchain.** Rust 1.98.1 with near-sdk 5.30 and cargo-near 0.22.0, the same pin as ~/scope. That keeps the reproducible-build image identical.
- **D-P0-2 (2026-11-07) Carry-over.** Files are copied into `operator/src/carry/`, `operator/scripts/` and `docs/`. Nothing imports from ~/scope. One fix: `receipt.ts` called `require()`, which breaks under ESM, and now uses an import.
- **D-P0-3 (2026-11-07) Dependencies.** Operator dependencies are pinned to the exact versions in scope's lockfile. Web reuses scope's package-lock (Next 15.5, React 19.1, wallet-selector 10.1.4).
- **D-P0-4 (2026-11-07) Branch.** Work happens on `master`, which is the local default, and is pushed to `origin/master`.
- **D-P0-5 (2026-11-07) Safety default.** The operator runs with `DRY_RUN=1` unless it is explicitly set to `0`. Nothing is signed or submitted against mainnet without Amit's OK.
- **D-P1a (2026-11-07) The vault key is MPC-controlled. The operator holds no vault key.**
  - **Question.** Can a contract-controlled ed25519 key (Chain Signatures, EdDSA domain) be registered on intents.far and sign transfer intents?
  - **Answer: yes.** It needs no registration.
  - **Source.** From near/intents at `32cd1f97` (2026-11-04):
    - `intents.far` is the defuse contract built with `--features far`, which is `imt` plus a DAO-only `force_add_public_keys`, deployed on the separate FAR chain. A NEAR contract therefore cannot authenticate there as the predecessor. Accounts on FAR sign `MultiPayload`s instead.
    - An implicit account (`hex(ed25519 pk)`) is authorised by its own key without `add_public_key` (`PublicKey::from_implicit_account_id`). NEP-413 verification is `ed25519.verify(pk, sha256(borsh((2^31+413, payload))), sig)` (`crates/signatures/nep413`).
    - The intents team ships an on-chain MPC ed25519 signer for exactly this purpose (`crates/mpc/signer`: `Payload::Eddsa`, `MAINNET_MPC_CONTRACT_ID = v1.signer`).
  - **Test.** `operator/scripts/p1-mpc-eddsa-probe.ts`, record in `docs/probes/p1-mpc-eddsa.json`:
    - Testnet MPC `v1.signer-prod.testnet` has domain 1 = FROST (EdDSA), Running.
    - The key derived for `(sp-probe-1794059432.testnet, "silent-partner/vault/probe")` is implicit account `da0d924d…0c77`. MPC `sign` with `payload_v2.Eddsa = NEP-413 prehash` returned an Ed25519 signature in 6.5 s, and it verifies locally.
    - A mainnet **read-only** `simulate_intents` on `intents.near` accepted the signed payload (`intents_executed` for that implicit account). The tampered copy panicked with `invalid signature`.
  - **Not tested directly.** The FAR-chain endpoint itself (intents.far). It runs the same verifier crate, and the recipient string is the only difference (`intents.far`). The first real check is the $1 round trip in NEEDS-AMIT.md.
  - **Design consequence.**
    - The vault's confidential account is the implicit account of `derived_public_key(vault_contract, "silent-partner/vault/<id>", domain 1)`.
    - The contract builds each intent message itself and asks `v1.signer` to sign it. It signs only:
      - (i) a transfer to a 1Click deposit address taken from a 1Click-signed, non-dry quote that the contract verifies on-chain (signature code carried over from scope; amount bound to `amountIn`);
      - (ii) withdrawals to the withdrawing holder's registered exit account;
      - (iii) in emergency mode, pro-rata exits that anyone can trigger.
    - The operator chooses trades and posts NAV but cannot move funds anywhere else. That is the trust assumption the README will state.
  - **Fallback.** If 1Click limit orders (no signed quote) are needed, the contract allows a transfer to an order deposit address only when the operator co-signs and the amount is ≤ the signal's % of NAV. Recorded as an operator-trust exception in the threat model.
- **D-P1b (2026-11-07) Round-trip path.**
  - **Route.** Public `intents.near` USDC → 1Click shield (`INTENTS → CONFIDENTIAL_INTENTS`, same asset) → unshield (`CONFIDENTIAL_INTENTS → INTENTS`). This needs no origin chain and has 0 app fees (dry quotes, `docs/probes/p1-roundtrip-dry.json`).
  - **Script.** `operator/scripts/roundtrip.ts` is dry by default. Live mode needs `ROUNDTRIP_LIVE=1` plus the account id typed at the prompt, and Amit runs it himself.
  - **Vault deposits.** The same shield route will carry follower deposits into the vault: a follower deposits to the vault's public intents account, and the operator shields.
- **D-P1c (2026-11-07) No OutLayer.** The operator is our own service.
  - **Cost.** OutLayer costs 0.0015 NEAR per 5 s run on-chain (live `get_pricing`), or needs a $1 prepaid key for HTTPS.
  - **Why not.** It would only attest the NAV computation, and P1a already removes the operator's custody. That's not worth a payment dependency before the deadline. It can be added later only if Amit approves the payment.
