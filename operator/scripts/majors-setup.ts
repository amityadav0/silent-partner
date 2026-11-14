// "Majors" (T6): the first multi-asset vault, on testnet in the paper season. Holds any mix of
// BTC, ETH, SOL and NEAR against USDC; NAV posts are bounded by 1Click-signed quotes for all
// four (set_nav_basket), verified with 1Click's real key (the season's dry quotes are signed
// by 1Click), so the bound is the mainnet one even on testnet. House leader, house signer.
// Idempotent.
//   npx tsx scripts/majors-setup.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { connect, keyStores, transactions, providers, KeyPair, type Account } from "near-api-js";
import { viewCall, BTC, ETH, SOL, USDC, WNEAR } from "../src/intents.js";
import { communityKeys } from "../src/season/community.js";
import { ONE_CLICK_MANAGER_PUB_KEY } from "../src/carry/signedQuote.js";

const RPC = "https://rpc.testnet.fastnear.com";
const TGAS = 1_000_000_000_000n, NEAR = 10n ** 24n;
const S = JSON.parse(readFileSync("season/vaults.json", "utf8"));
const OP: string = S.operator, USDC_T = S.base.replace(/^nep141:/, "");
const VAULT = `majors.${OP}`, LEADER = `lmajors.${OP}`;
const keys = JSON.parse(readFileSync("data/season-keys.json", "utf8"));
const ck = communityKeys(keys.state);
const credDir = `${homedir()}/.near-credentials/testnet`;
const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) } as unknown as Parameters<typeof connect>[0]);
const view = <T>(c: string, m: string, a: object = {}) => viewCall<T>(RPC, c, m, a, fetch, "optimistic");
const exists = (id: string) => (near.connection.provider as providers.JsonRpcProvider).query({ request_type: "view_account", finality: "optimistic", account_id: id }).then(() => true, () => false);
const txs: string[] = [];
async function call(who: string, contractId: string, methodName: string, args: object, gas = 100n * TGAS, deposit = 0n) {
  const o = await (await near.account(who)).functionCall({ contractId, methodName, args, gas, attachedDeposit: deposit });
  const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  if (failure) throw new Error(`${methodName} (${o.transaction.hash}): ${JSON.stringify(failure).slice(0, 300)}`);
  txs.push(o.transaction.hash);
  console.log(`  ✓ ${who.padEnd(30)} ${contractId}.${methodName} ${o.transaction.hash}`);
}
const op: Account = await near.account(OP);

if (!(await exists(VAULT))) {
  // spare testnet NEAR from house leader accounts that only sign (they keep ≥ 0.9 NEAR)
  for (const [from, amt] of [["sp-lmanual-92991.testnet", 3n * NEAR], ["sp-lmeanrev-92991.testnet", 1n * NEAR], ["sp-vault2-61557.testnet", 1n * NEAR]] as [string, bigint][]) {
    const o = await (await near.account(from)).sendMoney(OP, amt);
    txs.push(o.transaction.hash);
    console.log(`  ✓ ${from} → ${OP} ${amt / NEAR} NEAR`);
  }
}
if (!(await exists(LEADER))) {
  const kp = KeyPair.fromRandom("ed25519");
  mkdirSync(credDir, { recursive: true });
  writeFileSync(`${credDir}/${LEADER}.json`, JSON.stringify({ account_id: LEADER, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }));
  keys[`leader:${LEADER}`] = kp.toString();
  writeFileSync("data/season-keys.json", JSON.stringify(keys, null, 2));
  const r = await op.signAndSendTransaction({ receiverId: LEADER, actions: [transactions.createAccount(), transactions.transfer(NEAR / 2n), transactions.addKey(kp.getPublicKey(), transactions.fullAccessKey())] });
  txs.push(r.transaction.hash);
  console.log(`  ✓ create ${LEADER}`);
}
const template = await view<Record<string, unknown>>(S.community.template, "get_config");
const cfg = {
  ...template, owner: OP, leader: LEADER, oneclick_key: ONE_CLICK_MANAGER_PUB_KEY, nav_oracle: null, nav_quotes: null,
  allowed_assets: [S.base, "nep141:wrap.testnet", BTC, ETH, SOL],
};
if (!(await exists(VAULT))) {
  const wasm = readFileSync(new URL("../../contract/target/near/silent_partner.wasm", import.meta.url));
  const r = await op.signAndSendTransaction({ receiverId: VAULT, actions: [transactions.createAccount(), transactions.transfer(5n * NEAR), transactions.deployContract(wasm), transactions.functionCall("new", { cfg }, 100n * TGAS, 0n)] });
  const failure = (r.receipts_outcome as any[]).map((x) => x.outcome.status?.Failure).find(Boolean);
  if (failure) throw new Error(`create ${VAULT}: ${JSON.stringify(failure).slice(0, 300)}`);
  txs.push(r.transaction.hash);
  console.log(`  ✓ create + deploy + new ${VAULT} ${r.transaction.hash}`);
}
if (!(await view<{ vault_account: string | null }>(VAULT, "get_vault")).vault_account) await call(OP, VAULT, "activate", {}, 50n * TGAS);
if (!(await view(VAULT, "get_nav_basket"))) {
  await call(OP, VAULT, "set_nav_basket", { basket: { base_id: USDC, risk_ids: [WNEAR, BTC, ETH, SOL], max_age_ms: 300_000, tolerance_bps: 50, max_spread_bps: 100, min_interval_ms: 60_000, window_up_bps: 300 } }, 30n * TGAS);
}
if (!(await view(USDC_T, "storage_balance_of", { account_id: VAULT }))) await call(OP, USDC_T, "storage_deposit", { account_id: VAULT }, 30n * TGAS, 1_250_000_000_000_000_000_000n);
if ((await view<string | null>(VAULT, "get_signal_key")) !== ck.signalPublic) await call(LEADER, VAULT, "set_signal_key", { public_key: ck.signalPublic }, 30n * TGAS);
const holders: [string, bigint][] = [[LEADER, 100n], [S.followers[0], 300n], [S.followers[1], 250n]];
for (const [who, usd] of holders) {
  const amt = usd * 1_000_000n;
  if (BigInt((await view<[string, string]>(VAULT, "get_shares", { account_id: who }))[0]) > 0n) continue;
  if (!(await view(USDC_T, "storage_balance_of", { account_id: who }))) await call(who, USDC_T, "storage_deposit", { account_id: who }, 30n * TGAS, 1_250_000_000_000_000_000_000n);
  await call(who, USDC_T, "mint", { account_id: who, amount: amt.toString() }, 30n * TGAS);
  await call(who, USDC_T, "ft_transfer_call", { receiver_id: VAULT, amount: amt.toString(), msg: "" }, 150n * TGAS, 1n);
}
if (!S.vaults.some((v: { id: string }) => v.id === VAULT)) {
  S.vaults.splice(S.vaults.findIndex((v: { strategy: string }) => v.strategy === "drill"), 0, { id: VAULT, leader: LEADER, strategy: "majors", name: "Majors", blurb: "Bot: holds whichever of BTC, ETH, SOL and NEAR are up over 24 hours, equal weights, 80% at most." });
}
S.auto_topup = [...new Set([...(S.auto_topup ?? []), VAULT])];
writeFileSync("season/vaults.json", JSON.stringify(S, null, 2) + "\n");
const log = existsSync("data/season-setup-txs.json") ? JSON.parse(readFileSync("data/season-setup-txs.json", "utf8")) : [];
writeFileSync("data/season-setup-txs.json", JSON.stringify([...log, ...txs.map((tx) => ({ step: "majors-setup", tx }))], null, 2));
console.log(`\n${txs.length} txs; ${VAULT} listed`);
