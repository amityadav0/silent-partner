// Public market data for leader bots: NEAR/USD from CoinGecko (5-minute points
// over the last day). Nothing private goes in or comes out.
export type Series = { t: number[]; p: number[] };

export async function nearUsd(fetchImpl: typeof fetch = fetch): Promise<Series> {
  const r = await fetchImpl("https://api.coingecko.com/api/v3/coins/near/market_chart?vs_currency=usd&days=1", { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = (await r.json()) as { prices: [number, number][] };
  if (!j.prices?.length) throw new Error("coingecko: no prices");
  return { t: j.prices.map((x) => x[0]), p: j.prices.map((x) => x[1]) };
}

export function ema(xs: number[], n: number): number {
  const k = 2 / (n + 1);
  return xs.reduce((e, x, i) => (i === 0 ? x : x * k + e * (1 - k)), 0);
}

export function stats(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1));
  return { mean, sd };
}

/** Return over the last `points` samples (0.01 = +1%). */
export const ret = (p: number[], points: number) => (p.length > points ? p[p.length - 1] / p[p.length - 1 - points] - 1 : 0);

/** A compact public summary of the series: what the bots, and the AI leader, decide from. */
export function summary(s: Series) {
  const p = s.p, last = p[p.length - 1];
  const r = p.slice(1).map((x, i) => Math.log(x / p[i]));
  return {
    price: +last.toFixed(4),
    ret_1h: +ret(p, 12).toFixed(4),
    ret_6h: +ret(p, 72).toFixed(4),
    ret_24h: +(last / p[0] - 1).toFixed(4),
    vol_24h: +(stats(r).sd * Math.sqrt(r.length)).toFixed(4),
    vol_annual: +(stats(r).sd * Math.sqrt(r.length) * Math.sqrt(365)).toFixed(3),
    ema_1h: +ema(p.slice(-36), 12).toFixed(4),
    ema_6h: +ema(p, 72).toFixed(4),
    high_24h: +Math.max(...p).toFixed(4),
    low_24h: +Math.min(...p).toFixed(4),
  };
}

/**
 * NEAR/USD history for the "vs holding NEAR" benchmark (U9): hourly points for `days` days,
 * the last day at 5-minute resolution, merged into what was published before (so the
 * history outlives CoinGecko's window). Points older than 2 days are thinned to one per hour.
 */
export async function nearHistory(prev: Series | null, recent: Series | null, days = 90, fetchImpl: typeof fetch = fetch): Promise<Series> {
  let long: Series | null = null;
  try {
    const r = await fetchImpl(`https://api.coingecko.com/api/v3/coins/near/market_chart?vs_currency=usd&days=${days}`, { headers: { accept: "application/json" } });
    if (r.ok) {
      const j = (await r.json()) as { prices: [number, number][] };
      if (j.prices?.length) long = { t: j.prices.map((x) => x[0]), p: j.prices.map((x) => x[1]) };
    }
  } catch {
    /* keep what we have */
  }
  return mergeSeries([prev, long, recent], Date.now());
}

export function mergeSeries(parts: (Series | null)[], now: number): Series {
  const m = new Map<number, number>();
  for (const s of parts) if (s) s.t.forEach((t, i) => Number.isFinite(s.p[i]) && s.p[i] > 0 && m.set(Math.round(t), s.p[i]));
  const cut = now - 2 * 86_400_000, hours = new Set<number>();
  const t: number[] = [], p: number[] = [];
  for (const k of [...m.keys()].sort((a, b) => a - b)) {
    if (k < cut) {
      const h = Math.floor(k / 3_600_000);
      if (hours.has(h)) continue;
      hours.add(h);
    }
    t.push(k);
    p.push(+m.get(k)!.toFixed(5));
  }
  return { t, p };
}
