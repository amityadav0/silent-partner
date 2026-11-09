// Leader signals, built and signed in the browser with the leader's signal key.
// Matches operator/src/signal.ts: hash = sha256(canonicalJson(signal)), and the
// key signs the 32 raw hash bytes (what the contract's record_signal verifies).
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { base58 } from "@scure/base";
import { canonicalJson } from "./canonical";

export type Signal = { v: 1; vault: string; from: string; to: string; size_bps: number; type: "market" | "limit" | "target"; target_bps?: number; limit_price?: string; expires_ms?: number; nonce: string; created_ms: number };

export const signalHash = (s: Signal) => sha256(new TextEncoder().encode(canonicalJson(s)));

export function newSignalKey(): { secret: string; publicKey: string } {
  const sk = ed25519.utils.randomPrivateKey();
  return { secret: bytesToHex(sk), publicKey: "ed25519:" + base58.encode(ed25519.getPublicKey(sk)) };
}

export function publicKeyOf(secretHex: string): string {
  return "ed25519:" + base58.encode(ed25519.getPublicKey(hexToBytes(secretHex)));
}

export function signSignal(s: Signal, secretHex: string) {
  const sig = ed25519.sign(signalHash(s), hexToBytes(secretHex));
  return { signal: s, signature: "ed25519:" + base58.encode(sig), public_key: publicKeyOf(secretHex), hash: bytesToHex(signalHash(s)) };
}

export function randomNonce(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
}

function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
