"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ASSETS } from "@/lib/config";
import { aumBucket, maxDrawdown, priceOf, returns, status, verifyNavs } from "@/lib/vault";
import { Ret, ReturnsChart, StatusChip, short, useQueryParam, useVault } from "../ui";

/** Public share card for one vault: returns and proof, nothing else. */
export default function Share() {
  const id = useQueryParam("id");
  const { data, error } = useVault(id);
  const m = useMemo(() => {
    if (!data) return null;
    const last = data.navs.at(-1);
    return { ret: last ? priceOf(last.price) - 1 : 0, dd: maxDrawdown(data.navs), v: verifyNavs(data.id, data.cfg.attestation_key, data.navs), since: data.navs[0]?.timestamp_ms };
  }, [data]);
  if (id === null) return <p>Missing <code>?id=</code>.</p>;
  if (error) return <p className="neg">{error}</p>;
  if (!data || !m) return <p className="muted">Reading vault from NEAR…</p>;
  const allOk = m.v.bad.length === 0 && data.navs.length > 0;
  return (
    <section className="mx-auto max-w-xl" data-testid="share">
      <div className="panel">
        <div className="flex items-center gap-2">
          <span className="muted text-xs uppercase tracking-wide">Silent Partner vault</span>
          <StatusChip s={status(data.vault)} />
        </div>
        <h1 className="mt-1 text-xl font-semibold">{short(data.id, 16)}</h1>
        <p className="muted text-sm">Led by {short(data.cfg.leader, 12)}</p>
        <div className="mt-4 text-5xl font-bold tabular-nums" data-testid="share-return"><Ret r={m.ret} /></div>
        <p className="muted text-sm">
          since {m.since ? new Date(m.since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "inception"}, after fees
          {" · "}max drawdown {m.dd === 0 ? "0%" : `−${(m.dd * 100).toFixed(2)}%`}
          {" · "}AUM {aumBucket(data.vault.book_nav, ASSETS[data.cfg.base_asset_id]?.decimals ?? 6)}
        </p>
        <div className="mt-4"><ReturnsChart points={returns(data.navs)} height={150} /></div>
        <p className={`mt-3 text-sm ${allOk ? "pos" : "neg"}`} data-testid="share-proof">
          {allOk ? "✓" : "✗"} {m.v.ok} of {data.navs.length} NAV posts verified in your browser against the operator&apos;s key {short(data.cfg.attestation_key, 6)}
        </p>
        <p className="muted mt-1 text-xs">Positions are private. The vault trades through NEAR Confidential Intents, and only NAV is published.</p>
      </div>
      <p className="mt-3 text-center text-sm"><Link href={`/vault/?id=${data.id}`}>Open the vault</Link></p>
    </section>
  );
}
