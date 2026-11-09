// "Bring your track record": a trader proves they own a public EVM / Hyperliquid
// address by signing a message (EIP-191 personal_sign) that names their vault.
// Consent only: nothing is shown for an address that hasn't signed. Proofs are
// re-verified in every visitor's browser; stats are read live from Hyperliquid.
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export type TrackProof = { vault: string; address: string; issued: string; message: string; signature: string };

export function proofMessage(vault: string, address: string, issued: string): string {
  return `Silent Partner track record\nvault: ${vault}\naddress: ${address.toLowerCase()}\nissued: ${issued}`;
}

/** EIP-191 hash of a personal_sign message. */
export function personalHash(message: string): Uint8Array {
  const m = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${m.length}`);
  const all = new Uint8Array(prefix.length + m.length);
  all.set(prefix);
  all.set(m, prefix.length);
  return keccak_256(all);
}

/** The address that signed `message` (65-byte r‖s‖v hex signature), lowercase, or null. */
export function recoverAddress(message: string, signature: string): string | null {
  try {
    const sig = hexToBytes(signature.replace(/^0x/, ""));
    if (sig.length !== 65) return null;
    const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
    const pub = secp256k1.Signature.fromCompact(sig.subarray(0, 64)).addRecoveryBit(v).recoverPublicKey(personalHash(message)).toRawBytes(false);
    return "0x" + bytesToHex(keccak_256(pub.subarray(1)).subarray(12));
  } catch {
    return null;
  }
}

/** Valid when the message is exactly ours for this vault and address, and that address signed it. */
export function verifyProof(p: TrackProof): boolean {
  return p.message === proofMessage(p.vault, p.address, p.issued) && recoverAddress(p.message, p.signature) === p.address.toLowerCase();
}

export type HlStats = { pnl: number; volume: number; accountValue: number; maxDrawdown: number; since: number | null };

/** All-time stats from Hyperliquid's public info API (no key, CORS open). */
export async function hyperliquidStats(address: string, fetchImpl: typeof fetch = fetch): Promise<HlStats | null> {
  const r = await fetchImpl("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "portfolio", user: address }) });
  if (!r.ok) return null;
  const j = (await r.json()) as [string, { accountValueHistory: [number, string][]; pnlHistory: [number, string][]; vlm: string }][];
  const all = j.find(([k]) => k === "allTime")?.[1];
  if (!all) return null;
  const pnl = all.pnlHistory.map(([, v]) => Number(v));
  const av = all.accountValueHistory.map(([, v]) => Number(v));
  let peak = -Infinity, dd = 0;
  for (const v of av) {
    peak = Math.max(peak, v);
    if (peak > 0) dd = Math.max(dd, (peak - v) / peak);
  }
  return { pnl: pnl.at(-1) ?? 0, volume: Number(all.vlm), accountValue: av.at(-1) ?? 0, maxDrawdown: dd, since: all.accountValueHistory[0]?.[0] ?? null };
}
