// Leader trade signals. The leader signs sha256(canonicalJson(signal)) with the
// ed25519 key registered on the vault (`set_signal_key`, normally their NEAR
// access key). The operator verifies it, executes, then records the hash and
// signature on-chain (`record_signal`), where the contract verifies it again.
import { createHash } from "node:crypto";
import { z } from "zod";
import { KeyPair, utils } from "near-api-js";
import { base58 } from "@scure/base";
import { canonicalJson } from "./carry/receipt.js";

export const SignalSchema = z.object({
  v: z.literal(1),
  vault: z.string().min(2),
  from: z.string().min(3), // public asset id sold
  to: z.string().min(3),   // public asset id bought
  size_bps: z.number().int().min(1).max(10_000), // of NAV
  type: z.enum(["market", "limit"]),
  /** limit only: minimum human units of `to` per 1 human unit of `from`. */
  limit_price: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  /** limit only: give up after this time. */
  expires_ms: z.number().int().optional(),
  nonce: z.string().regex(/^[0-9a-f]{16,64}$/),
  created_ms: z.number().int(),
}).refine((s) => s.from !== s.to, "from and to must differ")
  .refine((s) => (s.type === "limit") === (s.limit_price !== undefined), "limit_price is required for limit signals only");
export type Signal = z.infer<typeof SignalSchema>;
export type SignedSignal = { signal: Signal; signature: string; public_key: string };

export const signalHash = (s: Signal): Buffer => createHash("sha256").update(canonicalJson(s)).digest();

export function signSignal(s: Signal, key: KeyPair): SignedSignal {
  return { signal: s, signature: "ed25519:" + base58.encode(key.sign(signalHash(s)).signature), public_key: key.getPublicKey().toString() };
}

export type SignalCheck = { ok: true; hash: string } | { ok: false; error: string };

export function verifySignal(x: unknown, want: { vault: string; signalKey: string | null; nowMs: number; maxAgeMs: number; seenNonces: Set<string>; allowedAssets: string[] }): SignalCheck {
  const env = z.object({ signal: z.unknown(), signature: z.string(), public_key: z.string() }).safeParse(x);
  if (!env.success) return { ok: false, error: "malformed envelope" };
  const parsed = SignalSchema.safeParse(env.data.signal);
  if (!parsed.success) return { ok: false, error: `malformed signal: ${parsed.error.issues[0]?.message}` };
  const s = parsed.data;
  if (!want.signalKey) return { ok: false, error: "leader has no signal key on the vault" };
  if (env.data.public_key !== want.signalKey) return { ok: false, error: "not signed by the vault's signal key" };
  if (s.vault !== want.vault) return { ok: false, error: "signal is for another vault" };
  if (!want.allowedAssets.includes(s.from) || !want.allowedAssets.includes(s.to)) return { ok: false, error: "asset not allowed" };
  if (Math.abs(want.nowMs - s.created_ms) > want.maxAgeMs) return { ok: false, error: "signal too old or from the future" };
  if (want.seenNonces.has(s.nonce)) return { ok: false, error: "replayed nonce" };
  const h = signalHash(s);
  let ok = false;
  try {
    ok = utils.PublicKey.fromString(env.data.public_key).verify(h, base58.decode(env.data.signature.replace(/^ed25519:/, "")));
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, error: "bad signature" };
  return { ok: true, hash: h.toString("hex") };
}
