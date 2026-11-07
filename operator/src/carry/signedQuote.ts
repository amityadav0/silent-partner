// Carried over from ~/scope/api/src (copied, not imported).
// 1Click signed quotes: build the exact message 1Click signs, check it with the
// official SDK, and hand it to the contract, which verifies it again on-chain
// (contract/src/quote.rs). See docs/1click-signature.md.
//
// Construction (from @defuse-protocol/one-click-sdk-typescript 0.1.26,
// src/quote-signature.ts):
//   message   = json-stable-stringify({...signedRequestFields, ...signedQuoteFields, timestamp})
//   digest    = base58(sha256(utf8(message)))
//   signature = ed25519 over utf8(digest), by ONE_CLICK_MANAGER_PUB_KEY
// The SDK doesn't export the field builders, so they're copied below. The
// copy is checked on every quote: digestText(message) must equal the SDK's own
// quoteHash(response), or the quote is refused.
import stringify from "json-stable-stringify";
import { quoteHash, verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import { sha256 } from "@noble/hashes/sha256";
import { base58 } from "@scure/base";
import { KeyPair } from "near-api-js";

/** 1Click's quote-signing key, from the SDK (unchanged 0.1.24 → 0.1.26). */
export const ONE_CLICK_MANAGER_PUB_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

export type QuoteResponse = {
  quote: Record<string, unknown>;
  quoteRequest: Record<string, unknown>;
  signature: string;
  timestamp: string;
};
export type SignedQuote = { message: string; signature: string; timestamp: string };

const opt = (v: unknown) => (v ? v : undefined);

/** = buildSignedQuoteRequest in the SDK. */
function signedRequestFields(r: QuoteResponse) {
  const q = r.quoteRequest;
  return {
    dry: q.dry, swapType: q.swapType, slippageTolerance: q.slippageTolerance, originAsset: q.originAsset, depositType: q.depositType,
    destinationAsset: q.destinationAsset, amount: q.amount, refundTo: q.refundTo, refundType: q.refundType, recipient: q.recipient,
    recipientType: q.recipientType, deadline: q.deadline, quoteWaitingTimeMs: opt(q.quoteWaitingTimeMs), referral: opt(q.referral),
    virtualChainRecipient: opt(q.virtualChainRecipient), virtualChainRefundRecipient: opt(q.virtualChainRefundRecipient), customRecipientMsg: opt(q.customRecipientMsg),
    sessionId: undefined, connectedWallets: undefined, correlationId: undefined, appFees: undefined, partnerId: undefined, userAccountId: undefined, depositMode: undefined,
  };
}

/** = buildSignedQuote in the SDK. */
function signedQuoteFields(r: QuoteResponse) {
  const q = r.quote;
  const base = { amountIn: q.amountIn, amountInFormatted: q.amountInFormatted, amountInUsd: q.amountInUsd, minAmountIn: q.minAmountIn, amountOut: q.amountOut, amountOutFormatted: q.amountOutFormatted, amountOutUsd: q.amountOutUsd, minAmountOut: q.minAmountOut };
  if (r.quoteRequest.dry) return base;
  return { ...base, depositAddress: opt(q.depositAddress), depositMemo: opt(q.depositMemo), deadline: opt(q.deadline), timeWhenInactive: opt(q.timeWhenInactive), timeEstimate: opt(q.timeEstimate), refundFee: opt(q.refundFee), withdrawFee: opt(q.withdrawFee) };
}

/** The exact string 1Click signs. */
export function quoteMessage(r: QuoteResponse): string {
  return stringify({ ...signedRequestFields(r), ...signedQuoteFields(r), timestamp: r.timestamp }) as string;
}

/** base58(sha256(utf8(message))): the text that is actually signed. */
export function digestText(message: string): string {
  return base58.encode(sha256(new TextEncoder().encode(message)));
}

/** A real 1Click response → SignedQuote, or an error if it isn't genuinely signed. */
export function toSignedQuote(r: QuoteResponse, key = ONE_CLICK_MANAGER_PUB_KEY): SignedQuote {
  if (!verifyQuoteSignature(r as never, key)) throw new Error("1Click quote signature does not verify");
  const message = quoteMessage(r);
  if (digestText(message) !== quoteHash(r as never)) throw new Error("quote message construction drifted from the 1Click SDK");
  return { message, signature: r.signature, timestamp: r.timestamp };
}

/**
 * Testnet only: 1Click has no testnet and dry quotes have no deposit address,
 * so the testnet API turns a real dry quote into a non-dry one with a
 * placeholder deposit address and signs it with the test key the testnet
 * contract holds (set_test_quote_key, `testnet-quotes` build). The result is
 * checked with the SDK's own verifier against the test public key.
 */
export function selfSignQuote(dry: QuoteResponse, over: { depositAddress: string; deadline: string }, testPrivateKey: string): SignedQuote {
  const kp = KeyPair.fromString(testPrivateKey as `ed25519:${string}`);
  const r: QuoteResponse = { ...dry, quoteRequest: { ...dry.quoteRequest, dry: false }, quote: { ...dry.quote, depositAddress: over.depositAddress, deadline: over.deadline } };
  const message = quoteMessage(r);
  const sig = kp.sign(new TextEncoder().encode(digestText(message)));
  const signature = `ed25519:${base58.encode(sig.signature)}`;
  if (!verifyQuoteSignature({ ...r, signature } as never, kp.getPublicKey().toString())) throw new Error("self-signed quote does not verify under the test key");
  return { message, signature, timestamp: r.timestamp };
}

/**
 * Mirror of the contract's binding (quote.rs `bind` + the deadline window), so
 * the API refuses locally instead of letting a mismatch reach propose_run,
 * where it would count as a breach.
 */
export function precheckBinding(
  message: string,
  want: { originAsset: string; destinationAsset: string; amount: string; slippageBps: number; recipient: string; refundTo: string; nowMs: number; maxAheadMs: number },
): { ok: true; depositAddress: string; amountOut: string; minAmountOut: string; deadlineMs: number } | { ok: false; error: string } {
  const v = JSON.parse(message) as Record<string, unknown>;
  const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
  const checks: [string, boolean][] = [
    ["dry", v.dry === false],
    ["swapType", s("swapType") === "EXACT_INPUT"],
    ["depositType", s("depositType") === "ORIGIN_CHAIN"],
    ["recipientType", s("recipientType") === "DESTINATION_CHAIN"],
    ["refundType", s("refundType") === "ORIGIN_CHAIN"],
    ["originAsset", s("originAsset") === want.originAsset],
    ["destinationAsset", s("destinationAsset") === want.destinationAsset],
    ["amount", s("amount") === want.amount],
    ["slippageTolerance", v.slippageTolerance === want.slippageBps],
    ["recipient", s("recipient").toLowerCase() === want.recipient.toLowerCase()],
    ["refundTo", s("refundTo").toLowerCase() === want.refundTo.toLowerCase()],
    ["depositAddress", /^0x[0-9a-fA-F]{40}$/.test(s("depositAddress"))],
  ];
  const bad = checks.find(([, ok]) => !ok);
  if (bad) return { ok: false, error: `signed quote field ${bad[0]} does not match the run/Mandate` };
  const deadlineMs = Date.parse(s("deadline"));
  if (!Number.isFinite(deadlineMs) || deadlineMs <= want.nowMs) return { ok: false, error: "signed quote deadline already passed" };
  if (deadlineMs > want.nowMs + want.maxAheadMs) return { ok: false, error: `signed quote deadline is more than ${want.maxAheadMs / 60000} minutes away` };
  return { ok: true, depositAddress: s("depositAddress"), amountOut: s("amountOut"), minAmountOut: s("minAmountOut"), deadlineMs };
}
