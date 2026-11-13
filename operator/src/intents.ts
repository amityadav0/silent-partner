// NEAR Intents helpers shared by the operator and scripts.
// NEP-413 prehash matches defuse crates/signatures/nep413 (verified against
// its test vector in test/intents.test.ts).
import { createHash, randomBytes } from "node:crypto";

export const TREASURY = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
export const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const WNEAR = "nep141:wrap.near";
/** Confidential (intents.far) token id for a public asset id. */
export const imt = (publicId: string) => `imt:${TREASURY}:${publicId}`;

export type Nep413Payload = { message: string; nonce: string /* base64, 32 bytes */; recipient: string; callbackUrl?: string };

/** sha256(borsh((2^31 + 413, payload))): the 32 bytes an ed25519 key signs. */
export function nep413Prehash(p: Nep413Payload): Buffer {
  const str = (s: string) => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  const nonce = Buffer.from(p.nonce, "base64");
  if (nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  const cb = p.callbackUrl === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), str(p.callbackUrl)]);
  return createHash("sha256").update(Buffer.concat([tag, str(p.message), nonce, str(p.recipient), cb])).digest();
}

/** Defuse versioned nonce: magic ‖ 0 ‖ salt(4) ‖ deadline ns LE ‖ now ns LE ‖ random(7). */
export function versionedNonce(saltHex: string, deadlineMs: number, nowMs = Date.now()): Buffer {
  const salt = Buffer.from(saltHex, "hex");
  if (salt.length !== 4) throw new Error("salt must be 4 bytes");
  const dl = Buffer.alloc(8); dl.writeBigUInt64LE(BigInt(deadlineMs) * 1_000_000n);
  const ts = Buffer.alloc(8); ts.writeBigUInt64LE(BigInt(nowMs) * 1_000_000n);
  return Buffer.concat([Buffer.from([0x56, 0x28, 0xf6, 0xc6, 0]), salt, dl, ts, randomBytes(7)]);
}

export async function viewCall<T>(rpc: string, contract: string, method: string, args: unknown, fetchImpl: typeof fetch = fetch, finality: "final" | "optimistic" = "final"): Promise<T> {
  const r = await fetchImpl(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality, account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error(`view ${contract}.${method}: ${String(JSON.stringify(j.error?.data ?? j.error?.message ?? j.error ?? j.result?.error)).slice(0, 300)}`);
  return JSON.parse(Buffer.from(j.result.result).toString()) as T;
}
