// The hero's leader (U11): best "vs holding NEAR" over the last 7 days among season leaders with at
// least 12 browser-verified price updates. Falls back to Contrarian when nothing qualifies (or the
// NEAR history is unavailable). The copy page, its share text and its link card follow the pick.
import { vsNear, type NearSeries } from "./bench";
import { COPY_DEFAULT } from "./copy";
import type { NavPost } from "./vault";

export const PICK_MIN_VERIFIED = 12;
const WEEK = 7 * 24 * 3600_000;

export type PickCandidate = { id: string; navs: Pick<NavPost, "price" | "timestamp_ms">[]; verified: number; season: boolean };

export function pickLeader(cs: PickCandidate[], near: NearSeries | null, now = Date.now()): { id: string; pts: number | null } {
  let best: { id: string; pts: number } | null = null;
  for (const c of cs) {
    if (!c.season || c.verified < PICK_MIN_VERIFIED) continue;
    const v = vsNear(c.navs, near, now - WEEK);
    if (v && (!best || v.pts > best.pts)) best = { id: c.id, pts: v.pts };
  }
  return best ?? { id: COPY_DEFAULT, pts: null };
}
