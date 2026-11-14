// On-chain usage (A1), read-only. Prints the detail locally (account ids are public on chain)
// and writes the counts-only summary the site reads.
//   npx tsx scripts/usage.ts [--out ../season-state/usage.json] [--quiet]
import { readFileSync, writeFileSync } from "node:fs";
import { launches as listLaunches } from "../src/season/provision.js";
import { loadOwn, summarize, vaultUsage, type VaultUsage } from "../src/season/usage.js";

const S = JSON.parse(readFileSync("season/vaults.json", "utf8"));
const MAINNET_VAULT = "1f80f62c945eec98005dac38ab9db5f95c44ef1258cf5ca9606fb8c7dd4da36e";
const own = loadOwn();
const ls = await listLaunches("https://rpc.testnet.fastnear.com", S.community.registry);
const ids = [...new Set<string>([...S.vaults.map((v: { id: string }) => v.id), ...(S.usage_extra ?? []), ...ls.filter((l) => l.vault).map((l) => l.vault!)])];
const out: VaultUsage[] = [];
for (const id of ids) {
  try {
    out.push(await vaultUsage("testnet", id, own));
  } catch (x) {
    console.error(`${id}: ${(x as Error).message}`);
  }
}
out.push(await vaultUsage("mainnet", MAINNET_VAULT, own));
const sum = summarize(out, ls, own);
const quiet = process.argv.includes("--quiet");
if (!quiet) {
  for (const v of out) console.log(`${v.vault.padEnd(32)} depositors ${v.depositors.length} holders ${v.holders.length} (all ${v.allHolders}) withdraw ${v.withdrawRequests.length} stop-loss ${v.stopLosses.length}${v.depositors.length ? "  " + v.depositors.join(", ") : ""}`);
  for (const l of ls) console.log(`launch #${l.id} ${l.name} by ${l.leader} ${new Date(Number(l.created_ms)).toISOString()} ${l.status} ${l.vault ?? ""}`);
}
console.log(JSON.stringify(sum, null, 1));
const i = process.argv.indexOf("--out");
if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(sum, null, 1) + "\n");
