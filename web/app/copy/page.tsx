"use client";
// "Your silent copy": the 10-second, no-wallet way in (V1) and the follower's share card (V2).
// A $100 simulated copy starts at the vault's latest signed share price and is valued at each
// later one. Nothing leaves the browser; the numbers shared are only that copy's real change.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadPaper, paperPosition, savePaper, startPaper, type PaperFollow } from "@/lib/paper";
import { agoWords, dipWords, nextUpdateWords, pctWords, shareText, shareUrl, sinceWords, COPY_DEFAULT } from "@/lib/copy";
import { metaOf } from "@/lib/vaults";
import { track } from "@/lib/funnel";
import { leaderStake, maxDrawdown, priceOf, verifyNavs, type VaultData } from "@/lib/vault";
import { copyVsNear, ptsWords, vsNear } from "@/lib/bench";
import { useAlertToggle } from "../vault/alerts";
import { copyText, LeaderChips, Redact, Sparkline, useFlash, useNear, useQueryParam, useVault } from "../ui";

const usd = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SilentCopy() {
  const q = useQueryParam("id");
  const start = useQueryParam("start");
  const id = q === undefined ? undefined : q || COPY_DEFAULT;
  const { data, error, reload } = useVault(id);
  const near = useNear();
  const alerts = useAlertToggle(id ?? "");
  const [flash, setFlash] = useFlash();
  const [, setNow] = useState(0);
  const router = useRouter();
  const [f, setF] = useState<PaperFollow | null | undefined>(undefined);
  const latest = data?.navs.at(-1);

  useEffect(() => {
    if (id) setF(loadPaper(id));
  }, [id]);
  useEffect(() => {
    // one tap from the landing page: start the $100 copy as soon as the share price is read
    if (!id || f !== null || start !== "1" || !latest) return;
    const p = startPaper(id, 100, latest);
    savePaper(p, id);
    setF(p);
    if (p) track("copy_start");
    router.replace(`/copy/?id=${encodeURIComponent(id)}`);
  }, [id, f, start, latest, router]);

  // Live while open: re-read every minute; a new price update can notify (the vault's alert switch).
  useEffect(() => {
    if (!id) return;
    const t = setInterval(() => { reload(); setNow(Date.now()); }, 60_000);
    return () => clearInterval(t);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastEpoch = useRef<number | null>(null);
  useEffect(() => {
    if (!latest || !f) return;
    if (lastEpoch.current !== null && latest.epoch > lastEpoch.current && alerts.on && typeof Notification !== "undefined") {
      const p = paperPosition(f, latest.price);
      new Notification("Silent Partner", { body: `${metaOf(f.vault)?.name ?? "Your leader"}: new price update. Your silent copy ${pctWords(p.pct)}.`, tag: `copy-${latest.epoch}` });
    }
    lastEpoch.current = latest.epoch;
  }, [latest, f, alerts.on]);

  const meta = id ? metaOf(id) : null;
  const pos = useMemo(() => (f && latest ? paperPosition(f, latest.price) : null), [f, latest]);
  const updates = f && data ? data.navs.filter((n) => n.epoch > f.entry_epoch).length : 0;

  if (error) return <p className="neg">{error}</p>;
  if (!id || !meta || f === undefined || !data) {
    return (
      <section className="copy-wrap">
        <div className="panel copy-card" data-testid="silent-copy-loading" aria-busy="true">
          <span className="eyebrow">Your silent copy</span>
          <div className="skeleton" style={{ height: 36, width: "55%" }} />
          <div className="skeleton" style={{ height: 48, width: "40%" }} />
          <p className="muted text-sm">Reading the leader&apos;s signed share price from NEAR…</p>
        </div>
      </section>
    );
  }

  if (!f || !pos) {
    return (
      <section className="copy-wrap">
        <div className="panel copy-card" data-testid="silent-copy-empty">
          <LeaderChips id={id} meta={meta} />
          <h1 className="text-3xl">Copy {meta.name} with $100</h1>
          <p className="muted">Simulated, no wallet. It follows the leader&apos;s real, signed share price. You never see their trades, and neither does anyone else.</p>
          <Record data={data} near={near ?? null} />
          <button
            className="btn btn-primary btn-lg self-start"
            disabled={!latest}
            onClick={() => {
              const p = startPaper(id, 100, latest);
              savePaper(p, id);
              setF(p);
              if (p) track("copy_start");
            }}
            data-testid="copy-start"
          >
            Start my $100 copy
          </button>
        </div>
      </section>
    );
  }

  const since = Date.now() - f.entry_ms;
  const rec = { ret: priceOf(latest!.price) - 1, dd: maxDrawdown(data.navs) };
  const recVs = vsNear(data.navs, near ?? null);
  const cVs = updates > 0 ? copyVsNear(Number(BigInt(f.entry_price)) / 1e18, f.entry_ms, Number(BigInt(latest!.price)) / 1e18, latest!.timestamp_ms, near ?? null) : null;
  const text = shareText({ name: meta.name, updates, copyPct: pos.pct, sinceMs: since, record: rec, copyVsNear: cVs?.pts ?? null, recordVsNear: recVs?.pts ?? null });
  const url = shareUrl(id);
  const next = nextUpdateWords(data.navs.map((n) => n.timestamp_ms));
  async function share() {
    track("share_click");
    if (typeof navigator.share === "function") {
      try {
        return await navigator.share({ text, url });
      } catch {
        /* cancelled: fall through to copying the link */
      }
    }
    if (await copyText(url)) setFlash("share");
  }
  return (
    <section className="copy-wrap">
      <div className="panel copy-card" data-testid="silent-copy">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">Your silent copy</span>
          <LeaderChips id={id} meta={meta} />
        </div>
        <h1 className="text-3xl">{meta.name}</h1>
        <div className="copy-value">
          <span className="num" data-testid="copy-value">{usd(pos.value)}</span>
          <span className="num muted" data-testid="copy-change">{pctWords(pos.pct)} ({usd(pos.pnl)}) since you joined</span>
          {cVs && (
            <span className={`num text-sm ${cVs.pts > 0 ? "vs-up" : "muted"}`} data-testid="copy-vs-near">
              {cVs.pts > 0 ? `beating NEAR by ${cVs.pts.toFixed(2)} pts since you joined` : `NEAR ${pctWords(cVs.near)} over the same time (${ptsWords(cVs.pts)})`}
            </span>
          )}
        </div>
        <Record data={data} near={near ?? null} />
        <div className="copy-next" data-testid="copy-next">
          <span className="text-sm">{updates === 0 ? "Your copy moves at the next price update" : `${updates} price update${updates === 1 ? "" : "s"} since you joined`}{next ? <>: next <b>{next}</b></> : null}</span>
          <button className="btn text-sm" onClick={alerts.toggle} aria-pressed={alerts.on} data-testid="copy-notify">{alerts.on ? "Notifying ✓" : "Notify me"}</button>
        </div>
        {alerts.note && <p className="neg text-sm" role="status">{alerts.note}</p>}
        <div className="row-kv">
          <span>The leader&apos;s trades</span>
          <span><Redact widths={[44, 30, 22]} h={14} label="sealed" /> <span className="muted text-sm">(sealed)</span></span>
        </div>
        <div className="row-kv">
          <span>Joined</span>
          <span className="muted">{sinceWords(since).replace(/^in /, "")} ago</span>
        </div>
        <p className="muted text-sm">Simulated with $100 at the leader&apos;s signed share price, kept only in this browser. You get the same trade at the same price as the leader, and nobody sees it coming.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={share} data-testid="copy-share" data-text={text} data-url={url}>{flash === "share" ? "Link copied ✓" : "Share my silent copy"}</button>
          <a className="btn" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" onClick={() => track("share_click")} data-testid="copy-x">Post on X</a>
          <Link className="btn" href={`/vault/?id=${encodeURIComponent(id)}`} data-testid="copy-real">Follow privately</Link>
        </div>
        <button
          className="quiet self-start text-sm"
          onClick={() => {
            savePaper(null, id);
            setF(null);
          }}
        >
          Stop this copy
        </button>
      </div>
    </section>
  );
}

/** The leader's verified record: what the first minute shows instead of "+0.00%" (U2). Facts only. */
function Record({ data, near }: { data: VaultData; near: import("@/lib/bench").NearSeries | null }) {
  const last = data.navs.at(-1);
  if (!last) return null;
  const ok = verifyNavs(data.id, data.cfg.attestation_key, [last]).ok === 1;
  const vs = vsNear(data.navs, near);
  return (
    <div className="copy-record" data-testid="copy-record">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="eyebrow">Leader&apos;s verified record</span>
        <span className="text-sm" data-testid="record-line">
          {pctWords(priceOf(last.price) - 1)} since start{vs && vs.pts > 0 ? <span className="vs-up"> ({ptsWords(vs.pts)})</span> : null} · worst dip {dipWords(maxDrawdown(data.navs))} · {(leaderStake(data.vault) * 100).toFixed(0)}% own money in
        </span>
        <span className="muted text-xs" data-testid="record-last">Last price update {agoWords(Date.now() - last.timestamp_ms)} {ok ? "✓ signature checked" : "✗ signature failed"}</span>
      </div>
      <Sparkline values={data.navs.slice(-48).map((n) => priceOf(n.price))} label={`${data.id} share price, last ${Math.min(48, data.navs.length)} updates`} />
    </div>
  );
}
