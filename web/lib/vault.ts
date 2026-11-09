// Vault reads (NEAR RPC, in the browser) and the public metrics derived from
// them. Only on-chain NAV posts are used: no positions exist anywhere here.
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { RPC } from "./config";

export type NavPost = { epoch: number; nav: string; timestamp_ms: number; block_ms: number; price: string; total_shares: string; fee_shares: string; withdrawn: string; fills_head: string; signature: string };
export type VaultView = { vault_account: string | null; total_shares: string; book_nav: string; price: string; hwm: string; epoch: number; last_nav_ms: number; stale: boolean; emergency: boolean; leader_shares: string; pending_withdrawals: number; signals: number };
export type Config = { owner: string; operator: string; leader: string; base_token: string; base_asset_id: string; attestation_key: string; oneclick_key: string; perf_fee_bps: number; min_leader_bps: number; max_slippage_bps: number; min_deposit: string; allowed_assets: string[]; intents_contract: string | null };
export type Claim = { id: number; account: string; exit_account: string; amount: string; paid: string; in_flight: { amount: string }[]; epoch: number; emergency: boolean };
export type SignalRec = { index: number; hash: string; fill_hash: string; executed_ms: number; epoch: number };

export async function view<T>(contract: string, method: string, args: object = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const r = await fetchImpl(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) } }),
  });
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error(`${contract}.${method}: ${JSON.stringify(j.error?.data ?? j.result?.error).slice(0, 200)}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) as T;
}

export type VaultData = { id: string; vault: VaultView; cfg: Config; navs: NavPost[] };

export async function loadVault(id: string, fetchImpl: typeof fetch = fetch): Promise<VaultData> {
  const [vault, cfg] = await Promise.all([view<VaultView>(id, "get_vault", {}, fetchImpl), view<Config>(id, "get_config", {}, fetchImpl)]);
  const navs: NavPost[] = [];
  for (let from = 0; ; from += 100) {
    const page = await view<NavPost[]>(id, "get_navs", { from, limit: 100 }, fetchImpl);
    navs.push(...page);
    if (page.length < 100) break;
  }
  return { id, vault, cfg, navs };
}

const SCALE = 1e18;
export const priceOf = (p: string) => Number(BigInt(p)) / SCALE;

/** Return series from the post-fee price per share (vaults start at price 1). */
export function returns(navs: NavPost[]): { t: number; r: number }[] {
  return navs.map((n) => ({ t: n.timestamp_ms, r: priceOf(n.price) - 1 }));
}

/** Largest peak-to-trough fall of the share price, as a fraction (0.2 = −20%). */
export function maxDrawdown(navs: NavPost[]): number {
  let peak = 1, dd = 0;
  for (const n of navs) {
    const p = priceOf(n.price);
    if (p > peak) peak = p;
    if (peak > 0) dd = Math.max(dd, (peak - p) / peak);
  }
  return dd;
}

/** AUM shown as a bucket, never the exact figure. */
export function aumBucket(units: string, decimals: number): string {
  const v = Number(BigInt(units)) / 10 ** decimals;
  if (v < 1_000) return "< $1k";
  if (v < 10_000) return "$1k–10k";
  if (v < 100_000) return "$10k–100k";
  if (v < 1_000_000) return "$100k–1M";
  return "> $1M";
}

/** The exact string the operator's attestation key signs (contract `nav_message`). */
export const navMessage = (contract: string, n: Pick<NavPost, "epoch" | "nav" | "timestamp_ms" | "fills_head">) =>
  `silent-partner/nav/v1|${contract}|${n.epoch}|${n.nav}|${n.timestamp_ms}|${n.fills_head}`;

/** Re-verify every NAV attestation in the browser. */
export function verifyNavs(contract: string, attestationKey: string, navs: NavPost[]): { ok: number; bad: number[] } {
  const pk = base58.decode(attestationKey.replace(/^ed25519:/, ""));
  const bad: number[] = [];
  for (const n of navs) {
    let good = false;
    try {
      good = ed25519.verify(base58.decode(n.signature.replace(/^ed25519:/, "")), new TextEncoder().encode(navMessage(contract, n)), pk);
    } catch {
      good = false;
    }
    if (!good) bad.push(n.epoch);
  }
  return { ok: navs.length - bad.length, bad };
}

export function status(v: VaultView): "active" | "stale" | "emergency" | "inactive" {
  if (!v.vault_account) return "inactive";
  if (v.emergency) return "emergency";
  return v.stale ? "stale" : "active";
}

export const pct = (x: number, digits = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)}%`;

export function fmtUnits(units: string | bigint, decimals: number, max = 2): string {
  const v = Number(BigInt(units)) / 10 ** decimals;
  return v.toLocaleString("en-US", { maximumFractionDigits: max, minimumFractionDigits: Math.min(2, max) });
}

/** Parse a human amount into raw units, exactly (no floats). */
export function toUnits(human: string, decimals: number): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(human.trim());
  if (!m || (m[2]?.length ?? 0) > decimals) return null;
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0") || "0");
}
