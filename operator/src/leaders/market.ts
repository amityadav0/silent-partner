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
    ema_1h: +ema(p.slice(-36), 12).toFixed(4),
    ema_6h: +ema(p, 72).toFixed(4),
    high_24h: +Math.max(...p).toFixed(4),
    low_24h: +Math.min(...p).toFixed(4),
  };
}
