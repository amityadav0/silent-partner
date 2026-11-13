// System status (D9): is everything that keeps the vaults honest actually running?
// Read in the browser from public sources: the mainnet vault, the season's last-run.json,
// and the keeper workflow's last run.
import { agoWords } from "./copy";
import { MAINNET_VAULT } from "./vaults";
import { seasonUrl, view } from "./vault";

export type Level = "ok" | "warn" | "bad";
export type Health = { mainnetMs: number | null; seasonMs: number | null; ai: "ok" | "down" | null; keeper: "ok" | "failed" | null };
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
    `NEAR AI ${h.ai === "down" ? "✗" : h.ai === "ok" ? "✓" : "…"}`,
  ];
  const headline = level === "ok" ? "All systems normal" : `${level === "bad" ? "Problem" : "Running late"}: ${problems.map((p) => p[1]).join("; ")}`;
  return { level, headline, parts };
}

let cache: Promise<Health> | null = null;
export function loadHealth(): Promise<Health> {
  cache ??= Promise.all([
    view<{ last_nav_ms: number }>(MAINNET_VAULT, "get_vault").then((v) => v.last_nav_ms, () => null),
    fetch(seasonUrl("last-run.json"))
      .then((r) => r.json())
      .then((j: { ranAt: string; results: { ai_model?: string; ai_status?: string }[] }) => {
        const ai = j.results.filter((x) => x.ai_model);
        return { at: Date.parse(j.ranAt), ai: ai.length ? (ai.some((x) => x.ai_status === "ok") ? "ok" : "down") : null } as const;
      })
      .catch(() => null),
    fetch("https://api.github.com/repos/amityadav0/silent-partner/actions/workflows/keeper.yml/runs?per_page=1&status=completed")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { workflow_runs?: { conclusion: string }[] } | null) => {
        const c = j?.workflow_runs?.[0]?.conclusion;
        return c ? (c === "success" ? "ok" : "failed") : null;
      })
      .catch(() => null),
  ]).then(([m, s, k]) => ({ mainnetMs: m, seasonMs: s?.at ?? null, ai: s?.ai ?? null, keeper: k as Health["keeper"] }));
  return cache;
}
