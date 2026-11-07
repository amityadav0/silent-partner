// Kill-test probes 1–3 for the copy-vault idea (docs/killtests-copyvault.md).
// Read-only except one unfunded 1-minute confidential order. Never signs or
// submits an intent. The throwaway ed25519 key lives only in memory.
//
//   npx tsx scripts/copyvault-probes.ts <out.json>
//   (reads AURORA_API_KEY from the environment; probe 1 is BLOCKED without it)
import { writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import { baseEncode } from "@near-js/utils";
import {
  OpenAPI, OneClickService, UserAuthService, AccountService, OrderService, ApiError,
} from "@defuse-protocol/one-click-sdk-typescript";

const out = process.argv[2] ?? "copyvault-probes.json";
const API_KEY = process.env.AURORA_API_KEY ?? "";
OpenAPI.BASE = "https://1click.chaindefuser.com";

const secrets: string[] = [];
const scrub = (v: unknown): unknown =>
  JSON.parse(secrets.filter(Boolean).reduce(
    (s, sec) => s.split(sec).join("[REDACTED]"), JSON.stringify(v ?? null)));

type Call = { name: string; status: number | null; ms: number; ok: boolean; body: unknown; error?: string };
async function call<T>(name: string, token: string | undefined, f: () => Promise<T>): Promise<Call & { raw?: T }> {
  OpenAPI.TOKEN = token; OpenAPI.HEADERS = API_KEY && process.env.SEND_KEY === "1" ? { "X-API-Key": API_KEY } : undefined;
  const t0 = performance.now();
  try {
    const raw = await f();
    return { name, status: 200, ms: Math.round(performance.now() - t0), ok: true, body: scrub(raw), raw };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    if (e instanceof ApiError) return { name, status: e.status, ms, ok: false, body: scrub(e.body), error: e.message };
    return { name, status: null, ms, ok: false, body: null, error: String(e) };
  }
}
const strip = <T extends { raw?: unknown }>(c: T) => { const { raw, ...rest } = c; return rest; };

// ---- throwaway implicit account (never printed, never written) ----
const kp = nacl.sign.keyPair();
const account = Buffer.from(kp.publicKey).toString("hex");
const publicKey = "ed25519:" + baseEncode(kp.publicKey);

// NEP-413: sign sha256(borsh(tag, message, nonce, recipient, callbackUrl))
// Defuse versioned nonce: magic(4) ‖ version 0 ‖ salt(4, intents.near current_salt) ‖ deadline ns u64 LE ‖ random(15)
async function versionedNonce(deadlineMs: number): Promise<Buffer> {
  const r = await fetch("https://rpc.mainnet.fastnear.com", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: "intents.near", method_name: "current_salt", args_base64: "e30=" } }) });
  const salt = Buffer.from(JSON.parse(Buffer.from((await r.json()).result.result).toString()), "hex");
  const dl = Buffer.alloc(8); dl.writeBigUInt64LE(BigInt(deadlineMs) * 1_000_000n);
  // inner 15 bytes: signing time (u64 LE, unit per NONCE_TIME_UNIT) ‖ random(7)
  const unit = process.env.NONCE_TIME_UNIT ?? "ns";
  const now = BigInt(Date.now());
  const ts = Buffer.alloc(8); ts.writeBigUInt64LE(unit === "ns" ? now * 1_000_000n : unit === "s" ? now / 1000n : now);
  return Buffer.concat([Buffer.from([0x56, 0x28, 0xf6, 0xc6, 0]), salt, dl, ts, randomBytes(7)]);
}
let nextNonce: Buffer | undefined;
function nep413(message: string, recipient: string) {
  const nonce = nextNonce ?? randomBytes(32); nextNonce = undefined;
  const str = (s: string) => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  const bytes = Buffer.concat([tag, str(message), nonce, str(recipient), Buffer.from([0])]);
  const sig = nacl.sign.detached(createHash("sha256").update(bytes).digest(), kp.secretKey);
  return {
    standard: "nep413" as const,
    payload: { message, nonce: nonce.toString("base64"), recipient },
    public_key: publicKey,
    signature: "ed25519:" + baseEncode(sig),
  };
}

const result: Record<string, unknown> = { ranAt: new Date().toISOString(), base: OpenAPI.BASE, account, publicKey, apiKeyPresent: !!API_KEY };
secrets.push(API_KEY);

// ---- asset ids (public) ----
const tokens = await call("getTokens", undefined, () => OneClickService.getTokens());
const list = (tokens.raw ?? []) as Array<{ assetId: string; symbol: string; blockchain: string }>;
const find = (sym: string) => list.find(t => t.blockchain === "near" && t.symbol === sym)?.assetId;
const USDC = find("USDC") ?? "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR = find("wNEAR") ?? "nep141:wrap.near";
result.assets = { USDC, WNEAR, tokensStatus: tokens.status, tokensMs: tokens.ms, tokenCount: list.length };

// ---- probe 1: confidential dry quote ----
const quoteReq = {
  dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100,
  originAsset: USDC, destinationAsset: WNEAR, amount: "1000000",
  depositType: "CONFIDENTIAL_INTENTS", recipientType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS",
  confidentiality: "advanced", recipient: account, refundTo: account,
  deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
};
// Sent after probe 2: confidential quotes need the user's session JWT
// ("User authentication is required for confidential intent quotes").

// ---- probe 2: authenticate the empty implicit account ----
const authDeadline = Date.now() + Number(process.env.AUTH_DEADLINE_S ?? 60) * 1000;
const authMsg = JSON.stringify({ signer_id: account, deadline: new Date(authDeadline).toISOString(), intents: [] });
if ((process.env.NONCE_MODE ?? "versioned") === "versioned") nextNonce = await versionedNonce(authDeadline);
const auth = await call("authenticate", undefined, () => UserAuthService.authenticate({ signedData: nep413(authMsg, "intents.near") as never }));
const jwt = (auth.raw as { accessToken?: string } | undefined)?.accessToken;
const refresh = (auth.raw as { refreshToken?: string } | undefined)?.refreshToken;
secrets.push(jwt ?? "", refresh ?? "");
const p2: Record<string, unknown> = { authMessage: JSON.parse(authMsg), recipient: "intents.near", authenticate: strip({ ...auth, body: scrub(auth.raw ?? auth.body) }) };
if (jwt) {
  p2.getBalances = strip(await call("getBalances", jwt, () => AccountService.getBalances()));
  p2.getHistory = strip(await call("getHistory", jwt, () => AccountService.getHistory()));
}
result.probe2 = p2;
result.probe1 = jwt
  ? { request: quoteReq, auth: `JWT${process.env.SEND_KEY === "1" ? " + X-API-Key" : ""}`, ...strip(await call("getQuote", jwt, () => OneClickService.getQuote(quoteReq as never))) }
  : { request: quoteReq, blocked: "no session (probe 2 failed)" };

// ---- probe 3: unfunded confidential LIMIT SELL, generate-intent only ----
if (jwt) {
  const orderReq = {
    orderType: "LIMIT", baseAsset: USDC, quoteAsset: WNEAR, quantity: "1000000", side: "SELL",
    price: "1000", // 1000 wNEAR per USDC: far above market, cannot fill
    depositType: "CONFIDENTIAL_INTENTS", refundTo: account, refundType: "CONFIDENTIAL_INTENTS",
    recipient: account, recipientType: "CONFIDENTIAL_INTENTS", confidentiality: "advanced",
    deadline: new Date(Date.now() + 60_000).toISOString(),
  };
  const order = await call("createOrder", jwt, () => OrderService.createOrder({ data: { type: "orders", attributes: orderReq as never } }));
  const p3: Record<string, unknown> = { request: orderReq, createOrder: strip(order) };
  const o = (order.raw as { data?: { id: string; attributes: { depositAddress: string } } } | undefined)?.data;
  if (o) {
    p3.generateIntent = strip(await call("generateIntent", jwt, () => OneClickService.generateIntent({
      type: "swap_transfer", standard: "nep413", signerId: account, depositAddress: o.attributes.depositAddress,
    } as never)));
    p3.getOrder = strip(await call("getOrder", jwt, () => OrderService.getOrder(o.id)));
  }
  result.probe3 = p3;
} else {
  result.probe3 = { blocked: "no session (probe 2 failed)" };
}

writeFileSync(out, JSON.stringify(scrub(result), null, 2));
const line = (n: number, ok: boolean | null, why: string) => console.log(`PROBE ${n} ${ok === null ? "BLOCKED" : ok ? "PASS" : "FAIL"}: ${why}`);
const p1 = result.probe1 as Call & { blocked?: string };
line(1, p1.blocked ? null : p1.ok, p1.blocked ?? `HTTP ${p1.status} in ${p1.ms} ms`);
line(2, auth.ok && !!jwt, `authenticate HTTP ${auth.status} in ${auth.ms} ms`);
const p3 = result.probe3 as { blocked?: string; createOrder?: Call; generateIntent?: Call };
line(3, p3.blocked ? null : !!p3.createOrder?.ok && !!p3.generateIntent?.ok,
  p3.blocked ?? `createOrder HTTP ${p3.createOrder?.status}, generateIntent HTTP ${p3.generateIntent?.status ?? "-"}`);
