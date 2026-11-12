// Verifiable AI decisions, checked in the browser (D-AI-4). The season publishes each
// AI decision's NEAR AI receipt (hashes, the TEE signature, the attestation's digest)
// and the attestation quotes. Here we recheck: the signature recovers to the enclave
// key, the quote binds that key and the nonce, and the memo committed in the leader's
// signal is sha256(signed text : quote digest). The reasoning itself stays sealed.
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { recoverAddress } from "./trackrecord";

export type PublicReceipt = { text: string; signature: string; signing_address: string; signature_kind: string; quote_sha256: string; nonce: string; bound: boolean; gpu_evidence: boolean };
export type AttestationDoc = Record<string, { model: string; signing_address: string; nonce: string; intel_quote: string; seen: string }>;
export type ReceiptCheck = { signature: boolean; model: boolean; memo: boolean; quote: boolean | null };

const hex = (s: string) => bytesToHex(sha256(new TextEncoder().encode(s)));

export function checkReceipt(r: PublicReceipt, model: string, memo: string | null, atts: AttestationDoc | null): ReceiptCheck {
  const signature = recoverAddress(r.text, r.signature) === r.signing_address.toLowerCase();
  const modelOk = r.text.startsWith(`${model}:`);
  const memoOk = memo === hex(`${r.text}:${r.quote_sha256}`);
  let quote: boolean | null = null;
  const a = atts?.[r.quote_sha256];
  if (a) {
    const q = hexToBytes(a.intel_quote.replace(/^0x/, ""));
    const rd = q.length >= 632 ? q.subarray(568, 632) : null;
    const want = new Uint8Array(64);
    want.set(hexToBytes(r.signing_address.replace(/^0x/, "")), 0);
    want.set(hexToBytes(r.nonce), 32);
    quote = bytesToHex(sha256(q)) === r.quote_sha256 && !!rd && bytesToHex(rd) === bytesToHex(want);
  }
  return { signature, model: modelOk, memo: memoOk, quote };
}

export const receiptOk = (c: ReceiptCheck) => c.signature && c.model && c.memo && c.quote !== false;
