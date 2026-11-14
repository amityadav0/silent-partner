// "Majors" house bot (T6): a multi-asset momentum rule over BTC, ETH, SOL and NEAR. Each asset
// up more than 1% over 24 h is held at an equal weight, 80% of the vault at most and 40% per
// asset; nothing up → all USDC. Public market data only (CoinGecko).
import { BTC, ETH, SOL } from "../intents.js";

export const MAJORS = { bitcoin: BTC, ethereum: ETH, solana: SOL, near: "nep141:wrap.testnet" } as const;
export type Changes = Partial<Record<keyof typeof MAJORS, number>>;

/** 24 h change in % per asset. */
export async function changes24h(fetchImpl: typeof fetch = fetch): Promise<Changes> {
  const r = await fetchImpl(`https://api.coingecko.com/api/v3/simple/price?ids=${Object.keys(MAJORS).join(",")}&vs_currencies=usd&include_24hr_change=true`);
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = (await r.json()) as Record<string, { usd_24h_change?: number }>;
  return Object.fromEntries(Object.keys(MAJORS).flatMap((k) => (typeof j[k]?.usd_24h_change === "number" ? [[k, j[k].usd_24h_change!]] : []))) as Changes;
}

/** Target weights (0..1) by vault asset id, or null to hold when data is missing. */
export function majors(c: Changes, assets: Record<string, string> = MAJORS): { targets: Record<string, number> | null; why: string } {
  const keys = Object.keys(assets) as (keyof typeof MAJORS)[];
  if (keys.some((k) => c[k] === undefined)) return { targets: null, why: "market data incomplete: holding" };
  const up = keys.filter((k) => c[k]! > 1);
  const w = up.length ? Math.min(0.4, 0.8 / up.length) : 0;
  const targets = Object.fromEntries(keys.map((k) => [assets[k], up.includes(k) ? +w.toFixed(4) : 0]));
  return { targets, why: up.length ? `up >1% over 24h: ${up.join(", ")}` : "nothing up >1% over 24h: all USDC" };
}
