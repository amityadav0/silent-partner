import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiDue, benchmarkTarget, blocked, lastTradeMs, TURNOVER } from "../src/season/turnover.js";
import { costSummary, FEE_BPS, pooledBps, priceAt, publish } from "../src/season/costs.js";
import type { Entry } from "../src/filllog.js";

const H = 3_600_000, NOW = Date.UTC(2026, 10, 14, 12);
const USDC = "nep141:usdc.fakes.testnet", WNEAR = "nep141:wrap.testnet";

describe("turnover rule (T1)", () => {
  it("needs a 20-point move", () => {
    expect(blocked({ current: 0.5, target: 0.69, lastTradeMs: null, nowMs: NOW, ret6h: 0 })).toMatch(/within 20 pts/);
    expect(blocked({ current: 0.5, target: 0.7, lastTradeMs: null, nowMs: NOW, ret6h: 0 })).toBeNull();
    expect(blocked({ current: 0.5, target: 0.3, lastTradeMs: null, nowMs: NOW, ret6h: 0 })).toBeNull();
  });
  it("waits 4 h after the last trade", () => {
    expect(blocked({ current: 0, target: 1, lastTradeMs: NOW - 3.9 * H, nowMs: NOW, ret6h: 0 })).toMatch(/under 4 h/);
    expect(blocked({ current: 0, target: 1, lastTradeMs: NOW - 4 * H, nowMs: NOW, ret6h: 0 })).toBeNull();
  });
  it("lets a de-risking cut through after a 5% drop, but not a buy", () => {
    expect(blocked({ current: 0.8, target: 0.2, lastTradeMs: NOW - H, nowMs: NOW, ret6h: -0.05 })).toBeNull();
    expect(blocked({ current: 0.8, target: 0.2, lastTradeMs: NOW - H, nowMs: NOW, ret6h: -0.049 })).toMatch(/under 4 h/);
    expect(blocked({ current: 0.2, target: 0.8, lastTradeMs: NOW - H, nowMs: NOW, ret6h: -0.08 })).toMatch(/under 4 h/);
    // the 20-point rule still holds for the exempt cut
    expect(blocked({ current: 0.8, target: 0.7, lastTradeMs: NOW - H, nowMs: NOW, ret6h: -0.1 })).toMatch(/within/);
  });
  it("at most one trade per 4 h over a day of 15-minute ticks that flip every time", () => {
    let last: number | null = null, w = 0, trades = 0;
    for (let t = 0; t < 96; t++) {
      const now = NOW + t * 15 * 60_000, target = t % 2 ? 0 : 1;
      if (!blocked({ current: w, target, lastTradeMs: last, nowMs: now, ret6h: 0 })) {
        w = target;
        last = now;
        trades++;
      }
    }
    expect(trades).toBe(6);
  });
  it("last trade comes from the fill log, refunds excluded", () => {
    const e = (ts: number, kind: Entry["kind"], amount_in = "1") => ({ seq: 0, prev: "", ts, kind, data: { amount_in }, hash: "" }) as Entry;
    expect(lastTradeMs([])).toBeNull();
    expect(lastTradeMs([e(1, "fill"), e(2, "nav"), e(3, "fill", "0"), e(4, "nav")])).toBe(1);
  });
  it("asks the AI hourly; an outage doesn't reset the clock", () => {
    const d = mkdtempSync(join(tmpdir(), "notes-"));
    const f = join(d, "n.jsonl");
    expect(aiDue(f, NOW)).toBe(true);
    writeFileSync(f, JSON.stringify({ ts: NOW - 30 * 60_000, why: "model target 0.4", usage: { prompt_tokens: 1 } }) + "\n");
    expect(aiDue(f, NOW)).toBe(false);
    expect(aiDue(f, NOW + 30 * 60_000)).toBe(true);
    writeFileSync(f, JSON.stringify({ ts: NOW - 2 * H, why: "model holds", usage: {} }) + "\n" + JSON.stringify({ ts: NOW - 5 * 60_000, why: "NEAR AI 503: holding" }) + "\n");
    expect(aiDue(f, NOW)).toBe(true);
    expect(TURNOVER.aiEveryMs).toBe(H);
  });
});

describe("benchmarks (T3)", () => {
  it("Hold NEAR invests cash and never sells", () => {
    expect(benchmarkTarget("hold", 0, null, NOW).target).toBe(1);
    expect(benchmarkTarget("hold", 0.9, NOW - H, NOW).target).toBe(1);
    expect(benchmarkTarget("hold", 0.96, NOW - H, NOW).target).toBeNull();
    expect(benchmarkTarget("hold", 1, NOW - H, NOW).target).toBeNull();
  });
  it("Half & Half rebalances weekly", () => {
    expect(benchmarkTarget("half", 0, null, NOW).target).toBe(0.5);
    expect(benchmarkTarget("half", 0.6, NOW - 6 * 24 * H, NOW).target).toBeNull();
    expect(benchmarkTarget("half", 0.6, NOW - 7 * 24 * H, NOW).target).toBe(0.5);
    expect(benchmarkTarget("half", 0.51, NOW - 8 * 24 * H, NOW).target).toBeNull();
  });
});

describe("trading cost (T2)", () => {
  const near = { t: [0, 10, 20], p: [2, 4, 4] };
  it("interpolates the mid", () => {
    expect(priceAt(near, 5)).toBe(3);
    expect(priceAt(near, -1)).toBe(2);
    expect(priceAt(near, 99)).toBe(4);
    expect(priceAt({ t: [], p: [] }, 1)).toBeNull();
  });
  const fill = (ts: number, from: string, amount_in: string, amount_out: string) => ({ seq: 0, prev: "", ts, kind: "fill", data: { from, to: from === USDC ? WNEAR : USDC, amount_in, amount_out }, hash: "" }) as Entry;
  it("buy and sell against the mid", () => {
    // buy $100 → 24.75 NEAR at $4 = $99 (1% cost); sell 25 NEAR ($100) → $99.5
    const entries = [fill(10, USDC, "100000000", (24.75e24).toString()), fill(20, WNEAR, (25e24).toString(), "99500000"), fill(20, USDC, "0", "0")];
    const c = costSummary(entries, { base: USDC, risk: WNEAR, near, navUsd: 1000, now: 20 });
    expect(c.trades).toBe(2);
    expect(c.trades_24h).toBe(2);
    expect(c.moved_usd).toBe(200);
    expect(c.cost_usd).toBe(1.5);
    expect(c.avg_cost_bps).toBe(75);
    const p = publish(c, pooledBps([c]), 1000);
    expect(p).toEqual({ trades: 2, trades_24h: 2, moved_usd: 200, cost_pct: 0.15, cost_bps: 75 });
  });
  it("the pooled rate never goes below the 1Click fee", () => {
    const c = { trades: 1, trades_24h: 0, moved_usd: 100, cost_usd: -1, avg_cost_bps: -100, cost_pct: null };
    expect(pooledBps([c])).toBe(FEE_BPS);
    expect(pooledBps([])).toBe(FEE_BPS);
  });
});

import { majors, MAJORS } from "../src/leaders/majors.js";
import { blockedBasket } from "../src/season/turnover.js";

describe("Majors bot and the basket turnover rule (T6)", () => {
  it("holds what's up >1% over 24 h, equal weights, 40% each and 80% in all at most", () => {
    expect(majors({ bitcoin: 2, ethereum: 0.5, solana: -3, near: 1.5 }).targets).toEqual({ [MAJORS.bitcoin]: 0.4, [MAJORS.ethereum]: 0, [MAJORS.solana]: 0, [MAJORS.near]: 0.4 });
    expect(majors({ bitcoin: 2, ethereum: 2, solana: 2, near: 2 }).targets![MAJORS.solana]).toBe(0.2);
    expect(majors({ bitcoin: 5, ethereum: 0, solana: 0, near: 0 }).targets![MAJORS.bitcoin]).toBe(0.4);
    expect(Object.values(majors({ bitcoin: -1, ethereum: -1, solana: -1, near: -1 }).targets!).every((w) => w === 0)).toBe(true);
    expect(majors({ bitcoin: 2 }).targets).toBeNull();
  });
  it("basket trades need Σ|Δ| ≥ 20 pts and 4 h", () => {
    const cur = { a: 0.4, b: 0.4 };
    expect(blockedBasket({ current: cur, targets: { a: 0.3, b: 0.4 }, lastTradeMs: null, nowMs: NOW })).toMatch(/within 20/);
    expect(blockedBasket({ current: cur, targets: { a: 0.3, b: 0.3 }, lastTradeMs: null, nowMs: NOW })).toBeNull();
    expect(blockedBasket({ current: cur, targets: { c: 0.2 }, lastTradeMs: NOW - H, nowMs: NOW })).toMatch(/4 h/);
    expect(blockedBasket({ current: cur, targets: { c: 0.2 }, lastTradeMs: NOW - 4 * H, nowMs: NOW })).toBeNull();
  });
});

import { viewCall } from "../src/intents.js";

describe("view calls survive RPC rate limits", () => {
  it("retries, then falls back to another endpoint", async () => {
    const hits: string[] = [];
    const ok = { jsonrpc: "2.0", result: { result: [...Buffer.from(JSON.stringify("7"))] } };
    const f = (async (u: RequestInfo | URL) => {
      hits.push(String(u));
      return hits.length < 3 ? new Response('{"error":"Rate limits exceeded"}', { status: 200 }) : new Response(JSON.stringify(ok));
    }) as typeof fetch;
    expect(await viewCall<string>("https://rpc.testnet.fastnear.com", "a.testnet", "m", {}, f, "optimistic", 0)).toBe("7");
    expect(hits).toEqual(["https://rpc.testnet.fastnear.com", "https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"]);
  });
  it("a contract error is not retried", async () => {
    let n = 0;
    const f = (async () => (n++, new Response(JSON.stringify({ result: { error: "MethodNotFound" } })))) as unknown as typeof fetch;
    await expect(viewCall("https://rpc.testnet.fastnear.com", "a.testnet", "m", {}, f, "final", 0)).rejects.toThrow(/MethodNotFound/);
    expect(n).toBe(1);
  });
});
