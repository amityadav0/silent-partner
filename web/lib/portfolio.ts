// "My partners": several vaults as one portfolio. Pure functions, tested in test/lib.test.ts.
import { priceOf, type NavPost } from "./vault";

type Series = { units: number; navs: Pick<NavPost, "timestamp_ms" | "price">[] };

/** Worst drawdown of today's mix: each vault's current holding valued along its own price history
 *  (price 1 before its first post), summed over every post time. */
export function mixDrawdown(series: Series[]): number {
  const times = [...new Set(series.flatMap((s) => s.navs.map((n) => n.timestamp_ms)))].sort((a, b) => a - b);
  const idx = series.map(() => -1);
  let peak = 0, dd = 0;
  for (const t of times) {
    let v = 0;
    series.forEach((s, i) => {
      while (idx[i] + 1 < s.navs.length && s.navs[idx[i] + 1].timestamp_ms <= t) idx[i]++;
      v += s.units * (idx[i] < 0 ? 1 : priceOf(s.navs[idx[i]].price));
    });
    peak = Math.max(peak, v);
    if (peak > 0) dd = Math.max(dd, (peak - v) / peak);
  }
  return dd;
}

export type Band = "calm" | "balanced" | "bold";
export const BLEND: Record<Band, { label: string; why: string }> = {
  calm: { label: "Calm", why: "the three smallest worst drawdowns" },
  balanced: { label: "Balanced", why: "the three best returns per unit of drawdown" },
  bold: { label: "Bold", why: "the three highest returns" },
};

type Candidate = { id: string; ret: number; dd: number; epochs: number; active: boolean };

/** Leaders for a blend: active, with some history, picked by band. */
export function blendPick(rows: Candidate[], band: Band, n = 3): string[] {
  const ok = rows.filter((r) => r.active && r.epochs >= 10);
  const by = {
    calm: (a: Candidate, b: Candidate) => a.dd - b.dd || b.ret - a.ret,
    balanced: (a: Candidate, b: Candidate) => b.ret / Math.max(b.dd, 0.0005) - a.ret / Math.max(a.dd, 0.0005),
    bold: (a: Candidate, b: Candidate) => b.ret - a.ret,
  }[band];
  return [...ok].sort(by).slice(0, n).map((r) => r.id);
}

/** Split an amount (in base units) evenly; the remainder goes to the first. */
export function split(total: bigint, n: number): bigint[] {
  if (n <= 0) return [];
  const each = total / BigInt(n);
  return Array.from({ length: n }, (_, i) => (i === 0 ? each + (total - each * BigInt(n)) : each));
}
