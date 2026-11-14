// One season tick for the Majors vault only, outside the CI loop (first post after setup, or to
// check the multi-asset path by hand). Reads and writes the sealed state in SEASON_STATE_DIR.
//   SEASON_STATE_DIR=../season-state npx tsx scripts/majors-tick.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { NearVault } from "../src/chain.js";
import { Confidential } from "../src/confidential.js";
import { FillLog } from "../src/filllog.js";
import { Operator } from "../src/operator.js";
import { loadEnv } from "../src/config.js";
import { sealDir, unsealDir } from "../src/season/state.js";
import { tick } from "../src/season/tick.js";
import { communityKeys } from "../src/season/community.js";
import { changes24h, majors } from "../src/leaders/majors.js";
import { blockedBasket, lastTradeMs } from "../src/season/turnover.js";

const S = JSON.parse(readFileSync("season/vaults.json", "utf8"));
const keys = JSON.parse(readFileSync("data/season-keys.json", "utf8"));
const sealed = process.env.SEASON_STATE_DIR ?? "../season-state";
const plain = "data/season-majors";
const V = S.vaults.find((v: { strategy: string }) => v.strategy === "majors").id as string;
unsealDir(join(sealed, "state"), plain, keys.state);
const env = loadEnv({ NEAR_NETWORK: "testnet", DRY_RUN: "1", CHAIN_WRITES: "1" });
const opKey = JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${S.operator}.json`, "utf8")).private_key;
const chain = new NearVault(V, env.rpc, "testnet", S.operator, opKey);
const va = (await chain.getVault()).vault_account!;
const fills = `fills-${V}.jsonl`, notes = `notes-${V}.jsonl`;
const log = new FillLog(V, join(plain, fills));
const op = new Operator(chain, new Confidential(env.oneclickUrl, "", fetch, undefined, true), log, KeyPair.fromString(keys.attestation), "ed25519:" + base58.encode(Buffer.from(va, "hex")), env.op);
const data = await changes24h();
const last = lastTradeMs(log.entries);
const r = await tick({
  op, vault: V, base: S.base, risk: S.risk, notesPath: join(plain, notes), signalKey: communityKeys(keys.state).signalSecret,
  decideBasket: async () => majors(data), allowBasket: (current, targets) => blockedBasket({ current, targets, lastTradeMs: last, nowMs: Date.now() }),
});
sealDir(plain, join(sealed, "state"), [fills, notes], keys.state);
console.log(JSON.stringify({ changes: data, result: r }, null, 1));
