// Testnet: the real NEAR Intents verifier (defuse 0.2.10 from near/intents
// releases) deployed to a faucet account, and a second vault pointed at it.
// Checks the two things the first testnet vault couldn't:
//   1. deposit forwarding: ft_transfer_call → vault mints → forwards to the
//      intents contract, credited to the vault's MPC-derived account;
//   2. an MPC-signed vault transfer (Shield-shaped, bound to a test-key quote)
//      executed for real by the defuse contract's execute_intents.
//
//   npx tsx scripts/testnet-intents.ts <path to defuse-0.2.10.wasm>
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { connect, keyStores, providers, KeyPair, type Account } from "near-api-js";
import { base58 } from "@scure/base";
import { signTestQuote } from "../src/testquote.js";
import { viewCall, versionedNonce } from "../src/intents.js";

const DEFUSE_WASM = process.argv[2];
if (!DEFUSE_WASM) throw new Error("usage: testnet-intents.ts <defuse.wasm>");
const RPC = "https://rpc.testnet.fastnear.com";
const USDC_T = "usdc.fakes.testnet";
const BASE_ID = `nep141:${USDC_T}`;
const TGAS = 1_000_000_000_000n;
const A = JSON.parse(readFileSync("data/testnet-accounts.json", "utf8"));
const B = JSON.parse(readFileSync("data/testnet-intents-accounts.json", "utf8")) as Record<"intents" | "fund" | "vault2", string>;
const K = JSON.parse(readFileSync("data/testnet-keys.json", "utf8"));
const qKey = KeyPair.fromString(K.testQuote), att = KeyPair.fromString(K.attestation);
const near = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) } as unknown as Parameters<typeof connect>[0]);
const txs: { step: string; tx: string }[] = [];
const view = <T>(c: string, m: string, a: object = {}) => viewCall<T>(RPC, c, m, a, fetch, "optimistic");

async function call(who: string, contractId: string, methodName: string, args: object, opts: { gas?: bigint; deposit?: bigint } = {}) {
  const a: Account = await near.account(who);
  const o = await a.functionCall({ contractId, methodName, args, gas: opts.gas ?? 100n * TGAS, attachedDeposit: opts.deposit ?? 0n });
  const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  txs.push({ step: `${methodName} (${who.split("-")[1]} → ${contractId.split("-")[1] ?? contractId})`, tx: o.transaction.hash });
  if (failure) throw new Error(`${methodName} failed (${o.transaction.hash}): ${JSON.stringify(failure).slice(0, 400)}`);
  console.log(`  ✓ ${methodName.padEnd(18)} ${o.transaction.hash}`);
  return providers.getTransactionLastResult(o) as any;
}

// 1. fund and deploy defuse
const ia = await near.account(B.intents);
if ((await ia.state()).code_hash === "11111111111111111111111111111111") {
  const f = await (await near.account(B.fund)).sendMoney(B.intents, 9_000_000_000_000_000_000_000_000n);
  txs.push({ step: "fund intents account (9 NEAR)", tx: f.transaction.hash });
  const d = await ia.deployContract(readFileSync(DEFUSE_WASM));
  txs.push({ step: "deploy defuse 0.2.10", tx: d.transaction.hash });
  console.log(`  ✓ deploy defuse      ${d.transaction.hash}`);
  await call(B.intents, B.intents, "new", { config: { wnear_id: "wrap.testnet", fees: { fee: 0, fee_collector: B.intents }, roles: { super_admins: [], admins: {}, grantees: {} } } }, { gas: 100n * TGAS });
}

// 2. vault2 pointed at it
const va = await near.account(B.vault2);
if ((await va.state()).code_hash === "11111111111111111111111111111111") {
  const d = await va.deployContract(readFileSync(new URL("../../contract/target/near/silent_partner.wasm", import.meta.url)));
  txs.push({ step: "deploy vault2", tx: d.transaction.hash });
  console.log(`  ✓ deploy vault2      ${d.transaction.hash}`);
  await call(B.vault2, B.vault2, "new", { cfg: {
    owner: B.vault2, operator: A.operator, leader: A.leader, base_token: USDC_T, base_asset_id: BASE_ID,
    intents_contract: B.intents, mpc_contract: "v1.signer-prod.testnet", mpc_path: "silent-partner/vault",
    oneclick_key: qKey.getPublicKey().toString(), attestation_key: att.getPublicKey().toString(),
    perf_fee_bps: 2000, min_leader_bps: 1000, max_slippage_bps: 100, min_deposit: "1000000", allowed_assets: [BASE_ID, "nep141:wrap.testnet"],
  } });
  await call(A.operator, B.vault2, "activate", {}, { gas: 50n * TGAS });
}
const vaultAccount = (await view<any>(B.vault2, "get_vault")).vault_account as string;
const vaultPk = "ed25519:" + base58.encode(Buffer.from(vaultAccount, "hex"));
console.log(`  vault2 MPC account ${vaultAccount}`);

// 3. storage on the fake USDC, then a leader deposit
for (const who of [B.vault2, B.intents]) {
  if (!(await view(USDC_T, "storage_balance_of", { account_id: who }))) await call(A.operator, USDC_T, "storage_deposit", { account_id: who }, { deposit: 1_250_000_000_000_000_000_000n, gas: 30n * TGAS });
}
await call(A.leader, USDC_T, "mint", { account_id: A.leader, amount: "10000000" }, { gas: 30n * TGAS });
const before = BigInt(await view<string>(B.intents, "mt_balance_of", { account_id: vaultAccount, token_id: BASE_ID }));
await call(A.leader, USDC_T, "ft_transfer_call", { receiver_id: B.vault2, amount: "10000000", msg: "" }, { deposit: 1n, gas: 150n * TGAS });
const afterDeposit = BigInt(await view<string>(B.intents, "mt_balance_of", { account_id: vaultAccount, token_id: BASE_ID }));
const inContract = BigInt(await view<string>(USDC_T, "ft_balance_of", { account_id: B.vault2 }));
console.log(`  forward: intents balance of vault ${before} → ${afterDeposit}; left in contract ${inContract}`);

// 4. MPC-signed Shield-shaped transfer, executed by defuse
const dep = randomBytes(32).toString("hex"); // stands in for a 1Click deposit address
const amount = "1000000";
const deadlineMs = Date.now() + 10 * 60_000;
const q = signTestQuote({
  originAsset: BASE_ID, destinationAsset: BASE_ID, amount, minAmountOut: amount, slippageTolerance: 0,
  depositType: "INTENTS", recipientType: "CONFIDENTIAL_INTENTS", refundType: "INTENTS",
  recipient: vaultAccount, refundTo: vaultAccount, depositAddress: dep, deadline: new Date(deadlineMs + 5 * 60_000).toISOString(),
}, qKey);
let nonce: Buffer;
try {
  nonce = versionedNonce(await view<string>(B.intents, "current_salt"), deadlineMs);
} catch {
  nonce = randomBytes(32); // 0.2.10 predates versioned nonces
}
// Exactly the strict shape the vault signs (and 1Click's generate-intent produces).
const payload = { message: JSON.stringify({ deadline: new Date(deadlineMs).toISOString(), intents: [{ intent: "transfer", receiver_id: dep, tokens: { [BASE_ID]: amount } }], signer_id: vaultAccount }), nonce: nonce.toString("base64"), recipient: B.intents };
let executed = false, refusedReason: string | null = null;
const signature: string | null = await call(A.operator, B.vault2, "sign_intent", { kind: "Shield", payload, quote: q }, { gas: 300n * TGAS });
try {
  await call(A.operator, B.intents, "execute_intents", { signed: [{ standard: "nep413", payload, public_key: vaultPk, signature }] }, { gas: 300n * TGAS });
  executed = true;
} catch (e) {
  refusedReason = String(e).slice(0, 500);
  console.log("  execute_intents refused:", refusedReason);
}
const depBal = BigInt(await view<string>(B.intents, "mt_balance_of", { account_id: dep, token_id: BASE_ID }));
const vaultBal = BigInt(await view<string>(B.intents, "mt_balance_of", { account_id: vaultAccount, token_id: BASE_ID }));
const out = { ranAt: new Date().toISOString(), accounts: B, vaultAccount, forward: { before: before.toString(), afterDeposit: afterDeposit.toString(), inContract: inContract.toString() }, transfer: { dep, amount, signature, executed, refusedReason, depBalance: depBal.toString(), vaultBalanceAfter: vaultBal.toString() }, txs };
writeFileSync("data/testnet-intents.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ forward: out.forward, transfer: out.transfer }, null, 2));
