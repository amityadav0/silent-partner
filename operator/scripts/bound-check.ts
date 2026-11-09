// Testnet check of the NAV bound on a migrated season vault: the operator's own
// attestation key signs an inflated NAV (+20% with NEAR flat). The contract reads
// the oracle and refuses it; nothing changes on-chain. (Run between season ticks.)
//   npx tsx scripts/bound-check.ts [vault] [factor]
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { NearVault, NavRejected } from "../src/chain.js";
import { navMessage } from "../src/operator.js";
import { viewCall } from "../src/intents.js";
import { MockFeed, coingeckoNearUsd } from "../src/oracle.js";

const RPC = "https://rpc.testnet.fastnear.com";
const vault = process.argv[2] ?? "sp-meanrev-92991.testnet";
const factor = Number(process.argv[3] ?? "1.2");
const S = JSON.parse(readFileSync("season/vaults.json", "utf8"));
const K = JSON.parse(readFileSync("data/season-keys.json", "utf8"));
const opKey = JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${S.operator}.json`, "utf8")).private_key;
const chain = new NearVault(vault, RPC, "testnet", S.operator, opKey);
const view = <T>(m: string, a: object = {}) => viewCall<T>(RPC, vault, m, a, fetch, "optimistic");
// a fresh oracle price (same public source the season uses)
const usd = await coingeckoNearUsd();
const pushed = await new MockFeed(RPC, S.oracle.contract, S.oracle.writer, K.oracleWriter).push(usd);
const before = await view<any>("get_vault");
const band = await view<[number, number] | null>("nav_band", { price: pushed.price });
const lie = BigInt(Math.round(Number(before.book_nav) * factor)).toString();
const epoch = before.epoch + 1, ts = Date.now() - 1000, head = "00".repeat(32);
const sig = "ed25519:" + base58.encode(KeyPair.fromString(K.attestation).sign(new TextEncoder().encode(navMessage(vault, epoch, lie, ts, head))).signature);
let result: Record<string, unknown>;
try {
  const tx = await chain.postNav(epoch, lie, ts, head, sig);
  result = { accepted: true, tx };
} catch (e) {
  result = e instanceof NavRejected ? { accepted: false, tx: e.tx, log: e.log } : { error: String(e) };
}
const after = await view<any>("get_vault");
const out = { ranAt: new Date().toISOString(), vault, oracle_tx: pushed.tx, near_usd: usd, band_bps: band, book_nav: before.book_nav, posted_nav: lie, factor, result, unchanged: after.epoch === before.epoch && after.book_nav === before.book_nav };
writeFileSync("data/bound-check.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
