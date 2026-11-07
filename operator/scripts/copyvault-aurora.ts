// Kill-test probes 1–3 against Aurora's intents API (docs/killtests-copyvault.md).
// The key is a path segment; it and all tokens are scrubbed from every record.
// No funding intent is signed or submitted. Throwaway ed25519 key, memory only.
//
//   npx tsx --env-file-if-exists=../.env scripts/copyvault-aurora.ts <out.json>
import { writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import { baseEncode } from "@near-js/utils";

const out = process.argv[2] ?? "copyvault-aurora.json";
const KEY = process.env.AURORA_API_KEY ?? "";
if (!KEY) { console.log("AURORA_API_KEY not set"); process.exit(1); }
const BASE = "https://intents-api.aurora.dev";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR = "nep141:wrap.near";

const secrets = [KEY];
const scrub = (s: string) => secrets.filter(Boolean).reduce((a, k) => a.split(k).join("[REDACTED]"), s);

type Rec = { name: string; method: string; path: string; bearer: boolean; status: number | null; ms: number; correlation: Record<string, string>; body: unknown };
async function req(name: string, method: string, path: string, bearer?: string, body?: unknown): Promise<Rec & { raw?: any }> {
  const t0 = performance.now();
  try {
    const r = await fetch(BASE + path.replace("{key}", KEY), {
      method, headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const ms = Math.round(performance.now() - t0);
    const text = await r.text();
    let raw: any; try { raw = JSON.parse(text); } catch { raw = text; }
    const correlation: Record<string, string> = {};
    r.headers.forEach((v, k) => { if (/request-id|correlation|trace|cf-ray/i.test(k)) correlation[k] = v; });
    const metaId = raw?.meta?.correlationId; if (metaId) correlation["body.meta.correlationId"] = metaId;
    return { name, method, path, bearer: !!bearer, status: r.status, ms, correlation, body: JSON.parse(scrub(JSON.stringify(raw ?? null))), raw };
  } catch (e) {
    return { name, method, path, bearer: !!bearer, status: null, ms: Math.round(performance.now() - t0), correlation: {}, body: scrub(String(e)) };
  }
}
const rec = (r: Rec & { raw?: unknown }) => { const { raw, ...x } = r; return JSON.parse(scrub(JSON.stringify(x))); };

// ---- throwaway implicit account ----
const kp = nacl.sign.keyPair();
const account = Buffer.from(kp.publicKey).toString("hex");
const publicKey = "ed25519:" + baseEncode(kp.publicKey);

// Defuse versioned nonce: magic ‖ v0 ‖ salt ‖ deadline ns ‖ signing time ns ‖ random(7)
async function versionedNonce(deadlineMs: number): Promise<Buffer> {
  const r = await fetch("https://rpc.mainnet.fastnear.com", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: "intents.near", method_name: "current_salt", args_base64: "e30=" } }) });
  const salt = Buffer.from(JSON.parse(Buffer.from((await r.json()).result.result).toString()), "hex");
  const dl = Buffer.alloc(8); dl.writeBigUInt64LE(BigInt(deadlineMs) * 1_000_000n);
  const ts = Buffer.alloc(8); ts.writeBigUInt64LE(BigInt(Date.now()) * 1_000_000n);
  return Buffer.concat([Buffer.from([0x56, 0x28, 0xf6, 0xc6, 0]), salt, dl, ts, randomBytes(7)]);
}
function nep413(message: string, recipient: string, nonce: Buffer) {
  const str = (s: string) => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  const sig = nacl.sign.detached(createHash("sha256").update(Buffer.concat([tag, str(message), nonce, str(recipient), Buffer.from([0])])).digest(), kp.secretKey);
  return { standard: "nep413", payload: { message, nonce: nonce.toString("base64"), recipient }, public_key: publicKey, signature: "ed25519:" + baseEncode(sig) };
}

const result: Record<string, unknown> = { ranAt: new Date().toISOString(), base: BASE, account };

// ---- probe 2 (Aurora): login ----
const deadline = Date.now() + 60_000;
const msg = JSON.stringify({ signer_id: account, deadline: new Date(deadline).toISOString(), intents: [] });
const auth = await req("authenticate", "POST", "/api/auth/authenticate/{key}", undefined, { signedData: nep413(msg, "intents.near", await versionedNonce(deadline)) });
const jwt: string | undefined = auth.raw?.accessToken;
secrets.push(jwt ?? "", auth.raw?.refreshToken ?? "");
const p2: Record<string, unknown> = { authenticate: { ...rec(auth), body: auth.raw && typeof auth.raw === "object"
  ? Object.fromEntries(Object.entries(auth.raw).map(([k, v]) => [k, /token/i.test(k) ? "[REDACTED]" : v])) : rec(auth).body } };
if (jwt) {
  p2.balances = rec(await req("balances", "GET", "/api/account/balances/{key}", jwt));
  p2.history = rec(await req("history", "GET",
    "/api/account/history/{key}?status=SUCCESS&depositType=CONFIDENTIAL_INTENTS&recipientType=CONFIDENTIAL_INTENTS&refundType=CONFIDENTIAL_INTENTS", jwt));
}
result.probe2 = p2;

// ---- probe 1: confidential dry quote, with and without Bearer ----
const quoteBody = {
  dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC, destinationAsset: WNEAR, amount: "1000000",
  depositType: "CONFIDENTIAL_INTENTS", recipientType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS",
  confidentiality: "advanced", recipient: account, refundTo: account, deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
};
const q1 = jwt ? await req("quote+bearer", "POST", "/api/quote/{key}", jwt, quoteBody) : undefined;
const q0 = await req("quote-no-bearer", "POST", "/api/quote/{key}", undefined, quoteBody);
result.probe1 = { request: quoteBody, withBearer: q1 && rec(q1), withoutBearer: rec(q0) };

// ---- probe 3: unfunded confidential LIMIT SELL (path inferred, not in docs) ----
if (jwt) {
  const attributes = {
    orderType: "LIMIT", baseAsset: USDC, quoteAsset: WNEAR, quantity: "1000000", side: "SELL", price: "1000",
    depositType: "CONFIDENTIAL_INTENTS", refundTo: account, refundType: "CONFIDENTIAL_INTENTS",
    recipient: account, recipientType: "CONFIDENTIAL_INTENTS", confidentiality: "advanced",
    deadline: new Date(Date.now() + 60_000).toISOString(),
  };
  const o = await req("createOrder", "POST", "/api/orders/{key}", jwt, { data: { type: "orders", attributes } });
  const p3: Record<string, unknown> = { request: attributes, createOrder: rec(o) };
  const dep = o.raw?.data?.attributes?.depositAddress;
  if (dep) p3.generateIntent = rec(await req("generateIntent", "POST", "/api/generate-intent/{key}", jwt,
    { type: "swap_transfer", standard: "nep413", signerId: account, depositAddress: dep }));
  result.probe3 = p3;
}

writeFileSync(out, scrub(JSON.stringify(result, null, 2)));
const ok = (r?: Rec) => !!r && r.status !== null && r.status < 300;
console.log(`PROBE 1 ${ok(q1) ? "PASS" : "FAIL"}: bearer HTTP ${q1?.status ?? "-"} ${q1?.ms ?? "-"}ms; no-bearer HTTP ${q0.status} ${q0.ms}ms`);
console.log(`PROBE 2 ${jwt ? "PASS" : "FAIL"}: authenticate HTTP ${auth.status} ${auth.ms}ms`);
const p3 = result.probe3 as { createOrder?: Rec; generateIntent?: Rec } | undefined;
console.log(`PROBE 3 ${ok(p3?.createOrder) ? "PASS" : "FAIL"}: createOrder HTTP ${p3?.createOrder?.status ?? "-"}, generateIntent HTTP ${p3?.generateIntent?.status ?? "-"}`);
console.log("PROBE 4 DEFERRED: paid");
