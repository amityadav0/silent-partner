import { describe, expect, it } from "vitest";
import { keeperDecision } from "../src/keeper.js";

const H = 3_600_000;
describe("keeperDecision", () => {
  const now = 100 * H;
  it("posts when the last post is 3.5 h old or more", () => {
    expect(keeperDecision({ last_nav_ms: now - 4 * H, emergency: false }, now).post).toBe(true);
    expect(keeperDecision({ last_nav_ms: now - 3.5 * H, emergency: false }, now).post).toBe(true);
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
