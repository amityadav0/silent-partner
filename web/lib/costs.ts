import { seasonUrl } from "./vault";
// What a depositor pays and how long things take (D2, D3). Every number here is
// either a contract parameter or measured from the vault's own signed price updates.

/** 1Click's partner fee on each trade (appFees on every quote we take; D-P3-2). */
export const SWAP_FEE_BPS = 20;
/** No price update for this long → anyone can open emergency exit (NAV_STALE_MS). */
export const EMERGENCY_MS = 24 * 3_600_000;

/** Median gap between the last ~10 price updates, or null with fewer than 3. */
export function medianGapMs(times: number[]): number | null {
  if (times.length < 3) return null;
  const w = times.slice(-11);
  const gaps = w.slice(1).map((t, i) => t - w[i]).sort((x, y) => x - y);
  return gaps[Math.floor(gaps.length / 2)];
}

/** "~15 min", "~3 h", "~2 days". */
export function durationWords(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 90) return `~${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `~${h} h`;
  return `~${Math.round(h / 24)} days`;
}

/** How often each network's vaults post a price: the testnet season ticks every 15 minutes,
 *  the mainnet keeper every 3 hours (keeper.yml). The FAQ and every vault page read these. */
export const UPDATE_EVERY_MS = { testnet: 15 * 60_000, mainnet: 3 * 3_600_000 } as const;

/** "30 minutes", "6 hours", "2 days" (no "~": callers say "about"). */
export function spanWords(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 90) return `${Math.max(1, m)} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${Math.round(h / 24)} days`;
}

/** A withdrawal is priced at the next update and paid at the one after: about two update gaps. */
export const exitWords = (network: keyof typeof UPDATE_EVERY_MS) => spanWords(2 * UPDATE_EVERY_MS[network]);

/** Performance fee on a gain above the high-water mark, assuming you enter at the high. */
export function perfFee(amount: number, ret: number, feeBps: number): number {
  return Math.max(0, amount * ret) * (feeBps / 10_000);
}

/** "$1,000 for a month at +5% → fee $10 (20% of the $50 gain)". */
export function feeExample(feeBps: number, amount = 1000, ret = 0.05): string {
  const gain = amount * ret;
  const fee = perfFee(amount, ret, feeBps);
  const $ = (x: number) => `$${x.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `${$(amount)} for a month at +${(ret * 100).toFixed(0)}% → fee ${$(fee)} (${feeBps / 100}% of the ${$(gain)} gain). A month at a loss → fee $0.`;
}

// Trading cost so far (T2), published per vault by the season job (season-state/costs.json):
// totals only, from the operator's fills against the NEAR/USD mid, at the season's pooled rate.
export type VaultCost = { trades: number; trades_24h: number; moved_usd: number; cost_pct: number | null; cost_24h_pct?: number | null; cost_bps: number };
export type CostDoc = { ranAt: string; cost_bps: number; turnover_rule_since: string; vaults: Record<string, VaultCost> };
let costCache: Promise<CostDoc | null> | null = null;
export function loadCosts(): Promise<CostDoc | null> {
  costCache ??= fetch(seasonUrl("costs.json")).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return costCache;
}

/** "0.84% of the vault (37 trades)". */
export function costWords(c: VaultCost): string {
  const pct = c.cost_pct === null ? "" : `${c.cost_pct < 0.01 && c.cost_pct > 0 ? "<0.01" : c.cost_pct.toFixed(2)}% of the vault `;
  return `${pct}(${c.trades.toLocaleString("en-US")} trade${c.trades === 1 ? "" : "s"})`;
}

/** The one trade-frequency figure the site shows (leaderboard row and vault page alike). */
export const tradesDay = (c: VaultCost) => `${c.trades_24h} trade${c.trades_24h === 1 ? "" : "s"} in the last 24 h`;

/** "0.12% in the last 24 h" (null before the season publishes it). */
export function cost24Words(c: VaultCost): string | null {
  if (c.cost_24h_pct === undefined || c.cost_24h_pct === null) return null;
  return `${c.cost_24h_pct > 0 && c.cost_24h_pct < 0.01 ? "<0.01" : c.cost_24h_pct.toFixed(2)}% in the last 24 h`;
}
