import { readFileSync } from "node:fs";
import { KeyPair } from "near-api-js";
import type { VaultChain, VaultView, Claim, Config, SignKind } from "../src/chain.js";
import type { Nep413Payload } from "../src/intents.js";
import type { SignedQuote, QuoteResponse } from "../src/carry/signedQuote.js";
import { selfSignQuote } from "../src/carry/signedQuote.js";
import { USDC, WNEAR } from "../src/intents.js";

export const VAULT_ACCT = "7164eb86180b4bfefcc6cc906aff0673c80f49b9d3837f0916b93dee7bb12a8f";
export const fixture = (name: string) => readFileSync(new URL(`./fixtures/quote-${name}.json`, import.meta.url), "utf8");

export class FakeChain implements VaultChain {
  readonly contractId = "vault.testnet";
  view: VaultView = { vault_account: VAULT_ACCT, total_shares: "0", book_nav: "0", price: "0", hwm: "0", epoch: 0, last_nav_ms: 0, stale: false, emergency: false, leader_shares: "0", pending_withdrawals: 0, signals: 0 };
  cfg: Config = { base_token: "usdc", base_asset_id: USDC, allowed_assets: [USDC, WNEAR], max_slippage_bps: 100, intents_contract: "intents.near", leader: "leader.testnet" };
  claims: Claim[] = [];
  signalKey: string | null = null;
  public = 0n;
  calls: { m: string; args: unknown[] }[] = [];
  signWith?: KeyPair;
  getVault = async () => this.view;
  getConfig = async () => this.cfg;
  getClaims = async () => this.claims;
  getSignalKey = async () => this.signalKey;
  publicBase = async () => this.public;
  publicBal = 0n;
  settleResult = "paid";
  publicBalance = async () => this.publicBal;
  async postNav(epoch: number, nav: string, ts: number, head: string, sig: string) {
    this.calls.push({ m: "postNav", args: [epoch, nav, ts, head, sig] });
    this.view = { ...this.view, epoch, last_nav_ms: ts };
    return "tx-nav";
  }
  async recordSignal(...args: [string, string, string, number]) {
    this.calls.push({ m: "recordSignal", args });
    return "tx-sig";
  }
  async signIntent(kind: SignKind, payload: Nep413Payload, quote: SignedQuote | null) {
    this.calls.push({ m: "signIntent", args: [kind, payload, quote] });
    const { nep413Prehash } = await import("../src/intents.js");
    const { base58 } = await import("@scure/base");
    const sig = this.signWith ? "ed25519:" + base58.encode(this.signWith.sign(nep413Prehash(payload)).signature) : null;
    return { tx: "tx-sign", signature: sig };
  }
  async settlePayout(...args: [number, string]) {
    this.calls.push({ m: "settlePayout", args });
    return { tx: "tx-settle", result: this.settleResult };
  }
  async executeIntents(...args: [string, unknown[]]) {
    this.calls.push({ m: "executeIntents", args });
    return "tx-exec";
  }
}

/** A non-dry quote response signed by `key` the way 1Click signs, built from a real dry fixture. */
export function liveQuote(name: string, key: KeyPair, depositAddress: string): string {
  const dry = JSON.parse(fixture(name)) as QuoteResponse;
  const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
  const sq = selfSignQuote(dry, { depositAddress, deadline }, key.toString());
  return JSON.stringify({ ...dry, quoteRequest: { ...dry.quoteRequest, dry: false }, quote: { ...dry.quote, depositAddress, deadline }, signature: sq.signature });
}

type Route = (body: any, url: string) => { status?: number; text: string } | undefined;

/** fetch that serves 1Click routes from fixtures; records every request body. */
export function fixtureFetch(routes: Record<string, Route>, seen: { path: string; body: any }[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    seen.push({ path, body });
    const r = routes[path]?.(body, url);
    if (!r) return new Response(JSON.stringify({ message: `no route ${path}` }), { status: 404 });
    return new Response(r.text, { status: r.status ?? 200 });
  }) as typeof fetch;
}

/** Dry quote routing by asset pair and deposit type. */
export const dryQuotes: Route = (b) => {
  if (b.depositType === "INTENTS" && b.recipientType === "INTENTS") return { status: 201, text: fixture(b.originAsset === USDC ? "public-usdc-wnear" : "public-wnear-usdc") };
  const key = b.depositType === "INTENTS" ? "shield-usdc" : b.recipientType === "INTENTS" ? "unshield-usdc" : b.originAsset === USDC ? "trade-usdc-wnear" : "trade-wnear-usdc";
  return { status: 201, text: fixture(key) };
};
