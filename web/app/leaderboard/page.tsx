"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ASSETS, VAULTS } from "@/lib/config";
import { aumBucket, loadVault, maxDrawdown, priceOf, returns, status, verifyNavs, type VaultData } from "@/lib/vault";
import { metaOf, modeLabel } from "@/lib/vaults";
import { ModeChip, Ret, Sparkline, StatusChip, short } from "../ui";

type Row = { d: VaultData; ret: number; dd: number; verified: string; aum: number };
type Key = "ret" | "dd" | "aum" | "epochs" | "name";
const SORTS: Record<Key, (a: Row, b: Row) => number> = {
  ret: (a, b) => b.ret - a.ret,
  dd: (a, b) => a.dd - b.dd,
  aum: (a, b) => b.aum - a.aum,
  epochs: (a, b) => b.d.navs.length - a.d.navs.length,
  name: (a, b) => metaOf(a.d.id).name.localeCompare(metaOf(b.d.id).name),
};

export default function Leaderboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [sort, setSort] = useState<Key>("ret");
  const sorted = useMemo(() => (rows ? [...rows].sort(SORTS[sort]) : null), [rows, sort]);
  const th = (k: Key, label: string, title?: string) => (
    <th>
      <button className={`sort ${sort === k ? "on" : ""}`} onClick={() => setSort(k)} title={title ?? `Sort by ${label.toLowerCase()}`} data-testid={`sort-${k}`} aria-pressed={sort === k}>
        {label}{sort === k ? " ↓" : ""}
      </button>
    </th>
  );
  useEffect(() => {
    Promise.allSettled(VAULTS.map((v) => loadVault(v))).then((rs) => {
      const ok: Row[] = [];
      const errs: string[] = [];
      rs.forEach((r, i) => {
        if (r.status === "rejected") return errs.push(`${VAULTS[i]}: ${String(r.reason?.message ?? r.reason)}`);
        const d = r.value;
        const last = d.navs.at(-1);
        const v = verifyNavs(d.id, d.cfg.attestation_key, d.navs);
        ok.push({ d, ret: last ? priceOf(last.price) - 1 : 0, dd: maxDrawdown(d.navs), verified: `${v.ok}/${d.navs.length}`, aum: Number(BigInt(d.vault.book_nav)) });
      });
      setRows(ok);
      setErrors(errs);
    });
  }, []);

  return (
    <section>
      <h1 className="text-2xl font-semibold">Leaderboard</h1>
      <p className="muted mt-1 max-w-2xl text-sm">
        Private copy-trading vaults on NEAR Confidential Intents. Followers and their leader share one confidential account. Every trade fills once, at one price, for the whole pool.
        You see attested NAV and returns. Positions are never published.
      </p>
      <div className="panel scroll-x mt-5 p-0">
        <table className="t" data-testid="leaderboard">
          <thead>
            <tr>
              <th>#</th>{th("name", "Vault")}{th("ret", "Return")}<th>Trend</th>{th("dd", "Max drawdown", "Sort by smallest drawdown")}{th("aum", "AUM")}{th("epochs", "Epochs")}<th>Attested</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr><td colSpan={9} className="muted">Reading vaults from NEAR…</td></tr>
            )}
            {rows?.length === 0 && (
              <tr><td colSpan={9} className="muted">No vaults yet.</td></tr>
            )}
            {sorted?.map((r, i) => (
              <tr key={r.d.id} data-testid={`row-${r.d.id}`}>
                <td>{i + 1}</td>
                <td>
                  <Link href={`/vault/?id=${r.d.id}`} className="font-semibold">{metaOf(r.d.id).name}</Link> <ModeChip id={r.d.id} />
                  <div className="muted text-xs" title={`leader ${r.d.cfg.leader}`}>{r.d.id}</div>
                </td>
                <td className="font-semibold"><Ret r={r.ret} /></td>
                <td><Sparkline points={returns(r.d.navs)} /></td>
                <td className="neg">{r.dd === 0 ? <span className="muted">0%</span> : `−${(r.dd * 100).toFixed(2)}%`}</td>
                <td>{aumBucket(r.d.vault.book_nav, ASSETS[r.d.cfg.base_asset_id]?.decimals ?? 6)}</td>
                <td>{r.d.navs.length}</td>
                <td title="NAV signatures verified in your browser against the operator's attestation key">{r.verified} ✓</td>
                <td><StatusChip s={status(r.d.vault)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted mt-2 text-xs" data-testid="honesty">
        Numbers marked <b>paper · testnet</b> are paper trades: fills are priced by real 1Click dry quotes, but no real funds move and the vaults hold testnet tokens. NAVs and signals are real testnet transactions.
      </p>
      {errors.map((e) => <p key={e} className="neg mt-2 text-sm">{e}</p>)}
      <div className="mt-8 grid gap-4 text-sm sm:grid-cols-3">
        <div><div className="font-semibold">One fill, one price</div><p className="muted mt-1">The operator executes each leader signal once, for the whole vault, through a 1Click confidential quote. Nobody gets in ahead of the followers.</p></div>
        <div><div className="font-semibold">The key can&apos;t be misused</div><p className="muted mt-1">The vault&apos;s intents key is an MPC key derived for the contract. The contract only signs transfers that go back to the vault or to a holder&apos;s own withdrawal.</p></div>
        <div><div className="font-semibold">Attested, not trusted</div><p className="muted mt-1">Each NAV post is signed by the operator and pinned to a hash-chained fill log. Your browser checks every signature.</p></div>
      </div>
    </section>
  );
}
