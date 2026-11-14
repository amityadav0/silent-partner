// The hero's leader (U11): best "vs holding NEAR" over the last 7 days among season leaders with at
// least 12 browser-verified price updates. Falls back to Contrarian when nothing qualifies (or the
// NEAR history is unavailable). The copy page, its share text and its link card follow the pick.
import { vsNear, type NearSeries, type VsNear } from "./bench";
import { COPY_DEFAULT } from "./copy";
import type { NavPost } from "./vault";
import { hasRecord } from "./record";

export const PICK_MIN_VERIFIED = 12;
const WEEK = 7 * 24 * 3600_000;

export type PickCandidate = { id: string; navs: Pick<NavPost, "price" | "timestamp_ms">[]; verified: number; season: boolean; benchmark?: boolean };

export function pickLeader(cs: PickCandidate[], near: NearSeries | null, now = Date.now()): { id: string; pts: number | null; v?: VsNear } {
  let best: { id: string; pts: number; v: VsNear } | null = null;
  for (const c of cs) {
    if (!c.season || c.benchmark || c.verified < PICK_MIN_VERIFIED || !hasRecord(c.navs)) continue;
    const v = vsNear(c.navs, near, now - WEEK);
    if (v && (!best || v.pts > best.pts)) best = { id: c.id, pts: v.pts, v };
  }
  return best ?? { id: COPY_DEFAULT, pts: null };
}

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
/** The hero's proof line (Z6): "Steady Hand: −3.0% while NEAR fell −8.6% this week". */
export function proofLine(name: string, v: VsNear): string {
  return `${name}: ${pct(v.ret)} while NEAR ${v.near < 0 ? "fell" : "rose"} ${pct(v.near)} this week`;
}
