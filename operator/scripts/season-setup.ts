// Paper season on testnet: 4 demo vaults (momentum bot, mean-reversion bot,
// AI leader, manual leader) plus a drill vault (emergency build), all pointed
// at the real defuse verifier deployed on testnet (sp-intents-61557).
// Idempotent: each step checks chain state first.
//
//   npx tsx scripts/season-setup.ts
//
// Reads data/season-accounts.json (faucet accounts, keys in ~/.near-credentials).
// Writes data/season-keys.json (private, gitignored) and season/vaults.json (public).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { connect, keyStores, providers, KeyPair, type Account } from "near-api-js";
import { viewCall } from "../src/intents.js";

const RPC = "https://rpc.testnet.fastnear.com";
const USDC_T = "usdc.fakes.testnet";
const BASE_ID = `nep141:${USDC_T}`;
const INTENTS = "sp-intents-61557.testnet";
const TGAS = 1_000_000_000_000n;
const A = JSON.parse(readFileSync("data/season-accounts.json", "utf8")) as Record<string, string>;
const PREV = existsSync("season/vaults.json") ? JSON.parse(readFileSync("season/vaults.json", "utf8")) : {};
const K0 = JSON.parse(readFileSync("data/testnet-keys.json", "utf8"));
const KEYS = "data/season-keys.json";
const keys: Record<string, string> = existsSync(KEYS) ? JSON.parse(readFileSync(KEYS, "utf8")) : {};
const gen = (k: string) => (keys[k] ??= KeyPair.fromRandom("ed25519").toString());
gen("attestation");
keys.state ??= randomBytes(32).toString("hex");
const VAULTS = [
  { id: A.momo, leader: A.lmomo, strategy: "momentum", name: "Momentum bot", blurb: "Rule-based: long NEAR when the 1h EMA is above the 6h EMA, flat when below.", seed: [100, 300, 450], wasm: "near" },
  { id: A.meanrev, leader: A.lmeanrev, strategy: "mean-reversion", name: "Mean-reversion bot", blurb: "Rule-based: buys NEAR 1.5σ below its 6h mean, sells 1.5σ above.", seed: [120, 400, 300], wasm: "near" },
  { id: A.ai, leader: A.lai, strategy: "ai", name: "Allocator", blurb: "AI (NEAR AI Cloud): picks a NEAR weight 0–100% each epoch from momentum, volatility and its own reasoning.", seed: [100, 250, 350], wasm: "near" },
  { id: A.trend, leader: A.ltrend, strategy: "ai-trend", name: "Trend Rider", blurb: "AI: rides trends: high NEAR weight when 1h and 6h momentum agree, low when they turn.", seed: [100, 300, 200], wasm: "near" },
  { id: A.contra, leader: A.lcontra, strategy: "ai-contrarian", name: "Contrarian", blurb: "AI: fades extremes: buys sharp drops, trims spikes, drifts back to 40% mid-range.", seed: [100, 200, 300], wasm: "near" },
  { id: A.voltgt, leader: A.lvoltgt, strategy: "ai-voltarget", name: "Vol Target", blurb: "AI: sizes NEAR to a 40% annualised volatility target, 20–100% invested.", seed: [120, 300, 250], wasm: "near" },
  { id: A.convict, leader: A.lconvict, strategy: "ai-conviction", name: "Conviction", blurb: "AI: 50% NEAR baseline, tilting 20–80% by conviction.", seed: [100, 250, 250], wasm: "near" },
  { id: A.manual, leader: A.lmanual, strategy: "manual", name: "Steady Hand", blurb: "Run by a person, not a bot: every trade is signed by hand with the leader's key.", seed: [150, 300, 200], wasm: "near" },
  { id: A.drill, leader: A.ldrill, strategy: "drill", name: "Emergency drill", blurb: "Test build with a 5-minute NAV timeout, for the emergency-exit drill.", seed: [20, 80, 0], wasm: "drill" },
];
for (const v of VAULTS) gen(`signal:${v.id}`);
writeFileSync(KEYS, JSON.stringify(keys, null, 2));

const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) } as unknown as Parameters<typeof connect>[0]);
const txs: { step: string; tx: string }[] = [];
const view = <T>(c: string, m: string, a: object = {}) => viewCall<T>(RPC, c, m, a, fetch, "optimistic");
async function call(who: string, contractId: string, methodName: string, args: object, opts: { gas?: bigint; deposit?: bigint } = {}) {
  const a: Account = await near.account(who);
  const o = await a.functionCall({ contractId, methodName, args, gas: opts.gas ?? 100n * TGAS, attachedDeposit: opts.deposit ?? 0n });
  const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  txs.push({ step: `${who} → ${contractId}.${methodName}`, tx: o.transaction.hash });
  if (failure) throw new Error(`${methodName} failed (${o.transaction.hash}): ${JSON.stringify(failure).slice(0, 400)}`);
  console.log(`  ✓ ${who.padEnd(26)} ${methodName.padEnd(18)} ${o.transaction.hash}`);
  return providers.getTransactionLastResult(o) as any;
}
const qKey = KeyPair.fromString(K0.testQuote);
const att = KeyPair.fromString(keys.attestation as `ed25519:${string}`);
const followers = [A.alice, A.bob];

for (const v of VAULTS) {
  console.log(`\n${v.name} (${v.id})`);
  const acct = await near.account(v.id);
  // the drill vault is in emergency after its run: nothing more to set up
  if (v.strategy === "drill" && (await acct.state()).code_hash !== "11111111111111111111111111111111") continue;
  const initialized = await view<any>(v.id, "get_config").then(() => true, () => false);
  if ((await acct.state()).code_hash === "11111111111111111111111111111111") {
    const d = await acct.deployContract(readFileSync(new URL(`../../contract/target/${v.wasm}/silent_partner.wasm`, import.meta.url)));
    txs.push({ step: `deploy ${v.id} (${v.wasm === "drill" ? "drill build" : "release build"})`, tx: d.transaction.hash });
    console.log(`  ✓ deploy ${d.transaction.hash}`);
  }
  if (!initialized) {
    await call(v.id, v.id, "new", { cfg: {
      owner: v.id, operator: A.sop, leader: v.leader, base_token: USDC_T, base_asset_id: BASE_ID,
      intents_contract: INTENTS, mpc_contract: "v1.signer-prod.testnet", mpc_path: "silent-partner/vault",
      oneclick_key: qKey.getPublicKey().toString(), attestation_key: att.getPublicKey().toString(),
      perf_fee_bps: 2000, min_leader_bps: 1000, max_slippage_bps: 100, min_deposit: "1000000", allowed_assets: [BASE_ID, "nep141:wrap.testnet"],
      // vaults created after the NAV-bound work read the season's mock oracle from the start
      ...(PREV.oracle ? { nav_oracle: { contract: PREV.oracle.contract, price_id: PREV.oracle.price_id, max_age_s: PREV.oracle.max_age_s, tolerance_bps: PREV.oracle.tolerance_bps }, nav_quotes: null } : {}),
    } });
  }
  if (!(await view<any>(v.id, "get_vault")).vault_account) await call(A.sop, v.id, "activate", {}, { gas: 50n * TGAS });
  if (!(await view(USDC_T, "storage_balance_of", { account_id: v.id }))) await call(A.sop, USDC_T, "storage_deposit", { account_id: v.id }, { deposit: 1_250_000_000_000_000_000_000n, gas: 30n * TGAS });
  const sk = KeyPair.fromString(keys[`signal:${v.id}`] as `ed25519:${string}`).getPublicKey().toString();
  if ((await view<string | null>(v.id, "get_signal_key")) !== sk) await call(v.leader, v.id, "set_signal_key", { public_key: sk }, { gas: 30n * TGAS });
  const holders = [v.leader, ...followers];
  for (let i = 0; i < holders.length; i++) {
    const amt = BigInt(v.seed[i]) * 1_000_000n;
    if (amt === 0n) continue;
    const [shares] = await view<[string, string]>(v.id, "get_shares", { account_id: holders[i] });
    if (BigInt(shares) > 0n) continue;
    if (!(await view(USDC_T, "storage_balance_of", { account_id: holders[i] }))) await call(holders[i], USDC_T, "storage_deposit", { account_id: holders[i] }, { deposit: 1_250_000_000_000_000_000_000n, gas: 30n * TGAS });
    await call(holders[i], USDC_T, "mint", { account_id: holders[i], amount: amt.toString() }, { gas: 30n * TGAS });
    await call(holders[i], USDC_T, "ft_transfer_call", { receiver_id: v.id, amount: amt.toString(), msg: "" }, { deposit: 1n, gas: 150n * TGAS });
  }
}

const pub: Record<string, unknown> = {
  network: "testnet", mode: "paper", operator: A.sop, intents_contract: INTENTS, base: BASE_ID, risk: "nep141:wrap.testnet",
  followers, createdAt: PREV.createdAt ?? new Date().toISOString(),
  vaults: VAULTS.map(({ id, leader, strategy, name, blurb }) => ({ id, leader, strategy, name, blurb })),
};
if (PREV.oracle) pub.oracle = PREV.oracle; // keep the NAV-bound oracle config
writeFileSync("season/vaults.json", JSON.stringify(pub, null, 2) + "\n");
const log = existsSync("data/season-setup-txs.json") ? JSON.parse(readFileSync("data/season-setup-txs.json", "utf8")) : [];
writeFileSync("data/season-setup-txs.json", JSON.stringify([...log, ...txs], null, 2));
console.log(`\n${txs.length} txs; wrote season/vaults.json`);
