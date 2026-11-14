import { describe, expect, it } from "vitest";
import { costWords, durationWords, exitWords, feeExample, medianGapMs, perfFee, spanWords, UPDATE_EVERY_MS } from "../lib/costs";
import { badgeOf, META, metaOf } from "../lib/vaults";

const M = 60_000;
describe("what you pay (D2)", () => {
  it("fee only on gains, 20% of the gain", () => {
    expect(perfFee(1000, 0.05, 2000)).toBeCloseTo(10, 9);
    expect(perfFee(1000, -0.05, 2000)).toBe(0);
  });
  it("worked example matches the box", () => {
    expect(feeExample(2000)).toBe("$1,000 for a month at +5% → fee $10 (20% of the $50 gain). A month at a loss → fee $0.");
  });
});

describe("what happens after Follow (D3)", () => {
  it("withdrawal ≈ two update gaps, one value per network (Y5: FAQ and vault pages agree)", () => {
    const testnet = [0, 15, 30, 45, 60].map((m) => m * M);
    expect(medianGapMs(testnet)).toBe(15 * M);
    expect(medianGapMs([0, 1])).toBeNull();
    expect(UPDATE_EVERY_MS.mainnet).toBe(3 * 60 * M);
    expect(exitWords("testnet")).toBe("30 minutes");
    expect(exitWords("mainnet")).toBe("6 hours");
    expect(spanWords(M)).toBe("1 minute");
    expect(spanWords(72 * 60 * M)).toBe("3 days");
  });
  it("duration words", () => {
    expect(durationWords(20_000)).toBe("~1 min");
    expect(durationWords(100 * M)).toBe("~2 h");
    expect(durationWords(72 * 60 * M)).toBe("~3 days");
  });
});

import { isNewLeader, recordWords, tradeRateWords } from "../lib/record";
describe("track record (D4)", () => {
  const D = 86_400_000;
  const times = Array.from({ length: 382 }, (_, i) => i * 15 * M);
  it("record length and the new-leader rule", () => {
    expect(recordWords(times, 4.2 * D)).toBe("4 days · 382 price updates");
    expect(recordWords([0], 6 * 3_600_000)).toBe("6 hours · 1 price update");
    expect(isNewLeader(times, 13 * D)).toBe(true);
    expect(isNewLeader(times, 15 * D)).toBe(false);
  });
  it("trade rate", () => {
    expect(tradeRateWords(0, times, 4 * D)).toBe("no trades yet");
    expect(tradeRateWords(12, times, 4 * D)).toBe("≈ 3 trades a day");
    expect(tradeRateWords(2, times, 7 * D)).toBe("2 trades so far"); // Y4: a handful is a count, not a rate
    expect(tradeRateWords(1, times, 4 * D)).toBe("1 trade so far");
    expect(tradeRateWords(6, times, 7 * D)).toBe("≈ 6 trades a week");
  });
});

import { judge } from "../lib/health";
describe("system status (D9)", () => {
  const now = 100 * 3_600_000;
  const ok = { mainnetMs: now - 3_600_000, seasonMs: now - 5 * M, ai: "ok" as const, keeper: "ok" as const };
  it("normal", () => {
    const j = judge(ok, now);
    expect(j.level).toBe("ok");
    expect(`${j.headline} · ${j.parts.join(" · ")}`).toBe("All systems normal · last mainnet price 1 h ago · keeper ✓ · NEAR AI ✓");
  });
  it("amber and red in plain words", () => {
    expect(judge({ ...ok, mainnetMs: now - 5 * 3_600_000 }, now)).toMatchObject({ level: "warn", headline: "Running late: the mainnet price is 5 h old (it should update every 3 h)" });
    expect(judge({ ...ok, ai: "down" }, now).headline).toContain("AI leaders are holding");
    expect(judge({ ...ok, mainnetMs: now - 13 * 3_600_000 }, now).level).toBe("bad");
    expect(judge({ ...ok, seasonMs: now - 4 * 3_600_000 }, now).headline).toContain("testnet prices stopped 4 h ago");
  });
});

describe("trading cost so far (T2)", () => {
  it("reads as a share of the vault and a trade count", () => {
    expect(costWords({ trades: 37, trades_24h: 4, moved_usd: 9000, cost_pct: 0.84, cost_bps: 34.5 })).toBe("0.84% of the vault (37 trades)");
    expect(costWords({ trades: 1, trades_24h: 1, moved_usd: 5, cost_pct: 0.004, cost_bps: 34.5 })).toBe("<0.01% of the vault (1 trade)");
    expect(costWords({ trades: 0, trades_24h: 0, moved_usd: 0, cost_pct: null, cost_bps: 20 })).toBe("(0 trades)");
  });
});

describe("benchmarks and test vaults (T3, T4)", () => {
  it("two benchmark vaults, labelled BENCHMARK", () => {
    const b = Object.entries(META).filter(([, m]) => m.benchmark);
    expect(b.map(([, m]) => m.name).sort()).toEqual(["Half & Half", "Hold NEAR"]);
    for (const [, m] of b) expect(badgeOf(m)).toBe("BENCHMARK");
  });
  it("the drill and the first testnet vault are test vaults, and the testnet one no longer collides with Genesis (mainnet)", () => {
    expect(metaOf("sp-drill-92991.testnet").test).toBe(true);
    expect(metaOf("sp-vault-60270.testnet")).toMatchObject({ test: true, name: "First test vault" });
    expect(Object.values(META).filter((m) => !m.test).every((m) => !/genesis/i.test(m.name))).toBe(true);
  });
});

import { tradesDay } from "../lib/costs";
describe("trades figure (Y1/Z2)", () => {
  const c = { trades: 136, trades_24h: 20, trades_since_rule: 0, moved_usd: 1, cost_pct: 1, cost_bps: 34 };
  it("counts trades since the rule for its first 24 h, then the last 24 h", () => {
    const since = "2026-11-14T07:32:00Z", t = Date.parse(since);
    expect(tradesDay(c, since, t + 8 * 3_600_000)).toBe("0 trades since the 4-hour rule went live (07:32 UTC)");
    expect(tradesDay({ ...c, trades_since_rule: 1 }, since, t + 3_600_000)).toBe("1 trade since the 4-hour rule went live (07:32 UTC)");
    expect(tradesDay(c, since, t + 25 * 3_600_000)).toBe("20 trades in the last 24 h");
    expect(tradesDay(c, null)).toBe("20 trades in the last 24 h");
  });
});

import { aiFromDecisions, within } from "../lib/health";
describe("status line never hangs (Z4)", () => {
  it("a slow source falls back after the timeout", async () => {
    expect(await within(new Promise<number>(() => {}), 10, -1)).toBe(-1);
    expect(await within(Promise.resolve(3), 10, -1)).toBe(3);
    expect(await within(Promise.reject(new Error("x")), 10, -1)).toBe(-1);
  });
  it("AI status comes from the latest hourly decision, not the latest tick", () => {
    const d = { a: [{ ranAt: "2026-11-14T13:00:00Z", ai_status: "ok" }], b: [{ ranAt: "2026-11-14T14:00:00Z", ai_status: "error" }] };
    expect(aiFromDecisions(d)).toEqual({ ai: "down", at: Date.parse("2026-11-14T14:00:00Z") });
    expect(aiFromDecisions({ a: [{ ranAt: "2026-11-14T15:00:00Z", ai_status: "ok" }] }).ai).toBe("ok");
    expect(aiFromDecisions({}).ai).toBeNull();
  });
});

import { proofLine } from "../lib/pick";
describe("hero proof line (Z6)", () => {
  it("names the leader, its week and NEAR's", () => {
    expect(proofLine("Steady Hand", { ret: -0.03, near: -0.086, pts: 5.6 })).toBe("Steady Hand: −3.0% while NEAR fell −8.6% this week");
    expect(proofLine("Majors", { ret: 0.021, near: 0.01, pts: 1.1 })).toBe("Majors: +2.1% while NEAR rose +1.0% this week");
  });
});

import { dayKey, keysFor, pathKey } from "../lib/funnel";
describe("page counts (A2): totals per event, per day and per path, nothing else", () => {
  const t = Date.parse("2026-11-14T15:00:00Z");
  it("keys", () => {
    expect(dayKey(t)).toBe("20261114");
    expect(pathKey("/")).toBe("home");
    expect(pathKey("/create/ai/")).toBe("create-ai");
    expect(pathKey("/vault")).toBe("vault");
    expect(pathKey("/v/abc/")).toBe("other");
    expect(keysFor("view", "/leaderboard/", t)).toEqual(["view", "view-d20261114", "view-p-leaderboard"]);
    expect(keysFor("wallet_connect", undefined, t)).toEqual(["wallet_connect", "wallet_connect-d20261114"]);
  });
});

import { lastDays } from "../lib/funnel";
describe("stats (A3)", () => {
  it("sums the last n UTC days", () => {
    const now = Date.parse("2026-11-14T10:00:00Z");
    const days = { "20261114": { view: 5 }, "20261113": { view: 3 }, "20261101": { view: 100 } };
    expect(lastDays(days, "view", 1, now)).toBe(5);
    expect(lastDays(days, "view", 7, now)).toBe(8);
    expect(lastDays(undefined, "view", 7, now)).toBe(0);
  });
});

import { keeperFrom } from "../lib/health";
describe("keeper status (B6)", () => {
  const now = Date.parse("2026-11-14T17:00:00Z");
  it("falls back to the mainnet post's age when GitHub doesn't answer", () => {
    expect(keeperFrom("failed", now - 3_600_000, now)).toBe("failed");
    expect(keeperFrom(null, now - 3 * 3_600_000, now)).toBe("ok");
    expect(keeperFrom(null, now - 5 * 3_600_000, now)).toBeNull();
    expect(keeperFrom(null, null, now)).toBeNull();
  });
});
