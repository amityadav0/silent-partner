"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ASSETS, VAULTS } from "@/lib/config";
import { aumBucket, loadVault, maxDrawdown, priceOf, status, verifyNavs, type VaultData } from "@/lib/vault";
import { metaOf, modeLabel } from "@/lib/vaults";
import { ModeChip, Ret, StatusChip, short } from "./ui";

type Row = { d: VaultData; ret: number; dd: number; verified: string };

export default function Leaderboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    Promise.allSettled(VAULTS.map((v) => loadVault(v))).then((rs) => {
      const ok: Row[] = [];
      const errs: string[] = [];
      rs.forEach((r, i) => {
        if (r.status === "rejected") return errs.push(`${VAULTS[i]}: ${String(r.reason?.message ?? r.reason)}`);
        const d = r.value;
        const last = d.navs.at(-1);
        const v = verifyNavs(d.id, d.cfg.attestation_key, d.navs);
        ok.push({ d, ret: last ? priceOf(last.price) - 1 : 0, dd: maxDrawdown(d.navs), verified: `${v.ok}/${d.navs.length}` });
      });
      ok.sort((a, b) => b.ret - a.ret);
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
              <th>#</th><th>Vault</th><th>Return</th><th>Max drawdown</th><th>AUM</th><th>Epochs</th><th>Attested</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr><td colSpan={8} className="muted">Reading vaults from NEAR…</td></tr>
            )}
            {rows?.length === 0 && (
              <tr><td colSpan={8} className="muted">No vaults yet.</td></tr>
            )}
            {rows?.map((r, i) => (
              <tr key={r.d.id} data-testid={`row-${r.d.id}`}>
                <td>{i + 1}</td>
                <td>
                  <Link href={`/vault/?id=${r.d.id}`} className="font-semibold">{metaOf(r.d.id).name}</Link> <ModeChip id={r.d.id} />
                  <div className="muted text-xs">{short(r.d.id, 10)} · leader {short(r.d.cfg.leader, 8)}</div>
                </td>
                <td className="font-semibold"><Ret r={r.ret} /></td>
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
