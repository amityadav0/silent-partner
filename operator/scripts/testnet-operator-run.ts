// Run the operator (dry 1Click, real testnet chain writes) against the testnet vault.
//   npx tsx --env-file-if-exists=../.env scripts/testnet-operator-run.ts
// Uses data/testnet-accounts.json + data/testnet-keys.json and the operator's
// key from ~/.near-credentials. Prints tx hashes only.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { NearVault } from "../src/chain.js";
import { Confidential } from "../src/confidential.js";
import { FillLog } from "../src/filllog.js";
import { Operator } from "../src/operator.js";
import { loadEnv } from "../src/config.js";
import { signSignal } from "../src/signal.js";

const A = JSON.parse(readFileSync("data/testnet-accounts.json", "utf8"));
const K = JSON.parse(readFileSync("data/testnet-keys.json", "utf8"));
const opKey = JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${A.operator}.json`, "utf8")).private_key;
const env = loadEnv({ ...process.env, NEAR_NETWORK: "testnet", DRY_RUN: "1" });
const chain = new NearVault(A.vault, env.rpc, "testnet", A.operator, opKey);
const v = await chain.getVault();
const log = new FillLog(A.vault, `data/fills-${A.vault}.jsonl`);
const op = new Operator(chain, new Confidential(env.oneclickUrl, env.oneclickJwt), log, KeyPair.fromString(K.attestation), "ed25519:" + base58.encode(Buffer.from(v.vault_account!, "hex")), env.op);

const out: Record<string, unknown> = { ranAt: new Date().toISOString(), before: v };
out.epochA = await op.epoch();
console.log("epoch A", out.epochA);
const sig = signSignal({ v: 1, vault: A.vault, from: "nep141:usdc.fakes.testnet", to: "nep141:wrap.testnet", size_bps: 3000, type: "market", nonce: randomBytes(8).toString("hex"), created_ms: Date.now() }, KeyPair.fromString(K.signal));
out.signal = await op.submitSignal(sig);
console.log("signal", out.signal);
out.navAfterTrade = await op.nav().then((n) => ({ nav: n.nav.toString(), gross: n.gross.toString(), liabilities: n.liabilities.toString() }));
out.epochB = await op.epoch();
console.log("epoch B", out.epochB);
out.after = await chain.getVault();
out.logHead = log.head();
out.logLength = log.entries.length;
writeFileSync("data/testnet-operator-run.json", JSON.stringify(out, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2));
console.log(JSON.stringify({ after: out.after, navAfterTrade: out.navAfterTrade, logLength: out.logLength }, null, 2));
