import { describe, expect, it } from "vitest";
import { durationWords, feeExample, medianGapMs, perfFee, withdrawEta } from "../lib/costs";

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
  it("withdrawal ≈ two update gaps, from the vault's own cadence", () => {
    const testnet = [0, 15, 30, 45, 60].map((m) => m * M);
    expect(medianGapMs(testnet)).toBe(15 * M);
    expect(withdrawEta(testnet)).toBe("~30 min");
    const mainnet = [0, 3, 6, 9].map((h) => h * 60 * M);
    expect(withdrawEta(mainnet)).toBe("~6 h");
    expect(withdrawEta([0, 1])).toBeNull();
  });
  it("duration words", () => {
    expect(durationWords(20_000)).toBe("~1 min");
    expect(durationWords(100 * M)).toBe("~2 h");
    expect(durationWords(72 * 60 * M)).toBe("~3 days");
  });
});
