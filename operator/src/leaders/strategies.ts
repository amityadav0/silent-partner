// Rule-based leaders. Each returns a target NEAR exposure (share of NAV in
// wNEAR, 0..1) or null to hold. `rebalance` turns a target into one signal.
import { randomBytes } from "node:crypto";
import { ema, stats, type Series } from "./market.js";
import type { Signal } from "../signal.js";

export type Decision = { target: number | null; why: string };
export type Strategy = (s: Series, current: number) => Decision;

/** Trend: long when the 1h EMA is above the 6h EMA by 0.2%, flat when below by 0.2%. */
export const momentum: Strategy = (s) => {
  const fast = ema(s.p.slice(-36), 12), slow = ema(s.p, 72);
  const gap = fast / slow - 1;
  if (gap > 0.002) return { target: 0.8, why: `ema1h/ema6h ${gap.toFixed(4)} > 0.002` };
  if (gap < -0.002) return { target: 0, why: `ema1h/ema6h ${gap.toFixed(4)} < -0.002` };
  return { target: null, why: `inside band (${gap.toFixed(4)})` };
};

/** Fade moves: z-score of the last price against the last 6h. */
export const meanReversion: Strategy = (s) => {
  const w = s.p.slice(-72);
  const { mean, sd } = stats(w);
  const z = sd > 0 ? (w[w.length - 1] - mean) / sd : 0;
  if (z < -1.5) return { target: 0.8, why: `z ${z.toFixed(2)} < -1.5` };
  if (z > 1.5) return { target: 0, why: `z ${z.toFixed(2)} > 1.5` };
  if (Math.abs(z) < 0.3) return { target: 0.4, why: `z ${z.toFixed(2)} near mean` };
  return { target: null, why: `z ${z.toFixed(2)}` };
};

export const STRATEGIES: Record<string, Strategy> = { momentum, "mean-reversion": meanReversion };

/** Minimum change in exposure worth a trade. */
export const MIN_STEP = 0.1;

/** The signal that moves exposure from `current` to `target`, or null. */
export function rebalance(vault: string, base: string, risk: string, current: number, target: number, nowMs: number, memoHash?: string): Signal | null {
  const d = target - current;
  if (Math.abs(d) < MIN_STEP) return null;
  const size_bps = Math.min(10_000, Math.max(1, Math.round(Math.abs(d) * 10_000)));
  // Selling everything of the risk asset: ask for 100% so rounding can't leave dust.
  const full = d < 0 && target === 0;
  return {
    v: 1, vault, type: "market", nonce: randomBytes(8).toString("hex"), created_ms: nowMs,
    from: d > 0 ? base : risk, to: d > 0 ? risk : base, size_bps: full ? 10_000 : size_bps,
    ...(memoHash ? { memo_hash: memoHash } : {}),
  };
}
