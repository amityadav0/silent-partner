import { describe, expect, it, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { KeyPair, utils } from "near-api-js";
import { base58 } from "@scure/base";
import { FakeChain, VAULT_ACCT, dryQuotes, fixture, fixtureFetch, liveQuote } from "./fakes.js";
import { Confidential } from "../src/confidential.js";
import { FillLog } from "../src/filllog.js";
import { fold } from "../src/ledger.js";
import { Operator, type OperatorCfg } from "../src/operator.js";
import { signSignal, verifySignal, type Signal } from "../src/signal.js";
import { USDC, WNEAR, nep413Prehash, imt } from "../src/intents.js";
import { toSignedQuote } from "../src/carry/signedQuote.js";

const NOW = 1_794_218_400_000;
const leader = KeyPair.fromRandom("ed25519");
const att = KeyPair.fromRandom("ed25519");
const CFG: OperatorCfg = { dryRun: true, chainWrites: true, slippageBps: 50, minShield: 1_000_000n, assetMap: {}, decimals: { [USDC]: 6, [WNEAR]: 24 }, signalMaxAgeMs: 300_000, pollMs: 0, pollTries: 3 };

const sig = (over: Partial<Signal> = {}): Signal => ({ v: 1, vault: "vault.testnet", from: USDC, to: WNEAR, size_bps: 2500, type: "market", nonce: randomBytes(8).toString("hex"), created_ms: NOW, ...over });

function setup(cfg: Partial<OperatorCfg> = {}, routes = { "/v0/quote": dryQuotes }) {
  const chain = new FakeChain();
  chain.signalKey = leader.getPublicKey().toString();
  const seen: { path: string; body: any }[] = [];
  const oc = new Confidential("https://1click.test", "jwt", fixtureFetch(routes, seen));
  const log = new FillLog("vault.testnet", null);
  const op = new Operator(chain, oc, log, att, "ed25519:" + base58.encode(Buffer.from(VAULT_ACCT, "hex")), { ...CFG, ...cfg }, () => NOW, async () => {});
  return { chain, op, log, seen };
}

describe("recorded 1Click fixtures", () => {
  it("every fixture is genuinely signed by 1Click", () => {
    for (const f of ["trade-usdc-wnear", "trade-wnear-usdc", "shield-usdc", "unshield-usdc"]) expect(() => toSignedQuote(JSON.parse(fixture(f)))).not.toThrow();
  });
});

describe("signals", () => {
  const want = (seen = new Set<string>()) => ({ vault: "vault.testnet", signalKey: leader.getPublicKey().toString(), nowMs: NOW, maxAgeMs: 300_000, seenNonces: seen, allowedAssets: [USDC, WNEAR] });
  it("verification table", () => {
    const other = KeyPair.fromRandom("ed25519");
    const good = signSignal(sig(), leader);
    const cases: [unknown, string | null][] = [
      [good, null],
      [{ ...good, signature: signSignal(sig(), other).signature }, "bad signature"],
      [signSignal(sig(), other), "not signed by the vault's signal key"],
      [{ ...good, signal: { ...good.signal, size_bps: 9999 } }, "bad signature"], // tampered after signing
      [signSignal(sig({ vault: "other.testnet" }), leader), "another vault"],
      [signSignal(sig({ to: "nep141:scam.near" }), leader), "asset not allowed"],
      [signSignal(sig({ created_ms: NOW - 400_000 }), leader), "too old"],
      [signSignal(sig({ size_bps: 0 }), leader), "malformed signal"],
      [signSignal(sig({ to: USDC }), leader), "malformed signal"],
      [signSignal(sig({ type: "limit" }), leader), "malformed signal"], // limit without price
      [{ nope: 1 }, "malformed envelope"],
    ];
    for (const [x, err] of cases) {
      const r = verifySignal(x, want());
      if (err === null) expect(r.ok).toBe(true);
      else expect(r.ok ? "ok" : r.error).toContain(err);
    }
    expect(verifySignal(good, { ...want(), signalKey: null })).toMatchObject({ ok: false });
    expect(verifySignal(good, want(new Set([good.signal.nonce])))).toMatchObject({ ok: false, error: "replayed nonce" });
  });
  it("signal hash vector shared with web/test/lib.test.ts", async () => {
    const { signalHash } = await import("../src/signal.js");
    const s = { v: 1 as const, vault: "sp-vault-60270.testnet", from: "nep141:usdc.fakes.testnet", to: "nep141:wrap.testnet", size_bps: 2500, type: "limit" as const, limit_price: "0.27", nonce: "00112233445566778899", created_ms: 1794218400000 };
    expect(signalHash(s).toString("hex")).toBe("90ef0a734e151929b54eecf4a846190932dce915b1c82b40cd5f0c20773c4483");
  });
  it("the signal hash signature verifies the way the contract checks it (ed25519 over the 32 raw bytes)", () => {
    const s = signSignal(sig(), leader);
    const r = verifySignal(s, want());
    expect(r.ok).toBe(true);
    if (r.ok) expect(leader.verify(Buffer.from(r.hash, "hex"), base58.decode(s.signature.slice(8)))).toBe(true);
  });
});

describe("fill log", () => {
  it("chains, survives reload, and detects tampering", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const p = join(mkdtempSync(join(tmpdir(), "sp-")), "fills.jsonl");
    const log = new FillLog("v", p);
    const g = log.head();
    log.append("shield", { amount: "1" }, 1);
    log.append("fill", { from: "a", to: "b", amount_in: "1", amount_out: "2" }, 2);
    expect(log.entries[0].prev).toBe(g);
    expect(log.entries[1].prev).toBe(log.entries[0].hash);
    const again = new FillLog("v", p);
    expect(again.head()).toBe(log.head());
    const tampered = log.entries.map((e) => ({ ...e }));
    tampered[0] = { ...tampered[0], data: { amount: "1000" } };
    expect(FillLog.verify(tampered, "v")).toBe(0);
    expect(FillLog.verify(log.entries, "other-vault")).toBe(0);
    const { writeFileSync, readFileSync } = await import("node:fs");
    writeFileSync(p, readFileSync(p, "utf8").replace('"amount":"1"', '"amount":"9"'));
    expect(() => new FillLog("v", p)).toThrow(/broken at seq 0/);
  });
});

describe("operator, dry mode", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    t.chain.public = 40_000_000n; // 40 USDC deposited, sitting public
  });

  it("shields public deposits once (paper), and NAV doesn't double count", async () => {
    expect(await t.op.shieldPending()).toBeTruthy();
    expect(await t.op.shieldPending()).toBeNull();
    const l = fold(t.log.entries, USDC);
    expect(l.confidential.get(USDC)).toBe(40_000_000n);
    expect((await t.op.nav()).nav).toBe(40_000_000n);
    t.chain.public = 41_500_000n; // a new 1.5 USDC deposit
    expect((await t.op.nav()).nav).toBe(41_500_000n);
  });

  it("executes one market signal for the whole vault and records it on-chain", async () => {
    await t.op.shieldPending();
    const r = await t.op.submitSignal(signSignal(sig(), leader));
    expect(r).toMatchObject({ ok: true, status: "executed" });
    const q = t.seen.filter((s) => s.path === "/v0/quote");
    // first quote is the trade (USDC base needs no valuation): 25% of 40 USDC
    expect(q[0].body).toMatchObject({ amount: "10000000", originAsset: USDC, destinationAsset: WNEAR, depositType: "CONFIDENTIAL_INTENTS", recipientType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", recipient: VAULT_ACCT, refundTo: VAULT_ACCT, dry: true, slippageTolerance: 50 });
    const fill = t.log.entries.find((e) => e.kind === "fill")!;
    const wnearOut = JSON.parse(fixture("trade-usdc-wnear")).quote.amountOut;
    expect(fill.data).toMatchObject({ from: USDC, to: WNEAR, amount_in: "10000000", amount_out: wnearOut, dry: true });
    const l = fold(t.log.entries, USDC);
    expect(l.confidential.get(USDC)).toBe(30_000_000n);
    expect(l.confidential.get(WNEAR)).toBe(BigInt(wnearOut));
    const rec = t.chain.calls.find((c) => c.m === "recordSignal")!;
    expect(rec.args[2]).toBe(fill.hash);
    expect(t.chain.calls.some((c) => c.m === "signIntent")).toBe(false); // dry: vault key never used
    // replay refused
    expect(await t.op.submitSignal(signSignal({ ...sig(), nonce: (t.log.entries.find((e) => e.kind === "signal")!.data.nonce as string) }, leader))).toMatchObject({ ok: false, error: "replayed nonce" });
  });

  it("NAV values non-base holdings with a 1Click quote into the base asset", async () => {
    await t.op.shieldPending();
    await t.op.submitSignal(signSignal(sig(), leader));
    const { nav, holdings } = await t.op.nav();
    const usdcFor = BigInt(JSON.parse(fixture("trade-wnear-usdc")).quote.amountOut);
    expect(nav).toBe(30_000_000n + usdcFor);
    expect(holdings[WNEAR].value).toBe(usdcFor.toString());
  });

  it("epoch: shields, appends a nav record, signs the contract's NAV message, posts with the log head", async () => {
    const e = await t.op.epoch();
    const post = t.chain.calls.find((c) => c.m === "postNav")!;
    const [epoch, nav, ts, head, signature] = post.args as [number, string, number, string, string];
    expect([epoch, nav, head]).toEqual([1, "40000000", t.log.head()]);
    expect(t.log.entries.at(-1)!.kind).toBe("nav");
    const msg = `silent-partner/nav/v1|vault.testnet|1|40000000|${ts}|${head}`;
    expect(utils.PublicKey.fromString(att.getPublicKey().toString()).verify(new TextEncoder().encode(msg), base58.decode(signature.slice(8)))).toBe(true);
    expect(e.tx).toBe("tx-nav");
  });

  it("NAV subtracts what open claims are still owed, and stays put when they're paid", async () => {
    await t.op.shieldPending();
    t.chain.claims = [
      { id: 0, account: "f", exit_account: "f.near", amount: "5000000", paid: "0", in_flight: [], epoch: 1, emergency: false },
      { id: 1, account: "g", exit_account: "g.near", amount: "2000000", paid: "0", in_flight: [{ prehash: "x", amount: "2000000", deadline_ms: 0, signed: true }], epoch: 1, emergency: false },
    ];
    const before = await t.op.nav();
    expect([before.gross, before.liabilities, before.nav]).toEqual([40_000_000n, 7_000_000n, 33_000_000n]);
    await t.op.payClaims(); // pays claim 0 (paper); claim 1 is in flight
    const after = await t.op.nav();
    expect([after.gross, after.liabilities, after.nav]).toEqual([35_000_000n, 2_000_000n, 33_000_000n]);
  });

  it("no chain writes when chainWrites is off", async () => {
    const u = setup({ chainWrites: false });
    u.chain.public = 40_000_000n;
    expect((await u.op.epoch()).tx).toBeNull();
    expect(u.chain.calls).toEqual([]);
  });

  it("pays open claims once (paper), skips emergency and paid claims", async () => {
    await t.op.shieldPending();
    t.chain.claims = [
      { id: 0, account: "f", exit_account: "f.near", amount: "5000000", paid: "0", in_flight: [], epoch: 1, emergency: false },
      { id: 1, account: "g", exit_account: "g.near", amount: "3000000", paid: "3000000", in_flight: [], epoch: 1, emergency: false },
      { id: 2, account: "h", exit_account: "h.near", amount: "2000000", paid: "0", in_flight: [], epoch: 1, emergency: true },
      { id: 3, account: "i", exit_account: "i.near", amount: "4000000", paid: "1000000", in_flight: [{ prehash: "x", amount: "1000000", deadline_ms: 0, signed: true }], epoch: 1, emergency: false },
    ];
    const out = await t.op.payClaims();
    expect(out.length).toBe(2);
    const pays = t.log.entries.filter((e) => e.kind === "payout").map((e) => [e.data.claim_id, e.data.amount]);
    expect(pays).toEqual([[0, "5000000"], [3, "2000000"]]);
    expect(await t.op.payClaims()).toEqual([]);
    expect(fold(t.log.entries, USDC).confidential.get(USDC)).toBe(33_000_000n);
  });

  it("limit signals wait for the price and expire", async () => {
    await t.op.shieldPending();
    const px = Number(JSON.parse(fixture("trade-usdc-wnear")).quote.amountOut) / 1e24 / 10; // wNEAR per USDC in the fixture
    expect((await t.op.submitSignal(signSignal(sig({ type: "limit", limit_price: (px * 1.01).toFixed(6) }), leader)))).toMatchObject({ status: "pending" });
    expect(await t.op.tickLimits()).toEqual([]);
    expect(t.op.limits.length).toBe(1);
    await t.op.submitSignal(signSignal(sig({ type: "limit", limit_price: (px * 0.99).toFixed(6) }), leader));
    expect((await t.op.tickLimits()).length).toBe(1);
    expect(t.op.limits.length).toBe(1);
    t.op.limits[0].signal.expires_ms = NOW - 1;
    expect(await t.op.tickLimits()).toEqual([]);
    expect(t.op.limits.length).toBe(0);
  });
});

describe("operator, live path (no funds: test-key quotes, fake 1Click)", () => {
  it("trade: non-dry quote → generate-intent → contract signs (Trade) → submit with the vault key → status → fill", async () => {
    const qKey = KeyPair.fromRandom("ed25519");
    const vaultKey = KeyPair.fromRandom("ed25519");
    const dep = randomBytes(32).toString("hex");
    const payload = { message: JSON.stringify({ deadline: new Date(NOW + 600_000).toISOString(), intents: [{ intent: "transfer", receiver_id: dep, tokens: { [imt(USDC)]: "10000000" } }], signer_id: VAULT_ACCT }), nonce: randomBytes(32).toString("base64"), recipient: "intents.far" };
    const seen: { path: string; body: any }[] = [];
    const routes = {
      "/v0/quote": (b: any) => (b.dry ? dryQuotes(b, "") : { status: 201, text: liveQuote("trade-usdc-wnear", qKey, dep) }),
      "/v0/generate-intent": () => ({ text: JSON.stringify({ intent: { standard: "nep413", payload } }) }),
      "/v0/submit-intent": () => ({ text: JSON.stringify({ intentHash: "ih1" }) }),
      "/v0/status": () => ({ text: JSON.stringify({ status: "SUCCESS", swapDetails: { amountOut: "2600000000000000000000000" } }) }),
    };
    const chain = new FakeChain();
    chain.signalKey = leader.getPublicKey().toString();
    chain.signWith = vaultKey;
    const oc = new Confidential("https://1click.test", "jwt", fixtureFetch(routes, seen), qKey.getPublicKey().toString());
    const log = new FillLog("vault.testnet", null);
    log.append("shield", { amount: "40000000", dry: false }, NOW);
    const op = new Operator(chain, oc, log, att, vaultKey.getPublicKey().toString(), { ...CFG, dryRun: false }, () => NOW, async () => {});
    const r = await op.submitSignal(signSignal(sig(), leader));
    expect(r).toMatchObject({ ok: true, status: "executed" });
    const s = chain.calls.find((c) => c.m === "signIntent")!;
    expect(s.args[0]).toBe("Trade");
    expect(s.args[1]).toEqual(payload);
    expect((s.args[2] as any).message).toContain(`"depositAddress":"${dep}"`);
    const sub = seen.find((x) => x.path === "/v0/submit-intent")!.body;
    expect(sub.signedData.public_key).toBe(vaultKey.getPublicKey().toString());
    expect(vaultKey.verify(nep413Prehash(payload), base58.decode(sub.signedData.signature.slice(8)))).toBe(true);
    const fill = log.entries.find((e) => e.kind === "fill")!;
    expect(fill.data).toMatchObject({ status: "SUCCESS", amount_out: "2600000000000000000000000", dry: false, intent_hash: "ih1", deposit_address: dep });
  });

  it("a refunded trade moves nothing in the ledger, and a refused signature stops before submit", async () => {
    const qKey = KeyPair.fromRandom("ed25519");
    const dep = randomBytes(32).toString("hex");
    const payload = { message: "{}", nonce: randomBytes(32).toString("base64"), recipient: "intents.far" };
    const seen: { path: string; body: any }[] = [];
    const routes = {
      "/v0/quote": (b: any) => (b.dry ? dryQuotes(b, "") : { status: 201, text: liveQuote("trade-usdc-wnear", qKey, dep) }),
      "/v0/generate-intent": () => ({ text: JSON.stringify({ intent: { payload } }) }),
      "/v0/submit-intent": () => ({ text: JSON.stringify({ intentHash: "ih" }) }),
      "/v0/status": () => ({ text: JSON.stringify({ status: "REFUNDED" }) }),
    };
    const chain = new FakeChain();
    chain.signalKey = leader.getPublicKey().toString();
    chain.signWith = KeyPair.fromRandom("ed25519");
    const log = new FillLog("vault.testnet", null);
    log.append("shield", { amount: "40000000", dry: false }, NOW);
    const op = new Operator(chain, new Confidential("https://1click.test", "jwt", fixtureFetch(routes, seen), qKey.getPublicKey().toString()), log, att, "ed25519:x", { ...CFG, dryRun: false }, () => NOW, async () => {});
    await op.submitSignal(signSignal(sig(), leader));
    expect(fold(log.entries, USDC).confidential.get(USDC)).toBe(40_000_000n);
    chain.signWith = undefined; // contract refuses
    await expect(op.submitSignal(signSignal(sig(), leader))).rejects.toThrow(/refused/);
    expect(seen.filter((x) => x.path === "/v0/submit-intent").length).toBe(1);
  });

  it("a quote not signed by the configured 1Click key is never used", async () => {
    const qKey = KeyPair.fromRandom("ed25519");
    const routes = { "/v0/quote": () => ({ status: 201, text: liveQuote("trade-usdc-wnear", KeyPair.fromRandom("ed25519"), "ab".repeat(32)) }) };
    const oc = new Confidential("https://1click.test", "jwt", fixtureFetch(routes), qKey.getPublicKey().toString());
    await expect(oc.quote({ leg: "trade", from: USDC, to: WNEAR, amount: "1", slippageBps: 50, vault: VAULT_ACCT, deadlineMs: NOW, dry: false })).rejects.toThrow(/does not verify/);
  });

  it("releases only expired payouts it submitted and 1Click reports as failed", async () => {
    const statuses: Record<string, string> = { dep1: "REFUNDED", dep2: "SUCCESS", dep3: "REFUNDED" };
    const routes = { "/v0/status": (_b: any, url: string) => ({ text: JSON.stringify({ status: statuses[new URL(url).searchParams.get("depositAddress")!] }) }) };
    const chain = new FakeChain();
    const log = new FillLog("vault.testnet", null);
    const op = new Operator(chain, new Confidential("https://1click.test", "jwt", fixtureFetch(routes)), log, att, "ed25519:x", { ...CFG, dryRun: false }, () => NOW, async () => {});
    const fl = (prehash: string, deadline_ms: number) => ({ prehash, amount: "1", deadline_ms, signed: true });
    const claims = [{ id: 0, account: "f", exit_account: "f.near", amount: "10", paid: "0", in_flight: [fl("p1", NOW - 1), fl("p2", NOW - 1), fl("p3", NOW + 1), fl("p4", NOW - 1)], epoch: 1, emergency: false }];
    for (const [p, d] of [["p1", "dep1"], ["p2", "dep2"], ["p3", "dep3"]]) log.append("note", { claim_id: 0, prehash: p, deposit_address: d }, NOW);
    expect(await op.releaseExpired(claims)).toBe(1); // p1 only: p2 succeeded, p3 not expired, p4 unknown
    expect(chain.calls.filter((c) => c.m === "settlePayout").map((c) => c.args)).toEqual([[0, "p1", false]]);
  });
});
