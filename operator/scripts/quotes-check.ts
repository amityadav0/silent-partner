// Testnet run of the 1Click-quote NAV price (follow-up item 1): a vault whose
// oneclick_key is 1Click's real key and whose nav_quotes price the mainnet
// USDC/wNEAR pair. Each post carries two real, public 1Click dry quotes,
// signed by 1Click, verified on-chain. Honest posts pass; a +20% post is refused.
//   npx tsx scripts/quotes-check.ts
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { connect, keyStores, providers, KeyPair, type Account } from "near-api-js";
import { base58 } from "@scure/base";
import { NearVault, NavRejected } from "../src/chain.js";
import { Confidential } from "../src/confidential.js";
import { FillLog } from "../src/filllog.js";
import { Operator, navMessage } from "../src/operator.js";
import { loadEnv } from "../src/config.js";
import { USDC, WNEAR, viewCall } from "../src/intents.js";

const RPC = "https://rpc.testnet.fastnear.com";
const A = JSON.parse(readFileSync("data/season-accounts.json", "utf8")) as Record<string, string>;
const K = JSON.parse(readFileSync("data/season-keys.json", "utf8"));
// argv[2]: vault account (default: the second run's vault, after the band review fixes)
const VAULT = process.argv[2] ?? `quotes2.${A.lmomo}`, LEADER = VAULT.split(".").slice(1).join("."), OP = A.sop;
const USDC_T = "usdc.fakes.testnet";
const TGAS = 1_000_000_000_000n;
const ONECLICK_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";
const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) } as unknown as Parameters<typeof connect>[0]);
const view = <T>(m: string, a: object = {}) => viewCall<T>(RPC, VAULT, m, a, fetch, "optimistic");
const txs: { step: string; tx: string; note?: string }[] = [];
async function call(step: string, who: string, contractId: string, methodName: string, args: object, opts: { gas?: bigint; deposit?: bigint } = {}) {
  const a: Account = await near.account(who);
  const o = await a.functionCall({ contractId, methodName, args, gas: opts.gas ?? 100n * TGAS, attachedDeposit: opts.deposit ?? 0n });
  const f = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  txs.push({ step, tx: o.transaction.hash });
  if (f) throw new Error(`${methodName} failed (${o.transaction.hash}): ${JSON.stringify(f).slice(0, 300)}`);
  console.log(`  ✓ ${step.padEnd(40)} ${o.transaction.hash}`);
  return providers.getTransactionLastResult(o);
}

const acct = await near.account(VAULT);
if ((await acct.state()).code_hash === "11111111111111111111111111111111") {
  const d = await acct.deployContract(readFileSync(new URL("../../contract/target/near/silent_partner.wasm", import.meta.url)));
  txs.push({ step: "deploy", tx: d.transaction.hash });
  await call("init (oneclick_key = 1Click's real key)", VAULT, VAULT, "new", { cfg: {
    owner: VAULT, operator: OP, leader: LEADER, base_token: USDC_T, base_asset_id: `nep141:${USDC_T}`, intents_contract: "sp-intents-61557.testnet",
    mpc_contract: "v1.signer-prod.testnet", mpc_path: "silent-partner/vault", oneclick_key: ONECLICK_KEY, attestation_key: KeyPair.fromString(K.attestation).getPublicKey().toString(),
    perf_fee_bps: 2000, min_leader_bps: 1000, max_slippage_bps: 100, min_deposit: "1000000", allowed_assets: [`nep141:${USDC_T}`, "nep141:wrap.testnet"],
    nav_oracle: null, nav_quotes: { base_id: USDC, risk_id: WNEAR, max_age_ms: 120_000, tolerance_bps: 25, max_spread_bps: 40, min_interval_ms: 60_000, window_up_bps: 200 },
  } });
  await call("activate (MPC)", OP, VAULT, "activate", {}, { gas: 50n * TGAS });
  await call("storage on fake USDC", OP, USDC_T, "storage_deposit", { account_id: VAULT }, { deposit: 1_250_000_000_000_000_000_000n, gas: 30n * TGAS });
  await call("leader: mint 10 USDC", LEADER, USDC_T, "mint", { account_id: LEADER, amount: "10000000" }, { gas: 30n * TGAS });
  await call("leader: deposit 10 USDC", LEADER, USDC_T, "ft_transfer_call", { receiver_id: VAULT, amount: "10000000", msg: "" }, { deposit: 1n, gas: 150n * TGAS });
}
const opKey = JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${OP}.json`, "utf8")).private_key;
const chain = new NearVault(VAULT, RPC, "testnet", OP, opKey);
const va = (await chain.getVault()).vault_account!;
const env = loadEnv({ NEAR_NETWORK: "testnet", DRY_RUN: "1" });
const op = new Operator(chain, new Confidential(env.oneclickUrl, "", fetch, ONECLICK_KEY, true), new FillLog(VAULT, null), KeyPair.fromString(K.attestation), "ed25519:" + base58.encode(Buffer.from(va, "hex")), env.op);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastQuotes: Awaited<ReturnType<typeof op.priceQuotes>>;
async function post(label: string, factor: number, reuse = false) {
  const v = await chain.getVault();
  const nav = BigInt(Math.round(Number(v.book_nav) * factor)).toString();
  const quotes = reuse && lastQuotes ? lastQuotes : (await op.priceQuotes())!;
  lastQuotes = quotes;
  const facts = quotes.map((q) => { const m = JSON.parse(q.message); return { from: m.originAsset.slice(0, 14), in: m.amountIn, out: m.amountOut, timestamp: m.timestamp }; });
  const point = await view<any>("price_from_quotes", { price_quotes: quotes });
  const band = await view<[number, number] | null>("nav_band", { point });
  const epoch = v.epoch + 1, ts = Date.now() - 1000, head = "00".repeat(32);
  const sig = "ed25519:" + base58.encode(KeyPair.fromString(K.attestation).sign(new TextEncoder().encode(navMessage(VAULT, epoch, nav, ts, head))).signature);
  let r: Record<string, unknown>;
  try {
    const tx = await chain.postNav(epoch, nav, ts, head, sig, quotes);
    r = { accepted: true, tx };
  } catch (e) {
    r = e instanceof NavRejected ? { accepted: false, tx: e.tx, log: e.log } : { error: String(e).slice(0, 300) };
  }
  const after = await chain.getVault();
  const out = { label, factor, book_nav: v.book_nav, posted_nav: nav, quotes: facts, half_spread_bps: point.half_spread_bps, band_bps: band, ...r, epoch_after: after.epoch };
  console.log(JSON.stringify(out));
  if (r.tx) txs.push({ step: label, tx: String(r.tx), note: r.accepted ? "accepted" : String(r.log ?? r.error) });
  return out;
}
const runs = [await post("post 1: honest (checked against the book price)", 1)];
await sleep(62_000);
runs.push(await post("post 2: honest", 1));
await sleep(62_000);
runs.push(await post("post 3: +20% inflated", 1.2));
runs.push(await post("post 4: honest again", 1));
await sleep(62_000);
runs.push(await post("post 5: re-uses post 4's quotes", 1, true));
writeFileSync("data/quotes-check.json", JSON.stringify({ ranAt: new Date().toISOString(), vault: VAULT, runs, txs }, null, 2));
