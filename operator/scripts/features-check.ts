// Testnet record for "follow from any chain" and "copy stop-loss" on an upgraded vault:
//   1. a relayer account deposits with msg = the follower's account (what 1Click's
//      customRecipientMsg does for a cross-chain deposit): the follower gets the shares;
//   2. the follower sets a 5% copy stop-loss; the contract stores the trigger.
//   npx tsx scripts/features-check.ts
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { connect, keyStores, providers } from "near-api-js";
import { viewCall } from "../src/intents.js";

const RPC = "https://rpc.testnet.fastnear.com";
const A = JSON.parse(readFileSync("data/season-accounts.json", "utf8")) as Record<string, string>;
const VAULT = A.convict, RELAYER = A.alice, FOLLOWER = A.bob, USDC_T = "usdc.fakes.testnet";
const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) } as unknown as Parameters<typeof connect>[0]);
const view = <T>(c: string, m: string, a: object = {}) => viewCall<T>(RPC, c, m, a, fetch, "optimistic");
const txs: { step: string; tx: string }[] = [];
async function call(step: string, who: string, contractId: string, methodName: string, args: object, deposit = 0n, gas = 100_000_000_000_000n) {
  const o = await (await near.account(who)).functionCall({ contractId, methodName, args, gas, attachedDeposit: deposit });
  const f = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  if (f) throw new Error(`${methodName}: ${JSON.stringify(f).slice(0, 300)}`);
  const logs = (o.receipts_outcome as any[]).flatMap((r) => r.outcome.logs as string[]).filter((l) => l.startsWith("silent-partner"));
  txs.push({ step, tx: o.transaction.hash });
  console.log(`  ✓ ${step.padEnd(52)} ${o.transaction.hash}  ${logs.join("; ").slice(0, 140)}`);
  return providers.getTransactionLastResult(o);
}
const before = (await view<[string, string]>(VAULT, "get_shares", { account_id: FOLLOWER }))[0];
await call("relayer: mint 25 test USDC", RELAYER, USDC_T, "mint", { account_id: RELAYER, amount: "25000000" }, 0n, 30_000_000_000_000n);
await call("relayer: ft_transfer_call(msg = follower)", RELAYER, USDC_T, "ft_transfer_call", { receiver_id: VAULT, amount: "25000000", msg: FOLLOWER }, 1n, 150_000_000_000_000n);
const after = (await view<[string, string]>(VAULT, "get_shares", { account_id: FOLLOWER }))[0];
const stop = await call("follower: set_stop_loss(5%)", FOLLOWER, VAULT, "set_stop_loss", { drawdown_bps: 500, exit_account: FOLLOWER }, 0n, 30_000_000_000_000n);
const out = { ranAt: new Date().toISOString(), vault: VAULT, relayer: RELAYER, follower: FOLLOWER, follower_shares: { before, after }, stop, txs };
writeFileSync("data/features-check.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ follower_shares: out.follower_shares, stop }, null, 2));
