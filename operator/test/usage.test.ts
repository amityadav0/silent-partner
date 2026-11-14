import { describe, expect, it } from "vitest";
import { isOwn, summarize, type Own, type VaultUsage } from "../src/season/usage.js";

const own: Own = { accounts: new Set(["sp-owl-0749.testnet"]), patterns: [/(^|\.)sp-[a-z0-9-]+-(92991|60270|8952|61557)\.testnet$/] };
describe("usage (A1)", () => {
  it("project accounts are excluded by list or pattern", () => {
    expect(isOwn(own, "sp-follower-60270.testnet")).toBe(true);
    expect(isOwn(own, "lhold.sp-sop-92991.testnet")).toBe(true);
    expect(isOwn(own, "sp-owl-0749.testnet")).toBe(true);
    expect(isOwn(own, "alice.testnet")).toBe(false);
  });
  it("the summary is counts only", () => {
    const v = (vault: string, net: "testnet" | "mainnet", depositors: string[], extra: Partial<VaultUsage> = {}): VaultUsage => ({ vault, net, depositors, holders: depositors, withdrawRequests: [], stopLosses: [], allHolders: depositors.length + 2, ...extra });
    const s = summarize([v("a.testnet", "testnet", ["x.testnet", "y.testnet"]), v("b.testnet", "testnet", ["x.testnet"], { stopLosses: ["z.testnet"] }), v("m", "mainnet", [])],
      [{ id: 0, leader: "sp-owl-0749.testnet", name: "Calm Owl", created_ms: "0", status: "live", vault: "c0" }, { id: 1, leader: "w.testnet", name: "W", created_ms: "1794600000000", status: "live", vault: "c1" }], own);
    expect(s.testnet.outside_depositors).toBe(2);
    expect(s.testnet.outside_accounts_active).toBe(4);
    expect(s.testnet.outside_launches).toEqual([{ id: 1, name: "W", status: "live", launched: "2026-11-13" }]);
    expect(s.mainnet).toMatchObject({ holders: 2, outside_holders: 0 });
    expect(JSON.stringify(s)).not.toMatch(/x\.testnet|w\.testnet/);
  });
});
