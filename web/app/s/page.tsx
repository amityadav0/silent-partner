"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ASSETS } from "@/lib/config";
import { seasonUrl } from "@/lib/vault";
import { aumBucket, cardUrl, drawdownWindow, leaderStake, maxDrawdown, priceOf, returns, sharpeLike, status, verifyNavs } from "@/lib/vault";
import { useState } from "react";
import { PageSkeleton, Redact, Ret, ReturnsChart, ModeChip, StatusChip, short, useQueryParam, useVault } from "../ui";
import { metaOf } from "@/lib/vaults";

/** Public share card for one vault: returns and proof, nothing else. */
export default function Share() {
  const id = useQueryParam("id");
  const { data, error } = useVault(id);
  const m = useMemo(() => {
    if (!data) return null;
    const last = data.navs.at(-1);
    return {
      ret: last ? priceOf(last.price) - 1 : 0,
      dd: maxDrawdown(data.navs),
      v: verifyNavs(data.id, data.cfg.attestation_key, data.navs),
      since: data.navs[0]?.timestamp_ms,
      sharpe: sharpeLike(data.navs),
      leaderPct: Number(data.vault.total_shares) > 0 ? Number(data.vault.leader_shares) / Number(data.vault.total_shares) : 0,
    };
  }, [data]);
  if (id === null) return <p>Missing <code>?id=</code>.</p>;
  if (error) return <p className="neg">{error}</p>;
  if (!data || !m) return <PageSkeleton />;
  const allOk = m.v.bad.length === 0 && data.navs.length > 0;
  return (
    <section className="mx-auto max-w-xl" data-testid="share">
      <div className="panel">
        <div className="flex items-center gap-2">
          <span className="muted text-xs uppercase tracking-wide">Silent Partner vault</span>
          <ModeChip id={data.id} />
          <StatusChip s={status(data.vault)} />
        </div>
        <h1 className="mt-2">{metaOf(data.id).name}</h1>
        <p className="muted text-xs">{short(data.id, 16)}</p>
        <p className="muted text-sm">Led by {short(data.cfg.leader, 12)}</p>
        <div className="mt-4 text-5xl tabular-nums" data-testid="share-return"><Ret r={m.ret} /></div>
        <p className="muted text-sm">
          since {m.since ? new Date(m.since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "inception"}, after fees
          {" · "}max drawdown {m.dd === 0 ? "0%" : `−${(m.dd * 100).toFixed(2)}%`}
          {" · "}AUM {aumBucket(data.vault.book_nav, ASSETS[data.cfg.base_asset_id]?.decimals ?? 6)}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm tabular-nums sm:grid-cols-4" data-testid="track-record">
          <div><div className="muted text-xs">Worst drawdown</div>{m.dd === 0 ? "0%" : `−${(m.dd * 100).toFixed(2)}%`}</div>
          <div><div className="muted text-xs">Sharpe-like</div>{m.sharpe === null ? <span className="muted">after 24h</span> : m.sharpe.toFixed(2)}</div>
          <div><div className="muted text-xs">Price updates</div>{data.navs.length}</div>
          <div><div className="muted text-xs">Leader holds</div>{(m.leaderPct * 100).toFixed(1)}%</div>
        </div>
        <div className="mt-4"><ReturnsChart points={returns(data.navs)} height={170} drawdown={drawdownWindow(data.navs)} /></div>
        <p className={`mt-3 text-sm ${allOk ? "pos" : "neg"}`} data-testid="share-proof">
          {allOk ? "✓" : "✗"} {m.v.ok} of {data.navs.length} price updates verified in your browser against the operator&apos;s key {short(data.cfg.attestation_key, 6)}
        </p>
        <div className="row-kv mt-2"><span>Holdings</span><span><Redact widths={[72, 40]} label="Holdings sealed" /></span></div>
        <p className="muted mt-1 text-xs">Positions are private. The vault trades privately; only its share price is published.</p>
      </div>
      <ShareImage id={data.id} name={metaOf(data.id).name} ret={m.ret} />
      <Badge id={data.id} stake={leaderStake(data.vault)} epochs={data.navs.length} />
      <p className="mt-3 text-center text-sm"><Link href={`/vault/?id=${data.id}`}>Open the vault</Link></p>
    </section>
  );
}

/** The season job's PNG of this card (regenerated every tick), ready to attach to a post. */
function ShareImage({ id, name, ret }: { id: string; name: string; ret: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  const url = cardUrl(id);
  const text = `${name} on Silent Partner: ${ret >= 0 ? "+" : "−"}${Math.abs(ret * 100).toFixed(2)}% after fees, every price update verified in your browser, positions never public. Built at #NEARHackathon`;
  return (
    <div className="panel mt-3" data-testid="share-image">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`${name} track-record card`} className="w-full rounded" onError={() => setOk(false)} />
      <p className="mt-2 flex flex-wrap gap-3 text-sm">
        <a href={url} download={`${id}.png`}>Open the image</a>
        <a href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`https://amityadav0.github.io/silent-partner/v/${id}/`)}`}>Post on X</a>
      </p>
    </div>
  );
}

/** An embeddable badge (rendered by the season each tick) and a line for an X bio. */
function Badge({ id, stake, epochs }: { id: string; stake: number; epochs: number }) {
  const link = `https://amityadav0.github.io/silent-partner/v/${id}/`;
  const img = seasonUrl(`badges/${id}.png`);
  const bio = `Leading on Silent Partner ✓ verified on chain · ${epochs} price updates · ${Math.round(stake * 100)}% own money in · positions sealed`;
  const md = `[![Silent Partner](${img})](${link})`;
  const [ok, setOk] = useState(true);
  return (
    <div className="panel mt-3 flex flex-col gap-3" data-testid="badge-embed">
      <h2>Badge</h2>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {ok && <img src={img} alt="Silent Partner badge" style={{ height: 28, width: "auto", alignSelf: "flex-start" }} onError={() => setOk(false)} />}
      <label className="flex flex-col gap-1 text-sm"><span className="muted">For a site or a README</span><input readOnly value={md} onFocus={(e) => e.target.select()} /></label>
      <label className="flex flex-col gap-1 text-sm"><span className="muted">For your X bio ({bio.length} characters)</span><input readOnly value={bio} onFocus={(e) => e.target.select()} data-testid="bio" /></label>
    </div>
  );
}
