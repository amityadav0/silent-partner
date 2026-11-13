import { describe, expect, it } from "vitest";
import { keeperDecision } from "../src/keeper.js";

const H = 3_600_000;
describe("keeperDecision", () => {
  const now = 100 * H;
  it("posts when the last post is 2.5 h old or more", () => {
    expect(keeperDecision({ last_nav_ms: now - 4 * H, emergency: false }, now).post).toBe(true);
    expect(keeperDecision({ last_nav_ms: now - 2.5 * H, emergency: false }, now).post).toBe(true);
  });
  it("waits when not due, and never inside the contract's 1 h minimum even with an override", () => {
    expect(keeperDecision({ last_nav_ms: now - 2 * H, emergency: false }, now).post).toBe(false);
    expect(keeperDecision({ last_nav_ms: now - 0.5 * H, emergency: false }, now, 0).post).toBe(false);
    expect(keeperDecision({ last_nav_ms: now - 1.5 * H, emergency: false }, now, 0).post).toBe(true);
  });
  it("never posts in emergency", () => {
    expect(keeperDecision({ last_nav_ms: now - 30 * H, emergency: true }, now)).toMatchObject({ post: false });
  });
});

import { staleLogReason } from "../src/keeper.js";
describe("staleLogReason (K3)", () => {
  const e = (hash: string, kind = "nav", data: Record<string, unknown> = {}) => ({ hash, kind, data });
  const log = [e("a", "shield"), e("b"), e("c", "fill"), e("d", "payout", { amount: "1994980", status: "paid", dry: false }), e("f")];
  it("passes a current log, even when the log is ahead of the last post", () => {
    expect(staleLogReason(log, { lastHead: "d", fillHashes: ["c"], paidTotal: 1994980n })).toBeNull();
    expect(staleLogReason(log, { lastHead: "f", fillHashes: ["c"], paidTotal: 1994980n })).toBeNull();
  });
  it("fails after a manual epoch, trade or payout the keeper hasn't seen", () => {
    expect(staleLogReason(log, { lastHead: "g", fillHashes: ["c"], paidTotal: 1994980n })).toMatch(/last accepted post/);
    expect(staleLogReason(log, { lastHead: "f", fillHashes: ["c", "x"], paidTotal: 1994980n })).toMatch(/trade fill/);
    expect(staleLogReason(log, { lastHead: "f", fillHashes: ["c"], paidTotal: 2994980n })).toMatch(/payouts/);
  });
});
