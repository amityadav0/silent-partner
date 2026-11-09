// The vault contract as the operator sees it. `NearVault` talks to NEAR;
// tests use an in-memory fake with the same interface.
import { connect, keyStores, providers, KeyPair, type Account } from "near-api-js";
import { viewCall, type Nep413Payload } from "./intents.js";
import type { SignedQuote } from "./carry/signedQuote.js";

export type SignKind = "Login" | "Shield" | "Trade" | "Unshield" | { PublicPayout: { claim_id: number } };
export type VaultView = { vault_account: string | null; total_shares: string; book_nav: string; price: string; hwm: string; epoch: number; last_nav_ms: number; stale: boolean; emergency: boolean; leader_shares: string; pending_withdrawals: number; signals: number };
export type InFlight = { prehash: string; nonce: string; amount: string; deadline_ms: number; signed: boolean };
export type Claim = { id: number; account: string; exit_account: string; amount: string; paid: string; in_flight: InFlight[]; epoch: number; emergency: boolean; opened_ms?: number };
export type SignedIntent = { standard: "nep413"; payload: Nep413Payload; public_key: string; signature: string };
export type Config = { base_token: string; base_asset_id: string; allowed_assets: string[]; max_slippage_bps: number; intents_contract: string | null; leader: string };

export interface VaultChain {
  readonly contractId: string;
  getVault(): Promise<VaultView>;
  getConfig(): Promise<Config>;
  getClaims(): Promise<Claim[]>;
  getSignalKey(): Promise<string | null>;
  /** Base units of the base asset held publicly: in the contract + on intents.near for the vault account. */
  publicBase(): Promise<bigint>;
  postNav(epoch: number, nav: string, timestampMs: number, fillsHead: string, signature: string): Promise<string>;
  recordSignal(hash: string, leaderSig: string, fillHash: string, executedMs: number): Promise<string>;
  signIntent(kind: SignKind, payload: Nep413Payload, quote: SignedQuote | null): Promise<{ tx: string; signature: string | null }>;
  /** Anyone: settle an in-flight payout against the public verifier's nonce record. Returns "paid" | "released" | "pending" | … */
  settlePayout(claimId: number, prehash: string): Promise<{ tx: string; result: string }>;
  /** Submit signed intents to the public verifier (intents.near) ourselves. */
  executeIntents(verifier: string, signed: SignedIntent[]): Promise<string>;
  /** The vault's balance of `asset` on the public verifier. */
  publicBalance(asset: string): Promise<bigint>;
}

const TGAS = 1_000_000_000_000n;

export class NearVault implements VaultChain {
  private account?: Account;
  constructor(readonly contractId: string, private rpc: string, private network: "testnet" | "mainnet", private operatorId: string, private operatorKey?: string, private intentsRpc = rpc) {}

  private view<T>(m: string, a: object = {}) {
    return viewCall<T>(this.rpc, this.contractId, m, a, fetch, "optimistic");
  }
  private async acct(): Promise<Account> {
    if (this.account) return this.account;
    const ks = new keyStores.InMemoryKeyStore();
    if (!this.operatorKey) throw new Error("OPERATOR_PRIVATE_KEY not set");
    await ks.setKey(this.network, this.operatorId, KeyPair.fromString(this.operatorKey as `ed25519:${string}`));
    // near-api-js 5's ConnectConfig re-export doesn't resolve under NodeNext; the shape is right.
    const near = await connect({ networkId: this.network, nodeUrl: this.rpc, keyStore: ks } as unknown as Parameters<typeof connect>[0]);
    return (this.account = await near.account(this.operatorId));
  }
  private async call(methodName: string, args: object, gas = 100n * TGAS): Promise<{ tx: string; result: any }> {
    const o = await (await this.acct()).functionCall({ contractId: this.contractId, methodName, args, gas, attachedDeposit: 0n });
    const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
    if (failure) throw new Error(`${methodName}: ${JSON.stringify(failure).slice(0, 300)}`);
    return { tx: o.transaction.hash, result: providers.getTransactionLastResult(o) };
  }

  getVault() { return this.view<VaultView>("get_vault"); }
  getConfig() { return this.view<Config>("get_config"); }
  async getClaims() {
    const out: Claim[] = [];
    for (let from = 0; ; from += 200) {
      const page = await this.view<Claim[]>("get_claims", { from, limit: 200 });
      out.push(...page);
      if (page.length < 200) return out;
    }
  }
  getSignalKey() { return this.view<string | null>("get_signal_key"); }
  async publicBase(): Promise<bigint> {
    const cfg = await this.getConfig();
    const v = await this.getVault();
    const inContract = BigInt(await viewCall<string>(this.rpc, cfg.base_token, "ft_balance_of", { account_id: this.contractId }, fetch, "optimistic"));
    if (!cfg.intents_contract || !v.vault_account) return inContract;
    const onIntents = BigInt(await viewCall<string>(this.intentsRpc, cfg.intents_contract, "mt_balance_of", { account_id: v.vault_account, token_id: cfg.base_asset_id }));
    return inContract + onIntents;
  }
  async postNav(epoch: number, nav: string, timestamp_ms: number, fills_head: string, signature: string) {
    // A post burns up to 100 queued withdrawals: give it room.
    return (await this.call("post_nav", { epoch, nav, timestamp_ms, fills_head, signature }, 300n * TGAS)).tx;
  }
  async recordSignal(hash: string, leader_sig: string, fill_hash: string, executed_ms: number) {
    return (await this.call("record_signal", { hash, leader_sig, fill_hash, executed_ms })).tx;
  }
  async signIntent(kind: SignKind, payload: Nep413Payload, quote: SignedQuote | null) {
    const q = quote ? { message: quote.message, signature: quote.signature } : null;
    const r = await this.call("sign_intent", { kind, payload, quote: q }, 300n * TGAS);
    return { tx: r.tx, signature: (r.result as string | null) ?? null };
  }
  async settlePayout(claim_id: number, prehash: string) {
    const r = await this.call("settle_payout", { claim_id, prehash }, 60n * TGAS);
    return { tx: r.tx, result: String(r.result) };
  }
  async executeIntents(verifier: string, signed: SignedIntent[]) {
    const o = await (await this.acct()).functionCall({ contractId: verifier, methodName: "execute_intents", args: { signed }, gas: 300n * TGAS, attachedDeposit: 0n });
    const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
    if (failure) throw new Error(`execute_intents: ${JSON.stringify(failure).slice(0, 300)}`);
    return o.transaction.hash;
  }
  async publicBalance(asset: string) {
    const [cfg, v] = await Promise.all([this.getConfig(), this.getVault()]);
    if (!v.vault_account) return 0n;
    return BigInt(await viewCall<string>(this.intentsRpc, cfg.intents_contract ?? "intents.near", "mt_balance_of", { account_id: v.vault_account, token_id: asset }));
  }
}
