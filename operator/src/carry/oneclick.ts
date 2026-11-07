// Carried over from ~/scope/api/src (copied, not imported).
// NEAR Intents 1Click client. Only three endpoints are used:
//   POST /v0/quote           (dry or real)
//   POST /v0/deposit/submit  (tell 1Click our deposit tx hash)
//   GET  /v0/status          (PENDING_DEPOSIT → ... → SUCCESS | REFUNDED | FAILED)
// Docs: https://docs.near-intents.org/integration/distribution-channels/1click-api

export type QuoteRequest = {
  dry: boolean;
  swapType: "EXACT_INPUT";
  slippageTolerance: number; // bps
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string; // ISO
  appFees?: { recipient: string; fee: number }[];
};

export type Quote = {
  amountIn: string;
  amountInFormatted?: string;
  amountOut: string;
  amountOutFormatted?: string;
  minAmountOut: string;
  timeEstimate?: number;
  depositAddress?: string;
  deadline?: string;
};

export type QuoteResponseRaw = { quote: Record<string, unknown>; quoteRequest: Record<string, unknown>; signature: string; timestamp: string; [k: string]: unknown };

export type OneClickStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export class OneClick {
  constructor(private base: string, private jwt?: string, private fetchImpl: typeof fetch = fetch) {}

  private headers() {
    const h: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.jwt) h.authorization = `Bearer ${this.jwt}`;
    return h;
  }

  /**
   * `raw` is the full response ({quote, quoteRequest, signature, timestamp, …})
   * parsed from `rawText`, the bytes 1Click sent. The signature covers fields
   * of both quote and quoteRequest, so callers verify `raw`, not `quote`.
   */
  async quote(req: QuoteRequest): Promise<{ quote: Quote; raw: QuoteResponseRaw; rawText: string }> {
    const r = await this.fetchImpl(`${this.base}/v0/quote`, { method: "POST", headers: this.headers(), body: JSON.stringify(req) });
    const rawText = await r.text();
    let raw: QuoteResponseRaw;
    try {
      raw = JSON.parse(rawText);
    } catch {
      throw new Error(`1click quote ${r.status}: not JSON`);
    }
    if (!r.ok) throw new Error(`1click quote ${r.status}: ${rawText.slice(0, 256)}`);
    const q = raw.quote as Quote | undefined;
    if (!q?.amountOut || !q?.minAmountOut) throw new Error("1click quote: missing amountOut/minAmountOut");
    return { quote: q, raw, rawText };
  }

  async submitDeposit(depositAddress: string, txHash: string): Promise<void> {
    const r = await this.fetchImpl(`${this.base}/v0/deposit/submit`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ depositAddress, txHash }),
    });
    if (!r.ok) throw new Error(`1click deposit/submit ${r.status}`);
  }

  async status(depositAddress: string): Promise<{ status: OneClickStatus; raw: unknown }> {
    const r = await this.fetchImpl(`${this.base}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, { headers: this.headers() });
    const raw = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`1click status ${r.status}`);
    return { status: (raw as { status: OneClickStatus }).status, raw };
  }
}

/** Build the request body the contract and the card both expect. */
export function buildQuoteRequest(p: {
  dry: boolean;
  originAssetId: string;
  destinationAssetId: string;
  amountIn: string;
  recipient: string;
  refundTo: string;
  slippageBps: number;
  deadlineMs: number;
}): QuoteRequest {
  return {
    dry: p.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: p.slippageBps,
    originAsset: p.originAssetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: p.destinationAssetId,
    amount: p.amountIn,
    refundTo: p.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: p.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(p.deadlineMs).toISOString(),
  };
}
