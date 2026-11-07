# Kill tests: private copy-vault

Runs on 2026-11-07:

- **Aurora:** `https://intents-api.aurora.dev` at 13:20 UTC, with the Aurora Studio key as a path segment.
- **1Click:** `https://1click.chaindefuser.com` at 13:33 UTC, with the partner JWT and SDK 0.1.26.

Re-run them with:

```sh
cd api && npx tsx --env-file-if-exists=../.env scripts/copyvault-aurora.ts <out.json>
cd api && npx tsx --env-file-if-exists=.env scripts/copyvault-oneclick.ts ../docs/copyvault-oneclick.json
```

`docs/copyvault-oneclick.json` is the full 1Click record, scrubbed. It contains no partner JWT (checked) and no user tokens. The earlier keyless 1Click attempts use `api/scripts/copyvault-probes.ts`.

Safety:

- **Throwaway account:** each run makes a new ed25519 key in memory. It is never printed or written. The implicit account is the hex public key.
- **Redaction:** the key, which appears in URL paths, is scrubbed from every record, as are the access and refresh tokens.
- **Nothing moved:** no funds moved, no funding intent was signed or submitted, and nothing was deployed.
- **Mainnet reads only:** the one mainnet call was a read of the `intents.near` `current_salt` view.

| # | Probe | Aurora (`intents-api.aurora.dev`, key in path) | 1Click (`1click.chaindefuser.com`, partner JWT) |
|---|---|---|---|
| — | User session (NEP-413 login) | **PASS**: 200 in 318 ms; `expiresIn` 900, `refreshExpiresIn` 604800 | **PASS**: 200 in 1430 ms; same expiries. No partner credential needed |
| 1 | Confidential dry quote | **PASS**: 200 in 529–581 ms. The user Bearer token is optional. **appFees 45 bps** | **PASS**: 200 in 656–665 ms. Needs the partner JWT; the user token is optional. **appFees 20 bps** |
| 2 | Balances, user token | `[]` (200, 367 ms) | `[]` (200, 362 ms) |
| 3 | Unfunded confidential LIMIT SELL | **BLOCKED**: no documented orders route; inferred `/api/orders/{key}` returned 404 | **PASS**: created `AWAITING_DEPOSIT` (651 ms). generate-intent 200 (unsigned payload saved), cancel 200 → `PENDING_CANCEL`, list 200 |
| 4 | History, user token | Invite-only: HTTP 400, body `statusCode: 403` | **Invite-only too**: 403 "History is invite-only for now", with or without the partner JWT |
| — | OutLayer HTTPS GET | **DEFERRED: paid** | — |

No response carried correlation headers. The IDs below come from the response bodies.

## Fees: 1Click vs Aurora

| | Aurora | 1Click direct |
|---|---|---|
| appFees | `widget_collect.sputnik-dao.near` **25** + `2238fd08…07805` **20** = **45 bps** | `2238fd08…07805` **20** = **20 bps** |
| amountOut for 1 USDC (dry) | 0.269693 wNEAR (13:20 UTC) | 0.268190 wNEAR (13:33 UTC) |
| Extra `quoteRequest` fields | `referral: "aurora-176if1z8t5"` | `insured: false`, `userAccountId` (the user session's account) |

- **The 20 bps recipient is the same account on both** (`2238fd089f1c92b206c218cd16b8676cb98964e0d50f8ab729c6396a81e07805`). Aurora's extra **25 bps** goes to `widget_collect.sputnik-dao.near`. Going direct to 1Click saves exactly those 25 bps.
- **The two amountOut values are not comparable.** The quotes are 13 minutes apart, and the market moved more than 25 bps (about 0.00067 wNEAR) in that time. Compare the fee lists, not the outputs.

## Endpoints

The base URL is `https://intents-api.aurora.dev`, and the key is the `{apiKey}` path parameter.

| Operation | Path | Source |
|---|---|---|
| authenticate | `POST /api/auth/authenticate/{apiKey}` | Aurora docs (Confidential Swaps API reference) |
| refresh | `POST /api/auth/refresh/{apiKey}` | Aurora docs |
| balances | `GET /api/account/balances/{apiKey}`, Bearer user JWT | Aurora docs |
| history | `GET /api/account/history/{apiKey}`, Bearer user JWT; `status`, `depositType`, `recipientType`, `refundType` required | Aurora docs |
| quote | `POST /api/quote/{apiKey}` | Amit; not in the docs index |
| orders, generate-intent, tokens | — | **not in the docs index** |

Every spec has `"security": []`. Auth is described only in the operation text.

## Probe 2: login (PASS)

The payload is the same as for 1Click: `{"signedData": {standard: "nep413", payload: {message, nonce, recipient: "intents.near"}, public_key, signature}}`.

- **Message:** `{"signer_id": "<implicit>", "deadline": "<now+60s>", "intents": []}`.
- **Nonce:** a defuse versioned nonce, laid out as `56 28 f6 c6 ‖ 00 ‖ salt ‖ deadline ns u64 LE ‖ signing time ns u64 LE ‖ random(7)`.
  - The salt is read live from `intents.near` `current_salt`.
  - A signing time that is not in nanoseconds fails with 401 "timestamp validation failed". That was found on 1Click; Aurora uses the same payload.

| Call | Status | Latency | Body |
|---|---|---|---|
| authenticate | 200 | 318 ms | `expiresIn: 900`, `refreshExpiresIn: 604800`, tokens redacted |
| balances | 200 | 367 ms | `{"balances": []}` |
| history | **400** | 208 ms | `{"message": "History is invite-only for now", "error": "Forbidden", "statusCode": 403}`: the HTTP status and the body disagree |

**An implicit account with no deposits, and no `add_public_key` on `intents.near`, can log in.**

## Probe 1: confidential dry quote (PASS)

Request body:

```json
{"dry": true, "swapType": "EXACT_INPUT", "slippageTolerance": 100,
 "originAsset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
 "destinationAsset": "nep141:wrap.near", "amount": "1000000",
 "depositType": "CONFIDENTIAL_INTENTS", "recipientType": "CONFIDENTIAL_INTENTS", "refundType": "CONFIDENTIAL_INTENTS",
 "confidentiality": "advanced", "recipient": "<implicit>", "refundTo": "<implicit>", "deadline": "<now+10m>"}
```

| Variant | Status | Latency | correlationId |
|---|---|---|---|
| `Authorization: Bearer <user JWT>` | 200 | 581 ms | `36cb5223-7293-45d9-a0ec-69cf8b58715d` |
| no Bearer | 200 | 529 ms | `17453b51-80f6-4d1f-8bfb-fb4670db3a3f` |

**The Bearer token makes no difference.** Both responses carry an identical quote. On Aurora, the key in the path is enough for a confidential quote. Direct 1Click without a user session refused the same quote ("User authentication is required for confidential intent quotes").

The response top-level keys are `timestamp`, `signature` (`ed25519:…`), `correlationId`, `quoteRequest` and `quote`. Aurora adds these to `quoteRequest`:

- **Defaults:** `depositMode: "SIMPLE"` and `quoteWaitingTimeMs: 0`.
- **Referral:** `referral: "aurora-176if1z8t5"`.
- **App fees:** `appFees: [{recipient: "widget_collect.sputnik-dao.near", fee: 25}, {recipient: "2238fd08…07805", fee: 20}]`, that is **45 bps** in total.

The quote:

```json
{"timeEstimate": 12, "amountIn": "1000000", "amountInFormatted": "1.0", "amountInUsd": "0.999697000000",
 "minAmountIn": "1000000", "amountOut": "269693495825345351043642", "amountOutFormatted": "0.269693495825345351043642",
 "amountOutUsd": "0.992472064637", "minAmountOut": "266996560867091897533205", "refundFee": "0", "withdrawFee": "0"}
```

1 USDC buys 0.26969 wNEAR, worth $0.9925, so the round trip costs about 0.72% including the 45 bps. A direct keyless 1Click public quote earlier the same day gave 0.27054 wNEAR. Being dry, the quote has no deposit address.

## Probe 3: unfunded confidential order (BLOCKED)

Aurora's docs index has no orders, generate-intent or tokens pages. Following the `/api/<op>/{apiKey}` pattern, I tried one inferred path:

| Call | Status | Latency | Body |
|---|---|---|---|
| `POST /api/orders/{key}`, Bearer user JWT, JSON:API `{"data": {"type": "orders", "attributes": {…}}}` | **404** | 165 ms | `Route POST:/api/orders/[REDACTED] not found` |

The order was a LIMIT SELL of 1 USDC at a price of 1000 wNEAR, with confidentiality `advanced`, every type `CONFIDENTIAL_INTENTS`, and a 60 s deadline. I did not try other paths. Two questions stay open: whether an unfunded order is accepted in a pending state, and what generate-intent returns. Both need the real orders route from Aurora.

## Probe 4: OutLayer (DEFERRED: paid)

There is no free compute path:

- **On-chain:** `request_execution` on `outlayer.near` / `outlayer.testnet` needs NEAR attached.
- **HTTPS API:** needs a prepaid payment key of at least $1.
- **Trial key:** 10 calls, tied to a wallet.

Outbound HTTPS needs `wasm32-wasip2`. Successful calls return an `attestation_url`.

## 1Click with the partner JWT (2026-11-07, 13:33 UTC)

The run used the throwaway account `0d4ac075…e02793`.

### Probe 1: credential matrix for the confidential dry quote

| Credential variant | Status | Latency | appFees | correlationId |
|---|---|---|---|---|
| `X-API-Key`=partner + `Bearer`=user | **200** | 658 ms | 20 bps | `d5c3f9f5-63d5-4ee7-a6cb-ef986de6e637` |
| `X-API-Key`=partner only | **200** | 656 ms | 20 bps | `b5708e76-f0f9-4474-8c59-dd81b69ae32c` |
| `Bearer`=user only | 401 "Invalid token" | 323 ms | — | — |
| `Bearer`=partner only | **200** | 665 ms | 20 bps | `b7d02cef-e067-4616-8294-33e822546751` |

- **The partner JWT is what authorises a confidential quote.** It works as `X-API-Key` or as `Bearer`. The user session token is optional, and on its own it gets 401.
- **With the user token,** 1Click adds `userAccountId` to the `quoteRequest`.
- **Earlier, with no credential,** the response was 401 "User authentication is required for confidential intent quotes". That wording was misleading: the partner credential is the one that was needed.

Quote (partner + user):

```json
{"amountIn": "1000000", "amountInUsd": "0.999663000000", "amountOut": "268189850390144931433180",
 "amountOutFormatted": "0.26818985039014493143318", "amountOutUsd": "0.989620547940",
 "minAmountOut": "265507951886243482118848", "timeEstimate": 12, "refundFee": "0", "withdrawFee": "0"}
```

### Probe 3: unfunded order → generate-intent → cancel → list

Every call used `X-API-Key`=partner + `Bearer`=user, which was the first variant tried and was accepted.

| Call | Status | Latency | correlationId | Result |
|---|---|---|---|---|
| createOrder | 200 | 651 ms | `32ca7491-75c9-42c0-98fe-f169b9f6c485` | `order_yYix68O4s0dYt14Kp1Ez2`, `fillStatus: AWAITING_DEPOSIT`, `payoutStatus: NOT_STARTED`, `depositedAmount: 0` |
| generateIntent | 200 | 369 ms | `1f3fbd38-fd80-44aa-b664-ce4ad5f0d287` | unsigned NEP-413 payload, below |
| getOrder | 200 | 348 ms | `491d1eb4-8b27-4e65-9d7b-616e0b2b3612` | still `AWAITING_DEPOSIT` |
| cancelOrder | 200 | 346 ms | `af66668c-744d-46ef-950b-9c858a141bbe` | `fillStatus: PENDING_CANCEL` |
| listOrders | 200 | 410 ms | `948119e1-34ee-4b7c-8f4f-50d8be6c3c01` | the one order, `PENDING_CANCEL` |

**1Click accepts an unfunded order and holds it as pending until funded.** What the order record shows:

- **Deposit address:** `depositAddress` is a 64-hex implicit account, `a555635c…cd5642`.
- **Price:** a price of 1000 became `swapView.minAmountOut = 1e27` (1000 wNEAR), `EXACT_INPUT`.
- **Fees and order settings:** `appFees` is 20 bps, `timeInForce` is `GTC` (the deadline still applies), and `estimatedWithdrawFee` and `estimatedRefundFee` are 0.

The unsigned intent from `generate-intent`, **never signed and never submitted**:

```json
{"standard": "nep413", "payload": {
  "message": "{\"deadline\":\"2026-11-07T13:34:24.444Z\",\"intents\":[{\"intent\":\"transfer\",\"receiver_id\":\"a555635c46126bcdf9b19813816426e7cdf71d66ad9721e5bc3a6875e4cd5642\",\"tokens\":{\"imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1\":\"1000000\"}}],\"signer_id\":\"0d4ac075c623c60efd1102572523a9f9b784885841e90a24864e60dab5e02793\"}",
  "nonce": "Vij2xgDhEPMXAKd3B6vG5RhBVeL9AuFIA1IZaLl832U=",
  "recipient": "intents.far"}}
```

Three things in this payload matter for the design:

- **The NEP-413 recipient is `intents.far`, not `intents.near`.** Confidential funding is signed for a different verifying contract than the login.
- **The token is an `imt:` wrapper**, `imt:51e8f94d…7cbe:nep141:<USDC>`, rather than plain `nep141:<USDC>`. The balance a confidential order spends is held as a distinct token id.
- **The intent is a plain `transfer`** of 1 USDC to the order's deposit address. The intent deadline is the order deadline, and the nonce is server-generated.

### Probe 4: history

`getHistory` with `Bearer`=user returned **403** "History is invite-only for now", and so did partner + user. 1Click is invite-only too, so history is not a route around Aurora.

## Earlier attempts without a working 1Click credential (same day)

- **The Aurora key is not a 1Click credential.** It got 401 "Invalid token" as a Bearer token and as `X-API-Key`, even on a plain quote. The same plain quote with no key returned 201.
- **Confidential quotes on 1Click** with no key return 401 "User authentication is required for confidential intent quotes". With the user JWT they return 401 "Invalid token".
- **1Click login works:** `POST /v0/auth/authenticate` returns 200 with the same payload. Balances are `[]` and history is 403 invite-only.
- **1Click `/v0/orders`** with only the user JWT returns 401 `authentication-required` (correlationIds `e00b7736-…`, `9de3be1a-…`, `6d0ca051-…`).

## To finish

1. **Aurora probe 3 (optional):** get the orders and generate-intent routes for `intents-api.aurora.dev` from Aurora. The 1Click run already answers the order questions.
2. **History** is invite-only on both. Ask 1Click for history access, or keep our own history from `listOrders` and `getOrder`.
3. **OutLayer** when a paid path is chosen.

A first try with a malformed `ONECLICK_JWT` (66 characters, not JWT-shaped) got 401 everywhere, even on a plain quote. Its correlationIds were `19f7c3b3-…`, `8da9380c-…`, `4d10fee5-…` and `4ae0f4d8-…`. The value was then fixed to the full 538-character JWT, and the 13:33 run above used it.
