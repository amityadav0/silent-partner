// Carried over from ~/scope/api/src (copied, not imported).
// Receipt: what actually happened, as the verifier can prove it.
// Pure functions here; I/O (1Click status, chain reads, NEAR calls) lives in
// verifier.ts so this file is fully unit-tested.
import { createHash } from "node:crypto";
import { KeyPair, utils } from "near-api-js";

export type Verdict = "WithinWorstCase" | "Short" | "Refunded" | "Unresolved";

export type Receipt = {
  schema: "scope.receipt.v1";
  run_id: number;
  mandate_id: number;
  quote: {
    amount_in: string;
    amount_out: string;
    min_amount_out: string;
    time_estimate_s: number | null;
    deposit_address: string;
    deadline: string;
  };
  origin: { chain: string; tx: string | null; block: number | null };
  intents: { status_trail: [string, string][]; explorer: string | null };
  destination: {
    chain: string;
    asset_id: string;
    recipient: string;
    balance_before: string;
    balance_after: string;
    delta: string;
    block_before: number;
    block_after: number;
  };
  verdict: Verdict;
  elapsed_s: number;
  verifier: string;
  /** Present on testnet Receipts, which are never broadcast. */
  network?: "testnet";
  /** Why a run closed the way it did, when the verdict alone doesn't say. */
  note?: string;
  verifier_sig?: string;
  near_tx?: string;
};

/** Verdict from the 1Click terminal status and the destination delta. */
export function decideVerdict(terminal: string, delta: bigint, minAmountOut: bigint): Verdict {
  switch (terminal) {
    case "SUCCESS":
      return delta >= minAmountOut ? "WithinWorstCase" : "Short";
    case "REFUNDED":
      return "Refunded";
    default:
      return "Unresolved";
  }
}

/** Canonical JSON: sorted keys, no whitespace, so the hash is reproducible. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** sha256 of the canonical JSON *without* the signature fields. */
export function receiptHash(r: Receipt): string {
  const { verifier_sig: _s, near_tx: _t, ...body } = r;
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

/** ed25519 signature over the receipt hash, by the verifier's NEAR key. */
export function signReceipt(r: Receipt, key: KeyPair): Receipt {
  const hash = receiptHash(r);
  const sig = key.sign(Buffer.from(hash, "hex"));
  return { ...r, verifier_sig: `ed25519:${Buffer.from(sig.signature).toString("base64")}` };
}

export function verifyReceiptSignature(r: Receipt, publicKey: string): boolean {
  if (!r.verifier_sig) return false;
  const sig = Buffer.from(r.verifier_sig.replace(/^ed25519:/, ""), "base64");
  return utils.PublicKey.fromString(publicKey).verify(Buffer.from(receiptHash(r), "hex"), sig);
}

/** One-line human summary for notifications and the status tool. */
export function summarize(r: Receipt, fmt: { inSym: string; inDec: number; outSym: string; outDec: number }): string {
  const f = (units: string, dec: number) => (Number(units) / 10 ** dec).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const sent = `${f(r.quote.amount_in, fmt.inDec)} ${fmt.inSym}`;
  const got = `${f(r.destination.delta, fmt.outDec)} ${fmt.outSym}`;
  const worst = `${f(r.quote.min_amount_out, fmt.outDec)} ${fmt.outSym}`;
  switch (r.verdict) {
    case "WithinWorstCase":
      return `Done. ${sent} → ${got} on ${r.destination.chain} (worst case was ${worst}), ${r.elapsed_s}s. Verified on-chain.`;
    case "Short":
      return `Short. ${sent} → ${got} on ${r.destination.chain}, below the worst case ${worst}. Standing dropped a rung.`;
    case "Refunded":
      return `Refunded. The swap did not fill; ${sent} went back to the refund address.`;
    default:
      if (!r.origin.tx) return r.network === "testnet" ? `Testnet run: signed, never broadcast. Nothing moved.` : `Unresolved. Nothing was broadcast, so nothing moved.`;
      return `Unresolved. ${sent} sent; the verifier could not confirm the outcome yet.`;
  }
}

/** What the public share page (/r/:id) may show: no addresses, no owner, no agent. */
export type PublicReceipt = {
  run_id: number;
  sent: string;
  received: string;
  worst_case: string;
  origin_chain: string;
  destination_chain: string;
  verdict: Verdict;
  elapsed_s: number;
  receipt_hash: string;
  network: "mainnet" | "testnet";
  note: string | null;
  verified_by: string;
};

export function publicReceipt(r: Receipt, fmt: { inSym: string; inDec: number; outSym: string; outDec: number }, contractId: string): PublicReceipt {
  const f = (units: string, dec: number) => (Number(units) / 10 ** dec).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return {
    run_id: r.run_id,
    sent: `${f(r.quote.amount_in, fmt.inDec)} ${fmt.inSym}`.trim(),
    received: `${f(r.destination.delta, fmt.outDec)} ${fmt.outSym}`.trim(),
    worst_case: `${f(r.quote.min_amount_out, fmt.outDec)} ${fmt.outSym}`.trim(),
    origin_chain: r.origin.chain,
    destination_chain: r.destination.chain,
    verdict: r.verdict,
    elapsed_s: r.elapsed_s,
    receipt_hash: receiptHash(r),
    network: r.network ?? "mainnet",
    note: r.note ?? null,
    verified_by: contractId,
  };
}
