# 1Click quote signatures

Every response from `POST https://1click.chaindefuser.com/v0/quote` carries an ed25519 `signature` by 1Click's quote-signing ("manager") key. Scope verifies it twice. The API checks it with the official SDK before using a quote. `scope.near` checks it again inside `propose_run`, then binds the signed message to the Mandate. The deposit address the signed transfer pays comes only from that verified message.

## Source

| | |
|---|---|
| Package | `@defuse-protocol/one-click-sdk-typescript` |
| Version read | **0.1.26** (npm `latest`, gitHead `414467b879863661e736eab338b316f567db68fe`) |
| Cross-checked | 0.1.24 (gitHead `bf5dad43df41692216bed6c5892f73f5b2f2a0ec`): same key, same construction |
| File | `src/quote-signature.ts` (compiled into `dist/index.mjs`) |
| Repo | https://github.com/defuse-protocol/one-click-sdk-typescript |
| Deps it uses | `json-stable-stringify` 1.3.0, `@noble/hashes` sha256, `@scure/base` base58, `tweetnacl` |

## The key

```
ONE_CLICK_MANAGER_PUB_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc"
```

This is passed to `new(…, oneclick_key)`, readable with the `oneclick_key()` view, and rotated by the admin with `set_oneclick_key`.

## Construction

```text
request = buildSignedQuoteRequest(response)   // explicit field list from response.quoteRequest
quote   = buildSignedQuote(response)          // explicit field list from response.quote
message = json-stable-stringify({ ...request, ...quote, timestamp: response.timestamp })
digest  = base58( sha256( utf8(message) ) )   // a base58 STRING
valid   = ed25519_verify( signature, utf8(digest), manager_key )
```

Details that matter:

1. **What is signed is the base58 text of the hash, not the hash bytes.** The contract computes `bs58::encode(env::sha256(message))` and verifies over its UTF-8 bytes (`contract/src/quote.rs`, `digest_text`).
2. **The fields are allow-listed.** From the request: `dry, swapType, slippageTolerance, originAsset, depositType, destinationAsset, amount, refundTo, refundType, recipient, recipientType, deadline`, plus `quoteWaitingTimeMs, referral, virtualChainRecipient, virtualChainRefundRecipient, customRecipientMsg` when set. `sessionId, connectedWallets, correlationId, appFees, partnerId, userAccountId, depositMode` are always dropped.
   From the quote: `amountIn, amountInFormatted, amountInUsd, minAmountIn, amountOut, amountOutFormatted, amountOutUsd, minAmountOut`, plus, for non-dry quotes only, `depositAddress, depositMemo, deadline, timeWhenInactive, timeEstimate, refundFee, withdrawFee` when set.
3. **The quote's fields override the request's in the merge.** A non-dry quote's `deadline` is the quote's own, and the contract uses that one.
4. **Undefined values are dropped**, and keys are sorted with no whitespace (json-stable-stringify).
5. **Dry quotes are signed too, but carry no `depositAddress`.** The contract refuses them (`QuoteIsDry`).
6. `signature` is `ed25519:<base58 of 64 bytes>`.

The SDK exports `verifyQuoteSignature` and `quoteHash`, but not the field builders. `api/src/signedQuote.ts` copies the builders and checks, for every quote, that `base58(sha256(ourMessage)) === quoteHash(response)` and that `verifyQuoteSignature(response)` passes. A drift in the SDK becomes a hard error, never a silent mismatch.

## What the contract checks (quote.rs `bind`, policy.rs)

After the signature verifies, the contract parses the message and requires:

| Field | Must equal |
|---|---|
| `dry` | `false` |
| `swapType` | `EXACT_INPUT` |
| `depositType` / `refundType` | `ORIGIN_CHAIN` |
| `recipientType` | `DESTINATION_CHAIN` |
| `originAsset`, `destinationAsset` | the run's asset ids, both allowed by the Mandate |
| `amount` | the run's `amount_in` |
| `slippageTolerance` | the run's `slippage_bps` (≤ the Mandate's ceiling) |
| `recipient` | the Mandate's `recipients[recipient_index].address` (case-insensitive hex) |
| `refundTo` | the Mandate origin asset's `evm_refund_to`, the owner's derived address |
| `deadline` | after now and at most 11 minutes ahead |

`depositAddress`, `amountOut`, `minAmountOut` and `deadline` are then stored as the run's `VerifiedQuote`, and those are the only values used. The signed ERC-20 transfer pays `depositAddress`. The slippage, cap and deadline checks use the stored amounts and deadline.

## Test vector

`contract/tests/vectors/oneclick_dry_quote.json` holds a live dry response from 5 Nov 2026: the message string, signature, timestamp and digest `8HND7xiQg1vbXAmPRDCHyV9pPCVD6vvJTyN38ZppM8Ef`.
- The contract test `real_1click_dry_quote_vector_verifies` checks it on-chain-style against the real key, and checks that the contract then refuses it as `QuoteIsDry`.
- The API test `test/signedQuote.test.ts` checks that the same vector comes out of `toSignedQuote` and matches the SDK's `quoteHash`.

## Testnet

1Click is mainnet-only. A contract built with `--features testnet-quotes` and deployed on a `.testnet` account can hold a second key (`set_test_quote_key`, admin-only). The testnet API turns a real dry quote into a non-dry one, with a placeholder deposit address, and signs it with that key (`TESTNET_QUOTE_KEY`). Both checks happen at runtime, so the setter refuses any account not ending in `.testnet`. The mainnet build never enables the feature, so it has no setter and never reads the field. The API also refuses to start on mainnet with `TESTNET_QUOTE_KEY` set.
