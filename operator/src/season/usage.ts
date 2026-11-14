// Who uses Silent Partner, from public chain data only (A1). Read-only: nearblocks lists the
// receipts each vault received (deposits arrive as ft_on_transfer from the USDC contract), an
// RPC node resolves who signed each deposit and what each account holds now. Accounts the
// project runs (season/own-accounts.json) are left out. Published as counts only (usage.json).
import { readFileSync } from "node:fs";
import { viewCall } from "../intents.js";

export type Net = "testnet" | "mainnet";
const API: Record<Net, string> = { testnet: "https://api-testnet.nearblocks.io/v1", mainnet: "https://api.nearblocks.io/v1" };
const ARCHIVAL: Record<Net, string[]> = {
  testnet: ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"],
  mainnet: ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"],
};
const RPC: Record<Net, string> = { testnet: "https://rpc.testnet.fastnear.com", mainnet: "https://rpc.mainnet.fastnear.com" };

type Receipt = { receipt_id: string; predecessor_account_id: string; block_timestamp: string; actions: { method: string | null }[] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every receipt `account` received for `method`, oldest last; paced for nearblocks' free tier. */
export async function receipts(net: Net, account: string, method: string, f: typeof fetch = fetch, paceMs = 2_500): Promise<Receipt[]> {
  const out: Receipt[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 40; page++) {
    const url = `${API[net]}/account/${account}/receipts?method=${method}&per_page=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    let j: { txns?: Receipt[]; cursor?: string } | null = null;
    for (let t = 0; t < 5 && !j; t++) {
      const r = await f(url, { headers: { accept: "application/json" } });
      if (r.status === 429) {
        await sleep(15_000 * (t + 1));
        continue;
      }
      if (!r.ok) throw new Error(`nearblocks ${r.status} for ${account} ${method}`);
      j = await r.json();
    }
    if (!j) throw new Error(`nearblocks kept rate-limiting ${account}`);
    out.push(...(j.txns ?? []).filter((x) => x.actions?.some((a) => a.method === method)));
    if (!j.cursor || !(j.txns ?? []).length) break;
    cursor = j.cursor;
    await sleep(paceMs);
  }
  return out;
}

/** The account that signed the transaction a receipt belongs to. */
export async function receiptSigner(net: Net, receiptId: string, f: typeof fetch = fetch): Promise<string | null> {
  for (const url of ARCHIVAL[net]) {
    try {
      const r = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_receipt", params: { receipt_id: receiptId } }) });
      const j = await r.json();
      const s = j.result?.receipt?.Action?.signer_id;
      if (s) return s;
    } catch {
      /* next endpoint */
    }
  }
  return null;
}

export type Own = { accounts: Set<string>; patterns: RegExp[] };
export function loadOwn(path = new URL("../../season/own-accounts.json", import.meta.url)): Own {
  const d = JSON.parse(readFileSync(path, "utf8")) as { accounts: string[]; patterns: string[] };
  return { accounts: new Set(d.accounts), patterns: d.patterns.map((p) => new RegExp(p)) };
}
export const isOwn = (o: Own, id: string) => o.accounts.has(id) || o.patterns.some((p) => p.test(id));

export type VaultUsage = { vault: string; net: Net; depositors: string[]; holders: string[]; withdrawRequests: string[]; stopLosses: string[]; allHolders: number };

/** Outside accounts that deposited into / hold / asked to withdraw from / set a stop-loss on one vault. */
export async function vaultUsage(net: Net, vault: string, own: Own, f: typeof fetch = fetch): Promise<VaultUsage> {
  const dep = await receipts(net, vault, "ft_on_transfer", f);
  const all = new Set<string>();
  for (const r of dep) {
    const s = await receiptSigner(net, r.receipt_id, f);
    if (s) all.add(s);
  }
  const signers = new Set([...all].filter((a) => !isOwn(own, a)));
  const callers = async (m: string) => [...new Set((await receipts(net, vault, m, f)).map((r) => r.predecessor_account_id).filter((a) => !isOwn(own, a)))];
  const withdrawRequests = await callers("request_withdraw");
  const stopLosses = await callers("set_stop_loss");
  const holding: string[] = [];
  for (const a of all) {
    try {
      const [shares] = await viewCall<[string, string]>(RPC[net], vault, "get_shares", { account_id: a }, f, "optimistic");
      if (BigInt(shares) > 0n) holding.push(a);
    } catch {
      /* not a vault any more */
    }
  }
  const holders = holding.filter((a) => signers.has(a)).sort();
  return { vault, net, depositors: [...signers].sort(), holders, withdrawRequests, stopLosses, allHolders: holding.length };
}

export type Launch = { id: number; leader: string; name: string; created_ms: string; status: string; vault: string | null };

/** The public summary: counts only, no account names. */
export function summarize(vaults: VaultUsage[], launches: Launch[], own: Own, now = Date.now()) {
  const testnet = vaults.filter((v) => v.net === "testnet");
  const uniq = (xs: string[][]) => new Set(xs.flat()).size;
  const outsideLaunches = launches.filter((l) => !isOwn(own, l.leader));
  const active = new Set([...testnet.flatMap((v) => [...v.depositors, ...v.withdrawRequests, ...v.stopLosses]), ...outsideLaunches.map((l) => l.leader)]);
  const genesis = vaults.find((v) => v.net === "mainnet");
  return {
    ranAt: new Date(now).toISOString(),
    note: "Public chain data only; accounts the project runs are excluded. Counts, no names.",
    testnet: {
      outside_depositors: uniq(testnet.map((v) => v.depositors)),
      per_vault: Object.fromEntries(testnet.map((v) => [v.vault, { depositors: v.depositors.length, holders: v.holders.length, withdraw_requests: v.withdrawRequests.length, stop_losses: v.stopLosses.length }])),
      withdraw_requesters: uniq(testnet.map((v) => v.withdrawRequests)),
      stop_loss_setters: uniq(testnet.map((v) => v.stopLosses)),
      outside_accounts_active: active.size,
      outside_launches: outsideLaunches.map((l) => ({ id: l.id, name: l.name, status: l.status, launched: new Date(Number(l.created_ms)).toISOString().slice(0, 10) })),
    },
    mainnet: genesis ? { vault: genesis.vault, holders: genesis.allHolders, outside_depositors: genesis.depositors.length, outside_holders: genesis.holders.length } : null,
  };
}
