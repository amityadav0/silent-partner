import { describe, expect, it } from "vitest";
import { mergeCount, readCounter } from "../src/season/funnel.js";

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("funnel counters (C4)", () => {
  it("a failed read is unknown, not zero", async () => {
    expect(await readCounter("u", (async () => res(200, { value: 68 })) as typeof fetch)).toBe(68);
    expect(await readCounter("u", (async () => res(500, { error: "Try again later." })) as typeof fetch)).toBeNull();
    expect(await readCounter("u", (async () => { throw new Error("timeout"); }) as typeof fetch)).toBeNull();
  });
  it("retries once", async () => {
    let n = 0;
    expect(await readCounter("u", (async () => (n++ ? res(200, { value: 4 }) : res(500, {}))) as typeof fetch)).toBe(4);
  });
  it("never publishes a lower count than before", () => {
    expect(mergeCount(68, null)).toBe(68);
    expect(mergeCount(68, 0)).toBe(68);
    expect(mergeCount(68, 70)).toBe(70);
    expect(mergeCount(undefined, null)).toBe(0);
  });
});
