// Leader stake over time (D4): the leader's share of all vault shares, in bps, read from
// get_vault each season tick (and backfilled once from archival blocks). Public on-chain data.
export type StakeDoc = { ranAt?: string; vaults: Record<string, { t: number[]; bps: number[] }> };

export const stakeBps = (leader: string, total: string): number => (BigInt(total) === 0n ? 0 : Number((BigInt(leader) * 10_000n) / BigInt(total)));

/** Add points; keep every point from the last 2 days and one per 6 hours before that. */
export function addStake(doc: StakeDoc, vault: string, pts: [number, number][], now: number): StakeDoc {
  const cur = doc.vaults[vault] ?? { t: [], bps: [] };
  const m = new Map<number, number>(cur.t.map((t, i) => [t, cur.bps[i]]));
  for (const [t, b] of pts) m.set(Math.round(t), b);
  const cut = now - 2 * 86_400_000, slots = new Set<number>();
  const out = { t: [] as number[], bps: [] as number[] };
  for (const k of [...m.keys()].sort((a, b) => a - b)) {
    if (k < cut) {
      const s = Math.floor(k / (6 * 3_600_000));
      if (slots.has(s)) continue;
      slots.add(s);
    }
    out.t.push(k);
    out.bps.push(m.get(k)!);
  }
  return { ...doc, vaults: { ...doc.vaults, [vault]: out } };
}
