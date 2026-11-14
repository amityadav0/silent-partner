// Funnel counts (V8), privacy-respecting: four aggregate counters, nothing per person. No cookies,
// no identifiers, no IP stored by us; a fire-and-forget hit to a public counter (abacus, no account).
// Skipped under Do Not Track, in automated browsers, and anywhere but the live site.
export type FunnelEvent = "view" | "copy_start" | "share_click" | "ref_landing" | "landing" | "create_open" | "wallet_connect";
export const FUNNEL_NS = "silent-partner-funnel";
export const FUNNEL_EVENTS: FunnelEvent[] = ["view", "copy_start", "share_click", "ref_landing", "landing", "create_open", "wallet_connect"];
/** Paths counted on their own (A2); every other path counts as "other". */
export const FUNNEL_PATHS = ["/", "/leaderboard/", "/vault/", "/copy/", "/create/ai/", "/how/", "/trust/", "/faq/", "/chain/", "/partners/"];
const HOST = "amityadav0.github.io";

export function shouldCount(env: { host: string; dnt: string | null; webdriver: boolean }): boolean {
  return env.host === HOST && env.dnt !== "1" && !env.webdriver;
}

/** UTC day, "20261114". */
export const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
/** "/create/ai/" → "create-ai"; "/" → "home"; anything unlisted → "other". */
export function pathKey(path: string): string {
  const p = path.endsWith("/") ? path : `${path}/`;
  if (!FUNNEL_PATHS.includes(p)) return "other";
  return p === "/" ? "home" : p.replace(/^\/|\/$/g, "").replace(/\//g, "-");
}
/** The counter keys one event bumps: its total and its day; a view also bumps its path. */
export function keysFor(e: FunnelEvent, path?: string, ms = Date.now()): string[] {
  const keys = [e, `${e}-d${dayKey(ms)}`];
  if (e === "view" && path) keys.push(`view-p-${pathKey(path)}`);
  return keys;
}

export function track(e: FunnelEvent, path?: string): void {
  if (typeof window === "undefined") return;
  const nav = navigator as Navigator & { doNotTrack?: string | null; globalPrivacyControl?: boolean };
  if (!shouldCount({ host: location.host, dnt: nav.globalPrivacyControl ? "1" : (nav.doNotTrack ?? null), webdriver: !!nav.webdriver })) return;
  for (const k of keysFor(e, path)) fetch(`https://abacus.jasoncameron.dev/hit/${FUNNEL_NS}/${k}`, { mode: "no-cors", keepalive: true, credentials: "omit", referrerPolicy: "no-referrer" }).catch(() => {});
}

/** Sum one event over the last `n` UTC days. */
export function lastDays(days: Record<string, Record<string, number>> | undefined, key: string, n: number, now = Date.now()): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += days?.[dayKey(now - i * 86_400_000)]?.[key] ?? 0;
  return s;
}
