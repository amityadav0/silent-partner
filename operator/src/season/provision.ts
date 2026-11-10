// Deploys community vaults filed through the registry, and talks to the registry.
// Every step checks chain state first, so a half-finished launch completes on the next tick.
import { connect, keyStores, transactions, providers, KeyPair, type Account } from "near-api-js";
import { viewCall } from "../intents.js";
import { communityPersona, MAX_PROMPT, promptHash, unseal, vaultIdFor, type Launch, type SealedSignal } from "./community.js";

const TGAS = 1_000_000_000_000n;
const NEAR = 10n ** 24n;
/** What a new community vault account starts with (the launch deposit is 5 NEAR). */
export const VAULT_FUNDING = 45n * NEAR / 10n;
const EMPTY_CODE = "11111111111111111111111111111111";

export type Ctx = { rpc: string; operator: string; operatorKey: string; registry: string; template: string; usdc: string; wasm: Uint8Array; sealSk: Uint8Array };

export async function operatorAccount(rpc: string, id: string, key: string): Promise<Account> {
  const ks = new keyStores.InMemoryKeyStore();
  await ks.setKey("testnet", id, KeyPair.fromString(key as `ed25519:${string}`));
  const near = await connect({ networkId: "testnet", nodeUrl: rpc, keyStore: ks } as unknown as Parameters<typeof connect>[0]);
  return near.account(id);
}

async function call(a: Account, contractId: string, methodName: string, args: object, gas = 100n * TGAS, deposit = 0n) {
  const o = await a.functionCall({ contractId, methodName, args, gas, attachedDeposit: deposit });
  const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
  if (failure) throw new Error(`${methodName} (${o.transaction.hash}): ${String(JSON.stringify(failure)).slice(0, 240)}`);
  return { tx: o.transaction.hash, value: providers.getTransactionLastResult(o) };
}

export async function launches(rpc: string, registry: string): Promise<Launch[]> {
  const out: Launch[] = [];
  for (let from = 0; ; from += 50) {
    const page = await viewCall<Launch[]>(rpc, registry, "get_launches", { from, limit: 50 }, fetch, "optimistic");
    out.push(...page);
    if (page.length < 50) return out;
  }
}
export const pendingSignals = (rpc: string, registry: string) => viewCall<SealedSignal[]>(rpc, registry, "pending_signals", {}, fetch, "optimistic");
export const ackSignals = (a: Account, registry: string, upto: number) => call(a, registry, "ack_signals", { upto: String(upto) }, 30n * TGAS);

async function accountCode(rpc: string, id: string): Promise<string | null> {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "optimistic", account_id: id } }) });
  const j = (await r.json()) as { result?: { code_hash: string }; error?: unknown };
  return j.result ? j.result.code_hash : null;
}

/** Check a launch before spending anything on it. Returns the reason to reject it, or null. */
export async function vet(l: Launch, sealSk: Uint8Array): Promise<string | null> {
  if (l.kind !== "ai") return null;
  let text: string;
  try {
    text = await unseal(l.sealed_prompt ?? "", sealSk, "launch");
  } catch {
    return "the sealed strategy can't be opened";
  }
  if (promptHash(text) !== l.prompt_hash) return "the sealed strategy doesn't match its hash";
  if (text.length > MAX_PROMPT) return `the strategy is longer than ${MAX_PROMPT} characters`;
  if (!communityPersona(l, text)) return "the strategy's limits contradict its risk band";
  return null;
}

/** Deploy and activate one pending launch, then mark it live. Returns the txs, for the run log. */
export async function provision(c: Ctx, a: Account, l: Launch): Promise<{ vault: string; txs: string[]; rejected?: string }> {
  const vault = vaultIdFor(l.id, c.operator);
  const txs: string[] = [];
  const why = await vet(l, c.sealSk);
  if (why) {
    txs.push((await call(a, c.registry, "set_status", { id: l.id, status: "rejected", vault: null, note: why }, 30n * TGAS)).tx);
    return { vault, txs, rejected: why };
  }
  const cfg = { ...(await viewCall<Record<string, unknown>>(c.rpc, c.template, "get_config", {}, fetch, "optimistic")), owner: c.operator, leader: l.leader };
  const code = await accountCode(c.rpc, vault);
  if (code === null) {
    const r = await a.signAndSendTransaction({
      receiverId: vault,
      actions: [transactions.createAccount(), transactions.transfer(VAULT_FUNDING), transactions.deployContract(c.wasm), transactions.functionCall("new", { cfg }, 100n * TGAS, 0n)],
    });
    const failure = (r.receipts_outcome as any[]).map((x) => x.outcome.status?.Failure).find(Boolean);
    if (failure) throw new Error(`create ${vault} (${r.transaction.hash}): ${String(JSON.stringify(failure)).slice(0, 240)}`);
    txs.push(r.transaction.hash);
  } else if (code === EMPTY_CODE) {
    throw new Error(`${vault} exists without code; fix by hand`);
  }
  if (!(await viewCall(c.rpc, vault, "get_config", {}, fetch, "optimistic").then(() => true, () => false))) txs.push((await call(a, vault, "new", { cfg })).tx);
  if (!(await viewCall<{ vault_account: string | null }>(c.rpc, vault, "get_vault", {}, fetch, "optimistic")).vault_account) txs.push((await call(a, vault, "activate", {}, 50n * TGAS)).tx);
  if (!(await viewCall(c.rpc, c.usdc, "storage_balance_of", { account_id: vault }, fetch, "optimistic"))) txs.push((await call(a, c.usdc, "storage_deposit", { account_id: vault }, 30n * TGAS, 1_250_000_000_000_000_000_000n)).tx);
  txs.push((await call(a, c.registry, "set_status", { id: l.id, status: "live", vault, note: null }, 30n * TGAS)).tx);
  return { vault, txs };
}
