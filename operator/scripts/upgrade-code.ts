// Deploy new contract code to vaults whose state layout is unchanged (no migration),
// one transaction each, and check that the state reads back the same.
//   npx tsx scripts/upgrade-code.ts <vault> [<vault> …]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { connect, keyStores, transactions } from "near-api-js";
import { viewCall } from "../src/intents.js";

const RPC = "https://rpc.testnet.fastnear.com";
const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) } as unknown as Parameters<typeof connect>[0]);
const wasm = readFileSync(new URL("../../contract/target/near/silent_partner.wasm", import.meta.url));
for (const id of process.argv.slice(2)) {
  const before: any = await viewCall(RPC, id, "get_vault", {}, fetch, "optimistic");
  const o = await (await near.account(id)).signAndSendTransaction({ receiverId: id, actions: [transactions.deployContract(wasm)] });
  const f = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  if (f) throw new Error(`${id}: ${JSON.stringify(f).slice(0, 300)}`);
  const after: any = await viewCall(RPC, id, "get_vault", {}, fetch, "optimistic");
  const path = await viewCall(RPC, id, "get_band_path", {}, fetch, "optimistic");
  if (after.total_shares !== before.total_shares || after.epoch < before.epoch) throw new Error(`${id}: state changed across the deploy`);
  console.log(`  ✓ ${id.padEnd(24)} ${o.transaction.hash}  epoch ${before.epoch}→${after.epoch} shares ${after.total_shares} band path ${path ? "ok" : "none"}`);
}
