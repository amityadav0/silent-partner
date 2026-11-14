// T5 on testnet: emergency exits paid in rounds, from what is actually in the vault.
// A fresh drill vault (drill build: price goes stale after 5 minutes) on the real defuse
// verifier, with the same config as the season vaults minus the price bound:
//   1. create drill2.<operator>, seed it: leader 20, follower 50, second follower 30 USDC
//   2. no price update for 5 minutes → anyone triggers emergency
//   3. follower exits; a payout before any round is refused (nothing allocated yet)
//   4. anyone: emergency_round → the vault reads its public USDC on the verifier and splits
//      it pro rata over the follower's claim and the holders still in (the pool)
//   5. follower pays out its allocation (execute_intents + ft_withdraw; settle → paid)
//   6. second follower exits later and takes its part of the pool, no new round needed; pays out
//   npx tsx scripts/drill-rounds.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { connect, keyStores, providers, transactions, type Account } from "near-api-js";
import { base58 } from "@scure/base";
import { viewCall } from "../src/intents.js";

const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const A = JSON.parse(readFileSync("data/season-accounts.json", "utf8")) as Record<string, string>;
const S = JSON.parse(readFileSync("season/vaults.json", "utf8"));
const OP: string = S.operator, VAULT = `drill2.${OP}`, LEADER = A.ldrill, F1 = A.alice, F2 = A.bob, ANYONE = A.bob;
const USDC_T = "usdc.fakes.testnet", BASE = S.base, INTENTS = S.intents_contract;
const TGAS = 1_000_000_000_000n, NEAR = 10n ** 24n;
const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) } as unknown as Parameters<typeof connect>[0]);
const view = <T>(c: string, m: string, a: object = {}) => viewCall<T>(RPC, c, m, a, fetch, "optimistic");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const txs: { step: string; who: string; tx: string; note?: string }[] = [];
const exists = (id: string) => (near.connection.provider as providers.JsonRpcProvider).query({ request_type: "view_account", finality: "optimistic", account_id: id }).then(() => true, () => false);

async function call(step: string, who: string, contractId: string, methodName: string, args: object, gas = 100n * TGAS, deposit = 0n, expectFail = false) {
  const a: Account = await near.account(who);
  let o: any;
  try {
    o = await a.functionCall({ contractId, methodName, args, gas, attachedDeposit: deposit });
  } catch (e: any) {
    // near-api-js throws on a failed call; a refusal we expect is the result we want
    const msg = String(e?.kind?.kind?.FunctionCallError?.ExecutionError ?? e?.message ?? e).replace(/^Smart contract panicked: /, "");
    const tx = e?.transaction_outcome?.id ?? "?";
    txs.push({ step, who, tx, note: msg.slice(0, 200) });
    if (!expectFail) throw e;
    console.log(`  ✗ refused, as expected: ${step.padEnd(40)} ${tx}  ${msg.slice(0, 140)}`);
    return null;
  }
  const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  const logs = (o.receipts_outcome as any[]).flatMap((r) => r.outcome.logs as string[]).filter((l) => l.startsWith("silent-partner"));
  const note = failure ? JSON.stringify(failure).match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? JSON.stringify(failure).slice(0, 200) : logs.join("; ").slice(0, 300);
  txs.push({ step, who, tx: o.transaction.hash, ...(note ? { note } : {}) });
  if (failure && !expectFail) throw new Error(`${methodName} failed (${o.transaction.hash}): ${note}`);
  if (!failure && expectFail) throw new Error(`${methodName} should have been refused (${o.transaction.hash})`);
  console.log(`  ${failure ? "✗ refused, as expected:" : "✓"} ${step.padEnd(48)} ${o.transaction.hash}  ${note.slice(0, 140)}`);
  return failure ? null : (providers.getTransactionLastResult(o) as any);
}

console.log("1. create and seed the drill vault");
if (!(await exists(VAULT))) {
  // spare testnet NEAR from the unlisted first test vault and the finished first drill
  for (const [from, amt] of [["sp-vault-60270.testnet", 4n * NEAR], ["sp-drill-92991.testnet", 2n * NEAR]] as [string, bigint][]) {
    const o = await (await near.account(from)).sendMoney(OP, amt);
    txs.push({ step: `${from} → ${OP} ${amt / NEAR} testnet NEAR`, who: from, tx: o.transaction.hash });
  }
  const cfg = { ...(await view<Record<string, unknown>>(S.community.template, "get_config")), owner: OP, leader: LEADER, nav_oracle: null, nav_quotes: null };
  const wasm = readFileSync(new URL("../../contract/target/drill/silent_partner.wasm", import.meta.url));
  const r = await (await near.account(OP)).signAndSendTransaction({ receiverId: VAULT, actions: [transactions.createAccount(), transactions.transfer(5n * NEAR), transactions.deployContract(wasm), transactions.functionCall("new", { cfg }, 100n * TGAS, 0n)] });
  const failure = (r.receipts_outcome as any[]).map((x) => x.outcome.status?.Failure).find(Boolean);
  if (failure) throw new Error(`create ${VAULT}: ${JSON.stringify(failure).slice(0, 300)}`);
  txs.push({ step: "create + deploy the T5 drill build + new", who: OP, tx: r.transaction.hash });
  console.log(`  ✓ create ${VAULT} ${r.transaction.hash}`);
}
if (!(await view<any>(VAULT, "get_vault")).vault_account) await call("operator: activate", OP, VAULT, "activate", {}, 50n * TGAS);
if (!(await view(USDC_T, "storage_balance_of", { account_id: VAULT }))) await call("operator: storage_deposit", OP, USDC_T, "storage_deposit", { account_id: VAULT }, 30n * TGAS, 1_250_000_000_000_000_000_000n);
const seeds: [string, bigint][] = [[LEADER, 20_000_000n], [F1, 50_000_000n], [F2, 30_000_000n]];
for (const [who, amt] of seeds) {
  if (BigInt((await view<[string, string]>(VAULT, "get_shares", { account_id: who }))[0]) > 0n) continue;
  if ((await view<any>(VAULT, "get_vault")).stale) break; // too late to deposit; run continues with what's in
  if (!(await view(USDC_T, "storage_balance_of", { account_id: who }))) await call(`${who}: storage_deposit`, who, USDC_T, "storage_deposit", { account_id: who }, 30n * TGAS, 1_250_000_000_000_000_000_000n);
  await call(`${who}: mint test USDC`, who, USDC_T, "mint", { account_id: who, amount: amt.toString() }, 30n * TGAS);
  await call(`${who}: deposit ${amt / 1_000_000n} USDC`, who, USDC_T, "ft_transfer_call", { receiver_id: VAULT, amount: amt.toString(), msg: "" }, 150n * TGAS, 1n);
}
const va = (await view<any>(VAULT, "get_vault")).vault_account as string;

console.log("2. no price update; waiting for the 5-minute timeout");
while (!(await view<any>(VAULT, "get_vault")).stale) await sleep(15_000);
if (!(await view<any>(VAULT, "get_vault")).emergency) await call("anyone: trigger_emergency", ANYONE, VAULT, "trigger_emergency", {}, 50n * TGAS);

const mk = (to: string, amount: string) => ({
  message: JSON.stringify({ deadline: new Date(Date.now() + 20 * 60_000).toISOString(), intents: [{ intent: "transfer", receiver_id: to, tokens: { [BASE]: amount } }], signer_id: va }),
  nonce: randomBytes(32).toString("base64"),
  recipient: INTENTS,
});
const claimOf = async (id: number) => (await view<any[]>(VAULT, "get_claims", { from: id, limit: 1 }))[0];
const allocOf = async (id: number) => (await view<[string[], string]>(VAULT, "get_rounds", { from: id, limit: 1 }))[0][0];
async function payOut(who: string, id: number, amount: string) {
  const payload = mk(who, amount);
  const signature: string = await call(`${who}: sign_intent(PublicPayout) ${Number(amount) / 1e6} USDC`, who, VAULT, "sign_intent", { kind: { PublicPayout: { claim_id: id } }, payload, quote: null }, 300n * TGAS);
  await call(`${who}: execute_intents on the verifier`, who, INTENTS, "execute_intents", { signed: [{ standard: "nep413", payload, public_key: "ed25519:" + base58.encode(Buffer.from(va, "hex")), signature }] }, 300n * TGAS);
  await call(`${who}: ft_withdraw to wallet`, who, INTENTS, "ft_withdraw", { token: USDC_T, receiver_id: who, amount }, 100n * TGAS, 1n);
  const prehash = (await claimOf(id)).in_flight[0].prehash;
  await call("anyone: settle_payout (verifier: nonce used)", ANYONE, VAULT, "settle_payout", { claim_id: id, prehash }, 60n * TGAS);
}

console.log("3. follower exits; a payout before any round is refused");
const existing = async (who: string) => (await view<any[]>(VAULT, "get_claims", { from: 0, limit: 50 })).find((c) => c.account === who)?.id as number | undefined;
const c1: number = (await existing(F1)) ?? (await call("follower: emergency_exit", F1, VAULT, "emergency_exit", { exit_account: F1 }, 50n * TGAS));
await call("follower: payout before any round", F1, VAULT, "sign_intent", { kind: { PublicPayout: { claim_id: c1 } }, payload: mk(F1, "1000000"), quote: null }, 300n * TGAS, 0n, true);

console.log("4. round");
const pub0 = await view<string>(INTENTS, "mt_balance_of", { account_id: va, token_id: BASE });
await call("anyone: emergency_round", ANYONE, VAULT, "emergency_round", {}, 150n * TGAS);
const r1 = await view<[string[], string]>(VAULT, "get_rounds", { from: 0, limit: 50 });

console.log("5. follower pays out its allocation");
const a1 = await allocOf(c1);
await payOut(F1, c1, a1);

console.log("6. second follower exits after the round and takes its part of the pool");
const c2: number = (await existing(F2)) ?? (await call("second follower: emergency_exit", F2, VAULT, "emergency_exit", { exit_account: F2 }, 50n * TGAS));
const a2 = await allocOf(c2);
await payOut(F2, c2, a2);

const out = {
  ranAt: new Date().toISOString(), vault: VAULT, vault_account: va, build: "drill (5-minute NAV timeout), T5 emergency rounds",
  vault_public_usdc_at_round: pub0, round_1: { allocs: r1[0], pool: r1[1] },
  claims: await Promise.all([c1, c2].map(async (id) => { const c = await claimOf(id); return { id, account: c.account, amount: c.amount, allocation: await allocOf(id), paid: c.paid }; })),
  pool_after: (await view<[string[], string]>(VAULT, "get_rounds", { from: 0, limit: 1 }))[1],
  vault_public_usdc_after: await view<string>(INTENTS, "mt_balance_of", { account_id: va, token_id: BASE }),
  txs,
};
writeFileSync("data/drill-rounds.json", JSON.stringify(out, null, 2));
if (existsSync("../docs")) writeFileSync("../docs/drill-rounds.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
