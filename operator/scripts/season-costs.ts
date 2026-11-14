// Recompute season-state/costs.json (T2) from the sealed fill logs, outside a tick.
// The season job writes the same file every tick; this is for a one-off refresh.
//
//   SEASON_STATE_DIR=../season-state npx tsx scripts/season-costs.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { open } from "../src/season/state.js";
import { costSummary, pooledBps, publish, type CostSummary } from "../src/season/costs.js";
import { TURNOVER } from "../src/season/turnover.js";

const S = JSON.parse(readFileSync("season/vaults.json", "utf8"));
const dir = process.env.SEASON_STATE_DIR ?? "../season-state";
const key = process.env.SEASON_STATE_KEY || JSON.parse(readFileSync("data/season-keys.json", "utf8")).state;
const near = JSON.parse(readFileSync(join(dir, "near-usd.json"), "utf8"));
const raw: [string, CostSummary, number | null][] = [];
for (const f of readdirSync(join(dir, "state")).filter((n) => n.startsWith("fills-") && n.endsWith(".jsonl.enc"))) {
  const vault = f.slice(6, -10);
  const entries = open(readFileSync(join(dir, "state", f), "utf8").trim(), key).toString().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const nav = entries.filter((e: { kind: string }) => e.kind === "nav").at(-1);
  const navUsd = nav ? Number(nav.data.nav) / 1e6 : null;
  raw.push([vault, costSummary(entries, { base: S.base, risk: S.risk, near, navUsd, now: Date.now() }), navUsd]);
}
const bps = pooledBps(raw.map(([, c]) => c));
const out = { ranAt: new Date().toISOString(), cost_bps: bps, turnover_rule_since: TURNOVER.liveSince, vaults: Object.fromEntries(raw.map(([id, c, nav]) => [id, publish(c, bps, nav)])) };
if (!existsSync(dir)) throw new Error(`no ${dir}`);
writeFileSync(join(dir, "costs.json"), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
