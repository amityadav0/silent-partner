// Season vaults get the NAV bound (item 2 of the Nov 9 follow-ups):
//   1. deploy oracle-mock (Pyth-compatible) at oracle.<lai>, writer feed.<lai>
//   2. push a first NEAR/USD price
//   3. upgrade each season vault in one transaction: deploy the current
//      contract + migrate_v1({nav_oracle}) — atomic, so a failed migration
//      leaves the old code and state in place.
// Writes the oracle config into season/vaults.json and the writer key into
// data/season-keys.json (→ repo secret SEASON_ORACLE_KEY).
//   npx tsx scripts/season-oracle-setup.ts
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { connect, keyStores, transactions, KeyPair } from "near-api-js";
import { viewCall } from "../src/intents.js";
import { MockFeed, NEAR_USD_FEED, coingeckoNearUsd } from "../src/oracle.js";

const RPC = "https://rpc.testnet.fastnear.com";
const A = JSON.parse(readFileSync("data/season-accounts.json", "utf8")) as Record<string, string>;
const S = JSON.parse(readFileSync("season/vaults.json", "utf8"));
const keys = JSON.parse(readFileSync("data/season-keys.json", "utf8"));
const ORACLE = `oracle.${A.lai}`, WRITER = `feed.${A.lai}`;
const ks = new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`);
const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: ks } as unknown as Parameters<typeof connect>[0]);
const view = <T>(c: string, m: string, a: object = {}) => viewCall<T>(RPC, c, m, a, fetch, "optimistic");
const txs: { step: string; tx: string }[] = [];
const ok = (step: string, o: any) => {
  const f = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  txs.push({ step, tx: o.transaction.hash });
  if (f) throw new Error(`${step} failed (${o.transaction.hash}): ${JSON.stringify(f).slice(0, 300)}`);
  console.log(`  ✓ ${step.padEnd(48)} ${o.transaction.hash}`);
};
const exists = async (id: string) => (await near.connection.provider.query({ request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false));

// 1. accounts + oracle
const lai = await near.account(A.lai);
for (const [id, amount] of [[ORACLE, 2n], [WRITER, 1n]] as const) {
  if (await exists(id)) continue;
  const kp = KeyPair.fromRandom("ed25519");
  await ks.setKey("testnet", id, kp);
  ok(`create ${id}`, await lai.createAccount(id, kp.getPublicKey(), amount * 10n ** 24n));
  if (id === WRITER) keys.oracleWriter = kp.toString();
}
if (!keys.oracleWriter) keys.oracleWriter = (await ks.getKey("testnet", WRITER))!.toString();
writeFileSync("data/season-keys.json", JSON.stringify(keys, null, 2));
const oa = await near.account(ORACLE);
if ((await oa.state()).code_hash === "11111111111111111111111111111111") {
  ok("deploy oracle-mock", await oa.deployContract(readFileSync(new URL("../../oracle-mock/target/near/oracle_mock.wasm", import.meta.url))));
  ok("init oracle-mock", await oa.functionCall({ contractId: ORACLE, methodName: "new", args: { writer: WRITER }, gas: 30_000_000_000_000n }));
}

// 2. first price
const usd = await coingeckoNearUsd();
const p = await new MockFeed(RPC, ORACLE, WRITER, keys.oracleWriter).push(usd);
txs.push({ step: `writer: set NEAR/USD ${usd}`, tx: p.tx });
console.log(`  ✓ set_price ${usd}  ${p.tx}`);

// 3. upgrade + migrate the season vaults (not the drill vault)
const navOracle = { contract: ORACLE, price_id: NEAR_USD_FEED, max_age_s: 300, tolerance_bps: 50 };
const wasm = readFileSync(new URL("../../contract/target/near/silent_partner.wasm", import.meta.url));
for (const v of S.vaults.filter((v: any) => v.strategy !== "drill")) {
  const cfg = await view<any>(v.id, "get_config");
  if (cfg.nav_oracle) { console.log(`  ${v.id}: already migrated`); continue; }
  const acct = await near.account(v.id);
  const o = await acct.signAndSendTransaction({ receiverId: v.id, actions: [transactions.deployContract(wasm), transactions.functionCall("migrate_v1", { nav_oracle: navOracle }, 100_000_000_000_000n, 0n)] });
  ok(`upgrade + migrate_v1 ${v.id}`, o);
  const after = await view<any>(v.id, "get_vault");
  console.log(`    epoch ${after.epoch}, shares ${after.total_shares}, oracle ${(await view<any>(v.id, "get_config")).nav_oracle.contract}`);
}
S.oracle = { ...navOracle, writer: WRITER, kind: "mock (Pyth-compatible), fed from CoinGecko by the season job" };
writeFileSync("season/vaults.json", JSON.stringify(S, null, 2) + "\n");
const prev = JSON.parse(readFileSync("data/season-setup-txs.json", "utf8"));
writeFileSync("data/season-setup-txs.json", JSON.stringify([...prev, ...txs], null, 2));
