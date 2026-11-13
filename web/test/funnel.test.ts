import { describe, expect, it } from "vitest";
import { shouldCount } from "../lib/funnel";

describe("funnel: privacy gates (V8)", () => {
  it("counts only on the live site, never under Do Not Track or in automation", () => {
    expect(shouldCount({ host: "amityadav0.github.io", dnt: null, webdriver: false })).toBe(true);
    expect(shouldCount({ host: "amityadav0.github.io", dnt: "1", webdriver: false })).toBe(false);
    expect(shouldCount({ host: "amityadav0.github.io", dnt: null, webdriver: true })).toBe(false);
    expect(shouldCount({ host: "localhost:3000", dnt: null, webdriver: false })).toBe(false);
  });
});
