import { describe, expect, it } from "vitest";
import { needsTopup, TOPUP } from "../src/season/topup.js";

describe("community vault auto top-up", () => {
  it("refills an account with under 3 days of spend while the operator can afford it", () => {
    expect(needsTopup(0, 0.29, 6.5)).toBe(true);
    expect(needsTopup(0.8, 0.29, 6.5)).toBe(true);
    expect(needsTopup(1, 0.29, 6.5)).toBe(false);
  });
  it("never takes the operator below its floor", () => {
    expect(needsTopup(0, 0.29, TOPUP.operatorFloor + TOPUP.amount - 0.01)).toBe(false);
    expect(needsTopup(0, 0.29, TOPUP.operatorFloor + TOPUP.amount)).toBe(true);
  });
});
