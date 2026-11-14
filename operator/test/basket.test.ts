// Multi-asset vaults (T6): basket signals, execution through the base, per-asset price quotes.
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { FakeChain, VAULT_ACCT } from "./fakes.js";
import { Confidential } from "../src/confidential.js";
import { FillLog } from "../src/filllog.js";
import { Operator, type OperatorCfg } from "../src/operator.js";
import { BTC, USDC, WNEAR } from "../src/intents.js";
import { signSignal, verifySignal, type BasketSignal } from "../src/signal.js";
import { digestText, quoteMessage, type QuoteResponse } from "../src/carry/signedQuote.js";
import type { NavBasket } from "../src/chain.js";

const NOW = 1_794_218_400_000;
const leader = KeyPair.fromRandom("ed25519");
const att = KeyPair.fromRandom("ed25519");
const qkey = KeyPair.fromRandom("ed25519");
const DEC: Record<string, number> = { [USDC]: 6, [WNEAR]: 24, [BTC]: 8 };
const USD: Record<string, number> = { [USDC]: 1, [WNEAR]: 3, [BTC]: 60_000 };
const CFG: OperatorCfg = { dryRun: true, chainWrites: true, slippageBps: 50, minShield: 1_000_000n, assetMap: {}, decimals: DEC, signalMaxAgeMs: 300_000, pollMs: 0, pollTries: 3 };

/** 1Click-like quotes at fixed prices, 0.2% fee, signed with a test key the way 1Click signs. */
function quoteFetch(seen: any[]): typeof fetch {
  return (async (_u: RequestInfo | URL, init?: RequestInit) => {
    const b = JSON.parse(String(init!.body));
    seen.push(b);
    const inUnits = Number(b.amount) / 10 ** DEC[b.originAsset];
    const out = BigInt(Math.floor(((inUnits * USD[b.originAsset]) / USD[b.destinationAsset]) * 0.998 * 10 ** DEC[b.destinationAsset]));
    const r: QuoteResponse = { quote: { amountIn: b.amount, amountOut: out.toString(), minAmountOut: ((out * 995n) / 1000n).toString() }, quoteRequest: b, timestamp: new Date(NOW).toISOString(), signature: "" } as never;
    r.signature = "ed25519:" + base58.encode(qkey.sign(new TextEncoder().encode(digestText(quoteMessage(r)))).signature);
    return new Response(JSON.stringify(r), { status: 201 });
  }) as typeof fetch;
}

function setup(basket: NavBasket | null = null) {
  const chain = new FakeChain();
  chain.cfg = { ...chain.cfg, allowed_assets: [USDC, WNEAR, BTC] };
  chain.signalKey = leader.getPublicKey().toString();
  (chain as FakeChain & { getNavBasket: () => Promise<NavBasket | null> }).getNavBasket = async () => basket;
  const seen: any[] = [];
  const log = new FillLog("vault.testnet", null);
  const op = new Operator(chain, new Confidential("https://1click.test", "", quoteFetch(seen), qkey.getPublicKey().toString()), log, att, "ed25519:" + base58.encode(Buffer.from(VAULT_ACCT, "hex")), CFG, () => NOW, async () => {});
  return { chain, op, log, seen };
}
const bsig = (targets_bps: Record<string, number>): BasketSignal => ({ v: 1, vault: "vault.testnet", type: "basket", targets_bps, nonce: randomBytes(8).toString("hex"), created_ms: NOW });
const fills = (t: ReturnType<typeof setup>) => t.log.entries.filter((e) => e.kind === "fill").map((e) => [e.data.from, e.data.to, e.data.amount_in]);

describe("basket signals (T6)", () => {
  const want = { vault: "vault.testnet", signalKey: leader.getPublicKey().toString(), nowMs: NOW, maxAgeMs: 300_000, seenNonces: new Set<string>(), allowedAssets: [USDC, WNEAR, BTC] };
  it("verify: allowed assets only, weights sum to at most 100%", () => {
    expect(verifySignal(signSignal(bsig({ [BTC]: 3000, [WNEAR]: 2000 }), leader), want).ok).toBe(true);
    expect(verifySignal(signSignal(bsig({ "nep141:sol.omft.near": 1000 }), leader), want)).toMatchObject({ ok: false, error: "asset not allowed" });
    expect(verifySignal(signSignal(bsig({ [BTC]: 6000, [WNEAR]: 5000 }), leader), want)).toMatchObject({ ok: false });
    expect(verifySignal(signSignal(bsig({}), leader), want)).toMatchObject({ ok: false });
  });

  it("buys each asset to its weight through the base, and records the signal once", async () => {
    const t = setup();
    t.chain.public = 100_000_000n;
    await t.op.shieldPending();
    const r = await t.op.submitSignal(signSignal(bsig({ [BTC]: 3000, [WNEAR]: 2000 }), leader));
    expect(r).toMatchObject({ ok: true, status: "executed" });
    // the BTC leg is sized on the NAV after the NEAR leg's 0.2% fee
    const f = fills(t);
    expect(f.map(([from, to]) => [from, to])).toEqual([[USDC, WNEAR], [USDC, BTC]]);
    expect(f[0][2]).toBe("20000000");
    expect(Math.abs(Number(f[1][2]) - 30_000_000)).toBeLessThan(30_000);
    expect(t.chain.calls.filter((c) => c.m === "recordSignal")).toHaveLength(1);
    const h = (await t.op.nav()).holdings;
    expect(Math.round(Number(h[BTC].value) / 1e6)).toBe(30);
  });

  it("sells first (all of a dropped asset), then buys", async () => {
    const t = setup();
    t.chain.public = 100_000_000n;
    await t.op.shieldPending();
    await t.op.submitSignal(signSignal(bsig({ [BTC]: 3000, [WNEAR]: 2000 }), leader));
    await t.op.submitSignal(signSignal(bsig({ [BTC]: 1000 }), leader));
    const f = fills(t).slice(2);
    expect(f.map(([from, to]) => [from, to])).toEqual([[WNEAR, USDC], [BTC, USDC]]);
    const h = (await t.op.nav()).holdings;
    expect(h[WNEAR]?.amount ?? "0").toBe("0");
    expect(t.chain.calls.filter((c) => c.m === "recordSignal")).toHaveLength(2);
    // already there: a note, no trade, no record
    await t.op.submitSignal(signSignal(bsig({ [BTC]: Math.round((Number(h[BTC].value) * 10_000) / Number((await t.op.nav()).nav)) }), leader));
    expect(t.chain.calls.filter((c) => c.m === "recordSignal")).toHaveLength(2);
  });

  it("a NAV post carries a quote pair for every risky asset in the basket, held or not", async () => {
    const t = setup({ base_id: USDC, risk_ids: [WNEAR, BTC], max_age_ms: 300_000, tolerance_bps: 50, max_spread_bps: 100, min_interval_ms: 60_000, window_up_bps: 300 });
    t.chain.public = 100_000_000n;
    await t.op.epoch();
    const post = t.chain.calls.find((c) => c.m === "postNav")!;
    const qs = post.args[5] as { message: string }[];
    expect(qs).toHaveLength(4);
    const legs = qs.map((q) => JSON.parse(q.message)).map((m) => [m.originAsset, m.destinationAsset]);
    expect(legs).toEqual([[USDC, WNEAR], [WNEAR, USDC], [USDC, BTC], [BTC, USDC]]);
  });
});
