import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { FakeChain, VAULT_ACCT, dryQuotes, fixture, fixtureFetch } from "./fakes.js";
import { Confidential, quoteBody } from "../src/confidential.js";
import { FillLog } from "../src/filllog.js";
import { Operator, type OperatorCfg } from "../src/operator.js";
import { USDC, WNEAR } from "../src/intents.js";
import { toSignedQuote } from "../src/carry/signedQuote.js";
import { signSignal, verifySignal, signalHash } from "../src/signal.js";
import { MIN_STEP, meanReversion, momentum, rebalance } from "../src/leaders/strategies.js";
import { summary, type Series } from "../src/leaders/market.js";
import { open, seal, sealDir, unsealDir } from "../src/season/state.js";
import { tick } from "../src/season/tick.js";

const NOW = 1_794_218_400_000;
const series = (f: (i: number) => number, n = 288): Series => ({ t: Array.from({ length: n }, (_, i) => NOW - (n - i) * 300_000), p: Array.from({ length: n }, (_, i) => f(i)) });

describe("strategies", () => {
  it("momentum: long in an uptrend, flat in a downtrend, holds when flat", () => {
    expect(momentum(series((i) => 3 + i * 0.002), 0).target).toBe(0.8);
    expect(momentum(series((i) => 4 - i * 0.002), 0.8).target).toBe(0);
    expect(momentum(series(() => 3.5), 0.4).target).toBeNull();
  });
  it("mean reversion: buys a dip, sells a spike, centres near the mean", () => {
    const wobble = (i: number) => 3.5 + 0.01 * Math.sin(i);
    expect(meanReversion(series((i) => (i === 287 ? 3.3 : wobble(i))), 0).target).toBe(0.8);
    expect(meanReversion(series((i) => (i === 287 ? 3.7 : wobble(i))), 0.8).target).toBe(0);
    expect(meanReversion(series((i) => (i === 287 ? 3.5 : wobble(i))), 0).target).toBe(0.4);
  });
  it("summary is public market data only", () => {
    const s = summary(series((i) => 3 + i * 0.001));
    expect(Object.keys(s).sort()).toEqual(["ema_1h", "ema_6h", "high_24h", "low_24h", "price", "ret_1h", "ret_24h", "ret_6h", "vol_24h", "vol_annual"]);
    expect(s.ret_24h).toBeGreaterThan(0);
  });
});

describe("rebalance", () => {
  it("buys the risk asset with base, sells it back, ignores small steps", () => {
    const up = rebalance("v", USDC, WNEAR, 0, 0.8, NOW)!;
    expect([up.from, up.to, up.size_bps]).toEqual([USDC, WNEAR, 8000]);
    const down = rebalance("v", USDC, WNEAR, 0.8, 0.3, NOW)!;
    expect([down.from, down.to, down.size_bps]).toEqual([WNEAR, USDC, 5000]);
    expect(rebalance("v", USDC, WNEAR, 0.8, 0, NOW)!.size_bps).toBe(10_000); // full exit leaves no dust
    expect(rebalance("v", USDC, WNEAR, 0.4, 0.4 + MIN_STEP / 2, NOW)).toBeNull();
  });
  it("memo_hash is part of the signed hash", () => {
    const k = KeyPair.fromRandom("ed25519");
    const memo = createHash("sha256").update("because").digest("hex");
    const s = rebalance("vault.testnet", USDC, WNEAR, 0, 0.5, NOW, memo)!;
    const env = signSignal(s, k);
    const want = { vault: "vault.testnet", signalKey: k.getPublicKey().toString(), nowMs: NOW, maxAgeMs: 300_000, seenNonces: new Set<string>(), allowedAssets: [USDC, WNEAR] };
    expect(verifySignal(env, want)).toEqual({ ok: true, hash: signalHash(s).toString("hex") });
    expect(verifySignal({ ...env, signal: { ...s, memo_hash: "00".repeat(32) } }, want).ok).toBe(false);
  });
});

describe("public pricing", () => {
  it("dry trade quotes go to the public legs; live and shield quotes are unchanged", () => {
    const a = { leg: "trade" as const, from: USDC, to: WNEAR, amount: "1", slippageBps: 50, vault: "v", deadlineMs: NOW, dry: true };
    expect(quoteBody(a, true)).toMatchObject({ depositType: "INTENTS", recipientType: "INTENTS", refundType: "INTENTS" });
    expect(quoteBody(a, true)).not.toHaveProperty("confidentiality");
    expect(quoteBody({ ...a, dry: false }, true)).toMatchObject({ depositType: "CONFIDENTIAL_INTENTS" });
    expect(quoteBody(a, false)).toMatchObject({ depositType: "CONFIDENTIAL_INTENTS" });
  });
  it("recorded public quotes are genuinely signed by 1Click", () => {
    for (const f of ["public-usdc-wnear", "public-wnear-usdc"]) expect(() => toSignedQuote(JSON.parse(fixture(f)))).not.toThrow();
  });
});

describe("sealed state", () => {
  const key = randomBytes(32).toString("hex");
  it("round-trips and rejects tampering or the wrong key", () => {
    const s = seal(Buffer.from("fill log"), key);
    expect(open(s, key).toString()).toBe("fill log");
    expect(() => open(s, randomBytes(32).toString("hex"))).toThrow();
    const b = Buffer.from(s.slice(4), "base64");
    b[b.length - 1] ^= 1;
    expect(() => open("sp1:" + b.toString("base64"), key)).toThrow();
  });
  it("seals and unseals a directory; ciphertext holds no plaintext", () => {
    const a = mkdtempSync(join(tmpdir(), "sp-")), z = mkdtempSync(join(tmpdir(), "sp-")), c = mkdtempSync(join(tmpdir(), "sp-"));
    writeFileSync(join(a, "fills-x.jsonl"), '{"kind":"fill","secret":"wNEAR"}\n');
    sealDir(a, z, ["fills-x.jsonl", "missing.jsonl"], key);
    expect(readFileSync(join(z, "fills-x.jsonl.enc"), "utf8")).not.toContain("wNEAR");
    expect(unsealDir(z, c, key)).toEqual(["fills-x.jsonl.enc"]);
    expect(readFileSync(join(c, "fills-x.jsonl"), "utf8")).toContain("wNEAR");
  });
});

describe("season tick", () => {
  const CFG: OperatorCfg = { dryRun: true, chainWrites: true, slippageBps: 50, minShield: 1_000_000n, assetMap: {}, decimals: { [USDC]: 6, [WNEAR]: 24 }, signalMaxAgeMs: 300_000, pollMs: 0, pollTries: 3 };
  function setup() {
    const chain = new FakeChain();
    const k = KeyPair.fromRandom("ed25519");
    chain.signalKey = k.getPublicKey().toString();
    chain.public = 500_000_000n;
    const seen: { path: string; body: any }[] = [];
    const op = new Operator(chain, new Confidential("https://1click.test", "", fixtureFetch({ "/v0/quote": dryQuotes }, seen), undefined, true), new FillLog("vault.testnet", null), KeyPair.fromRandom("ed25519"), "ed25519:" + base58.encode(Buffer.from(VAULT_ACCT, "hex")), CFG, () => NOW, async () => {});
    return { chain, op, k, seen, notes: join(mkdtempSync(join(tmpdir(), "sp-")), "notes.jsonl") };
  }
  it("a bot decision becomes a signed signal, a paper fill at a public quote, and a NAV post", async () => {
    const { chain, op, k, seen, notes } = setup();
    const r = await tick({ op, vault: "vault.testnet", base: USDC, risk: WNEAR, decide: async () => ({ target: 0.5, why: "test", rationale: "secret reasoning" }), signalKey: k.toString(), notesPath: notes, now: () => NOW });
    expect(r.signal && "hash" in r.signal && r.signal.status).toBe("executed");
    expect(chain.calls.map((c) => c.m)).toEqual(["recordSignal", "postNav"]);
    expect(seen.filter((s) => s.path === "/v0/quote").every((s) => s.body.depositType === "INTENTS" && s.body.dry === true)).toBe(true);
    const fill = op.log.entries.find((e) => e.kind === "fill")!;
    expect(fill.data).toMatchObject({ dry: true, status: "PAPER", from: USDC, to: WNEAR });
    // the rationale stays in the private notebook; only its hash is committed
    const note = JSON.parse(readFileSync(notes, "utf8").trim());
    expect(note.memo_hash).toBe(createHash("sha256").update("secret reasoning").digest("hex"));
    expect(JSON.stringify(r)).not.toContain("secret reasoning");
  });
  it("hold decisions post NAV without a signal; manual envelopes are executed as-is", async () => {
    const { chain, op, k, notes } = setup();
    const r = await tick({ op, vault: "vault.testnet", base: USDC, risk: WNEAR, decide: async () => ({ target: null, why: "hold" }), signalKey: k.toString(), notesPath: notes, now: () => NOW });
    expect(r.signal).toBeUndefined();
    expect(chain.calls.map((c) => c.m)).toEqual(["postNav"]);
    const env = signSignal({ v: 1, vault: "vault.testnet", from: USDC, to: WNEAR, size_bps: 2000, type: "market", nonce: randomBytes(8).toString("hex"), created_ms: NOW }, k);
    const m = await tick({ op, vault: "vault.testnet", base: USDC, risk: WNEAR, manual: env, notesPath: notes, now: () => NOW });
    expect(m.signal && "hash" in m.signal && m.signal.status).toBe("executed");
    const bad = await tick({ op, vault: "vault.testnet", base: USDC, risk: WNEAR, manual: env, notesPath: notes, now: () => NOW });
    expect(bad.signal).toEqual({ error: "replayed nonce" });
  });
});

import { aiLeader, parseReply, prompt, DEFAULT_MODEL } from "../src/leaders/ai.js";

describe("AI leader", () => {
  const s = series((i) => 3 + i * 0.001);
  it("parses, clamps and rounds replies; anything odd holds", () => {
    expect(parseReply('{"target_weight": 0.624, "rationale": "trend"}')).toEqual({ target: 0.62, rationale: "trend" });
    expect(parseReply('{"target_exposure": 0.3, "rationale": "old prompt"}').target).toBe(0.3);
    expect(parseReply('sure:\n```json\n{"target_weight": 1.5, "rationale": "x"}\n```').target).toBe(1);
    expect(parseReply('{"target_exposure": -1, "rationale": "x"}').target).toBe(0);
    expect(parseReply('{"target_exposure": null, "rationale": "wait"}')).toEqual({ target: null, rationale: "wait" });
    expect(parseReply("no json here").target).toBeNull();
    expect(parseReply('{"target_exposure": "lots"}').target).toBeNull();
  });
  it("prompt holds only public market data and the vault's own exposure", () => {
    const p = JSON.parse(prompt(s, 0.4));
    expect(Object.keys(p)).toEqual(["market", "vault"]);
    expect(p.vault).toEqual({ current_near_exposure: 0.4 });
  });
  it("holds without a key; calls NEAR AI Cloud with one and keeps the rationale out of `why`", async () => {
    expect(await aiLeader(s, 0, {})).toEqual({ target: null, why: "NEARAI_API_KEY not set: holding" });
    const seen: any[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ id: "chatcmpl-1", choices: [{ message: { content: '{"target_exposure": 0.5, "rationale": "EMAs crossed up"}' } }] }));
    }) as unknown as typeof fetch;
    const d = await aiLeader(s, 0, { apiKey: "k", fetchImpl: f });
    expect(seen[0].url).toBe("https://cloud-api.near.ai/v1/chat/completions");
    expect(seen[0].headers.authorization).toBe("Bearer k");
    expect(seen[0].body.model).toBe(DEFAULT_MODEL);
    expect(d.target).toBe(0.5);
    expect(d.why).not.toContain("EMAs");
    expect(JSON.parse(d.rationale!)).toEqual({ chat_id: "chatcmpl-1", model: DEFAULT_MODEL, rationale: "EMAs crossed up" });
    const err = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    expect((await aiLeader(s, 0, { apiKey: "k", fetchImpl: err })).target).toBeNull();
  });
});

import { toPythPrice } from "../src/oracle.js";
import { NavRejected } from "../src/chain.js";

describe("NAV bound plumbing", () => {
  it("Pyth price encoding: 8 decimals, confidence as a fraction", () => {
    expect(toPythPrice(3.6123, 0.0005, 100)).toEqual({ price: "361230000", conf: "180615", expo: -8, publish_time: 100 });
  });
  it("a NAV the bound rejects is noted in the log and surfaced", async () => {
    const chain = new FakeChain();
    chain.public = 40_000_000n;
    chain.postNav = async () => { throw new NavRejected("tx-r", "silent-partner.nav_rejected epoch=1 nav=1 reason=share return 900bps outside [-150, 150]bps (asset 0bps)"); };
    const op = new Operator(chain, new Confidential("https://1click.test", "", fixtureFetch({ "/v0/quote": dryQuotes })), new FillLog("vault.testnet", null), KeyPair.fromRandom("ed25519"), "ed25519:x", { dryRun: true, chainWrites: true, slippageBps: 50, minShield: 1_000_000n, assetMap: {}, decimals: {}, signalMaxAgeMs: 300_000, pollMs: 0, pollTries: 1 }, () => NOW, async () => {});
    await expect(op.epoch()).rejects.toThrow(/NAV rejected/);
    expect(op.log.entries.at(-1)!.data).toMatchObject({ msg: "NAV rejected by the oracle bound", tx: "tx-r" });
  });
});

import { AI_MIN_STEP, weightBucket } from "../src/leaders/ai.js";

describe("AI allocator", () => {
  it("trades on a 5-point move, not on less", () => {
    expect(rebalance("v", USDC, WNEAR, 0.4, 0.45, NOW, undefined, AI_MIN_STEP)!.size_bps).toBe(500);
    expect(rebalance("v", USDC, WNEAR, 0.4, 0.44, NOW, undefined, AI_MIN_STEP)).toBeNull();
    expect(rebalance("v", USDC, WNEAR, 0.4, 0.45, NOW)).toBeNull(); // bots keep 10 points
  });
  it("the public log shows a 20-point bucket, not the target", () => {
    expect([weightBucket(0), weightBucket(0.19), weightBucket(0.2), weightBucket(0.73), weightBucket(1), weightBucket(null)]).toEqual(["0–20%", "0–20%", "20–40%", "60–80%", "80–100%", "hold"]);
  });
});

describe("NAV price from 1Click quotes", () => {
  it("posts NAV with two signed dry quotes: base → risky, then exactly that much risky → base", async () => {
    const chain = new FakeChain();
    chain.public = 40_000_000n;
    chain.cfg = { ...chain.cfg, nav_quotes: { base_id: USDC, risk_id: WNEAR, max_age_ms: 300_000, tolerance_bps: 50, max_spread_bps: 100 } };
    const seen: { path: string; body: any }[] = [];
    const op = new Operator(chain, new Confidential("https://1click.test", "", fixtureFetch({ "/v0/quote": dryQuotes }, seen), undefined, true), new FillLog("vault.testnet", null), KeyPair.fromRandom("ed25519"), "ed25519:x", { dryRun: true, chainWrites: true, slippageBps: 50, minShield: 1_000_000n, assetMap: {}, decimals: {}, signalMaxAgeMs: 300_000, pollMs: 0, pollTries: 1 }, () => NOW, async () => {});
    await op.epoch();
    const post = chain.calls.find((c) => c.m === "postNav")!;
    const quotes = post.args[5] as { message: string; signature: string }[];
    expect(quotes.length).toBe(2);
    const [b, s] = quotes.map((q) => JSON.parse(q.message));
    expect([b.originAsset, b.destinationAsset, s.originAsset, s.destinationAsset]).toEqual([USDC, WNEAR, WNEAR, USDC]);
    const priced = seen.filter((x) => x.path === "/v0/quote").slice(-2).map((x) => x.body);
    expect(priced[0].amount).toBe("10000000");
    expect(priced[1].amount).toBe(b.amountOut); // sells what the buy would get
    expect(quotes.every((q) => q.signature.startsWith("ed25519:"))).toBe(true);
  });
});

import { PERSONAS, systemPrompt } from "../src/leaders/ai.js";

describe("house AI leaders", () => {
  const s = series((i) => 3 + i * 0.001);
  const reply = (w: number) => (async () => new Response(JSON.stringify({ id: "c", choices: [{ message: { content: `{"target_weight": ${w}, "rationale": "r"}` } }] }))) as unknown as typeof fetch;
  it("each persona has its own mandate, and its bounds are enforced in code", async () => {
    expect(Object.keys(PERSONAS).sort()).toEqual(["ai", "ai-contrarian", "ai-conviction", "ai-trend", "ai-voltarget"]);
    expect(systemPrompt(PERSONAS["ai-voltarget"])).toContain("annualised volatility");
    expect((await aiLeader(s, 0.5, { apiKey: "k", fetchImpl: reply(0), persona: "ai-conviction" })).target).toBe(0.2);
    expect((await aiLeader(s, 0.5, { apiKey: "k", fetchImpl: reply(1), persona: "ai-conviction" })).target).toBe(0.8);
    expect((await aiLeader(s, 0.5, { apiKey: "k", fetchImpl: reply(0.05), persona: "ai-voltarget" })).target).toBe(0.2);
    expect((await aiLeader(s, 0.5, { apiKey: "k", fetchImpl: reply(0), persona: "ai-trend" })).target).toBe(0);
  });
});

import { sharpeLike, trackRecord, cardSvg, cardPng } from "../src/season/card.js";

describe("track-record card", () => {
  const E18 = 10n ** 18n;
  const nav = (i: number, x: number, dt = 3_600_000) => ({ epoch: i + 1, timestamp_ms: i * dt, price: (BigInt(Math.round(x * 1e6)) * 10n ** 12n).toString() });
  it("return, max drawdown and leader share come from the posts", () => {
    const t = trackRecord([nav(0, 1.1), nav(1, 0.99), nav(2, 1.05)], "100", "1000");
    expect(t.ret).toBeCloseTo(0.05);
    expect(t.maxDrawdown).toBeCloseTo(0.1);
    expect(t.leaderPct).toBe(0.1);
  });
  it("Sharpe-like waits for a day of history", () => {
    expect(sharpeLike(Array.from({ length: 10 }, (_, i) => nav(i, 1 + i / 1000)))).toBeNull();
    const day = Array.from({ length: 30 }, (_, i) => nav(i, 1 + i / 1000 + (i % 2) / 2000));
    expect(sharpeLike(day)).toBeGreaterThan(0);
    void E18;
  });
  it("renders a PNG with only public numbers", () => {
    const svg = cardSvg({ name: "X <y>", badge: "AI", style: "s", vault: "v.testnet", navs: [nav(0, 1.01)], leaderShares: "1", totalShares: "10", asOf: new Date(0) });
    expect(svg).toContain("X &lt;y&gt;");
    expect(cardPng(svg).subarray(0, 4).toString("hex")).toBe("89504e47");
  });
});
