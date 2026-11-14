// Trading cost per vault (T2): what the fills cost the vault against the NEAR/USD mid at
// the time of each fill (1Click's fee plus the quote spread). Published per vault as totals
// only (season-state/costs.json): the number of trades is already public (each one is a
// signal recorded on chain), and a total cost says nothing about positions.
import type { Entry } from "../filllog.js";
import type { Series } from "../leaders/market.js";

const DAY = 86_400_000;

/** NEAR/USD at `ts`, linear between the two nearest points (5-minute data where we have it). */
export function priceAt(s: Series, ts: number): number | null {
  const { t, p } = s;
  if (!t.length) return null;
  if (ts <= t[0]) return p[0];
  if (ts >= t[t.length - 1]) return p[p.length - 1];
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= ts) lo = mid;
    else hi = mid;
  }
  const w = (ts - t[lo]) / (t[hi] - t[lo] || 1);
  return p[lo] + (p[hi] - p[lo]) * w;
}

export type CostSummary = { trades: number; trades_24h: number; moved_usd: number; cost_usd: number; avg_cost_bps: number | null; cost_pct: number | null };

/** 1Click's fee on every quote (D-P3-2): the floor of any trade's cost. */
export const FEE_BPS = 20;

/**
 * One vault's fills against a 5-minute (older: hourly) mid carry timing noise: a contrarian that
 * buys right after a drop looks cheap, a trend follower looks dear. So the published cost per
 * vault is its amount traded times the season's pooled rate (all fills, all vaults), never
 * below the 1Click fee.
 */
export function pooledBps(all: CostSummary[]): number {
  const moved = all.reduce((s, c) => s + c.moved_usd, 0), cost = all.reduce((s, c) => s + c.cost_usd, 0);
  return moved > 0 ? Math.max(FEE_BPS, +((cost / moved) * 10_000).toFixed(1)) : FEE_BPS;
}

export type PublishedCost = { trades: number; trades_24h: number; moved_usd: number; cost_pct: number | null; cost_bps: number };
export function publish(c: CostSummary, bps: number, navUsd: number | null): PublishedCost {
  const cost = (c.moved_usd * bps) / 10_000;
  return { trades: c.trades, trades_24h: c.trades_24h, moved_usd: c.moved_usd, cost_pct: navUsd && navUsd > 0 ? +((cost / navUsd) * 100).toFixed(2) : null, cost_bps: bps };
}

/** Every executed fill: value in minus value out at the mid, in USD. */
export function costSummary(entries: Entry[], o: { base: string; risk: string; near: Series; navUsd: number | null; now: number; baseDec?: number; riskDec?: number }): CostSummary {
  const bd = 10 ** (o.baseDec ?? 6), rd = 10 ** (o.riskDec ?? 24);
  let trades = 0, trades24 = 0, moved = 0, cost = 0;
  for (const e of entries) {
    if (e.kind !== "fill" || e.data.amount_in === "0") continue;
    const px = priceAt(o.near, e.ts);
    if (px === null) continue;
    const ain = Number(e.data.amount_in), aout = Number(e.data.amount_out);
    const buy = e.data.from === o.base;
    const inUsd = buy ? ain / bd : (ain / rd) * px;
    const outUsd = buy ? (aout / rd) * px : aout / bd;
    trades++;
    if (o.now - e.ts < DAY) trades24++;
    moved += inUsd;
    cost += inUsd - outUsd;
  }
  return {
    trades,
    trades_24h: trades24,
    moved_usd: +moved.toFixed(2),
    cost_usd: +cost.toFixed(2),
    avg_cost_bps: moved > 0 ? +((cost / moved) * 10_000).toFixed(1) : null,
    cost_pct: o.navUsd && o.navUsd > 0 ? +((cost / o.navUsd) * 100).toFixed(2) : null,
  };
}
