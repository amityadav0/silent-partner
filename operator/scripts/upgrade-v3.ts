// Upgrade vaults deployed at the f97e5c0 layout to the current contract in one
// transaction each (deploy + migrate_v3): adds copy stop-losses and deposits for
// a named beneficiary. A failed migration reverts the deploy with it.
//   npx tsx scripts/upgrade-v3.ts <vault> [<vault> …]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { connect, keyStores, transactions } from "near-api-js";
import { viewCall } from "../src/intents.js";

const RPC = "https://rpc.testnet.fastnear.com";
const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) } as unknown as Parameters<typeof connect>[0]);
const wasm = readFileSync(new URL("../../contract/target/near/silent_partner.wasm", import.meta.url));
for (const id of process.argv.slice(2)) {
  const before: any = await viewCall(RPC, id, "get_vault", {}, fetch, "optimistic");
  const o = await (await near.account(id)).signAndSendTransaction({ receiverId: id, actions: [transactions.deployContract(wasm), transactions.functionCall("migrate_v3", {}, 100_000_000_000_000n, 0n)] });
  const f = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  if (f) throw new Error(`${id}: ${JSON.stringify(f).slice(0, 300)}`);
  const after: any = await viewCall(RPC, id, "get_vault", {}, fetch, "optimistic");
  const stop = await viewCall(RPC, id, "get_stop_loss", { account_id: "nobody.testnet" }, fetch, "optimistic");
  console.log(`  ✓ ${id.padEnd(26)} ${o.transaction.hash}  epoch ${before.epoch}→${after.epoch} shares ${before.total_shares}→${after.total_shares} stops view ${stop === null ? "ok" : stop}`);
}
