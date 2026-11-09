// Emergency-exit drill on testnet, against the drill build (5-minute NAV
// timeout) and the real defuse verifier. The follower gets their money out
// with no operator and no 1Click:
//   1. operator alive: posts a signed NAV
//   2. operator stopped: nothing posts; wait until the NAV is stale (5 min)
//   3. anyone triggers emergency; a new deposit is refunded
//   4. follower: emergency_exit → claim at the last NAV, pro rata
//   5. follower: sign_intent(PublicPayout) → the vault's MPC key signs a
//      transfer of the claim from the vault's public intents balance to them
//   6. follower: execute_intents on the verifier, then ft_withdraw to their wallet
//   7. anyone: settle_payout asks the verifier whether the nonce was used → paid
//   npx tsx scripts/drill.ts
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { connect, keyStores, providers, KeyPair, type Account } from "near-api-js";
import { base58 } from "@scure/base";
import { NearVault } from "../src/chain.js";
import { Confidential } from "../src/confidential.js";
import { FillLog } from "../src/filllog.js";
import { Operator } from "../src/operator.js";
import { loadEnv } from "../src/config.js";
import { viewCall } from "../src/intents.js";

const RPC = "https://rpc.testnet.fastnear.com";
const A = JSON.parse(readFileSync("data/season-accounts.json", "utf8")) as Record<string, string>;
const K = JSON.parse(readFileSync("data/season-keys.json", "utf8"));
const S = JSON.parse(readFileSync("season/vaults.json", "utf8"));
const VAULT = A.drill, FOLLOWER = A.alice, ANYONE = A.bob, USDC_T = "usdc.fakes.testnet", BASE = S.base, INTENTS = S.intents_contract;
const TGAS = 1_000_000_000_000n;
const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) } as unknown as Parameters<typeof connect>[0]);
const view = <T>(c: string, m: string, a: object = {}) => viewCall<T>(RPC, c, m, a, fetch, "optimistic");
const txs: { step: string; who: string; tx: string; note?: string }[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usdc = (x: string | bigint) => (Number(BigInt(x)) / 1e6).toFixed(6);

async function call(step: string, who: string, contractId: string, methodName: string, args: object, opts: { gas?: bigint; deposit?: bigint } = {}) {
  const a: Account = await near.account(who);
  const o = await a.functionCall({ contractId, methodName, args, gas: opts.gas ?? 100n * TGAS, attachedDeposit: opts.deposit ?? 0n });
  const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  const logs = (o.receipts_outcome as any[]).flatMap((r) => r.outcome.logs as string[]).filter((l) => l.startsWith("silent-partner") || l.includes("refused"));
  txs.push({ step, who, tx: o.transaction.hash, ...(logs.length ? { note: logs.join("; ").slice(0, 300) } : {}) });
  if (failure) throw new Error(`${methodName} failed (${o.transaction.hash}): ${JSON.stringify(failure).slice(0, 400)}`);
  console.log(`  ✓ ${step.padEnd(44)} ${o.transaction.hash}${logs.length ? "  " + logs.join("; ").slice(0, 160) : ""}`);
  return providers.getTransactionLastResult(o) as any;
}
const state = async () => {
  const v = await view<any>(VAULT, "get_vault");
  return { epoch: v.epoch, stale: v.stale, emergency: v.emergency, total_shares: v.total_shares, book_nav: v.book_nav, last_nav_ms: v.last_nav_ms };
};
const snaps: Record<string, unknown> = {};

// 1. operator alive
const opKey = JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${A.sop}.json`, "utf8")).private_key;
const env = loadEnv({ NEAR_NETWORK: "testnet", DRY_RUN: "1" });
const chain = new NearVault(VAULT, RPC, "testnet", A.sop, opKey);
const va = (await chain.getVault()).vault_account!;
const op = new Operator(chain, new Confidential(env.oneclickUrl, "", fetch, undefined, true), new FillLog(VAULT, `data/fills-${VAULT}.jsonl`), KeyPair.fromString(K.attestation), "ed25519:" + base58.encode(Buffer.from(va, "hex")), env.op);
console.log("1. operator alive");
const e1 = await op.epoch();
txs.push({ step: `operator posts NAV epoch ${e1.epoch} (${usdc(e1.nav)} USDC)`, who: A.sop, tx: e1.tx! });
console.log(`  ✓ post_nav epoch ${e1.epoch} nav ${usdc(e1.nav)}   ${e1.tx}`);
snaps.afterNav = await state();

// 2. operator stopped
console.log("2. operator stopped; waiting for the 5-minute NAV timeout");
const stoppedAt = Date.now();
while (!(await state()).stale) await sleep(15_000);
snaps.stale = { ...(await state()), waited_s: Math.round((Date.now() - stoppedAt) / 1000) };
console.log("  stale after", (snaps.stale as any).waited_s, "s");

// 3. anyone triggers emergency; deposits now refunded
console.log("3. emergency");
await call("anyone: trigger_emergency", ANYONE, VAULT, "trigger_emergency", {}, { gas: 50n * TGAS });
snaps.emergency = await state();
await call("anyone: mint 5 test USDC", ANYONE, USDC_T, "mint", { account_id: ANYONE, amount: "5000000" }, { gas: 30n * TGAS });
const before = await view<string>(USDC_T, "ft_balance_of", { account_id: ANYONE });
await call("anyone: deposit 5 USDC (refunded)", ANYONE, USDC_T, "ft_transfer_call", { receiver_id: VAULT, amount: "5000000", msg: "" }, { deposit: 1n, gas: 150n * TGAS });
const after = await view<string>(USDC_T, "ft_balance_of", { account_id: ANYONE });
snaps.depositRefunded = before === after;

// 4. follower exits pro rata
console.log("4. follower exit");
const [fShares] = await view<[string, string]>(VAULT, "get_shares", { account_id: FOLLOWER });
const pre = await state();
const claimId: number = await call("follower: emergency_exit", FOLLOWER, VAULT, "emergency_exit", { exit_account: FOLLOWER }, { gas: 50n * TGAS });
const claim = (await view<any[]>(VAULT, "get_claims", { from: claimId, limit: 1 }))[0];
snaps.exit = { follower_shares: fShares, total_shares_before: pre.total_shares, book_nav_before: pre.book_nav, claim_amount: claim.amount, pro_rata: (BigInt(fShares) * BigInt(pre.book_nav)) / BigInt(pre.total_shares) === BigInt(claim.amount) };

// 5. vault MPC key signs the payout from its public intents balance
console.log("5. sign the payout");
const deadlineMs = Date.now() + 20 * 60_000;
const payload = { message: JSON.stringify({ deadline: new Date(deadlineMs).toISOString(), intents: [{ intent: "transfer", receiver_id: FOLLOWER, tokens: { [BASE]: claim.amount } }], signer_id: va }), nonce: randomBytes(32).toString("base64"), recipient: INTENTS };
const signature: string = await call("follower: sign_intent(PublicPayout)", FOLLOWER, VAULT, "sign_intent", { kind: { PublicPayout: { claim_id: claimId } }, payload, quote: null }, { gas: 300n * TGAS });
if (!signature) throw new Error("no signature");

// 6. follower executes it and withdraws to their wallet
console.log("6. execute and withdraw");
const vaultPub0 = await view<string>(INTENTS, "mt_balance_of", { account_id: va, token_id: BASE });
const wallet0 = await view<string>(USDC_T, "ft_balance_of", { account_id: FOLLOWER });
await call("follower: execute_intents on the verifier", FOLLOWER, INTENTS, "execute_intents", { signed: [{ standard: "nep413", payload, public_key: "ed25519:" + base58.encode(Buffer.from(va, "hex")), signature }] }, { gas: 300n * TGAS });
const credited = await view<string>(INTENTS, "mt_balance_of", { account_id: FOLLOWER, token_id: BASE });
await call("follower: ft_withdraw to wallet", FOLLOWER, INTENTS, "ft_withdraw", { token: USDC_T, receiver_id: FOLLOWER, amount: claim.amount }, { deposit: 1n, gas: 100n * TGAS });
const wallet1 = await view<string>(USDC_T, "ft_balance_of", { account_id: FOLLOWER });

// 7. confirm
const prehash = (await view<any[]>(VAULT, "get_claims", { from: claimId, limit: 1 }))[0].in_flight[0].prehash;
// (The 2026-11-09 run used the earlier contract, where the claimant confirmed with
// `executed: true`; since D-H-2 anyone settles against the verifier's nonce record.)
await call("follower: settle_payout (verifier: nonce used)", FOLLOWER, VAULT, "settle_payout", { claim_id: claimId, prehash }, { gas: 60n * TGAS });
const finalClaim = (await view<any[]>(VAULT, "get_claims", { from: claimId, limit: 1 }))[0];
snaps.payout = {
  vault_public_before: vaultPub0, vault_public_after: await view<string>(INTENTS, "mt_balance_of", { account_id: va, token_id: BASE }),
  follower_intents_credited: credited, wallet_before: wallet0, wallet_after: wallet1, wallet_gain: (BigInt(wallet1) - BigInt(wallet0)).toString(),
  claim_final: { amount: finalClaim.amount, paid: finalClaim.paid, in_flight: finalClaim.in_flight.length },
};
snaps.final = await state();
const out = { ranAt: new Date().toISOString(), vault: VAULT, vault_account: va, follower: FOLLOWER, anyone: ANYONE, signature, snaps, txs };
writeFileSync("data/drill.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(snaps, null, 2));
