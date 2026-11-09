// Vault holdings, folded from the fill log. Units are raw token units (bigint).
// `confidential` is the vault's intents.far balance per public asset id.
// `shieldedFromPublic` counts paper shields (dry mode), which don't move the
// on-chain public balance, so NAV doesn't count those funds twice.
import type { Entry } from "./filllog.js";

// Live payouts leave from the vault's *public* balance (after an `unshield`
// entry moved funds there), so only paper payouts debit `confidential`.
// A balance that would go negative is clamped and reported in `drift` rather
// than thrown: a stuck ledger would stop NAV posting for everyone.
export type Ledger = { confidential: Map<string, bigint>; shieldedFromPublic: bigint; paidOut: bigint; seenNonces: Set<string>; drift: string[] };

export function fold(entries: Entry[], baseAsset: string): Ledger {
  const l: Ledger = { confidential: new Map(), shieldedFromPublic: 0n, paidOut: 0n, seenNonces: new Set(), drift: [] };
  let seq = -1;
  const add = (a: string, d: bigint) => {
    const v = (l.confidential.get(a) ?? 0n) + d;
    if (v < 0n) l.drift.push(`${a} would go negative (${v}) at seq ${seq}`);
    l.confidential.set(a, v < 0n ? 0n : v);
  };
  for (const e of entries) {
    seq = e.seq;
    const d = e.data as Record<string, any>;
    switch (e.kind) {
      case "shield":
        add(baseAsset, BigInt(d.amount));
        if (d.dry) l.shieldedFromPublic += BigInt(d.amount);
        break;
      case "fill":
        add(d.from, -BigInt(d.amount_in));
        add(d.to, BigInt(d.amount_out));
        break;
      case "unshield":
        add(d.asset ?? baseAsset, -BigInt(d.amount));
        break;
      case "payout":
        if (d.dry) add(baseAsset, -BigInt(d.amount));
        l.paidOut += BigInt(d.amount);
        break;
      case "signal":
        l.seenNonces.add(d.nonce);
        break;
    }
  }
  return l;
}
