import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { bytesToHex } from "@noble/hashes/utils";
import { aumBucket, maxDrawdown, navMessage, returns, toUnits, verifyNavs, type NavPost } from "../lib/vault";
import { newSignalKey, signSignal, signalHash, type Signal } from "../lib/signal";

const P = (x: number) => (BigInt(Math.round(x * 1e6)) * 10n ** 12n).toString();
const nav = (epoch: number, price: number, over: Partial<NavPost> = {}): NavPost => ({ epoch, nav: "1000000", timestamp_ms: 1_794_218_400_000 + epoch, block_ms: 0, price: P(price), total_shares: "1", fee_shares: "0", withdrawn: "0", fills_head: "ab".repeat(32), signature: "", ...over });

describe("metrics", () => {
  it("returns from post-fee price", () => {
    expect(returns([nav(1, 1.1), nav(2, 0.95)]).map((x) => +x.r.toFixed(6))).toEqual([0.1, -0.05]);
  });
  it("max drawdown table", () => {
    const cases: [number[], number][] = [[[], 0], [[1.1, 1.2], 0], [[1.2, 0.9, 1.3, 1.17], 0.25], [[0.8], 0.2]];
    for (const [ps, want] of cases) expect(+maxDrawdown(ps.map((p, i) => nav(i + 1, p))).toFixed(6)).toBe(want);
  });
  it("aum buckets", () => {
    const cases: [string, string][] = [["999000000", "< $1k"], ["1000000000", "$1k–10k"], ["55000000000", "$10k–100k"], ["2000000000000", "> $1M"]];
    for (const [u, want] of cases) expect(aumBucket(u, 6)).toBe(want);
  });
  it("exact unit parsing", () => {
    expect(toUnits("1.5", 6)).toBe(1_500_000n);
    expect(toUnits("0.000001", 6)).toBe(1n);
    expect(toUnits("0.0000001", 6)).toBeNull();
    expect(toUnits("1e6", 6)).toBeNull();
    expect(toUnits("12", 24)).toBe(12n * 10n ** 24n);
  });
});

describe("attestations", () => {
  it("verifies NAV signatures against the contract's message format, flags forgeries", () => {
    const sk = ed25519.utils.randomPrivateKey();
    const key = "ed25519:" + base58.encode(ed25519.getPublicKey(sk));
    const sign = (n: NavPost) => ({ ...n, signature: "ed25519:" + base58.encode(ed25519.sign(new TextEncoder().encode(navMessage("v.testnet", n)), sk)) });
    const good = [sign(nav(1, 1)), sign(nav(2, 1.1))];
    expect(verifyNavs("v.testnet", key, good)).toEqual({ ok: 2, bad: [] });
    const forged = [good[0], { ...good[1], nav: "9999999" }];
    expect(verifyNavs("v.testnet", key, forged)).toEqual({ ok: 1, bad: [2] });
    expect(verifyNavs("other.testnet", key, good).bad).toEqual([1, 2]);
  });
  it("message format is the contract's", () => {
    expect(navMessage("v", { epoch: 3, nav: "5", timestamp_ms: 7, fills_head: "ff" })).toBe("silent-partner/nav/v1|v|3|5|7|ff");
  });
});

describe("signals", () => {
  const s: Signal = { v: 1, vault: "sp-vault-60270.testnet", from: "nep141:usdc.fakes.testnet", to: "nep141:wrap.testnet", size_bps: 2500, type: "limit", limit_price: "0.27", nonce: "00112233445566778899", created_ms: 1794218400000 };
  it("hash matches the operator's (vector from operator/src/signal.ts)", () => {
    expect(bytesToHex(signalHash(s))).toBe("90ef0a734e151929b54eecf4a846190932dce915b1c82b40cd5f0c20773c4483");
  });
  it("signature is ed25519 over the 32 raw hash bytes", () => {
    const k = newSignalKey();
    const env = signSignal(s, k.secret);
    expect(env.public_key).toBe(k.publicKey);
    expect(ed25519.verify(base58.decode(env.signature.slice(8)), signalHash(s), base58.decode(k.publicKey.slice(8)))).toBe(true);
  });
});

import { emergencyExitValue, openOfClaim, publicPayoutPayload, signatureFromLogs } from "../lib/vault";

describe("emergency helpers", () => {
  it("exit value rounds down like the contract", () => {
    expect(emergencyExitValue(80_000_000n, "100000000", "100000000")).toBe(80_000_000n);
    expect(emergencyExitValue(1n, "10", "3")).toBe(3n);
    expect(emergencyExitValue(5n, "10", "0")).toBe(0n);
  });
  it("public payout payload has exactly the shape the contract parses", () => {
    const p = publicPayoutPayload("ab".repeat(32), "alice.testnet", "nep141:usdc.fakes.testnet", "80000000", "sp-intents-61557.testnet", Date.UTC(2026, 10, 9), new Uint8Array(32));
    const m = JSON.parse(p.message);
    expect(Object.keys(m)).toEqual(["deadline", "intents", "signer_id"]);
    expect(m.intents).toEqual([{ intent: "transfer", receiver_id: "alice.testnet", tokens: { "nep141:usdc.fakes.testnet": "80000000" } }]);
    expect(m.deadline).toBe("2026-11-09T00:20:00.000Z");
    expect(atob(p.nonce).length).toBe(32);
    expect(p.recipient).toBe("sp-intents-61557.testnet");
  });
  it("finds the vault signature in on_signed logs", () => {
    const sig = "ed25519:3BSe9g3iXHTpR6AAt3dTYWVkqcLk8ShRUyfSUjkouYTmryStVdnr2MFL7eHCgHpaCMm6tT8mjkzU6GifYMqHVnX6";
    expect(signatureFromLogs(["silent-partner.claim id=0", `silent-partner.signed prehash=${"0f".repeat(32)} signature=${sig}`])).toBe(sig);
    expect(signatureFromLogs([`silent-partner.sign_failed prehash=${"0f".repeat(32)}`])).toBeNull();
  });
  it("open amount subtracts paid and in-flight", () => {
    expect(openOfClaim({ id: 0, account: "a", exit_account: "a", amount: "100", paid: "30", in_flight: [{ prehash: "", amount: "20", deadline_ms: 0, signed: true }], epoch: 1, emergency: true })).toBe(50n);
  });
});

import { checkDisclosure, entryHash, genesis, holdings, signalHashHex, type Disclosure, type Entry } from "../lib/disclosure";

describe("disclosure checks", () => {
  const V = "v.testnet", USDC = "nep141:usdc", NEAR = "nep141:wnear";
  const sig: Signal = { v: 1, vault: V, from: USDC, to: NEAR, size_bps: 5000, type: "market", nonce: "00112233445566778899", created_ms: 1 };
  const sh = signalHashHex(sig);
  function log(): Entry[] {
    const es: Entry[] = [];
    const add = (kind: string, data: Record<string, unknown>) => {
      const b = { seq: es.length, prev: es.at(-1)?.hash ?? genesis(V), ts: es.length, kind, data };
      es.push({ ...b, hash: entryHash(b) });
    };
    add("shield", { amount: "100", dry: true });
    add("signal", { hash: sh, nonce: sig.nonce, type: "market" });
    add("fill", { signal: sh, from: USDC, to: NEAR, amount_in: "50", amount_out: "7" });
    add("nav", { epoch: 1, nav: "99", timestamp_ms: 5 });
    return es;
  }
  const navs = (es: Entry[], nav = "99") => [{ epoch: 1, nav, timestamp_ms: 5, block_ms: 0, price: "0", total_shares: "0", fee_shares: "0", withdrawn: "0", fills_head: es[3].hash, signature: "" }];
  const signals = (es: Entry[]) => [{ index: 0, hash: sh, fill_hash: es[2].hash, executed_ms: 3, epoch: 0 }];
  const D = (es: Entry[], s = [{ hash: sh, signal: sig }]): Disclosure => ({ vault: V, upto_epoch: 1, published_at: "", entries: es, signals: s });

  it("an honest disclosure matches every commitment", () => {
    const es = log();
    const c = checkDisclosure(D(es), navs(es), signals(es));
    expect(c.length).toBe(3);
    expect(c.every((x) => x.ok)).toBe(true);
    expect(holdings(es, USDC)).toEqual(new Map([[USDC, 50n], [NEAR, 7n]]));
  });
  it("a rewritten entry, a different NAV, or a forged signal are caught", () => {
    const es = log();
    const tampered = es.map((e) => (e.seq === 2 ? { ...e, data: { ...e.data, amount_out: "70" } } : e));
    expect(checkDisclosure(D(tampered), navs(es), signals(es))[0].ok).toBe(false);
    expect(checkDisclosure(D(es), navs(es, "100"), signals(es))[1].ok).toBe(false);
    const forged = { ...sig, size_bps: 9000 };
    expect(checkDisclosure(D(es, [{ hash: sh, signal: forged }]), navs(es), signals(es))[2].ok).toBe(false);
  });
});

import { claimState, pnl } from "../lib/vault";

describe("position", () => {
  const E18 = 10n ** 18n;
  it("P&L = value at book price + withdrawn − deposited", () => {
    expect(pnl({ shares: "4000000", locked: "0", deposited: "8000000", claimed: "4400000" }, (11n * E18 / 10n).toString())).toEqual({ value: 4_400_000n, abs: 800_000n, pct: 0.1 });
    expect(pnl({ shares: "1000000", locked: "0", deposited: "1000000", claimed: "0" }, (9n * E18 / 10n).toString()).abs).toBe(-100_000n);
    expect(pnl({ shares: "0", locked: "0", deposited: "0", claimed: "0" }, E18.toString()).pct).toBeNull();
  });
  it("claim states", () => {
    const c = { id: 0, account: "a", exit_account: "a", amount: "100", paid: "0", in_flight: [] as { prehash: string; amount: string; deadline_ms: number; signed: boolean }[], epoch: 1, emergency: false };
    expect(claimState(c)).toBe("burned");
    expect(claimState({ ...c, in_flight: [{ prehash: "", amount: "100", deadline_ms: 0, signed: true }] })).toBe("paying");
    expect(claimState({ ...c, paid: "40" })).toBe("paying");
    expect(claimState({ ...c, paid: "100" })).toBe("paid");
  });
});

import { buildInit, commands, type Form } from "../lib/create";

describe("create-vault wizard", () => {
  const f: Form = { network: "testnet", vault: "my-vault.testnet", leader: "me.testnet", owner: "", operatorMode: "silent-partner", operator: "", attestationKey: "", feePct: "20", minLeaderPct: "10", slippagePct: "1", minDeposit: "1", extraAssets: ["nep141:wrap.testnet"] };
  it("builds the exact init args the contract takes", () => {
    const { cfg, errors } = buildInit(f);
    expect(errors).toEqual([]);
    expect(cfg).toMatchObject({ owner: "me.testnet", leader: "me.testnet", operator: "sp-sop-92991.testnet", perf_fee_bps: 2000, min_leader_bps: 1000, max_slippage_bps: 100, min_deposit: "1000000", allowed_assets: ["nep141:usdc.fakes.testnet", "nep141:wrap.testnet"], mpc_contract: "v1.signer-prod.testnet" });
    expect(commands(f, cfg!)[1]).toContain(`json-args '{"cfg":{`);
  });
  it("mirrors the contract's limits", () => {
    expect(buildInit({ ...f, feePct: "60" }).errors).toContain("Performance fee: 0–50%");
    expect(buildInit({ ...f, slippagePct: "6" }).errors).toContain("Max slippage: 0–5%");
    expect(buildInit({ ...f, vault: "Bad Vault" }).errors[0]).toMatch(/Vault account/);
    expect(buildInit({ ...f, vault: "v.near" }).errors[0]).toMatch(/end in .testnet/);
  });
  it("mainnet needs your own operator; uses 1Click's real key and USDC", () => {
    const m = { ...f, network: "mainnet" as const, vault: "v.near", leader: "me.near", extraAssets: ["nep141:wrap.near"] };
    expect(buildInit(m).errors[0]).toMatch(/no Silent Partner operator on mainnet/);
    const { cfg } = buildInit({ ...m, operatorMode: "own", operator: "op.near", attestationKey: "ed25519:4mm15GiMGtZSfQnSy14N2N2D114sUcSSSc3qBdyasgih" });
    expect(cfg).toMatchObject({ oneclick_key: "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc", intents_contract: "intents.near", mpc_contract: "v1.signer", allowed_assets: ["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "nep141:wrap.near"] });
  });
});

import { rpc } from "../lib/vault";

describe("rpc fallback", () => {
  it("falls through a rate-limited or unreachable endpoint to the next", async () => {
    const seen: string[] = [];
    const f = (async (url: string) => {
      seen.push(url);
      if (url === "a") return new Response("{}", { status: 429 });
      if (url === "b") throw new TypeError("Failed to fetch");
      return new Response('{"ok":1}');
    }) as unknown as typeof fetch;
    const r = await rpc({}, f, ["a", "b", "c"]);
    expect(await r.json()).toEqual({ ok: 1 });
    expect(seen).toEqual(["a", "b", "c"]);
  });
});

import { copyLine, paperPosition, startPaper } from "../lib/paper";

describe("paper follow", () => {
  const E18 = 10n ** 18n;
  it("enters at the latest attested price and values the copy at later NAVs", () => {
    const f = startPaper("v", 1000, { price: E18.toString(), epoch: 5 }, 0)!;
    expect(f.entry_epoch).toBe(5);
    const p = paperPosition(f, ((E18 * 105n) / 100n).toString());
    expect([p.value, p.pnl]).toEqual([1050, 50]);
    expect(p.pct).toBeCloseTo(0.05);
    expect(paperPosition(f, ((E18 * 9n) / 10n).toString()).pnl).toBeCloseTo(-100);
    expect(startPaper("v", 1000, undefined)).toBeNull();
  });
  it("the copy line starts at zero on the entry epoch", () => {
    const f = startPaper("v", 1000, { price: E18.toString(), epoch: 2 }, 0)!;
    const navs = [1, 2, 3].map((e) => ({ epoch: e, timestamp_ms: e, price: (E18 + BigInt(e) * 10n ** 16n).toString() }));
    const f2 = { ...f, entry_price: navs[1].price };
    expect(copyLine(navs, f2).map((p) => p.epoch)).toEqual([2, 3]);
    expect(copyLine(navs, f2)[0].r).toBe(0);
  });
});

import { CHAINS, crossQuoteBody, NEAR_USDC } from "../lib/crosschain";

describe("follow from any chain", () => {
  it("asks 1Click for USDC on the origin chain → USDC on NEAR into the vault, crediting the follower", () => {
    const b = crossQuoteBody({ chain: CHAINS[0], usdc: 25.5, vault: "vault.near", beneficiary: "me.near", refundTo: "0xabc", dry: true, nowMs: 0 });
    expect(b).toMatchObject({ originAsset: CHAINS[0].asset, destinationAsset: NEAR_USDC, amount: "25500000", depositType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", recipient: "vault.near", customRecipientMsg: "me.near", refundTo: "0xabc", dry: true });
    expect(CHAINS.map((c) => c.name)).toEqual(["Base", "Arbitrum", "Ethereum", "Solana"]);
  });
});

import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { personalHash, proofMessage, recoverAddress, verifyProof } from "../lib/trackrecord";

describe("bring your track record", () => {
  const priv = secp256k1.utils.randomPrivateKey();
  const addr = "0x" + bytesToHex(keccak_256(secp256k1.getPublicKey(priv, false).subarray(1)).subarray(12));
  const sign = (m: string) => {
    const s = secp256k1.sign(personalHash(m), priv);
    return "0x" + bytesToHex(s.toCompactRawBytes()) + (27 + s.recovery).toString(16);
  };
  it("recovers the signer of an EIP-191 message and accepts only the exact proof", () => {
    const m = proofMessage("v.near", addr, "2026-11-09T10:00:00Z");
    const p = { vault: "v.near", address: addr, issued: "2026-11-09T10:00:00Z", message: m, signature: sign(m) };
    expect(recoverAddress(m, p.signature)).toBe(addr);
    expect(verifyProof(p)).toBe(true);
    expect(verifyProof({ ...p, vault: "other.near" })).toBe(false); // the proof names one vault
    expect(verifyProof({ ...p, address: "0x" + "11".repeat(20) })).toBe(false); // someone else's address
    expect(recoverAddress(m, "0x1234")).toBeNull();
  });
});

import { drawdownWindow, feeEarned, leaderStake } from "../lib/vault";

describe("risk metrics", () => {
  const E18 = 10n ** 18n;
  const px = (x: number) => ({ price: (BigInt(Math.round(x * 1e6)) * 10n ** 12n).toString() });
  it("finds the worst drawdown window, indexed from inception", () => {
    expect(drawdownWindow([1.1, 0.99, 1.05, 1.2, 1.1].map(px))).toMatchObject({ peak: 1, trough: 2 });
    expect(drawdownWindow([1.1, 0.99, 1.05, 1.2, 1.1].map(px))!.dd).toBeCloseTo(0.1);
  });
  it("counts a fall from the starting price", () => {
    expect(drawdownWindow([0.9, 0.8].map(px))).toMatchObject({ peak: 0, trough: 2 });
  });
  it("is null when the price never fell", () => {
    expect(drawdownWindow([1.01, 1.02].map(px))).toBeNull();
    expect(drawdownWindow([])).toBeNull();
  });
  it("leader stake is a fraction and safe on an empty vault", () => {
    expect(leaderStake({ leader_shares: "25", total_shares: "100" })).toBe(0.25);
    expect(leaderStake({ leader_shares: "0", total_shares: "0" })).toBe(0);
  });
  it("values each fee at the price of its own post", () => {
    expect(feeEarned([{ fee_shares: "100", price: (2n * E18).toString() }, { fee_shares: "0", price: E18.toString() }, { fee_shares: "50", price: E18.toString() }])).toBe(250n);
  });
});

import { bounds, promptHash, seal, suggestStyle, NAME_RE } from "../lib/community";
import { calmScore, windowStats } from "../lib/vault";

describe("open season", () => {
  // Shared with operator/test/community.test.ts: the site seals exactly as the season expects.
  it("seals to the shared vector", async () => {
    const fixed = { esk: new Uint8Array(32).fill(7), iv: new Uint8Array(12).fill(9) };
    expect(await seal("vector text", "launch", "vpEgRfuoiMBgE0qM8LoKNCCKuYps4kaMvpbNZNzGVAo", fixed)).toBe("E75P6uryBMf9M1j8nAByGIHRdCeBKCJ-xnTzf3_pe20JCQkJCQkJCQkJCQk0aqaB_xRjjZNkVtNFFe6voQoUlxCXQFJMsuQ");
    expect(promptHash("vector text")).toBe("a01d42719f12b747e2b5ae6d1924290d39fe0285e9dff07181284c99615fd93c");
  });
  it("random seals differ and fit the registry's format", async () => {
    const a = await seal("x", "launch"), b = await seal("x", "launch");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,6000}$/);
  });
  it("bounds match the season's rules", () => {
    expect(bounds("hold NEAR above its 7-day average, max 60%, cut to 20% on an 8% drop", "high")).toEqual({ min: 0, max: 0.6 });
    expect(bounds("max 60%", "low")).toEqual({ min: 0, max: 0.4 });
    expect(bounds("at least 30% NEAR, up to 90%", "med")).toEqual({ min: 0.3, max: 0.7 });
    expect(bounds("never below 60%", "low")).toBeNull();
  });
  it("suggests a style line without quoting the strategy", () => {
    const s = suggestStyle("Hold NEAR above its 24-hour average; cut to 20% if it drops 5%", "med");
    expect(s).toBe("Follows the trend, cuts risk fast; medium risk");
    expect(s).not.toMatch(/24-hour|5%/);
  });
  it("names", () => {
    expect(NAME_RE.test("Calm Owl")).toBe(true);
    expect(NAME_RE.test("x")).toBe(false);
    expect(NAME_RE.test("Calm <Owl>")).toBe(false);
  });
});

describe("calmest return", () => {
  const E12 = 10n ** 12n;
  const p = (x: number, h: number) => ({ price: (BigInt(Math.round(x * 1e6)) * E12).toString(), timestamp_ms: h * 3600_000 });
  it("measures the window from the price just before it", () => {
    const navs = [p(1.1, 0), p(1.0, 10), p(1.05, 20), p(0.99, 30), p(1.02, 40)];
    const s = windowStats(navs, 15 * 3600_000)!;
    expect(s.posts).toBe(3);
    expect(s.ret).toBeCloseTo(0.02);
    expect(s.dd).toBeCloseTo((1.05 - 0.99) / 1.05);
    expect(windowStats(navs, 35 * 3600_000)).toBeNull();
  });
  it("ranks return per unit of drawdown, with a floor for flat weeks", () => {
    expect(calmScore({ ret: 0.01, dd: 0.005 })).toBeCloseTo(2);
    expect(calmScore({ ret: 0.001, dd: 0 })).toBeCloseTo(2);
  });
});
