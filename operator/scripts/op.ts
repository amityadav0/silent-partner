// Operator CLI, one step at a time (mainnet runbook in docs/NEEDS-AMIT.md).
//
//   npx tsx --env-file-if-exists=../.env scripts/op.ts <command>
//
//   status                 vault state, NAV breakdown (private), log head
//   shield                 shield the vault's public base balance into its confidential account
//   signal <to> <bps>      sign a market signal with LEADER_SIGNAL_KEY and execute it (from = base asset)
//   epoch                  compute NAV, post it, then pay open claims
//   pay                    pay open claims only
//
// On mainnet, a step that writes to chain or uses the vault key prints what it
// will do and waits for "yes". Config and gates come from config.ts:
// MAINNET_WRITES=1 for chain writes, DRY_RUN=0 + MAINNET_LIVE_OK=1 for live 1Click.
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { NearVault } from "../src/chain.js";
import { Confidential } from "../src/confidential.js";
import { FillLog } from "../src/filllog.js";
import { Operator } from "../src/operator.js";
import { loadEnv } from "../src/config.js";
import { signSignal } from "../src/signal.js";

const [cmd, ...args] = process.argv.slice(2);
const env = loadEnv();
if (!env.contractId || !env.attestationKey) throw new Error("set VAULT_CONTRACT_ID and ATTESTATION_PRIVATE_KEY");
mkdirSync(env.dataDir, { recursive: true });
const chain = new NearVault(env.contractId, env.rpc, env.network, env.operatorId, env.operatorKey);
const v = await chain.getVault();
if (!v.vault_account) throw new Error("vault not active: call activate first");
const op = new Operator(chain, new Confidential(env.oneclickUrl, env.oneclickJwt, fetch, env.oneclickKey), new FillLog(env.contractId, join(env.dataDir, `fills-${env.contractId}.jsonl`)), KeyPair.fromString(env.attestationKey as `ed25519:${string}`), "ed25519:" + base58.encode(Buffer.from(v.vault_account, "hex")), env.op);
const J = (x: unknown) => JSON.stringify(x, (_, y) => (typeof y === "bigint" ? y.toString() : y), 2);

async function confirm(what: string) {
  console.log(`\n${env.network.toUpperCase()} ${env.op.dryRun ? "(dry 1Click)" : "(LIVE 1Click, vault key)"}: ${what}`);
  if (env.network !== "mainnet") return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question('Type "yes" to continue: ');
  rl.close();
  if (a.trim() !== "yes") { console.log("aborted"); process.exit(1); }
}

// K3: every mainnet step that can change the fill log refreshes the keeper's copy afterwards,
// even when the step fails (a rejected NAV still appends a note).
if (env.network === "mainnet" && ["shield", "signal", "epoch", "pay"].includes(cmd)) {
  process.on("exit", () => {
    const r = spawnSync("sh", [new URL("./keeper-sync.sh", import.meta.url).pathname], { encoding: "utf8" });
    console.log(r.status === 0 ? r.stdout.trim() : `WARNING: keeper-sync failed (${(r.stderr || "").trim().slice(0, 200)}). Run operator/scripts/keeper-sync.sh by hand.`);
  });
}
console.log(J({ network: env.network, vault: env.contractId, dryRun: env.op.dryRun, chainWrites: env.op.chainWrites, vault_account: v.vault_account, epoch: v.epoch, book_nav: v.book_nav }));
switch (cmd) {
  case "status": {
    const n = await op.nav();
    console.log(J({ nav: n, logHead: op.log.head(), logLength: op.log.entries.length, claims: await chain.getClaims() }));
    break;
  }
  case "shield": {
    const pending = (await chain.publicBase()) - op.ledger().shieldedFromPublic;
    await confirm(`shield ${pending} base units into ${v.vault_account}`);
    console.log("shield entry:", await op.shieldPending());
    break;
  }
  case "signal": {
    const [to, bps] = args;
    const key = process.env.LEADER_SIGNAL_KEY;
    if (!to || !bps || !key) throw new Error("usage: signal <to-asset-id> <bps>; needs LEADER_SIGNAL_KEY");
    const cfg = await chain.getConfig();
    const s = signSignal({ v: 1, vault: env.contractId, from: cfg.base_asset_id, to, size_bps: Number(bps), type: "market", nonce: randomBytes(8).toString("hex"), created_ms: Date.now() }, KeyPair.fromString(key as `ed25519:${string}`));
    await confirm(`execute ${bps} bps of NAV: ${cfg.base_asset_id} → ${to}, then record_signal`);
    console.log(J(await op.submitSignal(s)));
    break;
  }
  case "epoch": {
    const n = await op.nav();
    await confirm(`post NAV ${n.nav} (gross ${n.gross}, owed ${n.liabilities}) for epoch ${v.epoch + 1}, then pay open claims`);
    console.log(J(await op.epoch()));
    break;
  }
  case "pay": {
    await confirm("pay open claims");
    console.log(J(await op.payClaims()));
    break;
  }
  default:
    console.log("commands: status | shield | signal <to> <bps> | epoch | pay");
}
