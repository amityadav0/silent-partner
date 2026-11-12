// Verifiable AI decisions (D-AI-4). NEAR AI Cloud signs every completion inside the
// model's TEE: text = "<model>:<sha256(request bytes)>:<sha256(response bytes)>", an
// EIP-191 signature by the model's enclave key. Its attestation report carries an
// Intel TDX quote whose report_data binds that key (first 32 bytes: the address,
// zero-padded) to our nonce (last 32 bytes). The receipt keeps only hashes, the
// signature and the quote's digest, so it can be public while the reasoning stays sealed.
import { createHash, randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export type Receipt = {
  model: string;
  /** "<model>:<sha256(request)>:<sha256(response)>" as NEAR AI signed it. */
  text: string;
  signature: string;
  signing_address: string;
  signature_kind: string;
  /** sha256 of the attestation's TDX quote bytes, hex. */
  quote_sha256: string;
  /** The nonce we sent with the attestation request (the quote's last 32 report_data bytes). */
  nonce: string;
  /** The quote's report_data binds signing_address and nonce. */
  bound: boolean;
  /** NVIDIA GPU evidence was present in the report. */
  gpu_evidence: boolean;
};

/** Public attestation evidence for one tick (the quote itself, hex), so browsers can recheck the binding. */
export type Attestation = { model: string; signing_address: string; nonce: string; intel_quote: string };

export const sha256hex = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");

/** What goes on chain inside the leader-signed signal: commits to the model, the
 *  request and response (hence the reasoning) and the attestation. */
export const receiptMemo = (r: Pick<Receipt, "text" | "quote_sha256">) => sha256hex(`${r.text}:${r.quote_sha256}`);

/** report_data (64 bytes) of a TDX v4 quote: 48-byte header, then the TD report, report_data at +520. */
export function tdxReportData(quote: Uint8Array): Uint8Array | null {
  return quote.length >= 632 ? quote.subarray(568, 632) : null;
}

/** Does the quote bind this ECDSA address (zero-padded to 32 bytes) and nonce? */
export function quoteBinds(quote: Uint8Array, address: string, nonce: string): boolean {
  const rd = tdxReportData(quote);
  if (!rd) return false;
  const want = new Uint8Array(64);
  want.set(hexToBytes(address.replace(/^0x/, "").toLowerCase()), 0);
  want.set(hexToBytes(nonce), 32);
  return bytesToHex(rd) === bytesToHex(want);
}

/** EIP-191 personal_sign signer of `text` (65-byte r‖s‖v hex), lowercase, or null. */
export function recoverSigner(text: string, signature: string): string | null {
  try {
    const sig = hexToBytes(signature.replace(/^0x/, ""));
    if (sig.length !== 65) return null;
    const m = new TextEncoder().encode(text);
    const h = keccak_256(new Uint8Array([...new TextEncoder().encode(`\x19Ethereum Signed Message:\n${m.length}`), ...m]));
    const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
    const pub = secp256k1.Signature.fromCompact(sig.subarray(0, 64)).addRecoveryBit(v).recoverPublicKey(h).toRawBytes(false);
    return "0x" + bytesToHex(keccak_256(pub.subarray(1)).subarray(12));
  } catch {
    return null;
  }
}

/** A receipt checks out: the TEE signature recovers to its address and covers these exact bytes for this model. */
export function verifyReceipt(r: Receipt, expect?: { requestSha: string; responseSha: string }): boolean {
  if (recoverSigner(r.text, r.signature) !== r.signing_address.toLowerCase()) return false;
  if (!r.text.startsWith(`${r.model}:`)) return false;
  return !expect || r.text === `${r.model}:${expect.requestSha}:${expect.responseSha}`;
}

/** Fetch NEAR AI's signature for a completion and the model's attestation; null (with why) if unavailable. */
export async function fetchReceipt(o: { url: string; apiKey: string; model: string; chatId: string; requestSha: string; responseSha: string; fetchImpl?: typeof fetch; retryMs?: number; attestation?: Attestation & { report: { gpu: boolean } } }): Promise<{ receipt: Receipt; attestation: Attestation } | { error: string }> {
  const f = o.fetchImpl ?? fetch;
  let sig: { text?: string; signature?: string; signing_address?: string; signing_algo?: string; signature_kind?: string; error_code?: string } | null = null;
  for (let i = 0; i < 4 && !sig?.signature; i++) {
    if (i) await new Promise((ok) => setTimeout(ok, o.retryMs ?? 1500));
    const r = await f(`${o.url}/signature/${encodeURIComponent(o.chatId)}?signing_algo=ecdsa`, { headers: { authorization: `Bearer ${o.apiKey}`, accept: "application/json" } }).catch(() => null);
    if (r?.ok) sig = await r.json().catch(() => null);
  }
  if (!sig?.signature || !sig.text || !sig.signing_address) return { error: "no TEE signature for this completion" };
  // One attestation per tick and model: reuse it when the signer matches.
  let att = o.attestation && o.attestation.signing_address.toLowerCase() === sig.signing_address.toLowerCase() ? o.attestation : undefined;
  if (!att) {
    const nonce = randomBytes(32).toString("hex");
    const r = await f(`${o.url}/attestation/report?model=${encodeURIComponent(o.model)}&provider=near&signing_algo=ecdsa&nonce=${nonce}`, { headers: { accept: "application/json", "x-no-aliasing": "true", authorization: `Bearer ${o.apiKey}` } }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as { model_attestations?: { signing_address: string; signing_algo: string; intel_quote: string; nvidia_payload?: string }[] } | null) : null;
    const m = j?.model_attestations?.find((x) => x.signing_algo === "ecdsa" && x.signing_address.toLowerCase() === sig!.signing_address!.toLowerCase());
    if (!m) return { error: "no attestation for the signing key" };
    att = { model: o.model, signing_address: m.signing_address.toLowerCase(), nonce, intel_quote: m.intel_quote, report: { gpu: !!m.nvidia_payload } };
  }
  const quote = hexToBytes(att.intel_quote.replace(/^0x/, ""));
  const receipt: Receipt = {
    model: o.model,
    text: sig.text,
    signature: sig.signature,
    signing_address: sig.signing_address.toLowerCase(),
    signature_kind: sig.signature_kind ?? "provider_tee",
    quote_sha256: sha256hex(quote),
    nonce: att.nonce,
    bound: quoteBinds(quote, sig.signing_address, att.nonce),
    gpu_evidence: att.report.gpu,
  };
  if (!verifyReceipt(receipt, { requestSha: o.requestSha, responseSha: o.responseSha })) return { error: "TEE signature does not cover this completion" };
  return { receipt, attestation: att };
}
