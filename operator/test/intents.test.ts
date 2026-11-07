import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { imt, nep413Prehash, versionedNonce, USDC } from "../src/intents.js";

describe("NEP-413", () => {
  it("matches the defuse nep413 crate test vector", () => {
    const pk = Buffer.from("e2e9cb7ac57cb46d4da1ce1d1cc2c33bdfe17407c517916b522724a8ea2c6c50", "hex");
    const sig = Buffer.from("e2ff6254871a3fec1853c167b42f0f14248c4cf7fef5452dc24d8dbdc5c4bf183ab707322b4d782d5f5a05571bae476c5f7ee41c473f3002e600865e46b75d0f", "hex");
    const h = nep413Prehash({ message: "Hello, world!", nonce: Buffer.alloc(32).toString("base64"), recipient: "intents.near" });
    expect(nacl.sign.detached.verify(h, sig, pk)).toBe(true);
    const other = nep413Prehash({ message: "Hello, world!", nonce: Buffer.alloc(32).toString("base64"), recipient: "intents.far" });
    expect(nacl.sign.detached.verify(other, sig, pk)).toBe(false);
  });
  it("versioned nonce layout", () => {
    const n = versionedNonce("252812b3", 2_000, 1_000);
    expect(n.length).toBe(32);
    expect(n.subarray(0, 9).toString("hex")).toBe("5628f6c600252812b3");
    expect(n.readBigUInt64LE(9)).toBe(2_000_000_000n);
    expect(n.readBigUInt64LE(17)).toBe(1_000_000_000n);
  });
  it("imt id", () => {
    expect(imt(USDC)).toBe("imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:" + USDC);
  });
});
