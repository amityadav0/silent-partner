"use client";
// "Your silent copy": the 10-second, no-wallet way in (V1) and the follower's share card (V2).
// A $100 simulated copy starts at the vault's latest signed share price and is valued at each
// later one. Nothing leaves the browser; the numbers shared are only that copy's real change.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadPaper, paperPosition, savePaper, startPaper, type PaperFollow } from "@/lib/paper";
import { pctWords, shareText, shareUrl, sinceWords, COPY_DEFAULT } from "@/lib/copy";
import { metaOf } from "@/lib/vaults";
import { track } from "@/lib/funnel";
import { LeaderChips, Redact, useQueryParam, useVault } from "../ui";

const usd = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SilentCopy() {
  const q = useQueryParam("id");
  const start = useQueryParam("start");
  const id = q === undefined ? undefined : q || COPY_DEFAULT;
  const { data, error } = useVault(id);
  const router = useRouter();
  const [f, setF] = useState<PaperFollow | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
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
  const text = shareText(meta.name, pos.pct, since);
  const url = shareUrl(id);
  async function share() {
    track("share_click");
    try {
      if (navigator.share) return await navigator.share({ text, url });
    } catch {
      /* cancelled or unsupported: copy instead */
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
    } catch {
      window.prompt("Copy this post", `${text} ${url}`);
    }
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
        </div>
        <div className="row-kv">
          <span>The leader&apos;s trades</span>
          <span><Redact widths={[44, 30, 22]} h={14} label="sealed" /> <span className="muted text-sm">(sealed)</span></span>
        </div>
        <div className="row-kv">
          <span>Joined</span>
          <span className="muted">{sinceWords(since).replace(/^in /, "")} ago · {updates} price update{updates === 1 ? "" : "s"} since</span>
        </div>
        <p className="muted text-sm">Simulated with $100 at the leader&apos;s signed share price, kept only in this browser. You get the same trade at the same price as the leader, and nobody sees it coming.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={share} data-testid="copy-share" data-text={text} data-url={url}>{copied ? "Copied: paste it anywhere" : "Share my silent copy"}</button>
          <a className="btn" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" onClick={() => track("share_click")} data-testid="copy-x">Post on X</a>
          <Link className="btn" href={`/vault/?id=${encodeURIComponent(id)}`} data-testid="copy-real">Follow privately with a wallet</Link>
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
