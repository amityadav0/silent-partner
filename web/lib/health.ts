// System status (D9): is everything that keeps the vaults honest actually running?
// Read in the browser from public sources: the mainnet vault, the season's last-run.json,
// and the keeper workflow's last run.
import { agoWords } from "./copy";
import { MAINNET_VAULT } from "./vaults";
import { seasonUrl, view } from "./vault";

export type Level = "ok" | "warn" | "bad";
export type Health = { mainnetMs: number | null; seasonMs: number | null; ai: "ok" | "down" | null; keeper: "ok" | "failed" | null; aiMs?: number | null; staleMs?: number | null };
const H = 3_600_000;

/** Thresholds: mainnet posts every 3 h (emergency at 24 h); the season ticks every 15 min. */
export function judge(h: Health, now = Date.now()): { level: Level; headline: string; parts: string[] } {
  const problems: [Level, string][] = [];
  const mAge = h.mainnetMs === null ? null : now - h.mainnetMs;
  const sAge = h.seasonMs === null ? null : now - h.seasonMs;
  if (mAge !== null && mAge > 12 * H) problems.push(["bad", `the mainnet price is ${agoWords(mAge).replace(" ago", "")} old; the emergency exit opens at 24 h`]);
  else if (mAge !== null && mAge > 4 * H) problems.push(["warn", `the mainnet price is ${agoWords(mAge).replace(" ago", "")} old (it should update every 3 h)`]);
  if (sAge !== null && sAge > 3 * H) problems.push(["bad", `testnet prices stopped ${agoWords(sAge)}`]);
  else if (sAge !== null && sAge > 45 * 60_000) problems.push(["warn", `testnet prices are late (last ${agoWords(sAge)})`]);
  if (h.keeper === "failed") problems.push(["warn", "the keeper's last run failed"]);
  if (h.ai === "down") problems.push(["warn", "NEAR AI is unreachable, so AI leaders are holding"]);
  const level: Level = problems.some((p) => p[0] === "bad") ? "bad" : problems.length ? "warn" : "ok";
  const parts = [
    mAge === null ? "mainnet price: checking" : `last mainnet price ${agoWords(mAge)}`,
    `keeper ${h.keeper === "failed" ? "✗" : h.keeper === "ok" ? "✓" : "…"}`,
    `NEAR AI ${h.ai === "down" ? "✗" : h.ai === "ok" ? "✓" : "…"}${h.aiMs ? ` (last decision ${agoWords(now - h.aiMs)})` : ""}`,
  ];
  if (h.staleMs) parts.push(`some checks timed out: showing the last known state from ${agoWords(now - h.staleMs)}`);
  const headline = level === "ok" ? "All systems normal" : `${level === "bad" ? "Problem" : "Running late"}: ${problems.map((p) => p[1]).join("; ")}`;
  return { level, headline, parts };
}

/** Resolve to `fallback` if `p` takes longer than `ms` (Z4: a slow source never leaves "…" up). */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((res) => {
    const t = setTimeout(() => res(fallback), ms);
    p.then((v) => (clearTimeout(t), res(v)), () => (clearTimeout(t), res(fallback)));
  });
}

type Decision = { ranAt: string; ai_status?: string };
/** AI leaders decide hourly, so most ticks carry no AI result: read the latest decision instead. */
export function aiFromDecisions(d: Record<string, Decision[]>): { ai: "ok" | "down" | null; at: number | null } {
  const last = Object.values(d).flatMap((xs) => xs.slice(-1)).sort((a, b) => Date.parse(b.ranAt) - Date.parse(a.ranAt))[0];
  if (!last) return { ai: null, at: null };
  return { ai: last.ai_status === "ok" ? "ok" : "down", at: Date.parse(last.ranAt) };
}

/** The keeper's state: its last GitHub run if known, else a mainnet post under 4 h old means it's working. */
export function keeperFrom(run: Health["keeper"], mainnetMs: number | null, now = Date.now()): Health["keeper"] {
  return run ?? (mainnetMs !== null && now - mainnetMs < 4 * H ? "ok" : null);
}

const KEY = "sp.health";
const TIMEOUT_MS = 6_000;
let cache: Promise<Health> | null = null;
export function loadHealth(): Promise<Health> {
  cache ??= Promise.all([
    within(view<{ last_nav_ms: number }>(MAINNET_VAULT, "get_vault").then((v) => v.last_nav_ms, () => null), TIMEOUT_MS, null),
    within(fetch(seasonUrl("last-run.json")).then((r) => r.json()).then((j: { ranAt: string }) => Date.parse(j.ranAt)).catch(() => null), TIMEOUT_MS, null),
    within(fetch(seasonUrl("decisions.json")).then((r) => r.json()).then(aiFromDecisions).catch(() => null), TIMEOUT_MS, null),
    within(
      fetch("https://api.github.com/repos/amityadav0/silent-partner/actions/workflows/keeper.yml/runs?per_page=1&status=completed")
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { workflow_runs?: { conclusion: string }[] } | null) => {
          const c = j?.workflow_runs?.[0]?.conclusion;
          return c ? (c === "success" ? "ok" : "failed") : null;
        })
        .catch(() => null),
      TIMEOUT_MS,
      null,
    ),
  ]).then(([m, s, a, k]) => {
    // B6: the keeper's job is the mainnet post; if GitHub's API is slow or rate-limited, a post
    // under 4 h old says the keeper is working.
    const keeper = keeperFrom(k as Health["keeper"], m);
    const fresh: Health = { mainnetMs: m, seasonMs: s, ai: a?.ai ?? null, aiMs: a?.at ?? null, keeper };
    let saved: (Health & { savedMs: number }) | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    } catch {
      /* no storage */
    }
    const missing = fresh.mainnetMs === null || fresh.seasonMs === null || fresh.ai === null || fresh.keeper === null;
    const h: Health = missing && saved
      ? { mainnetMs: fresh.mainnetMs ?? saved.mainnetMs, seasonMs: fresh.seasonMs ?? saved.seasonMs, ai: fresh.ai ?? saved.ai, aiMs: fresh.aiMs ?? saved.aiMs, keeper: fresh.keeper ?? saved.keeper, staleMs: saved.savedMs }
      : fresh;
    // remember whatever resolved, field by field, so one slow source never blanks the line next time
    try {
      const merged = { mainnetMs: fresh.mainnetMs ?? saved?.mainnetMs ?? null, seasonMs: fresh.seasonMs ?? saved?.seasonMs ?? null, ai: fresh.ai ?? saved?.ai ?? null, aiMs: fresh.aiMs ?? saved?.aiMs ?? null, keeper: fresh.keeper ?? saved?.keeper ?? null, savedMs: Date.now() };
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      /* no storage */
    }
    return h;
  });
  return cache;
}
