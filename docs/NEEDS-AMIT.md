# Needs Amit

This list holds only what needs you: signatures or real funds, mainnet deploys, paying OutLayer, the video, the X post and the application POST. Everything else I decide and record in DECISIONS.md.

## 1. $1 round trip: public → confidential → public (P1b)

**Status:** waiting for your OK and your signature. Nothing has been signed or sent yet.

**Why:** it proves the confidential leg works end to end with our partner JWT, before any vault money depends on it.

**Already checked (dry, 2026-11-07):** `docs/probes/p1-roundtrip-dry.json`.
- **Shield quote:** `INTENTS → CONFIDENTIAL_INTENTS`, USDC→USDC, 1 USDC: HTTP 201, `amountOut = 1000000`, `appFees = []`, ~10 s.
- **Unshield quote:** the same, the other way: HTTP 201, `amountOut = 1000000`.

**Cost:** 1 USDC goes out and comes back. Fees in the quotes are 0, and gas is about 0.01 NEAR.

### Steps

1. **Pick the account.** Use a mainnet account you control; call it `ACCOUNT`. An implicit (64-hex) account is simplest, because its key is accepted on intents without registration.
2. **Register the key (named accounts only).** For a named account like `amit.near`, register the key you'll sign with on intents.near. This is one tx with 1 yocto:
   ```sh
   near contract call-function as-transaction intents.near add_public_key json-args '{"public_key":"ed25519:<your pk>"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as <ACCOUNT> network-config mainnet sign-with-keychain send
   ```
3. **Put 1 USDC on your public intents balance.** This is one tx. An empty `msg` credits the sender:
   ```sh
   near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 ft_transfer_call json-args '{"receiver_id":"intents.near","amount":"1000000","msg":""}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as <ACCOUNT> network-config mainnet sign-with-keychain send
   ```
   Check it with `intents.near mt_balance_of {"account_id":"<ACCOUNT>","token_id":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"}`, which should return `1000000`. The near.com UI deposit works too.
4. **Run the script.** Add these lines to `.env` yourself and don't paste the key anywhere else:
   ```
   ROUNDTRIP_ACCOUNT=<ACCOUNT>
   ROUNDTRIP_PRIVATE_KEY=ed25519:...
   ```
   Then run:
   ```sh
   cd operator && ROUNDTRIP_LIVE=1 npx tsx --env-file-if-exists=../.env scripts/roundtrip.ts ../docs/probes/p1-roundtrip-live.json
   ```
   It asks you to type the account id, then:
   - signs an empty NEP-413 login (`intents.near`) and gets a session token for balances;
   - **shields** 1 USDC: quote (non-dry) → `generate-intent` → your key signs the NEP-413 transfer (recipient `intents.near`) → `submit-intent` → polls `status` until `SUCCESS`, about 10 s;
   - reads balances, which should show 1 USDC with `source: "private"`;
   - **unshields** 1 USDC: the same three calls, but `generate-intent` returns an **intents.far** transfer of `imt:51e8f94d…7cbe:nep141:<USDC>`, which your key signs → polls until `SUCCESS`;
   - reads balances again, which should show public intents USDC back at 1.
5. **Tell me it's done.** I read `p1-roundtrip-live.json`; it's scrubbed, with no JWT or tokens. Then I record the result in DECISIONS.md and docs/mainnet.md.
6. **Optional: withdraw to NEAR.** `ft_withdraw` on intents.near: `{"token":"17208628…33a1","receiver_id":"<ACCOUNT>","amount":"1000000"}`, 1 yocto.

**Not covered by this run:** the vault key signing on intents.far with MPC. P1a showed intents.near accepts that signature. The FAR leg of an MPC-signed vault is checked in the P5 mainnet runbook.

## 2. OutLayer price for one run (P1c)

**Status:** for info only. Nothing to pay. By default the operator is our own service (D-P1c).

Live from `outlayer.near` (mainnet view calls, 2026-11-07):
- **`get_pricing`:** base fee **0.001 NEAR**, **0.0000000001 NEAR per million instructions** (1e14 yocto), **0.0000001 NEAR per ms** (1e17 yocto), and the same rate per compile-ms.
- **`estimate_execution_cost`** for one run with a 1B-instruction, 5 s limit: **0.0015001 NEAR**, about **$0.006** at ~$3.7/NEAR (from today's dry quote, 1 USDC ≈ 0.268 wNEAR). You're charged on the requested limits and the excess is refunded. Failed runs are not refunded.
- **Paying through the HTTPS API** instead needs a prepaid payment key, minimum **$1** USDC/USDT, with a minimum per-call compute limit of $0.001. The free trial covers only connector calls (10–50, depending on the doc), not our own WASI code.

Using OutLayer would cost about $0.006 per NAV post, plus a $1 key if we go through HTTPS. Say so if you want it. Otherwise it stays off.
