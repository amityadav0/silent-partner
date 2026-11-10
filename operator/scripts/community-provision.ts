// Deploy pending open-season launches now, without waiting for the next season tick.
// The season does the same at the start of every tick (scripts/season.ts).
//   npx tsx scripts/community-provision.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { communityKeys } from "../src/season/community.js";
import { launches, operatorAccount, provision } from "../src/season/provision.js";

const RPC = process.env.NEAR_RPC_URL || "https://rpc.testnet.fastnear.com";
const S = JSON.parse(readFileSync("season/vaults.json", "utf8"));
const local = existsSync("data/season-keys.json") ? JSON.parse(readFileSync("data/season-keys.json", "utf8")) : {};
const opKey = process.env.SEASON_OPERATOR_KEY || JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${S.operator}.json`, "utf8")).private_key;
const ck = communityKeys(process.env.SEASON_STATE_KEY || local.state);
const ctx = { rpc: RPC, operator: S.operator, operatorKey: opKey, registry: S.community.registry, template: S.community.template, usdc: S.base.replace(/^nep141:/, ""), wasm: readFileSync(new URL("../season/vault.wasm", import.meta.url)), sealSk: ck.sealSk };
const a = await operatorAccount(RPC, S.operator, opKey);
for (const l of (await launches(RPC, ctx.registry)).filter((l) => l.status === "pending")) {
  const r = await provision(ctx, a, l);
  console.log(JSON.stringify({ launch: l.id, name: l.name, ...r }));
}
