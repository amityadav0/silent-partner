// Benchmark vaults (T3): "Hold NEAR" (100% NEAR, never sells) and "Half & Half" (50/50,
// rebalanced weekly), as house vaults under the season operator. Same contract build and
// config as the season vaults (copied from the template vault), led by two house leader
// accounts whose signal key is the season's derived signer, so no new CI secret is needed.
// Idempotent: every step checks chain state first.
//
//   npx tsx scripts/bench-setup.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { connect, keyStores, transactions, providers, KeyPair, type Account } from "near-api-js";
import { viewCall } from "../src/intents.js";
import { communityKeys } from "../src/season/community.js";

const RPC = "https://rpc.testnet.fastnear.com";
const TGAS = 1_000_000_000_000n, NEAR = 10n ** 24n;
const S = JSON.parse(readFileSync("season/vaults.json", "utf8"));
const OP: string = S.operator, USDC = S.base.replace(/^nep141:/, "");
const keys = JSON.parse(readFileSync("data/season-keys.json", "utf8"));
const ck = communityKeys(keys.state);
const credDir = `${homedir()}/.near-credentials/testnet`;
const ks = new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`);
const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: ks } as unknown as Parameters<typeof connect>[0]);
const view = <T>(c: string, m: string, a: object = {}) => viewCall<T>(RPC, c, m, a, fetch, "optimistic");
const exists = async (id: string) => (await (near.connection.provider as providers.JsonRpcProvider).query({ request_type: "view_account", finality: "optimistic", account_id: id }).then(() => true, () => false));
const txs: string[] = [];
async function call(who: string, contractId: string, methodName: string, args: object, gas = 100n * TGAS, deposit = 0n) {
  const a: Account = await near.account(who);
  const o = await a.functionCall({ contractId, methodName, args, gas, attachedDeposit: deposit });
  const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  if (failure) throw new Error(`${methodName} (${o.transaction.hash}): ${JSON.stringify(failure).slice(0, 300)}`);
  txs.push(o.transaction.hash);
  console.log(`  ✓ ${who.padEnd(30)} ${contractId}.${methodName} ${o.transaction.hash}`);
  return o;
}

// Spare testnet NEAR from old test accounts that are no longer listed (D-T-3).
const SPARE: [string, bigint][] = [["sp-vault2-61557.testnet", 5n * NEAR], ["sp-drill-92991.testnet", 4n * NEAR]];
const BENCH = [
  { id: `hold.${OP}`, leader: `lhold.${OP}`, strategy: "hold", name: "Hold NEAR", blurb: "Benchmark: 100% NEAR from day one. Buys only to invest new deposits; never sells.", seed: [100, 300, 250] },
  { id: `half.${OP}`, leader: `lhalf.${OP}`, strategy: "half", name: "Half & Half", blurb: "Benchmark: 50% NEAR, 50% USDC, rebalanced once a week.", seed: [100, 300, 250] },
];
const followers: string[] = S.followers;

const opAcct = await near.account(OP);
if (!BENCH.every((b) => existsSync(`${credDir}/${b.leader}.json`)) || !(await Promise.all(BENCH.map((b) => exists(b.id)))).every(Boolean)) {
  for (const [from, amt] of SPARE) {
    const o = await (await near.account(from)).sendMoney(OP, amt);
    txs.push(o.transaction.hash);
    console.log(`  ✓ ${from} → ${OP} ${amt / NEAR} NEAR ${o.transaction.hash}`);
  }
}
const template = await view<Record<string, unknown>>(S.community.template, "get_config");
const wasm = readFileSync(new URL("../season/vault.wasm", import.meta.url));

for (const b of BENCH) {
  console.log(`\n${b.name} (${b.id})`);
  // house leader account, key kept locally (gitignored) like the other season leaders
  if (!(await exists(b.leader))) {
    const kp = KeyPair.fromRandom("ed25519");
    mkdirSync(credDir, { recursive: true });
    writeFileSync(`${credDir}/${b.leader}.json`, JSON.stringify({ account_id: b.leader, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }));
    keys[`leader:${b.leader}`] = kp.toString();
    writeFileSync("data/season-keys.json", JSON.stringify(keys, null, 2));
    const r = await opAcct.signAndSendTransaction({ receiverId: b.leader, actions: [transactions.createAccount(), transactions.transfer(NEAR / 2n), transactions.addKey(kp.getPublicKey(), transactions.fullAccessKey())] });
    txs.push(r.transaction.hash);
    console.log(`  ✓ create ${b.leader} ${r.transaction.hash}`);
  }
  const cfg = { ...template, owner: OP, leader: b.leader };
  if (!(await exists(b.id))) {
    const r = await opAcct.signAndSendTransaction({ receiverId: b.id, actions: [transactions.createAccount(), transactions.transfer(45n * NEAR / 10n), transactions.deployContract(wasm), transactions.functionCall("new", { cfg }, 100n * TGAS, 0n)] });
    const failure = (r.receipts_outcome as any[]).map((x) => x.outcome.status?.Failure).find(Boolean);
    if (failure) throw new Error(`create ${b.id} (${r.transaction.hash}): ${JSON.stringify(failure).slice(0, 300)}`);
    txs.push(r.transaction.hash);
    console.log(`  ✓ create + deploy + new ${b.id} ${r.transaction.hash}`);
  }
  if (!(await view<{ vault_account: string | null }>(b.id, "get_vault")).vault_account) await call(OP, b.id, "activate", {}, 50n * TGAS);
  if (!(await view(USDC, "storage_balance_of", { account_id: b.id }))) await call(OP, USDC, "storage_deposit", { account_id: b.id }, 30n * TGAS, 1_250_000_000_000_000_000_000n);
  if ((await view<string | null>(b.id, "get_signal_key")) !== ck.signalPublic) await call(b.leader, b.id, "set_signal_key", { public_key: ck.signalPublic }, 30n * TGAS);
  const holders = [b.leader, ...followers];
  for (let i = 0; i < holders.length; i++) {
    const amt = BigInt(b.seed[i]) * 1_000_000n;
    const [shares] = await view<[string, string]>(b.id, "get_shares", { account_id: holders[i] });
    if (BigInt(shares) > 0n) continue;
    if (!(await view(USDC, "storage_balance_of", { account_id: holders[i] }))) await call(holders[i], USDC, "storage_deposit", { account_id: holders[i] }, 30n * TGAS, 1_250_000_000_000_000_000_000n);
    await call(holders[i], USDC, "mint", { account_id: holders[i], amount: amt.toString() }, 30n * TGAS);
    await call(holders[i], USDC, "ft_transfer_call", { receiver_id: b.id, amount: amt.toString(), msg: "" }, 150n * TGAS, 1n);
  }
}

// List them in the season (keeps every other field of vaults.json as it is).
for (const b of BENCH) if (!S.vaults.some((v: { id: string }) => v.id === b.id)) S.vaults.splice(S.vaults.findIndex((v: { strategy: string }) => v.strategy === "drill"), 0, { id: b.id, leader: b.leader, strategy: b.strategy, name: b.name, blurb: b.blurb });
S.auto_topup = [...new Set([...(S.auto_topup ?? []), ...BENCH.map((b) => b.id)])];
writeFileSync("season/vaults.json", JSON.stringify(S, null, 2) + "\n");
const log = existsSync("data/season-setup-txs.json") ? JSON.parse(readFileSync("data/season-setup-txs.json", "utf8")) : [];
writeFileSync("data/season-setup-txs.json", JSON.stringify([...log, ...txs.map((tx) => ({ step: "bench-setup", tx }))], null, 2));
console.log(`\n${txs.length} txs; season/vaults.json lists ${BENCH.map((b) => b.name).join(" and ")}`);
