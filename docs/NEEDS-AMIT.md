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

## 3. Mainnet runbook (P5)

**Status:** waiting for your OK. Do §1 (the $1 round trip) first. Nothing below has been run.

Every command is yours to sign. The operator steps (`op.ts`) print what they will do and wait for `yes`. I run nothing on mainnet without your OK in chat; once you give it, we go step by step and I record every tx in `docs/mainnet.md`.

**Budget**

| Item | Amount |
|---|---|
| Vault account | about 4.5 NEAR (the code is ~310 KB; ≈3.2 NEAR is locked as storage) |
| Operator account | about 1 NEAR, for gas. `sign_intent` uses up to 300 TGas, about 0.03 NEAR each |
| Leader deposit | 2 USDC |
| Follower deposit | 5 USDC |

1Click shield and unshield fees are 0. Trades pay 20 bps.

**Accounts** (my suggestion; pick your own):

| Placeholder | Suggestion |
|---|---|
| `<VAULT>` | `sp-vault.<you>.near` (new) |
| `<OPERATOR>` | `sp-op.<you>.near` (new) |
| `<LEADER>` | an account you control |
| `<FOLLOWER>` | a second account you control |

Replace the placeholders in `docs/mainnet-init.json`. The attestation key in that file is the operator's mainnet NAV key. Its private half is in `operator/data/mainnet-keys.json`, which is gitignored.

**0. Check the artifact.** `contract/target/near/silent_partner.wasm` from `cargo near build reproducible-wasm` should hash to `sha256 = 5195977e740eba227d60707fb8dfeb4c3ca168acfd09041d24cf56726e86192f` (base58 `6VUKkPFgpJWk3ZjknAbf8JcPPJJqB4KD54Bwsh44xUD4`, 408,440 bytes). It's built from commit `44e3995` (the NAV band priced by 1Click-signed quotes with the review fixes in D-H-6, deposits for a named beneficiary for cross-chain follows, and copy stop-loss; `docs/mainnet-init.json` sets `nav_quotes` for USDC/wNEAR, a 1 h minimum post interval and `nav_oracle: null`) with image `sourcescan/cargo-near:0.22.0-rust-1.98.1`. After the deploy, `near contract view-code-hash`, or the account's `code_hash`, must show that base58 value. If Docker's credential helper hangs, set `DOCKER_CONFIG` to a directory containing an empty `config.json`.

**1. Create the accounts.** Two txs:
```sh
near account create-account fund-myself <VAULT> '4.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as <you>.near network-config mainnet sign-with-keychain send
near account create-account fund-myself <OPERATOR> '1 NEAR' autogenerate-new-keypair save-to-keychain sign-as <you>.near network-config mainnet sign-with-keychain send
```

**2. Deploy and init** in one tx:
```sh
near contract deploy <VAULT> use-file contract/target/near/silent_partner.wasm with-init-call new file-args docs/mainnet-init.json prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
near contract call-function as-read-only <VAULT> get_config json-args {} network-config mainnet now
```
Check that `oneclick_key` = `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`.

**3. Register storage.** USDC storage for the vault and for both depositors, since a refunded deposit needs it:
```sh
for a in <VAULT> <LEADER> <FOLLOWER>; do near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 storage_deposit json-args "{\"account_id\":\"$a\"}" prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as <OPERATOR> network-config mainnet sign-with-keychain send; done
```

**4. Activate.** The vault learns its MPC key from `v1.signer`:
```sh
near contract call-function as-transaction <VAULT> activate json-args {} prepaid-gas '50 Tgas' attached-deposit '0 NEAR' sign-as <OPERATOR> network-config mainnet sign-with-keychain send
near contract call-function as-read-only <VAULT> get_vault json-args {} network-config mainnet now
near contract call-function as-read-only v1.signer derived_public_key json-args '{"path":"silent-partner/vault","predecessor":"<VAULT>","domain_id":1}' network-config mainnet now
```
`vault_account` must equal the hex of that key. I'll check it.

**5. Register the leader's signal key.** Use either:
- **The web leader console:** connect `<LEADER>` and click "Create and register a signal key". This is one wallet tx.
- **The CLI:** `near contract call-function as-transaction <VAULT> set_signal_key json-args '{"public_key":"<pk>"}' … sign-as <LEADER>`, then put the private key in `.env` as `LEADER_SIGNAL_KEY`.

**6. Deposits.** Two txs: the leader seeds the vault, then the follower deposits (the leader ends with 2/7 = 28.6% ≥ 10%):
```sh
near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 ft_transfer_call json-args '{"receiver_id":"<VAULT>","amount":"2000000","msg":""}' prepaid-gas '150 Tgas' attached-deposit '1 yoctoNEAR' sign-as <LEADER> network-config mainnet sign-with-keychain send
near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 ft_transfer_call json-args '{"receiver_id":"<VAULT>","amount":"5000000","msg":""}' prepaid-gas '150 Tgas' attached-deposit '1 yoctoNEAR' sign-as <FOLLOWER> network-config mainnet sign-with-keychain send
```
The contract mints shares and forwards the USDC to `intents.near`, credited to the vault's MPC account. The web vault page works for this too.

**7. Configure the operator.** Add these lines to `.env` (operator key from `~/.near-credentials/mainnet/<OPERATOR>.json`):
```sh
NEAR_NETWORK=mainnet
VAULT_CONTRACT_ID=<VAULT>
OPERATOR_ACCOUNT_ID=<OPERATOR>
OPERATOR_PRIVATE_KEY=ed25519:...
ATTESTATION_PRIVATE_KEY=<from operator/data/mainnet-keys.json>
MAINNET_WRITES=1
DRY_RUN=0
MAINNET_LIVE_OK=1
DATA_DIR=./data-mainnet
```
Then run `cd operator && npx tsx --env-file-if-exists=../.env scripts/op.ts status`, which is read-only.

**8. Shield.** This is the first MPC-signed intent on mainnet: an `intents.near` transfer of 7 USDC to a 1Click shield deposit address, which credits the vault's confidential account.
```sh
npx tsx --env-file-if-exists=../.env scripts/op.ts shield
```

**9. First NAV.**
```sh
npx tsx --env-file-if-exists=../.env scripts/op.ts epoch
```
This posts epoch 1 with NAV ≈ 7 USDC.

**10. One leader trade.** This is the first MPC-signed `intents.far` transfer: 25% of NAV, USDC → wNEAR, one confidential 1Click quote for the whole vault. The signal hash is then recorded on-chain.
```sh
npx tsx --env-file-if-exists=../.env scripts/op.ts signal nep141:wrap.near 2500
```

**11. One withdrawal.** The follower requests 2,000,000 shares:
```sh
near contract call-function as-transaction <VAULT> request_withdraw json-args '{"shares":"2000000","exit_account":"<FOLLOWER>"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as <FOLLOWER> network-config mainnet sign-with-keychain send
npx tsx --env-file-if-exists=../.env scripts/op.ts epoch
```
The epoch call:
- posts epoch 2;
- burns the shares at that NAV and opens the claim;
- unshields the payout to `<FOLLOWER>`'s `intents.near` balance (MPC-signed `intents.far` payout);
- settles the claim.

**12. Optional: withdraw to the wallet.** The follower takes the USDC off intents with `intents.near ft_withdraw {"token":"17208628…33a1","receiver_id":"<FOLLOWER>","amount":"<claim amount>"}`, attaching 1 yocto.

**If a step fails:**
- **No funds are lost.** Funds stay in the vault, because the contract only signs transfers back to the vault or to a claim's exit account.
- **USDC stuck in the contract** (forward failed): `forward_to_intents`.
- **A failed shield, trade or payout** shows up in the fill log as a note. Payouts are released after their deadline.
- **No NAV for 24 h:** anyone can trigger emergency mode, and holders exit at the last NAV.
- **Keys to delete afterwards:** the vault account's full-access key is kept for the demo (D-P5-1).


> **Before any real payout on mainnet (added 2026-11-09, D-H-2):** payouts now go through `PublicPayout` on `intents.near` with a *plain* (non-versioned) NEP-413 nonce, settled via `is_nonce_used`. First run a read-only `simulate_intents` of a plain-nonce transfer signed by the vault key (no funds move) to confirm that mainnet `intents.near` still accepts legacy nonces. If it doesn't, the contract needs a different settlement proof before mainnet payouts.

## 4. Demo video (P6): you record it

Follow the script in [demo-script.md](demo-script.md): 3:00, a screen recording with a voiceover. The setup commands are at the top of the script. Every screen it uses works today on testnet. If the mainnet run (§3) is done first, end on docs/mainnet.md.

## 5. X post (P6): you post it

The required parts are: "built at NEAR HACKATHON", @NEARProtocol and #NEARHackathon. Optional tags: @NearLegion and @NearBuilders. Attach the video, or the Conviction track-record card from `https://raw.githubusercontent.com/amityadav0/silent-partner/season-state/cards/sp-convict-8952.testnet.png`.

> Copy trading puts your orders behind the leader's, and puts the leader's whole book in public.
>
> Silent Partner fixes both on NEAR: one private vault, one fill, one price for leader and followers.
> • Confidential Intents keeps positions private
> • A Chain Signatures key held by the contract: nobody can take the funds
> • AI leaders run on NEAR AI; their reasoning stays private, committed on-chain by hash
> • Follow from Base, Arbitrum, Ethereum or Solana in one step via 1Click
>
> Built at NEAR HACKATHON @NEARProtocol #NEARHackathon @NearBuilders
> Try it, no wallet needed: amityadav0.github.io/silent-partner
> Code: github.com/amityadav0/silent-partner
>
> Would you copy a trader you can't see, if the chain proves their returns?

It's about 640 characters. If your account has a 280-character limit, post the first two lines plus the links, and put the bullets and the question in a reply.

## 6. Hackathon application (P6): you submit it

This is `POST https://nearhackathon.com/api/applications` with `Content-Type: application/json`.
- Send the fields below and no others. Do **not** send `website`: it's a spam trap.
- Submit once. Fixes go through https://nearhackathon.com/request-changes.
- The deadline is 2026-11-14 23:59 UTC, and the repo must be public by then (it is).

Fill in the four `<…>` fields, then set `requestId` once with `uuidgen | tr A-Z a-z` and reuse it on any retry.

```json
{
  "requestId": "<uuid>",
  "projectName": "Silent Partner",
  "leadName": "Amit Yadav",
  "email": "<your email>",
  "size": "1",
  "tracks": ["privacy", "defi", "agents"],
  "nearAddress": "<your mainnet account, e.g. amit.near>",
  "projectUrl": "https://github.com/amityadav0/silent-partner",
  "demoUrl": "<URL of your X post>",
  "idea": "Silent Partner is private copy trading on NEAR Confidential Intents. A leader and followers share one vault whose funds sit in a confidential intents account, so the market never sees the book. Each leader signal executes once for the whole pool through one 1Click confidential quote, at one price: nobody can trade ahead of the followers. The vault's intents key is an MPC key derived for the contract (Chain Signatures): it signs only quote-bound transfers back into the vault or a holder's own payout, settled against the verifier's nonce record. Every NAV post must fit NEAR's price move, proven by two 1Click-signed quotes the contract verifies, so an operator can't inflate returns. Holders can always exit pro rata without the operator. Leaders can be human, rule-based, or AI agents on NEAR AI Cloud whose reasoning stays private and is committed on-chain by hash. Live testnet season with 8 leaders: https://amityadav0.github.io/silent-partner/",
  "consent": true
}
```

Tracks (D-S-10):
- **privacy** (primary): positions never public. Confidential Intents holds the funds, fill logs and AI rationales are sealed, and the chain sees only NAV, hashes and claims.
- **defi**: a copy-trading vault with share accounting, a high-water-mark fee, a NAV bounded by 1Click-signed prices, and a permissionless emergency exit.
- **agents**: five AI leaders on NEAR AI Cloud trade autonomously every 15 minutes. Each one's reasoning stays private and is committed on-chain by hash.

Two more rule checks:
- **Two-project rule.** This README already names Scope as a separate project. If you submit Scope, its README needs one line naming Silent Partner. Scope is a private repo: make it public first (§9) or judges can't open it.
- **`consent: true`** means you agree to the site's contact notice. Read it on the form before you send.

## 7. NEAR AI Cloud key for the AI leader (season item 2): DONE (2026-11-09)

**Done.** The key is in `.env` and uploaded as the repo secret `NEARAI_API_KEY`. The AI leader has been deciding on NEAR AI Cloud since the 06:21 UTC tick, at ≈ $0.00037 per tick (D-AI-2). The original instructions follow.

`NEARAI_API_KEY` isn't in `.env`. Until it exists, the AI leader vault (`sp-ai-92991.testnet`) holds: it posts NAV every epoch but sends no signals. The two bot vaults run meanwhile.

1. Create a key at https://cloud.near.ai and add credit. This is paying, so it's yours to do. Cost: the default model `deepseek-ai/DeepSeek-V4.1-Flash-1017` (private TEE inference) is $0.30 / $1.20 per million tokens. One decision is about 600 tokens in and 300 out, so 96 epochs a day is about $0.05/day.
2. Either put `NEARAI_API_KEY=…` in `.env` and tell me (I'll upload it as a repo secret and never print it), or run it yourself:
   ```sh
   gh secret set NEARAI_API_KEY --repo amityadav0/silent-partner   # paste the key at the prompt
   ```
   The next 15-minute tick picks it up. To use another model, set the repo variable/secret `NEARAI_MODEL`.

## 8. ~~Pyth Hermes API key~~: no longer needed (2026-11-09)

Nothing to do. The mainnet NAV band is now priced by two 1Click-signed quotes attached to each post, verified with the vault's immutable `oneclick_key`: no Pyth, no key, no fee (D-H-5). The original text is kept below for the record.

### (superseded) Pyth Hermes API key

The vault now rejects any NAV whose per-share move doesn't fit NEAR's price move (D-H-3). On mainnet it reads `pyth-oracle.near`. Pyth on NEAR is pull-based: its stored NEAR/USD price was 75 days old today, so the operator must push a fresh signed update from Pyth's Hermes service before each NAV post. Hermes now answers `401 unauthorized` without an API key.

1. Get a Hermes API key from Pyth (https://docs.pyth.network): an account signup, so it's yours.
2. Put `PYTH_HERMES_KEY=…` in `.env`. The operator (`src/oracle.ts`, `PythPush`) then calls `update_price_feeds` on `pyth-oracle.near` before each epoch. It pays Pyth's update fee from the operator account: a fraction of a cent per update, but it is a mainnet payment, so it starts only with the rest of §3.
3. A key-free alternative was checked and doesn't work. Burrow's `priceoracle.near` has no fresh prices: every asset reads `null` inside its 90 s window, and the last `wrap.near` report is ~230 days old (D-H-4). So the Pyth key is still needed.
4. Without a key, mainnet NAV posts are rejected ("no fresh oracle price") and the vault goes stale. Alternatively, deploy with `"nav_oracle": null` in `docs/mainnet-init.json` to run without the bound (back to attested-only NAV).

## 9. Optional: make Scope public (submission rules)

The README names Scope as the source of the carried-over code and as a separate project, but `github.com/amityadav0/scope` is private, so judges can't open it. Every carried file is already copied into this repo, so the submission stands either way. If you want the link to work:

```sh
gh repo edit amityadav0/scope --visibility public --accept-visibility-change-consequences
```
