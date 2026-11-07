// $1 round trip: public intents.near USDC → confidential (intents.far) → public.
//
// Default: DRY. Two dry 1Click quotes (shield, unshield); nothing is signed.
// Live: only when ROUNDTRIP_LIVE=1 AND the operator types the account id at
// the prompt. Amit runs live mode himself (docs/NEEDS-AMIT.md); this agent never does.
//
//   npx tsx --env-file-if-exists=../.env scripts/roundtrip.ts [out.json]
//
// Env: ONECLICK_JWT (partner), ROUNDTRIP_ACCOUNT (NEAR account holding ≥1 USDC
// on intents.near), live only: ROUNDTRIP_PRIVATE_KEY (ed25519:… full-access or
// a key registered on intents.near for that account). Secrets are never printed.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { USDC, nep413Prehash, versionedNonce, viewCall, type Nep413Payload } from "../src/intents.js";

const BASE = process.env.ONECLICK_URL ?? "https://1click.chaindefuser.com";
const JWT = process.env.ONECLICK_JWT ?? "";
const ACCOUNT = process.env.ROUNDTRIP_ACCOUNT ?? "0000000000000000000000000000000000000000000000000000000000000001";
const LIVE = process.env.ROUNDTRIP_LIVE === "1";
const AMOUNT = process.env.ROUNDTRIP_AMOUNT ?? "1000000"; // 1 USDC
const out = process.argv[2] ?? "roundtrip.json";
if (!JWT) { console.log("ONECLICK_JWT not set"); process.exit(1); }
const scrub = (v: unknown) => JSON.parse(JSON.stringify(v ?? null).split(JWT).join("[REDACTED]"));

async function api(method: "GET" | "POST", path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "X-API-Key": JWT };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const t0 = Date.now();
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { text: text.slice(0, 300) }; }
  return { status: r.status, ms: Date.now() - t0, json };
}

const quoteBody = (dry: boolean, leg: "shield" | "unshield") => ({
  dry, swapType: "EXACT_INPUT", slippageTolerance: 0, originAsset: USDC, destinationAsset: USDC, amount: AMOUNT,
  depositType: leg === "shield" ? "INTENTS" : "CONFIDENTIAL_INTENTS",
  recipientType: leg === "shield" ? "CONFIDENTIAL_INTENTS" : "INTENTS",
  refundType: leg === "shield" ? "INTENTS" : "CONFIDENTIAL_INTENTS",
  recipient: ACCOUNT, refundTo: ACCOUNT, deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
});

const result: Record<string, unknown> = { ranAt: new Date().toISOString(), live: LIVE, account: ACCOUNT, amount: AMOUNT };
result.dryShield = await api("POST", "/v0/quote", quoteBody(true, "shield"));
result.dryUnshield = await api("POST", "/v0/quote", quoteBody(true, "unshield"));

if (LIVE) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = await rl.question(`LIVE: moves ${AMOUNT} USDC units for ${ACCOUNT}. Type the account id to continue: `);
  rl.close();
  if (typed.trim() !== ACCOUNT) { console.log("aborted"); process.exit(1); }
  const key = KeyPair.fromString(process.env.ROUNDTRIP_PRIVATE_KEY as `ed25519:${string}`);
  const sign = (p: Nep413Payload) => ({ standard: "nep413", payload: p, public_key: key.getPublicKey().toString(), signature: "ed25519:" + base58.encode(key.sign(nep413Prehash(p)).signature) });

  // session token (for confidential balances)
  const salt = await viewCall<string>("https://rpc.mainnet.fastnear.com", "intents.near", "current_salt", {});
  const dl = Date.now() + 60_000;
  const login = sign({ message: JSON.stringify({ signer_id: ACCOUNT, deadline: new Date(dl).toISOString(), intents: [] }), nonce: versionedNonce(salt, dl).toString("base64"), recipient: "intents.near" });
  const auth = await api("POST", "/v0/auth/authenticate", { signedData: login });
  const bearer: string | undefined = auth.json?.accessToken;
  result.auth = { status: auth.status, ms: auth.ms };
  const balances = async () => (bearer ? (await api("GET", "/v0/account/balances", undefined, bearer)).json : null);
  result.balancesBefore = await balances();

  for (const leg of ["shield", "unshield"] as const) {
    const q = await api("POST", "/v0/quote", quoteBody(false, leg));
    const depositAddress = q.json?.quote?.depositAddress;
    const r: Record<string, unknown> = { quote: q };
    if (!depositAddress) { result[leg] = r; break; }
    const gi = await api("POST", "/v0/generate-intent", { type: "swap_transfer", standard: "nep413", signerId: ACCOUNT, depositAddress });
    r.generateIntent = gi;
    const payload = gi.json?.intent?.payload as Nep413Payload | undefined;
    if (!payload) { result[leg] = r; break; }
    r.submit = await api("POST", "/v0/submit-intent", { type: "swap_transfer", signedData: sign(payload) });
    const trail: [string, string][] = [];
    for (let i = 0; i < 60; i++) {
      const s = await api("GET", `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
      const st = s.json?.status ?? `HTTP ${s.status}`;
      if (trail.at(-1)?.[1] !== st) trail.push([new Date().toISOString(), st]);
      if (["SUCCESS", "REFUNDED", "FAILED"].includes(st)) { r.final = s.json; break; }
      await new Promise((res) => setTimeout(res, 5_000));
    }
    r.trail = trail;
    result[leg] = r;
    result[`balancesAfter_${leg}`] = await balances();
    if (trail.at(-1)?.[1] !== "SUCCESS") break;
  }
}

writeFileSync(out, JSON.stringify(scrub(result), null, 2));
const s = (k: string) => { const v = result[k] as any; return v ? `HTTP ${v.status} amountOut=${v.json?.quote?.amountOut ?? "-"} ${v.json?.message ?? ""}` : "-"; };
console.log(`dry shield:   ${s("dryShield")}\ndry unshield: ${s("dryUnshield")}`);
if (LIVE) console.log(`shield: ${JSON.stringify((result.shield as any)?.trail)}\nunshield: ${JSON.stringify((result.unshield as any)?.trail)}`);
