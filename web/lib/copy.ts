// "Your silent copy" (V1/V2): the words a follower shares. Only the simulated copy's real change
// goes in; no personal data, no invented numbers.
export const COPY_DEFAULT = "sp-contra-8952.testnet";
const SITE = "https://amityadav0.github.io/silent-partner";

export const pctWords = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(2)}%`;

/** "in 3 days", "in 5 hours", "in 12 min": how long the copy has run. */
export function sinceWords(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h} hour${h === 1 ? "" : "s"}`;
  return `in ${Math.round(h / 24)} days`;
}

/** "−3.8%": a dip with one decimal. */
export const dipWords = (dd: number) => (dd <= 0 ? "0%" : `−${(dd * 100).toFixed(1)}%`);
const ptsShort = (pts: number) => `${pts.toFixed(2)} pts`;

export type ShareInput = {
  name: string;
  /** price updates since the copy started */
  updates: number;
  /** the copy's change, as a fraction */
  copyPct: number;
  sinceMs: number;
  /** the leader's verified record: return since start and worst dip (fractions) */
  record: { ret: number; dd: number };
  /** percentage points vs holding NEAR since joining (copy) and since start (record); null if unknown */
  copyVsNear?: number | null;
  recordVsNear?: number | null;
};

/**
 * What a follower posts (U3, U9). Fewer than 3 price updates since joining: the leader's verified
 * record, because "+0.00% in 1 min" says nothing. From 3 updates on: the copy's own change. The
 * NEAR comparison goes in only when it is positive; it is never invented.
 */
export function shareText(x: ShareInput): string {
  const tail = "i can't see their trades. neither can bots.";
  if (x.updates < 3) {
    const vs = x.recordVsNear != null && x.recordVsNear > 0 ? ` (+${ptsShort(x.recordVsNear)} vs NEAR)` : "";
    return `just started silently copying ${x.name} on @NEARProtocol. verified record: ${pctWords(x.record.ret)}${vs}, worst dip ${dipWords(x.record.dd)}. ${tail}`;
  }
  const vs = x.copyVsNear != null && x.copyVsNear > 0 ? `, beating NEAR by ${ptsShort(x.copyVsNear)}` : "";
  return `silently copying ${x.name} on @NEARProtocol: ${pctWords(x.copyPct)} ${sinceWords(x.sinceMs)}${vs}. ${tail}`;
}

/** "~12 min", or "any minute now" when the cadence says it is due. Cadence = median gap of recent updates. */
export function nextUpdateWords(times: number[], now = Date.now()): string | null {
  if (times.length < 3) return null;
  const w = times.slice(-11);
  const gaps = w.slice(1).map((t, i) => t - w[i]).sort((x, y) => x - y);
  const median = gaps[Math.floor(gaps.length / 2)];
  const left = times[times.length - 1] + median - now;
  if (left <= 60_000) return "any minute now";
  const m = Math.round(left / 60_000);
  return m < 90 ? `in ~${m} min` : `in ~${Math.round(m / 60)} h`;
}

/** "3 min ago", "2 h ago", "just now". */
export function agoWords(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** The pre-rendered vault link (its own X/Telegram card), opening straight into a $100 copy. */
export const shareUrl = (id: string) => `${SITE}/v/${encodeURIComponent(id)}/?ref=copy&copy=1`;
