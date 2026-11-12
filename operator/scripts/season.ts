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
import { createHash } from "node:crypto";
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
import { aiLeader, AI_MIN_STEP, weightBucket } from "../src/leaders/ai.js";
import type { Attestation } from "../src/leaders/receipt.js";
import { MockFeed } from "../src/oracle.js";
import { open, sealDir, unsealDir } from "../src/season/state.js";
import { tick, type Decide, type TickResult } from "../src/season/tick.js";
import { badgeSvg, cardPng, cardSvg } from "../src/season/card.js";
import { viewCall } from "../src/intents.js";
import { communityKeys, communityPersona, unseal, type Launch } from "../src/season/community.js";
import { ackSignals, launches, operatorAccount, pendingSignals, provision } from "../src/season/provision.js";
import { needsTopup, TOPUP } from "../src/season/topup.js";
import { computeAlerts, pushNtfy, telegram, type AlertEvent, type Snapshot, type TgState, type VaultState } from "../src/season/alerts.js";

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

// Open season: deploy up to two pending launches per tick, then run every live community vault.
const C = (S as any).community as { registry: string; template: string } | undefined;
const ck = communityKeys(stateKey);
let community: Launch[] = [];
const communityLog: Record<string, unknown>[] = [];
let sealedSignals: { id: string; vault: string; sealed: string }[] = [];
if (C) {
  try {
    const opAcct = await operatorAccount(env.rpc, S.operator, opKey);
    const ctx = { rpc: env.rpc, operator: S.operator, operatorKey: opKey, registry: C.registry, template: C.template, usdc: S.base.replace(/^nep141:/, ""), wasm: readFileSync(new URL("../season/vault.wasm", import.meta.url)), sealSk: ck.sealSk };
    for (const l of (await launches(env.rpc, C.registry)).filter((l) => l.status === "pending").slice(0, 2)) {
      try {
        const r = await provision(ctx, opAcct, l);
        communityLog.push({ launch: l.id, vault: r.vault, ...(r.rejected ? { rejected: r.rejected } : { live: true }), txs: r.txs });
      } catch (x) {
        communityLog.push({ launch: l.id, error: String((x as Error).message).slice(0, 200) });
      }
    }
    community = (await launches(env.rpc, C.registry)).filter((l) => l.status === "live" && l.vault);
    sealedSignals = await pendingSignals(env.rpc, C.registry);
  } catch (x) {
    communityLog.push({ error: `registry: ${String((x as Error).message).slice(0, 160)}` });
  }
  for (const c of communityLog) console.log(JSON.stringify({ community: c }));
}

const results: TickResult[] = [];
// One NEAR AI attestation per tick and signing key, reused across AI leaders and published
// whole (attestation.json), so a browser can recheck that its quote binds the signer.
let attestation: (Attestation & { report: { gpu: boolean } }) | undefined;
const attestations = new Map<string, Attestation>();
const ai = (persona: Parameters<typeof aiLeader>[2]["persona"]): Decide => async (cur) => {
  const d = await aiLeader(market!, cur, { apiKey: e.NEARAI_API_KEY, model: e.NEARAI_MODEL, persona, attestation });
  if (d.attestation) {
    attestation = d.attestation as typeof attestation;
    attestations.set(d.attestation.signing_address, { model: d.attestation.model, signing_address: d.attestation.signing_address, nonce: d.attestation.nonce, intel_quote: d.attestation.intel_quote });
  }
  return d;
};
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
    if (market && v.strategy.startsWith("ai")) decide = ai(v.strategy);
    // one manual signal per vault per tick; the rest wait for the next tick
    const m = v.strategy === "manual" ? pending.find((p) => p.env?.signal?.vault === v.id) : undefined;
    if (m?.file) consumed.push(m.file);
    results.push(await tick({ op, vault: v.id, base: S.base, risk: S.risk, decide: v.strategy === "manual" ? undefined : decide, signalKey: signalKeys[v.id], manual: m?.env ?? undefined, notesPath: join(plain, notes), minStep: v.strategy.startsWith("ai") ? AI_MIN_STEP : undefined }));
  } catch (x) {
    results.push({ vault: v.id, exposureBefore: NaN, error: String((x as Error).message).slice(0, 300) });
  }
  console.log(JSON.stringify(redact(results[results.length - 1])));
}

// Community vaults: AI leaders from their sealed strategy (once the leader registered the
// season's signer), human leaders from their sealed signals, one per vault per tick.
const processed = new Set<string>();
for (const l of community) {
  const vid = l.vault!;
  const fills = `fills-${vid}.jsonl`, notes = `notes-${vid}.jsonl`;
  files.push(fills, notes);
  try {
    const chain = new NearVault(vid, env.rpc, "testnet", S.operator, opKey);
    const va = (await chain.getVault()).vault_account!;
    const op = new Operator(chain, new Confidential(env.oneclickUrl, "", fetch, undefined, true), new FillLog(vid, join(plain, fills)), KeyPair.fromString(attKey), "ed25519:" + base58.encode(Buffer.from(va, "hex")), env.op);
    let decide: Decide | undefined, signalKey: string | undefined, manual: unknown;
    if (l.kind === "ai") {
      const persona = communityPersona(l, await unseal(l.sealed_prompt ?? "", ck.sealSk, "launch"));
      const registered = await viewCall<string | null>(env.rpc, vid, "get_signal_key", {}, fetch, "optimistic");
      if (persona && market && registered === ck.signalPublic) {
        decide = ai(persona);
        signalKey = ck.signalSecret;
      }
    } else {
      const s = sealedSignals.find((x) => x.vault === vid && !processed.has(x.id));
      if (s) {
        processed.add(s.id);
        manual = await unseal(s.sealed, ck.sealSk, `signal:${vid}`).then((t) => JSON.parse(t), () => undefined);
      }
    }
    results.push(await tick({ op, vault: vid, base: S.base, risk: S.risk, decide, signalKey, manual, notesPath: join(plain, notes), minStep: l.kind === "ai" ? AI_MIN_STEP : undefined }));
  } catch (x) {
    results.push({ vault: vid, exposureBefore: NaN, error: String((x as Error).message).slice(0, 300) });
  }
  console.log(JSON.stringify(redact(results[results.length - 1])));
}
// Acknowledge the sealed signals read this tick (a contiguous prefix; signals for unknown vaults are dropped).
if (C && sealedSignals.length) {
  const live = new Set(community.map((l) => l.vault));
  let upto: number | null = null;
  for (const s of [...sealedSignals].sort((a, b) => Number(a.id) - Number(b.id))) {
    if (processed.has(s.id) || !live.has(s.vault)) upto = Number(s.id) + 1;
    else break;
  }
  if (upto !== null) {
    try {
      await ackSignals(await operatorAccount(env.rpc, S.operator, opKey), C.registry, upto);
    } catch (x) {
      communityLog.push({ error: `ack: ${String((x as Error).message).slice(0, 120)}` });
    }
  }
}

// Alerts: vault-level events from public chain state, to season-state/alerts.json, ntfy.sh and Telegram.
const alertVaults = [...S.vaults.filter((v) => v.strategy !== "drill").map((v) => ({ id: v.id, name: v.name })), ...community.map((l) => ({ id: l.vault!, name: l.name }))];
const snaps: Snapshot[] = [];
for (const v of alertVaults) {
  try {
    const g = await viewCall<{ price: string; last_nav_ms: number; emergency: boolean; pending_withdrawals: number }>(env.rpc, v.id, "get_vault", {}, fetch, "optimistic");
    const claims = await viewCall<{ amount: string; paid: string }[]>(env.rpc, v.id, "get_claims", { from: 0, limit: 1000 }, fetch, "optimistic");
    snaps.push({ vault: v.id, name: v.name, price: Number(BigInt(g.price)) / 1e18, lastNavMs: g.last_nav_ms, emergency: g.emergency, pending: g.pending_withdrawals, claimsPaid: claims.filter((c) => BigInt(c.paid) >= BigInt(c.amount)).length });
  } catch {
    /* a missed read skips this vault's alerts for one tick */
  }
}
const alertFile = join(sealed, "alerts.json");
let alertDoc: { state: Record<string, VaultState>; events: AlertEvent[] } = { state: {}, events: [] };
try {
  alertDoc = JSON.parse(readFileSync(alertFile, "utf8"));
} catch {
  /* first run */
}
const fresh = computeAlerts(alertDoc.state, snaps, Date.now());
writeFileSync(alertFile, JSON.stringify({ state: fresh.state, events: [...fresh.events, ...alertDoc.events].slice(0, 200) }, null, 2) + "\n");
for (const ev of fresh.events) {
  console.log(JSON.stringify({ alert: ev }));
  await pushNtfy(ev).catch(() => undefined);
}
if (e.TELEGRAM_BOT_TOKEN) {
  const tgFile = join(plain, "telegram.json");
  files.push("telegram.json");
  try {
    const st: TgState = existsSync(tgFile) ? JSON.parse(readFileSync(tgFile, "utf8")) : { offset: 0, subs: {} };
    writeFileSync(tgFile, JSON.stringify(await telegram(e.TELEGRAM_BOT_TOKEN, st, fresh.events, new Set(alertVaults.map((v) => v.id)))));
  } catch (x) {
    console.log(JSON.stringify({ telegram_error: String((x as Error).message).slice(0, 120) }));
  }
}

// Track-record cards (public PNGs, only on-chain data): season-state/cards/<vault>.png.
const STYLE: Record<string, [string, string]> = {
  momentum: ["Bot", "EMA crossover"], "mean-reversion": ["Bot", "Buys −1.5σ, sells +1.5σ"], manual: ["Human", "Signs by hand"],
  ai: ["AI", "Momentum + volatility, own judgement"], "ai-trend": ["AI", "Rides momentum"], "ai-contrarian": ["AI", "Fades extremes"],
  "ai-voltarget": ["AI", "Targets 40% volatility"], "ai-conviction": ["AI", "50% NEAR, tilts by conviction"],
};
mkdirSync(join(sealed, "cards"), { recursive: true });
mkdirSync(join(sealed, "badges"), { recursive: true });
const cardVaults = [...S.vaults.filter((v) => v.strategy !== "drill"), ...community.map((l) => ({ id: l.vault!, strategy: `community-${l.kind}`, name: l.name, style: l.style }))];
for (const v of cardVaults) {
  try {
    const navs: { epoch: number; timestamp_ms: number; price: string }[] = [];
    for (let from = 0; ; from += 100) {
      const page = await viewCall<typeof navs>(env.rpc, v.id, "get_navs", { from, limit: 100 }, fetch, "optimistic");
      navs.push(...page);
      if (page.length < 100) break;
    }
    const g = await viewCall<{ leader_shares: string; total_shares: string }>(env.rpc, v.id, "get_vault", {}, fetch, "optimistic");
    const [badge, style] = STYLE[v.strategy] ?? [v.strategy === "community-ai" ? "AI" : "Human", (v as { style?: string }).style ?? ""];
    const bsvg = badgeSvg({ navs });
    writeFileSync(join(sealed, "badges", `${v.id}.png`), cardPng(bsvg, 2 * Number(bsvg.match(/width="([\d.]+)"/)![1])));
    writeFileSync(join(sealed, "cards", `${v.id}.png`), cardPng(cardSvg({ name: v.name, badge, style, vault: v.id, navs, leaderShares: g.leader_shares, totalShares: g.total_shares, asOf: new Date() })));
  } catch (x) {
    console.log(JSON.stringify({ card_error: v.id, error: String((x as Error).message).slice(0, 120) }));
  }
}

// Keep-online check (D-S-11): warn when an account the season spends from has
// < 10 days of budget left. Balances are public on-chain anyway.
const DAILY: [string, number][] = [[S.operator, 0.35], ...(((S as any).oracle?.writer ? [[(S as any).oracle.writer, 0.03]] : []) as [string, number][]), ...S.vaults.filter((v) => v.strategy !== "drill").map((v) => [v.id, 0.29] as [string, number]), ...community.map((l) => [l.vault!, 0.29] as [string, number])];
const warnings: Record<string, unknown>[] = [];
const topups: Record<string, unknown>[] = [];
const freeNear = async (id: string) => {
  const r = await fetch(env.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: id } }) });
  const a = ((await r.json()) as any).result;
  return Number(BigInt(a.amount)) / 1e24 - a.storage_usage * 1e-5;
};
// Auto top-up: community vaults (no keys of their own) plus vaults.json `auto_topup`.
const AUTO = new Set([...community.map((l) => l.vault!), ...(((S as any).auto_topup ?? []) as string[])]);
for (const [id, perDay] of DAILY) {
  try {
    let free = await freeNear(id);
    if (AUTO.has(id) && opKey && needsTopup(free, perDay, await freeNear(S.operator))) {
      try {
        const o = await (await operatorAccount(env.rpc, S.operator, opKey)).sendMoney(id, BigInt(TOPUP.amount) * 10n ** 24n);
        const t = { topup: id, near: TOPUP.amount, from: S.operator, tx: o.transaction.hash };
        topups.push(t);
        console.log(JSON.stringify(t));
        free = await freeNear(id);
      } catch (x) {
        console.log(JSON.stringify({ topup_error: id, error: String((x as Error).message).slice(0, 160) }));
      }
    }
    if (free / perDay < 10 && !(AUTO.has(id) && free / perDay >= TOPUP.belowDays)) {
      const w = { warning: "low balance: top up from the spare testnet accounts", account: id, free_near: +free.toFixed(2), days_left: +(free / perDay).toFixed(1) };
      warnings.push(w);
      console.log(JSON.stringify(w));
    }
  } catch {
    /* a missed balance read must not fail the tick */
  }
}

/** What may be printed (CI logs are public) or committed in clear: only what the chain shows. */
function redact(r: TickResult) {
  const sig = r.signal && "hash" in r.signal ? { signal_hash: r.signal.hash, signal_status: r.signal.status } : r.signal ? { signal_error: r.signal.error } : {};
  // Token counts and the model are not positions: safe to print (cost tracking).
  // AI leader: the target as a 20-point bucket and the rationale's hash, never the exact target or the rationale.
  // ai_status says whether NEAR AI answered, so an outage never reads as a "hold" decision.
  const down = r.decision?.model && !r.decision.usage && /^NEAR AI|NEARAI_API_KEY/.test(r.decision.why ?? "");
  // The TEE receipt is public by design: hashes, NEAR AI's signature and the attestation digest, no reasoning.
  const rc = r.decision?.receipt;
  const receipt = rc ? { ai_receipt: { text: rc.text, signature: rc.signature, signing_address: rc.signing_address, signature_kind: rc.signature_kind, quote_sha256: rc.quote_sha256, nonce: rc.nonce, bound: rc.bound, gpu_evidence: rc.gpu_evidence } } : r.decision?.receipt_error ? { ai_receipt_error: r.decision.receipt_error } : {};
  const ai = r.decision?.model ? { ai_model: r.decision.model, ai_status: down ? "unavailable" : "ok", ...(down ? { ai_error: String(r.decision.why).slice(0, 80) } : {}), ai_tokens: r.decision.usage ?? null, ai_target_band: weightBucket(r.decision.target), ai_rationale_hash: r.decision.memo_hash ?? null, ...receipt } : {};
  return { vault: r.vault, epoch: r.epoch, nav: r.nav, tx: r.tx, ...sig, ...ai, ...(r.error ? { error: r.error } : {}) };
}

const manualIds = new Set(S.vaults.filter((v) => v.strategy === "manual").map((v) => v.id));
for (const p of pending) if (p.file && !manualIds.has(p.env?.signal?.vault)) consumed.push(p.file); // not for a manual vault: drop
sealDir(plain, join(sealed, "state"), files, stateKey);
for (const f of consumed) rmSync(join(inboxDir, f), { force: true });
// Public run summary: no positions, only what the chain already shows plus decisions' public parts.
const ranAt = new Date().toISOString();
writeFileSync(join(sealed, "last-run.json"), JSON.stringify({ ranAt, marketData: !!market, oracle, warnings, topups, community: communityLog, results: results.map(redact) }, null, 2) + "\n");
// Recent signals per vault (hashes only), so the vault page can match a trade to its on-chain record.
const recentFile = join(sealed, "recent-signals.json");
let recent: Record<string, Record<string, unknown>[]> = {};
try {
  recent = JSON.parse(readFileSync(existsSync(recentFile) ? recentFile : new URL("../season/recent-signals.seed.json", import.meta.url), "utf8"));
} catch {
  /* first run without a seed */
}
for (const r of results.map(redact) as Record<string, any>[]) {
  if (!r.signal_hash || r.signal_status === "rejected") continue;
  const keep = { ranAt, epoch: r.epoch, signal_hash: r.signal_hash, signal_status: r.signal_status, ai_target_band: r.ai_target_band ?? null, ai_rationale_hash: r.ai_rationale_hash ?? null, ...(r.ai_receipt ? { ai_model: r.ai_model, ai_receipt: r.ai_receipt } : {}) };
  recent[r.vault] = [...(recent[r.vault] ?? []), keep].slice(-20);
}
writeFileSync(recentFile, JSON.stringify(recent, null, 2) + "\n");
// The attestation quotes behind this tick's receipts, keyed by quote digest (kept across ticks, last 50).
const attFile = join(sealed, "attestations.json");
let attDoc: Record<string, Attestation & { seen: string }> = {};
try {
  if (existsSync(attFile)) attDoc = JSON.parse(readFileSync(attFile, "utf8"));
} catch {
  /* start over */
}
for (const a of attestations.values()) attDoc[createHash("sha256").update(Buffer.from(a.intel_quote.replace(/^0x/, ""), "hex")).digest("hex")] = { ...a, seen: ranAt };
writeFileSync(attFile, JSON.stringify(Object.fromEntries(Object.entries(attDoc).slice(-50)), null, 1) + "\n");
if (results.some((r) => r.error)) process.exitCode = 1;
