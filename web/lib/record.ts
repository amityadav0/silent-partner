// Track-record honesty (D4): how long the record is, whether the leader is new, how often
// it trades, and the leader's stake over time (season-state/stake.json, on-chain views).
import { seasonUrl } from "./vault";

const DAY = 86_400_000;
export const NEW_LEADER_DAYS = 14;

export function recordAge(times: number[], now = Date.now()): number {
  return times.length ? Math.max(0, now - times[0]) : 0;
}

/** "4 days · 382 price updates", "6 hours · 20 price updates". */
export function recordWords(times: number[], now = Date.now()): string {
  const age = recordAge(times, now);
  const d = Math.floor(age / DAY);
  const span = d >= 1 ? `${d} day${d === 1 ? "" : "s"}` : `${Math.max(1, Math.round(age / 3_600_000))} hours`;
  return `${span} · ${times.length.toLocaleString("en-US")} price update${times.length === 1 ? "" : "s"}`;
}

export const isNewLeader = (times: number[], now = Date.now()) => recordAge(times, now) < NEW_LEADER_DAYS * DAY;

/** "≈ 3 trades a day", "≈ 1 trade a week", "no trades yet". */
export function tradeRateWords(signals: number, times: number[], now = Date.now()): string {
  if (!signals) return "no trades yet";
  const days = recordAge(times, now) / DAY;
  // a rate from a handful of trades is a guess: say the count
  if (days < 1 || signals < 5) return `${signals} trade${signals === 1 ? "" : "s"} so far`;
  const perDay = signals / days;
  if (perDay >= 1) return `≈ ${Math.round(perDay)} trade${Math.round(perDay) === 1 ? "" : "s"} a day`;
  const perWeek = perDay * 7;
  return perWeek >= 1 ? `≈ ${Math.round(perWeek)} trade${Math.round(perWeek) === 1 ? "" : "s"} a week` : "fewer than 1 a week";
}

export type StakeSeries = { t: number[]; bps: number[] };
let cache: Promise<Record<string, StakeSeries> | null> | null = null;
export function loadStake(): Promise<Record<string, StakeSeries> | null> {
  cache ??= fetch(seasonUrl("stake.json"))
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { vaults?: Record<string, StakeSeries> } | null) => d?.vaults ?? null, () => null);
  return cache;
}
