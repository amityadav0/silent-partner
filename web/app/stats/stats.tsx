"use client";
import { useEffect, useState } from "react";
import { seasonUrl } from "@/lib/vault";
import { lastDays } from "@/lib/funnel";

type Funnel = { ranAt: string; days?: Record<string, Record<string, number>>; paths?: Record<string, number> } & Record<string, unknown>;
type Usage = { ranAt: string; testnet: { outside_depositors: number; outside_accounts_active: number; withdraw_requesters: number; stop_loss_setters: number; outside_launches: { id: number; name: string; status: string; launched: string }[]; per_vault: Record<string, { depositors: number; holders: number }> }; mainnet: { holders: number; outside_holders: number } | null };

const get = <T,>(f: string) => fetch(`${seasonUrl(f)}?t=${Date.now()}`).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);

export function Stats() {
  const [f, setF] = useState<Funnel | null | undefined>(undefined);
  const [u, setU] = useState<Usage | null | undefined>(undefined);
  useEffect(() => {
    get<Funnel>("funnel.json").then(setF);
    get<Usage>("usage.json").then(setU);
  }, []);
  const row = (label: string, today: number | string, week: number | string, testid: string) => (
    <tr data-testid={testid}><td>{label}</td><td className="num">{today}</td><td className="num">{week}</td></tr>
  );
  const n = (k: string, days: number) => (f ? lastDays(f.days, k, days) : "…");
  return (
    <section className="flex max-w-3xl flex-col gap-6" data-testid="stats">
      <h1>Stats</h1>
      <p className="muted text-sm">Aggregate counts only. Page counts: no cookies, nothing per person (updated hourly{f ? `, last ${new Date(f.ranAt).toUTCString().slice(17, 22)} UTC` : ""}). On-chain usage: public chain data, accounts the project runs excluded{u ? ` (as of ${new Date(u.ranAt).toUTCString().slice(17, 22)} UTC)` : ""}.</p>
      <div className="panel p-0">
        <table className="lb w-full">
          <thead><tr><th>Site</th><th>Today (UTC)</th><th>Last 7 days</th></tr></thead>
          <tbody>
            {row("Page views", n("view", 1), n("view", 7), "st-views")}
            {row("Landing views", n("landing", 1), n("landing", 7), "st-landing")}
            {row("$100 copies started", n("copy_start", 1), n("copy_start", 7), "st-copy")}
            {row("/create/ai/ opens", n("create_open", 1), n("create_open", 7), "st-create")}
            {row("Wallets connected", n("wallet_connect", 1), n("wallet_connect", 7), "st-wallet")}
            {row("Shares", n("share_click", 1), n("share_click", 7), "st-share")}
          </tbody>
        </table>
      </div>
      {f?.paths && (
        <p className="text-sm" data-testid="st-paths">All-time views by page: {Object.entries(f.paths).sort((a, b) => b[1] - a[1]).map(([p, v]) => `${p} ${v}`).join(" · ")} <span className="muted">(per-page counting started Nov 14)</span></p>
      )}
      <div className="panel flex flex-col gap-2" data-testid="st-chain">
        <h2>On chain</h2>
        {u === undefined ? <p className="muted">Reading…</p> : u === null ? <p className="muted">usage.json not published yet.</p> : (
          <ul className="flex flex-col gap-1 text-[15px]">
            <li>Outside depositors (testnet): <b className="num" data-testid="st-depositors">{u.testnet.outside_depositors}</b></li>
            <li>Outside vaults launched: <b className="num" data-testid="st-launches">{u.testnet.outside_launches.length}</b>{u.testnet.outside_launches.map((l) => ` · ${l.name} (${l.launched}, ${l.status})`).join("")}</li>
            <li>Outside accounts active on chain (deposit, withdrawal, stop-loss, launch): <b className="num">{u.testnet.outside_accounts_active}</b></li>
            <li>Mainnet Genesis holders: <b className="num">{u.mainnet?.holders ?? "?"}</b> <span className="muted">({u.mainnet?.outside_holders ?? 0} from outside the project)</span></li>
          </ul>
        )}
      </div>
    </section>
  );
}
