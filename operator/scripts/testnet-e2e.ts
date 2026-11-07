// Testnet end-to-end for the vault contract (P2). Testnet only; never mainnet.
//
//   npx tsx scripts/testnet-e2e.ts
//
// Reads data/testnet-accounts.json (faucet accounts, keys in ~/.near-credentials).
// Generates the operator attestation key, leader signal key and testnet quote key
// into data/testnet-keys.json (gitignored) on first run. Writes data/testnet-e2e.json
// and prints the tx list for docs/testnet.md. Never prints private keys.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { connect, keyStores, providers, KeyPair, type Account } from "near-api-js";
import { base58 } from "@scure/base";
import { signTestQuote } from "../src/testquote.js";
import { imt, viewCall } from "../src/intents.js";

const NET = "testnet";
const RPC = "https://rpc.testnet.fastnear.com";
const USDC_T = "usdc.fakes.testnet";
const BASE_ID = `nep141:${USDC_T}`;
const WNEAR_ID = "nep141:wrap.testnet";
const TGAS = 1_000_000_000_000n;
const WASM = new URL("../../contract/target/near/silent_partner.wasm", import.meta.url);

const A = JSON.parse(readFileSync("data/testnet-accounts.json", "utf8")) as Record<"vault" | "operator" | "leader" | "follower", string>;
const KEYS_PATH = "data/testnet-keys.json";
if (!existsSync(KEYS_PATH)) {
  const k = () => KeyPair.fromRandom("ed25519").toString();
  writeFileSync(KEYS_PATH, JSON.stringify({ attestation: k(), signal: k(), testQuote: k() }), { mode: 0o600 });
}
const K = JSON.parse(readFileSync(KEYS_PATH, "utf8")) as Record<"attestation" | "signal" | "testQuote", string>;
const kp = (s: string) => KeyPair.fromString(s as `ed25519:${string}`);
const att = kp(K.attestation), sigKey = kp(K.signal), qKey = kp(K.testQuote);

const near = await connect({ networkId: NET, nodeUrl: RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) });
const acct = (id: string) => near.account(id);
const txs: { step: string; tx: string; result?: unknown }[] = [];

async function call(who: string, contractId: string, methodName: string, args: object, opts: { gas?: bigint; deposit?: bigint } = {}) {
  const a: Account = await acct(who);
  const o = await a.functionCall({ contractId, methodName, args, gas: opts.gas ?? 100n * TGAS, attachedDeposit: opts.deposit ?? 0n });
  const result = providers.getTransactionLastResult(o);
  const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  if (failure) throw new Error(`${methodName} failed: ${JSON.stringify(failure).slice(0, 400)}`);
  txs.push({ step: `${who.split("-")[1]} → ${contractId === A.vault ? "vault" : contractId}.${methodName}`, tx: o.transaction.hash, result });
  console.log(`  ✓ ${methodName.padEnd(18)} ${o.transaction.hash}`);
  return result as any;
}
const view = <T>(method: string, args: object = {}) => viewCall<T>(RPC, A.vault, method, args, fetch, "optimistic");
const msNow = () => Date.now();

// 1. deploy + init (idempotent)
const state = await (await acct(A.vault)).state();
if (state.code_hash === "11111111111111111111111111111111") {
  const o = await (await acct(A.vault)).deployContract(readFileSync(WASM));
  txs.push({ step: "deploy", tx: o.transaction.hash });
  console.log(`  ✓ deploy             ${o.transaction.hash}`);
  await call(A.vault, A.vault, "new", { cfg: {
    owner: A.vault, operator: A.operator, leader: A.leader, base_token: USDC_T, base_asset_id: BASE_ID,
    intents_contract: null, mpc_contract: "v1.signer-prod.testnet", mpc_path: "silent-partner/vault",
    oneclick_key: qKey.getPublicKey().toString(), attestation_key: att.getPublicKey().toString(),
    perf_fee_bps: 2000, min_leader_bps: 1000, max_slippage_bps: 100, min_deposit: "1000000",
    allowed_assets: [BASE_ID, WNEAR_ID],
  } });
}
let v = await view<any>("get_vault");
if (!v.vault_account) {
  await call(A.operator, A.vault, "activate", {}, { gas: 50n * TGAS });
  v = await view<any>("get_vault");
}
const mpcPk = await viewCall<string>(RPC, "v1.signer-prod.testnet", "derived_public_key", { path: "silent-partner/vault", predecessor: A.vault, domain_id: 1 });
const vaultAccount: string = v.vault_account;
if (Buffer.from(base58.decode(mpcPk.replace("ed25519:", ""))).toString("hex") !== vaultAccount) throw new Error("vault_account does not match the MPC-derived key");
console.log(`  vault confidential account = MPC-derived ${vaultAccount}`);

// 2. tokens: storage + mint fake USDC to leader and follower
for (const who of [A.vault, A.leader, A.follower]) {
  const reg = await viewCall<unknown>(RPC, USDC_T, "storage_balance_of", { account_id: who });
  if (!reg) await call(A.operator, USDC_T, "storage_deposit", { account_id: who }, { deposit: 1_250_000_000_000_000_000_000n, gas: 30n * TGAS });
}
for (const [who, amt] of [[A.leader, "20000000"], [A.follower, "100000000"]] as const) {
  await call(who, USDC_T, "mint", { account_id: who, amount: amt }, { gas: 30n * TGAS });
}

// 3. deposits: leader seeds 10 USDC, follower 50 (leader 16.7% ≥ 10%), follower 100 refused (would be < 10%)
const dep = (who: string, amount: string) => call(who, USDC_T, "ft_transfer_call", { receiver_id: A.vault, amount, msg: "" }, { deposit: 1n, gas: 100n * TGAS });
await dep(A.leader, "10000000");
await dep(A.follower, "50000000");
await dep(A.follower, "45000000"); // 105 total, leader 10/105 = 9.5% → refunded
const afterDeps = await view<any>("get_vault");

// 4. NAV epoch: +10% (66 USDC) → performance fee to the leader
const nextEpoch = afterDeps.epoch + 1;
const head = createHash("sha256").update("fills:genesis").digest("hex");
async function postNav(nav: string) {
  const e = (await view<any>("get_vault")).epoch + 1;
  const ts = msNow() - 2000;
  const m = await view<string>("nav_message", { epoch: e, nav, timestamp_ms: ts, fills_head: head });
  const sig = "ed25519:" + base58.encode(att.sign(new TextEncoder().encode(m)).signature);
  return call(A.operator, A.vault, "post_nav", { epoch: e, nav, timestamp_ms: ts, fills_head: head, signature: sig });
}
const nav1 = await postNav("66000000");

// 5. leader signal registry
if (!(await view<string | null>("get_signal_key"))) await call(A.leader, A.vault, "set_signal_key", { public_key: sigKey.getPublicKey().toString() });
const signal = { v: 1, vault: A.vault, pair: "USDC/wNEAR", side: "buy", pct_nav_bps: 2500, type: "market", nonce: randomBytes(8).toString("hex") };
const sigHash = createHash("sha256").update(JSON.stringify(signal)).digest();
await call(A.operator, A.vault, "record_signal", {
  hash: sigHash.toString("hex"), leader_sig: "ed25519:" + base58.encode(sigKey.sign(sigHash).signature),
  fill_hash: createHash("sha256").update("fill:0").digest("hex"), executed_ms: msNow() - 1000,
});

// 6. follower withdraws 10,000,000 shares → burned at the next NAV
await call(A.follower, A.vault, "request_withdraw", { shares: "10000000", exit_account: A.follower });
const nav2 = await postNav("66000000");
const claims = await view<any[]>("get_claims", { from: 0, limit: 50 });
const claim = claims.at(-1)!;

// 7. real MPC signatures from the vault key
const nonce = () => randomBytes(32).toString("base64");
const deadline = new Date(msNow() + 10 * 60_000).toISOString();
const login = { message: JSON.stringify({ deadline, intents: [], signer_id: vaultAccount }), nonce: nonce(), recipient: "intents.near" };
const loginSig = await call(A.operator, A.vault, "sign_intent", { kind: "Login", payload: login, quote: null }, { gas: 300n * TGAS });

const depositAddress = randomBytes(32).toString("hex");
const payAmt = claim.amount as string;
const q = signTestQuote({
  originAsset: BASE_ID, destinationAsset: BASE_ID, amount: payAmt, minAmountOut: payAmt, slippageTolerance: 0,
  depositType: "CONFIDENTIAL_INTENTS", recipientType: "INTENTS", refundType: "CONFIDENTIAL_INTENTS",
  recipient: A.follower, refundTo: vaultAccount, depositAddress, deadline: new Date(msNow() + 15 * 60_000).toISOString(),
}, qKey);
const payout = { message: JSON.stringify({ deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [imt(BASE_ID)]: payAmt } }], signer_id: vaultAccount }), nonce: nonce(), recipient: "intents.far" };
const payoutSig = await call(A.operator, A.vault, "sign_intent", { kind: { Payout: { claim_id: claim.id } }, payload: payout, quote: q }, { gas: 300n * TGAS });

// a thief payout (recipient not the claim's exit account) must be refused
let thiefRefused = false;
try {
  const bad = signTestQuote({ ...JSON.parse(q.message), recipient: A.operator } as any, qKey);
  await call(A.operator, A.vault, "sign_intent", { kind: { Payout: { claim_id: claim.id } }, payload: { ...payout, nonce: nonce() }, quote: bad }, { gas: 300n * TGAS });
} catch (e) { thiefRefused = /exit account/.test(String(e)); console.log(`  ✓ thief payout refused: ${thiefRefused}`); }

const out = {
  ranAt: new Date().toISOString(), accounts: A, vaultAccount, mpcDerivedKey: mpcPk,
  afterDeposits: afterDeps, nav1, nav2, claim, loginSignature: loginSig, payoutSignature: payoutSig, thiefRefused,
  final: await view("get_vault"), txs,
};
writeFileSync("data/testnet-e2e.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ vaultAccount, final: out.final, claim, loginSig, payoutSig, thiefRefused }, null, 2));
