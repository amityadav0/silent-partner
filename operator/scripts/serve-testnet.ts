// Start the operator service against the testnet vault: dry 1Click, testnet
// chain writes. Keys come from data/ and ~/.near-credentials, never from argv.
//   npx tsx --env-file-if-exists=../.env scripts/serve-testnet.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const A = JSON.parse(readFileSync("data/testnet-accounts.json", "utf8"));
const K = JSON.parse(readFileSync("data/testnet-keys.json", "utf8"));
Object.assign(process.env, {
  NEAR_NETWORK: "testnet", DRY_RUN: "1", VAULT_CONTRACT_ID: A.vault, OPERATOR_ACCOUNT_ID: A.operator,
  OPERATOR_PRIVATE_KEY: JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${A.operator}.json`, "utf8")).private_key,
  ATTESTATION_PRIVATE_KEY: K.attestation, DATA_DIR: "./data", PORT: "8788", EPOCH_MS: process.env.EPOCH_MS ?? String(6 * 3600_000),
});
const { main } = await import("../src/index.js");
await main();
