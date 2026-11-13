// Mainnet NAV keeper (NEEDS-AMIT §12 option A, D-P5-12). Runs from GitHub Actions every 3 h.
// Secrets: KEEPER_POST_NAV_KEY (function-call key on the operator account, post_nav only,
// 0.5 NEAR allowance), ATTESTATION_PRIVATE_KEY, KEEPER_FILL_LOG (base64 of the fill log).
// It only posts NAV: shields, trades and payouts stay with the full operator key, by hand.
//   NEAR_NETWORK=mainnet VAULT_CONTRACT_ID=… OPERATOR_ACCOUNT_ID=… npx tsx scripts/keeper.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { NearVault } from "../src/chain.js";
import { Confidential } from "../src/confidential.js";
import { FillLog } from "../src/filllog.js";
import { Operator } from "../src/operator.js";
import { loadEnv } from "../src/config.js";
import { keeperDecision, KEEPER } from "../src/keeper.js";

process.env.NAV_GAS_TGAS ??= "40";
const env = loadEnv({ ...process.env, OPERATOR_PRIVATE_KEY: process.env.KEEPER_POST_NAV_KEY ?? process.env.OPERATOR_PRIVATE_KEY, MAINNET_WRITES: "1" });
if (!env.contractId || !env.attestationKey || !env.operatorKey) throw new Error("set VAULT_CONTRACT_ID, ATTESTATION_PRIVATE_KEY and KEEPER_POST_NAV_KEY");
mkdirSync(env.dataDir, { recursive: true });
const logFile = join(env.dataDir, `fills-${env.contractId}.jsonl`);
if (process.env.KEEPER_FILL_LOG) writeFileSync(logFile, Buffer.from(process.env.KEEPER_FILL_LOG, "base64"));

const chain = new NearVault(env.contractId, env.rpc, env.network, env.operatorId, env.operatorKey);
const v = await chain.getVault();
if (!v.vault_account) throw new Error("vault not active");
const d = keeperDecision(v, Date.now(), Number(process.env.KEEPER_MIN_AGE_MS ?? KEEPER.minAgeMs));
console.log(JSON.stringify({ vault: env.contractId, epoch: v.epoch, last_nav: new Date(v.last_nav_ms).toISOString(), ...d }));
if (v.emergency) process.exit(1);
const dry = process.env.KEEPER_DRY === "1"; // compute NAV and fetch the signed quotes, don't send
if (!d.post && !dry) process.exit(0);

// No partner JWT in CI: price with public dry quotes (same solver market; the contract checks 1Click's signature).
const oc = new Confidential(env.oneclickUrl, env.oneclickJwt, fetch, env.oneclickKey, !env.oneclickJwt);
const log = new FillLog(env.contractId, logFile);
if (!log.entries.length) throw new Error("empty fill log: set KEEPER_FILL_LOG");
const op = new Operator(chain, oc, log, KeyPair.fromString(env.attestationKey as `ed25519:${string}`), "ed25519:" + base58.encode(Buffer.from(v.vault_account, "hex")), env.op);
if (dry) {
  const n = await op.nav();
  const q = await op.priceQuotes();
  console.log(JSON.stringify({ dry: true, nav: n.nav.toString(), liabilities: n.liabilities.toString(), quotes: q?.length ?? 0, head: log.head() }));
  process.exit(0);
}
const r = await op.keeperPost();
console.log(JSON.stringify({ posted: true, ...r }));
if (BigInt(r.liabilities) > 0n) console.log("::warning::open claims are owed; pay them by hand with the full operator key (op.ts pay)");
