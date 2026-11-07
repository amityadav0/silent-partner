import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KeyPair } from "near-api-js";
import { quoteHash } from "@defuse-protocol/one-click-sdk-typescript";
import { digestText, toSignedQuote, type QuoteResponse } from "../src/carry/signedQuote.js";
import { canonicalJson } from "../src/carry/receipt.js";
import { app } from "../src/index.js";

const REAL: QuoteResponse = JSON.parse(readFileSync(new URL("./fixtures/oneclick-dry-quote.raw.json", import.meta.url), "utf8"));

describe("carried 1Click quote-signature verification", () => {
  it("a recorded real 1Click quote verifies and matches the SDK hash", () => {
    const sq = toSignedQuote(REAL);
    expect(digestText(sq.message)).toBe(quoteHash(REAL as never));
  });
  it("a tampered quote is refused", () => {
    expect(() => toSignedQuote({ ...REAL, quote: { ...REAL.quote, minAmountOut: "1" } })).toThrow(/does not verify/);
  });
});

describe("canonical json", () => {
  it("sorts keys and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: "x" }] })).toBe('{"a":[2,{"c":"x"}],"b":1}');
  });
  it("ed25519 sign/verify over a canonical hash round-trips", () => {
    const kp = KeyPair.fromRandom("ed25519");
    const msg = Buffer.from(canonicalJson({ nav: "1" }));
    expect(kp.verify(msg, kp.sign(msg).signature)).toBe(true);
  });
});

describe("operator http", () => {
  it("health reports dry-run by default", async () => {
    const r = await app.request("/health");
    expect(await r.json()).toMatchObject({ ok: true, dryRun: true });
  });
});
