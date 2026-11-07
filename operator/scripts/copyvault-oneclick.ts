// Copy-vault kill tests against 1Click with a partner JWT (docs/killtests-copyvault.md).
// Never prints ONECLICK_JWT or user tokens. Never signs or submits a transfer intent.
// Throwaway ed25519 key, memory only.
//
//   npx tsx --env-file-if-exists=.env scripts/copyvault-oneclick.ts <out.json>
import { writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import { baseEncode } from "@near-js/utils";
import {
  OpenAPI, OneClickService, UserAuthService, AccountService, OrderService, ApiError,
} from "@defuse-protocol/one-click-sdk-typescript";

const out = process.argv[2] ?? "copyvault-oneclick.json";
const PARTNER = process.env.ONECLICK_JWT ?? "";
if (!PARTNER) { console.log("ONECLICK_JWT not set"); process.exit(1); }
OpenAPI.BASE = "https://1click.chaindefuser.com";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR = "nep141:wrap.near";

const secrets = [PARTNER];
const scrub = (v: unknown) => JSON.parse(secrets.filter(Boolean).reduce((s, k) => s.split(k).join("[REDACTED]"), JSON.stringify(v ?? null)));

type Creds = { label: string; apiKey?: string; bearer?: string };
type Rec = { name: string; creds: string; status: number | null; ms: number; ok: boolean; correlationId?: string; body: unknown; error?: string };
async function call<T>(name: string, c: Creds, f: () => Promise<T>): Promise<Rec & { raw?: any }> {
  OpenAPI.TOKEN = c.bearer;
  OpenAPI.HEADERS = c.apiKey ? { "X-API-Key": c.apiKey } : undefined;
  const t0 = performance.now();
  try {
    const raw: any = await f();
    return { name, creds: c.label, status: 200, ms: Math.round(performance.now() - t0), ok: true,
      correlationId: raw?.correlationId ?? raw?.meta?.correlationId, body: scrub(raw), raw };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    if (e instanceof ApiError) {
      const b: any = e.body;
      return { name, creds: c.label, status: e.status, ms, ok: false, correlationId: b?.correlationId ?? b?.meta?.correlationId, body: scrub(b), error: e.message };
    }
    return { name, creds: c.label, status: null, ms, ok: false, body: null, error: scrub(String(e)) };
  }
}
const rec = ({ raw, ...r }: Rec & { raw?: unknown }) => r;

// ---- throwaway implicit account ----
const kp = nacl.sign.keyPair();
const account = Buffer.from(kp.publicKey).toString("hex");
const publicKey = "ed25519:" + baseEncode(kp.publicKey);
async function versionedNonce(deadlineMs: number): Promise<Buffer> {
  const r = await fetch("https://rpc.mainnet.fastnear.com", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: "intents.near", method_name: "current_salt", args_base64: "e30=" } }) });
  const salt = Buffer.from(JSON.parse(Buffer.from((await r.json()).result.result).toString()), "hex");
  const dl = Buffer.alloc(8); dl.writeBigUInt64LE(BigInt(deadlineMs) * 1_000_000n);
  const ts = Buffer.alloc(8); ts.writeBigUInt64LE(BigInt(Date.now()) * 1_000_000n);
  return Buffer.concat([Buffer.from([0x56, 0x28, 0xf6, 0xc6, 0]), salt, dl, ts, randomBytes(7)]);
}
function nep413(message: string, nonce: Buffer) {
  const recipient = "intents.near";
  const str = (s: string) => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  const sig = nacl.sign.detached(createHash("sha256").update(Buffer.concat([tag, str(message), nonce, str(recipient), Buffer.from([0])])).digest(), kp.secretKey);
  return { standard: "nep413", payload: { message, nonce: nonce.toString("base64"), recipient }, public_key: publicKey, signature: "ed25519:" + baseEncode(sig) };
}

const result: Record<string, unknown> = { ranAt: new Date().toISOString(), base: OpenAPI.BASE, account };

// ---- 1. user session ----
const deadline = Date.now() + 60_000;
const msg = JSON.stringify({ signer_id: account, deadline: new Date(deadline).toISOString(), intents: [] });
const auth = await call("authenticate", { label: "none" }, async () => UserAuthService.authenticate({ signedData: nep413(msg, await versionedNonce(deadline)) as never }));
const user: string | undefined = auth.raw?.accessToken;
secrets.push(user ?? "", auth.raw?.refreshToken ?? "");
result.session = rec({ ...auth, body: { expiresIn: auth.raw?.expiresIn, refreshExpiresIn: auth.raw?.refreshExpiresIn, error: auth.ok ? undefined : auth.body } });
if (!user) { writeFileSync(out, JSON.stringify(scrub(result), null, 2)); console.log(`SESSION FAIL: HTTP ${auth.status}`); process.exit(1); }

const BOTH: Creds = { label: "X-API-Key=partner + Bearer=user", apiKey: PARTNER, bearer: user };
const variants: Creds[] = [
  BOTH,
  { label: "X-API-Key=partner only", apiKey: PARTNER },
  { label: "Bearer=user only", bearer: user },
  { label: "Bearer=partner only", bearer: PARTNER },
];

// ---- 2. probe 1: confidential dry quote ----
const quoteBody = () => ({
  dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC, destinationAsset: WNEAR, amount: "1000000",
  depositType: "CONFIDENTIAL_INTENTS", recipientType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS",
  confidentiality: "advanced", recipient: account, refundTo: account, deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
});
const quotes = [];
for (const v of variants) quotes.push(await call("getQuote", v, () => OneClickService.getQuote(quoteBody() as never)));
result.probe1 = quotes.map(q => ({ ...rec(q), appFees: q.raw?.quoteRequest?.appFees ?? null, quote: q.raw?.quote ?? null }));

// ---- 3. probe 3: unfunded order → generate-intent (unsigned) → cancel → list ----
const orderAttrs = () => ({
  orderType: "LIMIT", baseAsset: USDC, quoteAsset: WNEAR, quantity: "1000000", side: "SELL",
  price: "1000", // 1000 wNEAR per USDC: ~3700× market, cannot fill
  depositType: "CONFIDENTIAL_INTENTS", refundTo: account, refundType: "CONFIDENTIAL_INTENTS",
  recipient: account, recipientType: "CONFIDENTIAL_INTENTS", confidentiality: "advanced",
  deadline: new Date(Date.now() + 60_000).toISOString(),
});
const creates = [];
let orderCreds: Creds | undefined; let order: any;
for (const v of variants) {
  const r = await call("createOrder", v, () => OrderService.createOrder({ data: { type: "orders", attributes: orderAttrs() as never } }));
  creates.push(rec(r));
  if (r.ok) { orderCreds = v; order = r.raw.data; break; }
}
const p3: Record<string, unknown> = { request: orderAttrs(), createOrder: creates };
if (order && orderCreds) {
  const gi = await call("generateIntent", orderCreds, () => OneClickService.generateIntent({
    type: "swap_transfer", standard: "nep413", signerId: account, depositAddress: order.attributes.depositAddress,
  } as never));
  p3.generateIntent = rec(gi); // unsigned payload; never signed, never submitted
  p3.getOrder = rec(await call("getOrder", orderCreds, () => OrderService.getOrder(order.id)));
  p3.cancelOrder = rec(await call("cancelOrder", orderCreds, () => OrderService.cancelOrder(order.id)));
  p3.listOrders = rec(await call("listOrders", orderCreds, () => OrderService.listOrders()));
}
result.probe3 = p3;

// ---- 4. history with the user token ----
const hist = [];
for (const v of [{ label: "Bearer=user only", bearer: user }, BOTH]) hist.push(rec(await call("getHistory", v, () => AccountService.getHistory())));
result.history = hist;
result.balances = rec(await call("getBalances", { label: "Bearer=user only", bearer: user }, () => AccountService.getBalances()));

writeFileSync(out, JSON.stringify(scrub(result), null, 2));

// ---- summary ----
const bps = (fees: any) => Array.isArray(fees) ? fees.reduce((s: number, f: any) => s + Number(f.fee ?? 0), 0) : null;
for (const q of result.probe1 as any[]) console.log(`  quote [${q.creds}] HTTP ${q.status} ${q.ms}ms appFees=${q.appFees ? bps(q.appFees) + "bps" : "-"} corr=${q.correlationId ?? "-"}`);
const okQ = (result.probe1 as any[]).find(q => q.ok);
console.log(`SESSION ${user ? "PASS" : "FAIL"}: authenticate HTTP ${auth.status} ${auth.ms}ms`);
console.log(`PROBE 1 ${okQ ? "PASS" : "FAIL"}: ${okQ ? `first OK with ${okQ.creds}` : "no credential variant accepted"}`);
const c = creates.at(-1)!;
console.log(`PROBE 3 ${order ? "PASS" : "FAIL"}: createOrder HTTP ${c.status} [${c.creds}]; generateIntent ${(p3.generateIntent as Rec | undefined)?.status ?? "-"}; cancel ${(p3.cancelOrder as Rec | undefined)?.status ?? "-"}; list ${(p3.listOrders as Rec | undefined)?.status ?? "-"}`);
console.log(`PROBE 4 ${hist.some(h => h.ok) ? "PASS (history allowed)" : "FAIL"}: history ${hist.map(h => `${h.status} [${h.creds}]`).join(", ")}`);
console.log(`FEES: 1Click ${okQ?.appFees ? bps(okQ.appFees) + " bps" : "none added"} vs Aurora 45 bps; amountOut ${okQ?.quote?.amountOutFormatted ?? "-"} wNEAR (Aurora 0.269693)`);
