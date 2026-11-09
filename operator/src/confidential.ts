// 1Click client for confidential vault flows. Partner JWT as X-API-Key (20 bps
// tier). Every quote response is checked with the carried 1Click signature
// verifier before it's used; a quote that doesn't verify is never acted on.
import { toSignedQuote, type QuoteResponse, type SignedQuote } from "./carry/signedQuote.js";
import type { Nep413Payload } from "./intents.js";

export type Leg = "trade" | "shield" | "unshield";
export type QuoteArgs = { leg: Leg; from: string; to: string; amount: string; slippageBps: number; vault: string; recipient?: string; deadlineMs: number; dry: boolean };

/** `publicPricing`: price dry quotes on the public INTENTS legs (no partner JWT
 *  needed; same solver market). Used by the CI paper season. */
export function quoteBody(a: QuoteArgs, publicPricing = false) {
  if (publicPricing && a.dry && a.leg === "trade") {
    return { dry: true, swapType: "EXACT_INPUT", slippageTolerance: a.slippageBps, originAsset: a.from, destinationAsset: a.to, amount: a.amount, depositType: "INTENTS", recipientType: "INTENTS", refundType: "INTENTS", recipient: a.vault, refundTo: a.vault, deadline: new Date(a.deadlineMs).toISOString() };
  }
  const types = {
    trade: ["CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS"],
    shield: ["INTENTS", "CONFIDENTIAL_INTENTS", "INTENTS"],
    unshield: ["CONFIDENTIAL_INTENTS", "INTENTS", "CONFIDENTIAL_INTENTS"],
  }[a.leg];
  return {
    dry: a.dry, swapType: "EXACT_INPUT", slippageTolerance: a.slippageBps, originAsset: a.from, destinationAsset: a.to, amount: a.amount,
    depositType: types[0], recipientType: types[1], refundType: types[2],
    recipient: a.recipient ?? a.vault, refundTo: a.vault, deadline: new Date(a.deadlineMs).toISOString(),
    ...(a.leg === "trade" ? { confidentiality: "advanced" } : {}),
  };
}

export type VerifiedQuote = { raw: QuoteResponse; signed: SignedQuote; amountIn: bigint; amountOut: bigint; minAmountOut: bigint; depositAddress?: string };

export class Confidential {
  constructor(private base: string, private jwt: string, private fetchImpl: typeof fetch = fetch, private oneClickKey?: string, private publicPricing = false) {}

  private async req(method: "GET" | "POST", path: string, body?: unknown, bearer?: string): Promise<any> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.jwt) headers["X-API-Key"] = this.jwt;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const r = await this.fetchImpl(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any;
    try { j = JSON.parse(text); } catch { throw new Error(`1click ${path} ${r.status}: not JSON`); }
    if (!r.ok) throw new Error(`1click ${path} ${r.status}: ${String(j?.message ?? text).slice(0, 200)}`);
    return j;
  }

  async quote(a: QuoteArgs): Promise<VerifiedQuote> {
    const raw = (await this.req("POST", "/v0/quote", quoteBody(a, this.publicPricing))) as QuoteResponse;
    const signed = this.oneClickKey ? toSignedQuote(raw, this.oneClickKey) : toSignedQuote(raw);
    const q = raw.quote as Record<string, string>;
    return { raw, signed, amountIn: BigInt(q.amountIn), amountOut: BigInt(q.amountOut), minAmountOut: BigInt(q.minAmountOut), depositAddress: q.depositAddress };
  }

  async generateIntent(signerId: string, depositAddress: string): Promise<Nep413Payload> {
    const j = await this.req("POST", "/v0/generate-intent", { type: "swap_transfer", standard: "nep413", signerId, depositAddress });
    const p = j?.intent?.payload;
    if (!p?.message || !p?.nonce || !p?.recipient) throw new Error("generate-intent: no payload");
    return { message: p.message, nonce: p.nonce, recipient: p.recipient };
  }

  async submitIntent(payload: Nep413Payload, publicKey: string, signature: string): Promise<string> {
    const j = await this.req("POST", "/v0/submit-intent", { type: "swap_transfer", signedData: { standard: "nep413", payload, public_key: publicKey, signature } });
    return j.intentHash;
  }

  async status(depositAddress: string): Promise<{ status: string; raw: any }> {
    const j = await this.req("GET", `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
    return { status: j.status, raw: j };
  }

  async authenticate(signedData: unknown): Promise<string> {
    return (await this.req("POST", "/v0/auth/authenticate", { signedData })).accessToken;
  }

  async balances(bearer: string): Promise<{ tokenId: string; amount: string; source?: string }[]> {
    return (await this.req("GET", "/v0/account/balances", undefined, bearer)).balances ?? [];
  }
}

export const TERMINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);
