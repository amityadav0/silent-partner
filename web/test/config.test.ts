import { describe, expect, it } from "vitest";
import { NETWORK, RPC } from "../lib/config";
describe("config", () => {
  it("defaults to testnet on fastnear", () => {
    expect(NETWORK).toBe("testnet");
    expect(RPC).toContain("fastnear");
  });
});
