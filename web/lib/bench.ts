// "vs holding NEAR" (U9): the leader's return next to what simply holding NEAR did over the same
// window, both measured at the times of the same signed price updates. NEAR/USD history comes from
// season-state/near-usd.json (CoinGecko, published by the season job), or CoinGecko directly.
import { priceOf, seasonUrl, type NavPost } from "./vault";

export type NearSeries = { t: number[]; p: number[] };

const SLACK = 3 * 3600_000; // allow a post up to 3 h past either end of the series

/** NEAR/USD at time t, linearly interpolated; null when t is outside the series. */
export function nearAt(s: NearSeries, t: number): number | null {
  const n = s.t.length;
  if (!n || t < s.t[0] - SLACK || t > s.t[n - 1] + SLACK) return null;
  if (t <= s.t[0]) return s.p[0];
  if (t >= s.t[n - 1]) return s.p[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s.t[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - s.t[lo]) / (s.t[hi] - s.t[lo] || 1);
  return s.p[lo] + f * (s.p[hi] - s.p[lo]);
}

export type VsNear = { ret: number; near: number; pts: number };

/**
 * Return of the share price and of NEAR between the same two moments: the post just before
 * `sinceMs` (or the vault's start at price 1, timed at its first post) and the latest post.
 * `pts` is the difference in percentage points (positive = beat holding NEAR).
 */
export function vsNear(navs: Pick<NavPost, "price" | "timestamp_ms">[], s: NearSeries | null, sinceMs = 0): VsNear | null {
  if (!s || !navs.length) return null;
  const last = navs[navs.length - 1];
  const before = navs.filter((n) => n.timestamp_ms < sinceMs).at(-1);
  const inside = navs.filter((n) => n.timestamp_ms >= sinceMs);
  if (!inside.length) return null;
  const p0 = before ? priceOf(before.price) : 1;
  const t0 = before ? before.timestamp_ms : inside[0].timestamp_ms;
  const n0 = nearAt(s, t0), n1 = nearAt(s, last.timestamp_ms);
  if (n0 == null || n1 == null || n0 <= 0 || p0 <= 0) return null;
  const ret = priceOf(last.price) / p0 - 1, near = n1 / n0 - 1;
  return { ret, near, pts: (ret - near) * 100 };
}

/** Same comparison for a simulated copy that joined at `entryPrice` at `entryMs`. */
export function copyVsNear(entryPrice: number, entryMs: number, nowPrice: number, nowMs: number, s: NearSeries | null): VsNear | null {
  if (!s || entryPrice <= 0) return null;
  const n0 = nearAt(s, entryMs), n1 = nearAt(s, nowMs);
  if (n0 == null || n1 == null || n0 <= 0) return null;
  const ret = nowPrice / entryPrice - 1, near = n1 / n0 - 1;
  return { ret, near, pts: (ret - near) * 100 };
}

/** "+1.23 pts vs NEAR" (never "−0.00"). */
export function ptsWords(pts: number, digits = 2): string {
  const v = Math.abs(pts) < 0.5 * 10 ** -digits ? 0 : pts;
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)} pts vs NEAR`;
}

/** Ratio to 2 dp that never prints "-0.00". */
export function ratio2(x: number): string {
  const v = Math.round(x * 100) / 100;
  return (v === 0 ? 0 : v).toFixed(2).replace("-", "−");
}

let cache: Promise<NearSeries | null> | null = null;

async function fromSeason(fetchImpl: typeof fetch): Promise<NearSeries> {
  const r = await fetchImpl(seasonUrl("near-usd.json"), { cache: "no-store" });
  if (!r.ok) throw new Error(`near-usd.json ${r.status}`);
  const j = (await r.json()) as NearSeries;
  if (!j.t?.length || j.t.length !== j.p.length) throw new Error("near-usd.json empty");
  return { t: j.t, p: j.p };
}

async function fromCoinGecko(fetchImpl: typeof fetch): Promise<NearSeries> {
  const r = await fetchImpl("https://api.coingecko.com/api/v3/coins/near/market_chart?vs_currency=usd&days=30");
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = (await r.json()) as { prices: [number, number][] };
  if (!j.prices?.length) throw new Error("coingecko empty");
  return { t: j.prices.map((x) => x[0]), p: j.prices.map((x) => x[1]) };
}

/** NEAR/USD history, once per page load. Null if both sources fail (the UI then hides the column). */
export function loadNear(fetchImpl: typeof fetch = fetch): Promise<NearSeries | null> {
  if (!cache) cache = fromSeason(fetchImpl).catch(() => fromCoinGecko(fetchImpl)).catch(() => null);
  return cache;
}
export const _resetNearCache = () => { cache = null; };
