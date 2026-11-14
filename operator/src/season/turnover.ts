// The season's turnover rule (T1, from 2026-11-14): leaders churned ~27 trades a day at
// ≈0.2% each and the cost ate their returns. Operator-side only; the contract is unchanged.
//   - Trade only when the target is ≥20 pts from the current weight AND ≥4 h have passed
//     since the vault's last trade.
//   - Exempt from the 4 h wait: a cut to a lower NEAR weight after NEAR fell ≥5% over 6 h.
//   - AI leaders are asked hourly, not every tick; price updates stay every 15 minutes.
//   - Benchmarks have their own fixed rule (see `benchmarkTarget`).
import { readFileSync, existsSync } from "node:fs";
import type { Entry } from "../filllog.js";

export const TURNOVER = {
  since: "2026-11-14",
  /** first season tick that ran the rule (the loop kept its old checkout until its 07:31 UTC handover) */
  liveSince: "2026-11-14T07:32:00Z",
  minStep: 0.2,
  minGapMs: 4 * 3_600_000,
  aiEveryMs: 3_600_000,
  deriskDrop: 0.05,
} as const;

/** Why a trade from `current` to `target` may not go now, or null when it may. */
export function blocked(o: { current: number; target: number; lastTradeMs: number | null; nowMs: number; ret6h: number }): string | null {
  const d = o.target - o.current;
  if (Math.abs(d) < TURNOVER.minStep - 1e-9) return `target within ${TURNOVER.minStep * 100} pts`;
  const derisk = d < 0 && o.ret6h <= -TURNOVER.deriskDrop;
  if (!derisk && o.lastTradeMs !== null && o.nowMs - o.lastTradeMs < TURNOVER.minGapMs) {
    const h = ((TURNOVER.minGapMs - (o.nowMs - o.lastTradeMs)) / 3_600_000).toFixed(1);
    return `last trade under 4 h ago (${h} h to wait)`;
  }
  return null;
}

/** Time of the vault's last executed trade, from its fill log. */
export function lastTradeMs(entries: Entry[]): number | null {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].kind === "fill" && entries[i].data.amount_in !== "0") return entries[i].ts;
  return null;
}

/** Is an AI decision due? The last notebook line that got an answer from NEAR AI sets the clock;
 *  an outage doesn't, so the next tick asks again. */
export function aiDue(notesPath: string, nowMs: number): boolean {
  if (!existsSync(notesPath)) return true;
  const lines = readFileSync(notesPath, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const n = JSON.parse(lines[i]) as { ts: number; why?: string; usage?: unknown };
      if (n.usage || !/^NEAR AI|NEARAI_API_KEY/.test(n.why ?? "")) return nowMs - n.ts >= TURNOVER.aiEveryMs - 60_000;
    } catch {
      /* skip a bad line */
    }
  }
  return true;
}

/** The same rule for a basket (T6): Σ|target − current| ≥ 20 pts, and 4 h since the last trade. */
export function blockedBasket(o: { current: Record<string, number>; targets: Record<string, number>; lastTradeMs: number | null; nowMs: number }): string | null {
  const keys = new Set([...Object.keys(o.current), ...Object.keys(o.targets)]);
  const moved = [...keys].reduce((s, k) => s + Math.abs((o.targets[k] ?? 0) - (o.current[k] ?? 0)), 0);
  if (moved < TURNOVER.minStep - 1e-9) return `basket within ${TURNOVER.minStep * 100} pts`;
  if (o.lastTradeMs !== null && o.nowMs - o.lastTradeMs < TURNOVER.minGapMs) return `last trade under 4 h ago`;
  return null;
}

export const BENCHMARKS = {
  /** 100% NEAR. Buys only to invest new deposits (cash above 5%); never sells. */
  hold: { target: 1, why: "Hold NEAR: 100% NEAR" },
  /** 50/50, rebalanced once a week (and the first trade). */
  half: { target: 0.5, why: "Half & Half: 50/50, weekly" },
} as const;
export type Benchmark = keyof typeof BENCHMARKS;
const WEEK = 7 * 86_400_000;

/** The benchmark's target this tick, or null to hold. */
export function benchmarkTarget(kind: Benchmark, current: number, lastTrade: number | null, nowMs: number): { target: number | null; why: string } {
  if (kind === "hold") return current < 0.95 ? { target: 1, why: "invest cash: 100% NEAR" } : { target: null, why: "holding NEAR" };
  const drift = Math.abs(current - 0.5);
  if (drift >= 0.02 && (lastTrade === null || nowMs - lastTrade >= WEEK)) return { target: 0.5, why: "weekly rebalance to 50/50" };
  return { target: null, why: lastTrade === null ? "at 50/50" : "rebalances weekly" };
}
