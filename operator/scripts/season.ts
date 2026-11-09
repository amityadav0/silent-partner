// Paper-season runner (GitHub Actions cron, every 15 minutes; or locally).
//
// For each season vault: the leader decides (bots from public market data; the
// manual vault only when a signed signal is passed in), the operator executes
// the signal as a paper fill priced by a real 1Click dry quote, then posts a
// signed NAV epoch to the testnet vault. Testnet only, dry only.
//
// Secrets (env, testnet only; locally they fall back to data/season-keys.json):
//   SEASON_OPERATOR_KEY     operator account key (sp-sop-…testnet)
//   SEASON_ATTESTATION_KEY  NAV attestation key
//   SEASON_SIGNAL_KEYS      JSON {vault: key} for the bot leaders
//   SEASON_STATE_KEY        32-byte hex; seals fill logs and bot notes at rest
//   NEARAI_API_KEY          optional; the AI leader holds without it
// Inputs: SEASON_SIGNAL (manual leader's signed envelope), SEASON_STATE_DIR
// (sealed state checkout, default ../season-state).
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { NearVault } from "../src/chain.js";
import { Confidential } from "../src/confidential.js";
import { FillLog } from "../src/filllog.js";
import { Operator } from "../src/operator.js";
import { loadEnv } from "../src/config.js";
import { nearUsd, type Series } from "../src/leaders/market.js";
import { STRATEGIES } from "../src/leaders/strategies.js";
import { aiLeader } from "../src/leaders/ai.js";
import { MockFeed } from "../src/oracle.js";
import { open, sealDir, unsealDir } from "../src/season/state.js";
import { tick, type Decide, type TickResult } from "../src/season/tick.js";

const S = JSON.parse(readFileSync("season/vaults.json", "utf8")) as { operator: string; base: string; risk: string; vaults: { id: string; strategy: string; name: string }[] };
const local = existsSync("data/season-keys.json") ? JSON.parse(readFileSync("data/season-keys.json", "utf8")) : {};
const e = process.env;
const opKey = e.SEASON_OPERATOR_KEY || (existsSync(`${homedir()}/.near-credentials/testnet/${S.operator}.json`) ? JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${S.operator}.json`, "utf8")).private_key : "");
const attKey = e.SEASON_ATTESTATION_KEY || local.attestation;
const stateKey = e.SEASON_STATE_KEY || local.state;
const signalKeys: Record<string, string> = e.SEASON_SIGNAL_KEYS ? JSON.parse(e.SEASON_SIGNAL_KEYS) : Object.fromEntries(Object.entries(local).filter(([k]) => k.startsWith("signal:")).map(([k, v]) => [k.slice(7), v]));
if (!opKey || !attKey || !stateKey) throw new Error("missing season secrets");

const sealed = e.SEASON_STATE_DIR ?? "../season-state";
const plain = "data/season";
mkdirSync(plain, { recursive: true });
unsealDir(join(sealed, "state"), plain, stateKey);

const env = loadEnv({ NEAR_NETWORK: "testnet", DRY_RUN: "1", CHAIN_WRITES: "1" });
if (env.network !== "testnet" || !env.op.dryRun) throw new Error("the season is testnet paper only");
// Manual signals: the sealed inbox (season-inbox.ts), oldest first; SEASON_SIGNAL (clear JSON) for local runs.
const inboxDir = join(sealed, "inbox");
const inbox = existsSync(inboxDir) ? readdirSync(inboxDir).filter((n) => n.endsWith(".enc")).sort() : [];
const pending = inbox.map((n) => {
  try {
    return { file: n, env: JSON.parse(open(readFileSync(join(inboxDir, n), "utf8").trim(), stateKey).toString()) };
  } catch {
    return { file: n, env: null };
  }
});
if (e.SEASON_SIGNAL) pending.push({ file: "", env: JSON.parse(e.SEASON_SIGNAL) });
const consumed: string[] = pending.filter((p) => p.env === null).map((p) => p.file); // undecryptable: drop

let market: Series | null = null;
try { market = await nearUsd(); } catch (x) { console.log("market data unavailable; bots hold:", (x as Error).message); }

// NAV bound: put a fresh NEAR/USD price in the vaults' oracle before the posts.
// The writer is a separate account (SEASON_ORACLE_KEY), not the operator.
let oracle: { tx?: string; error?: string } | null = null;
const oracleCfg = (S as any).oracle as { contract: string; writer: string } | undefined;
const oracleKey = e.SEASON_ORACLE_KEY || local.oracleWriter;
if (oracleCfg && oracleKey && market) {
  try {
    oracle = { tx: (await new MockFeed(env.rpc, oracleCfg.contract, oracleCfg.writer, oracleKey).push(market.p[market.p.length - 1])).tx };
  } catch (x) {
    oracle = { error: String((x as Error).message).slice(0, 200) };
  }
  console.log(JSON.stringify({ oracle }));
}

const results: TickResult[] = [];
const files: string[] = [];
for (const v of S.vaults.filter((v) => v.strategy !== "drill")) {
  const fills = `fills-${v.id}.jsonl`, notes = `notes-${v.id}.jsonl`;
  files.push(fills, notes);
  try {
    const chain = new NearVault(v.id, env.rpc, "testnet", S.operator, opKey);
    const va = (await chain.getVault()).vault_account!;
    const op = new Operator(chain, new Confidential(env.oneclickUrl, "", fetch, undefined, true), new FillLog(v.id, join(plain, fills)), KeyPair.fromString(attKey), "ed25519:" + base58.encode(Buffer.from(va, "hex")), env.op);
    let decide: Decide | undefined;
    if (market && STRATEGIES[v.strategy]) decide = async (cur) => STRATEGIES[v.strategy](market!, cur);
    if (market && v.strategy === "ai") decide = (cur) => aiLeader(market!, cur, { apiKey: e.NEARAI_API_KEY, model: e.NEARAI_MODEL });
    // one manual signal per vault per tick; the rest wait for the next tick
    const m = v.strategy === "manual" ? pending.find((p) => p.env?.signal?.vault === v.id) : undefined;
    if (m?.file) consumed.push(m.file);
    results.push(await tick({ op, vault: v.id, base: S.base, risk: S.risk, decide: v.strategy === "manual" ? undefined : decide, signalKey: signalKeys[v.id], manual: m?.env ?? undefined, notesPath: join(plain, notes) }));
  } catch (x) {
    results.push({ vault: v.id, exposureBefore: NaN, error: String((x as Error).message).slice(0, 300) });
  }
  console.log(JSON.stringify(redact(results[results.length - 1])));
}

/** What may be printed (CI logs are public) or committed in clear: only what the chain shows. */
function redact(r: TickResult) {
  const sig = r.signal && "hash" in r.signal ? { signal_hash: r.signal.hash, signal_status: r.signal.status } : r.signal ? { signal_error: r.signal.error } : {};
  return { vault: r.vault, epoch: r.epoch, nav: r.nav, tx: r.tx, ...sig, ...(r.error ? { error: r.error } : {}) };
}

const manualIds = new Set(S.vaults.filter((v) => v.strategy === "manual").map((v) => v.id));
for (const p of pending) if (p.file && !manualIds.has(p.env?.signal?.vault)) consumed.push(p.file); // not for a manual vault: drop
sealDir(plain, join(sealed, "state"), files, stateKey);
for (const f of consumed) rmSync(join(inboxDir, f), { force: true });
// Public run summary: no positions, only what the chain already shows plus decisions' public parts.
writeFileSync(join(sealed, "last-run.json"), JSON.stringify({ ranAt: new Date().toISOString(), marketData: !!market, oracle, results: results.map(redact) }, null, 2) + "\n");
if (results.some((r) => r.error)) process.exitCode = 1;
