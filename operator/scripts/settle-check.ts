// Testnet check of trustless payout settlement (review finding 1) on the real
// defuse verifier, with the fixed contract:
//   claim 0: the operator pays it (PublicPayout → execute_intents) and
//            settle_payout asks the verifier: nonce used → "paid";
//   claim 1: a payout is signed but never executed: settle → "pending" before
//            its deadline, "released" after it; then it is paid properly.
// An executed payout can no longer be released and paid twice.
//   npx tsx scripts/settle-check.ts
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { connect, keyStores, providers, KeyPair, type Account } from "near-api-js";
import { base58 } from "@scure/base";
import { NearVault } from "../src/chain.js";
import { Confidential } from "../src/confidential.js";
import { FillLog } from "../src/filllog.js";
import { Operator, navMessage } from "../src/operator.js";
import { loadEnv } from "../src/config.js";
import { viewCall, nep413Prehash } from "../src/intents.js";

const RPC = "https://near-testnet.drpc.org";
const A = JSON.parse(readFileSync("data/season-accounts.json", "utf8")) as Record<string, string>;
const K = JSON.parse(readFileSync("data/season-keys.json", "utf8"));
const K0 = JSON.parse(readFileSync("data/testnet-keys.json", "utf8"));
const VAULT = "settle.sp-lmanual-92991.testnet", LEADER = A.lmanual, FOLLOWER = A.alice, OP = A.sop;
const USDC_T = "usdc.fakes.testnet", BASE = `nep141:${USDC_T}`, INTENTS = "sp-intents-61557.testnet";
const TGAS = 1_000_000_000_000n;
const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) } as unknown as Parameters<typeof connect>[0]);
const view = <T>(c: string, m: string, a: object = {}) => viewCall<T>(RPC, c, m, a, fetch, "optimistic");
const txs: { step: string; tx: string; result?: unknown }[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function call(step: string, who: string, contractId: string, methodName: string, args: object, opts: { gas?: bigint; deposit?: bigint } = {}) {
  const a: Account = await near.account(who);
  const o = await a.functionCall({ contractId, methodName, args, gas: opts.gas ?? 100n * TGAS, attachedDeposit: opts.deposit ?? 0n });
  const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  const result = failure ? undefined : providers.getTransactionLastResult(o);
  txs.push({ step, tx: o.transaction.hash, ...(result !== undefined && result !== "" ? { result } : {}) });
  if (failure) throw new Error(`${methodName} failed (${o.transaction.hash}): ${JSON.stringify(failure).slice(0, 300)}`);
  console.log(`  ✓ ${step.padEnd(52)} ${o.transaction.hash}${result !== undefined && result !== "" ? "  → " + JSON.stringify(result).slice(0, 60) : ""}`);
  return result as any;
}
const opKey = JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${OP}.json`, "utf8")).private_key;
const att = KeyPair.fromString(K.attestation);
const chain = new NearVault(VAULT, RPC, "testnet", OP, opKey);

// setup
const acct = await near.account(VAULT);
if ((await acct.state()).code_hash === "11111111111111111111111111111111") {
  const d = await acct.deployContract(readFileSync(new URL("../../contract/target/near/silent_partner.wasm", import.meta.url)));
  txs.push({ step: "deploy fixed contract", tx: d.transaction.hash });
  await call("init", VAULT, VAULT, "new", { cfg: {
    owner: VAULT, operator: OP, leader: LEADER, base_token: USDC_T, base_asset_id: BASE, intents_contract: INTENTS,
    mpc_contract: "v1.signer-prod.testnet", mpc_path: "silent-partner/vault", oneclick_key: KeyPair.fromString(K0.testQuote).getPublicKey().toString(),
    attestation_key: att.getPublicKey().toString(), perf_fee_bps: 2000, min_leader_bps: 1000, max_slippage_bps: 100, min_deposit: "1000000", allowed_assets: [BASE, "nep141:wrap.testnet"],
  } });
  await call("activate (MPC)", OP, VAULT, "activate", {}, { gas: 50n * TGAS });
  await call("storage on fake USDC", OP, USDC_T, "storage_deposit", { account_id: VAULT }, { deposit: 1_250_000_000_000_000_000_000n, gas: 30n * TGAS });
  for (const [who, amt] of [[LEADER, "10000000"], [FOLLOWER, "20000000"]] as const) {
    await call(`${who.split("-")[1]}: mint`, who, USDC_T, "mint", { account_id: who, amount: amt }, { gas: 30n * TGAS });
    await call(`${who.split("-")[1]}: deposit ${Number(amt) / 1e6} USDC`, who, USDC_T, "ft_transfer_call", { receiver_id: VAULT, amount: amt, msg: "" }, { deposit: 1n, gas: 150n * TGAS });
  }
}
const va = (await chain.getVault()).vault_account!;
const vaultPk = "ed25519:" + base58.encode(Buffer.from(va, "hex"));
const env = loadEnv({ NEAR_NETWORK: "testnet", DRY_RUN: "1" });
const log = new FillLog(VAULT, `data/fills-${VAULT}.jsonl`);
const op = new Operator(chain, new Confidential(env.oneclickUrl, "", fetch, undefined, true), log, att, vaultPk, { ...env.op, dryRun: false, chainWrites: true });

async function postNav() {
  const v = await chain.getVault();
  const nav = await chain.publicBase();
  const owed = (await chain.getClaims()).reduce((s, c) => s + BigInt(c.amount) - BigInt(c.paid), 0n);
  const epoch = v.epoch + 1, ts = Math.max(Date.now() - 1000, v.last_nav_ms + 1);
  log.append("nav", { epoch, nav: (nav - owed).toString(), timestamp_ms: ts }, Date.now());
  const sig = "ed25519:" + base58.encode(att.sign(new TextEncoder().encode(navMessage(VAULT, epoch, (nav - owed).toString(), ts, log.head()))).signature);
  const tx = await chain.postNav(epoch, (nav - owed).toString(), ts, log.head(), sig);
  txs.push({ step: `post NAV epoch ${epoch} (${Number(nav - owed) / 1e6} USDC)`, tx });
  console.log(`  ✓ post NAV epoch ${epoch}                                  ${tx}`);
}

// claim 0: withdrawal → NAV → operator pays live → settle reads the verifier: paid
console.log("claim 0: paid through the verifier");
await call("follower: request_withdraw 8 USDC", FOLLOWER, VAULT, "request_withdraw", { shares: "8000000", exit_account: FOLLOWER }, { gas: 30n * TGAS });
await postNav();
const before0 = BigInt(await view<string>(INTENTS, "mt_balance_of", { account_id: FOLLOWER, token_id: BASE }));
await op.payClaims();
const pay0 = log.entries.filter((e) => e.kind === "payout").at(-1)!.data;
for (const [k, step] of [["sign_tx", "operator: sign_intent(PublicPayout claim 0)"], ["exec_tx", "operator: execute_intents on the verifier"], ["settle_tx", "anyone: settle_payout → verifier says nonce used"]] as const) txs.push({ step, tx: String(pay0[k]), ...(k === "settle_tx" ? { result: pay0.status } : {}) });
const after0 = BigInt(await view<string>(INTENTS, "mt_balance_of", { account_id: FOLLOWER, token_id: BASE }));
const c0 = (await chain.getClaims())[0];
console.log("  claim 0:", { status: pay0.status, paid: c0.paid, amount: c0.amount, in_flight: c0.in_flight.length, follower_credited: (after0 - before0).toString() });

// claim 1: a signed payout that never executes
console.log("claim 1: signed, never executed → pending, then released after its deadline");
await call("follower: request_withdraw 4 USDC", FOLLOWER, VAULT, "request_withdraw", { shares: "4000000", exit_account: FOLLOWER }, { gas: 30n * TGAS });
await postNav();
const c1id = (await chain.getClaims()).length - 1;
const c1 = (await chain.getClaims())[c1id];
const deadlineMs = Date.now() + 5 * 60_000 + 20_000;
const payload = { message: JSON.stringify({ deadline: new Date(deadlineMs).toISOString(), intents: [{ intent: "transfer", receiver_id: FOLLOWER, tokens: { [BASE]: c1.amount } }], signer_id: va }), nonce: randomBytes(32).toString("base64"), recipient: INTENTS };
const prehash = nep413Prehash(payload).toString("hex");
await call("operator: sign_intent(PublicPayout claim 1), not executed", OP, VAULT, "sign_intent", { kind: { PublicPayout: { claim_id: c1id } }, payload, quote: null }, { gas: 300n * TGAS });
const early = await call("anyone: settle_payout before the deadline", FOLLOWER, VAULT, "settle_payout", { claim_id: c1id, prehash }, { gas: 60n * TGAS });
while (Date.now() < deadlineMs + 15_000) await sleep(10_000);
const late = await call("anyone: settle_payout after the deadline", FOLLOWER, VAULT, "settle_payout", { claim_id: c1id, prehash }, { gas: 60n * TGAS });
const c1after = (await chain.getClaims())[c1id];
await op.payClaims();
const pay1 = log.entries.filter((e) => e.kind === "payout").at(-1)!.data;
txs.push({ step: "operator: pays claim 1 properly (sign, execute, settle)", tx: String(pay1.settle_tx), result: pay1.status });
const c1final = (await chain.getClaims())[c1id];

const out = {
  ranAt: new Date().toISOString(), vault: VAULT, vault_account: va,
  claim0: { status: pay0.status, amount: c0.amount, paid: c0.paid, in_flight: c0.in_flight.length, follower_credited: (after0 - before0).toString() },
  claim1: { early, late, open_after_release: (BigInt(c1after.amount) - BigInt(c1after.paid)).toString(), in_flight_after_release: c1after.in_flight.length, final: { status: pay1.status, paid: c1final.paid, amount: c1final.amount } },
  txs,
};
writeFileSync("data/settle-check.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ claim0: out.claim0, claim1: out.claim1 }, null, 2));
