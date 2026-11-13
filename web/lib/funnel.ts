// Funnel counts (V8), privacy-respecting: four aggregate counters, nothing per person. No cookies,
// no identifiers, no IP stored by us; a fire-and-forget hit to a public counter (abacus, no account).
// Skipped under Do Not Track, in automated browsers, and anywhere but the live site.
export type FunnelEvent = "view" | "copy_start" | "share_click" | "ref_landing";
export const FUNNEL_NS = "silent-partner-funnel";
export const FUNNEL_EVENTS: FunnelEvent[] = ["view", "copy_start", "share_click", "ref_landing"];
const HOST = "amityadav0.github.io";

export function shouldCount(env: { host: string; dnt: string | null; webdriver: boolean }): boolean {
  return env.host === HOST && env.dnt !== "1" && !env.webdriver;
}

export function track(e: FunnelEvent): void {
  if (typeof window === "undefined") return;
  const nav = navigator as Navigator & { doNotTrack?: string | null; globalPrivacyControl?: boolean };
  if (!shouldCount({ host: location.host, dnt: nav.globalPrivacyControl ? "1" : (nav.doNotTrack ?? null), webdriver: !!nav.webdriver })) return;
  fetch(`https://abacus.jasoncameron.dev/hit/${FUNNEL_NS}/${e}`, { mode: "no-cors", keepalive: true, credentials: "omit", referrerPolicy: "no-referrer" }).catch(() => {});
}
