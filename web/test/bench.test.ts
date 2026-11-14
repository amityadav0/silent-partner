import { describe, expect, it } from "vitest";
import { copyVsNear, nearAt, ptsWords, ratio2, vsNear, type NearSeries } from "../lib/bench";
import { pickLeader } from "../lib/pick";
import { agoWords, nextUpdateWords, shareText } from "../lib/copy";

const H = 3_600_000;
const px = (x: number) => (BigInt(Math.round(x * 1e6)) * 10n ** 12n).toString();
const nav = (t: number, price: number) => ({ timestamp_ms: t, price: px(price) });
// NEAR falls 10% over 10 hours: 5.0 → 4.5
const near: NearSeries = { t: Array.from({ length: 11 }, (_, i) => i * H), p: Array.from({ length: 11 }, (_, i) => 5 - 0.05 * i) };

describe("vs holding NEAR (U9)", () => {
  it("interpolates and refuses times outside the series", () => {
    expect(nearAt(near, 0.5 * H)).toBeCloseTo(4.975, 6);
    expect(nearAt(near, 11 * H)).toBeCloseTo(4.5, 6); // within 3 h of the end: clamp
    expect(nearAt(near, 20 * H)).toBeNull();
  });
  it("a small loss while NEAR fell 10% is +9.5 pts, measured at the same posts", () => {
    const v = vsNear([nav(0, 1), nav(5 * H, 0.99), nav(10 * H, 0.995)], near)!;
    expect(v.ret).toBeCloseTo(-0.005, 6);
    expect(v.near).toBeCloseTo(-0.1, 6);
    expect(v.pts).toBeCloseTo(9.5, 4);
    expect(ptsWords(v.pts)).toBe("+9.50 pts vs NEAR");
  });
  it("a window starts at the post just before it", () => {
    const v = vsNear([nav(0, 1), nav(5 * H, 1.1), nav(10 * H, 1.1)], near, 6 * H)!;
    expect(v.ret).toBeCloseTo(0, 6);
    expect(v.near).toBeCloseTo(4.5 / 4.75 - 1, 6);
  });
  it("no series, no number", () => {
    expect(vsNear([nav(0, 1)], null)).toBeNull();
    expect(copyVsNear(1, 0, 1.01, 2 * H, null)).toBeNull();
  });
  it("formats without negative zero", () => {
    expect(ptsWords(-0.001)).toBe("±0.00 pts vs NEAR");
    expect(ptsWords(-1.234)).toBe("−1.23 pts vs NEAR");
    expect(ratio2(-0.001)).toBe("0.00");
    expect(ratio2(-0.04)).toBe("−0.04");
    expect(ratio2(3.14159)).toBe("3.14");
  });
});

describe("hero pick (U11, B1)", () => {
  // a real record: 201 posts over 100 h (≥ 3 days and ≥ 200 posts)
  const navs = (end: number) => Array.from({ length: 201 }, (_, i) => nav(i * 0.5 * H, i === 200 ? end : 1));
  const near: NearSeries = { t: Array.from({ length: 101 }, (_, i) => i * H), p: Array.from({ length: 101 }, (_, i) => 5 - 0.005 * i) };
  it("a vault without 3 days and 200 posts is never the pick", () => {
    const young = Array.from({ length: 20 }, (_, i) => nav(90 * H + i * 0.5 * H, i === 19 ? 1.5 : 1));
    expect(pickLeader([{ id: "a.testnet", navs: navs(0.99), verified: 201, season: true }, { id: "majors.testnet", navs: young, verified: 20, season: true }], near, 100 * H).id).toBe("a.testnet");
  });
  it("best vs NEAR over 7 days among season leaders with ≥12 verified updates", () => {
    const p = pickLeader(
      [
        { id: "a.testnet", navs: navs(0.99), verified: 40, season: true },
        { id: "b.testnet", navs: navs(1.02), verified: 40, season: true },
        { id: "c.testnet", navs: navs(1.5), verified: 5, season: true }, // too new
        { id: "d.testnet", navs: navs(1.5), verified: 40, season: false }, // not in the season
        { id: "half.testnet", navs: navs(1.4), verified: 40, season: true, benchmark: true }, // benchmarks are never the pick (T3)
      ],
      near,
      100 * H,
    );
    expect(p.id).toBe("b.testnet");
  });
  it("falls back to Contrarian", () => {
    expect(pickLeader([{ id: "a.testnet", navs: navs(1), verified: 40, season: true }], null).id).toBe("sp-contra-8952.testnet");
    expect(pickLeader([], near).id).toBe("sp-contra-8952.testnet");
  });
});

describe("share text (U3, U9)", () => {
  const base = { name: "Contrarian", copyPct: 0, sinceMs: 60_000, record: { ret: 0.0128, dd: 0.038 } };
  it("under 3 updates: the leader's verified record", () => {
    expect(shareText({ ...base, updates: 0 })).toBe("just started silently copying Contrarian on @NEARProtocol. verified record: +1.28%, worst dip −3.8%. i can't see their trades. neither can bots.");
    expect(shareText({ ...base, updates: 2, recordVsNear: 4.1 })).toContain("verified record: +1.28% (+4.10 pts vs NEAR), worst dip −3.8%.");
    expect(shareText({ ...base, updates: 2, recordVsNear: -1 })).not.toContain("NEAR)");
  });
  it("from 3 updates: the copy's change, and beating NEAR only when true", () => {
    const t = shareText({ ...base, updates: 3, copyPct: 0.0042, sinceMs: 3 * H, copyVsNear: 2.5 });
    expect(t).toBe("silently copying Contrarian on @NEARProtocol: +0.42% in 3 hours, beating NEAR by 2.50 pts. i can't see their trades. neither can bots.");
    expect(shareText({ ...base, updates: 5, copyPct: -0.01, sinceMs: 3 * H, copyVsNear: -0.5 })).not.toContain("beating");
  });
});

describe("copy card timing (U2)", () => {
  it("next update from the median cadence", () => {
    const ts = [0, 15, 30, 45, 60].map((m) => m * 60_000);
    expect(nextUpdateWords(ts, 63 * 60_000)).toBe("in ~12 min");
    expect(nextUpdateWords(ts, 80 * 60_000)).toBe("any minute now");
    expect(nextUpdateWords(ts.slice(0, 2))).toBeNull();
  });
  it("ago words", () => {
    expect(agoWords(20_000)).toBe("just now");
    expect(agoWords(3 * 60_000)).toBe("3 min ago");
    expect(agoWords(5 * H)).toBe("5 h ago");
  });
});
