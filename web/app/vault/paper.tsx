"use client";
// "Follow with $1,000 (paper)": try the product without a wallet.
import { useEffect, useState } from "react";
import { loadPaper, paperPosition, savePaper, startPaper, type PaperFollow } from "@/lib/paper";
import type { NavPost } from "@/lib/vault";

export function usePaper(id: string) {
  const [f, setF] = useState<PaperFollow | null>(null);
  useEffect(() => setF(loadPaper(id)), [id]);
  return {
    follow: f,
    start: (latest: NavPost | undefined) => {
      const p = startPaper(id, 1000, latest);
      savePaper(p, id);
      setF(p);
    },
    stop: () => {
      savePaper(null, id);
      setF(null);
    },
  };
}

const usd = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PaperFollowPanel({ navs, paper }: { navs: NavPost[]; paper: ReturnType<typeof usePaper> }) {
  const latest = navs.at(-1);
  const f = paper.follow;
  if (!f) {
    return (
      <div className="panel" data-testid="paper-follow">
        <h2 className="font-semibold">Try it: follow with $1,000 (paper)</h2>
        <p className="muted mt-1 text-sm">No wallet needed. You enter at this vault&apos;s latest attested share price, and your copy moves with every new NAV. It&apos;s stored only in this browser.</p>
        <button className="btn btn-primary mt-3" data-testid="paper-start" disabled={!latest} onClick={() => paper.start(latest)}>
          Follow with $1,000 (paper)
        </button>
      </div>
    );
  }
  const pos = paperPosition(f, latest?.price ?? f.entry_price);
  const since = navs.filter((n) => n.epoch > f.entry_epoch).length;
  return (
    <div className="panel" data-testid="paper-follow">
      <h2 className="font-semibold">Your paper copy</h2>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm tabular-nums">
        <div>
          <div className="muted text-xs">Value</div>
          <span data-testid="paper-value">{usd(pos.value)}</span>
        </div>
        <div>
          <div className="muted text-xs">P&amp;L since you joined</div>
          <span className={pos.pnl >= 0 ? "pos" : "neg"} data-testid="paper-pnl">
            {pos.pnl >= 0 ? "+" : ""}
            {usd(pos.pnl)} ({pos.pct >= 0 ? "+" : "−"}
            {Math.abs(pos.pct * 100).toFixed(2)}%)
          </span>
        </div>
        <div>
          <div className="muted text-xs">Joined</div>
          epoch {f.entry_epoch} · {since} NAV{since === 1 ? "" : "s"} since
        </div>
      </div>
      <p className="muted mt-2 text-xs">
        Entry share price {(Number(BigInt(f.entry_price)) / 1e18).toFixed(6)}, from the attested NAV at epoch {f.entry_epoch}. It&apos;s after fees, exactly as a real
        follower sees it. The dashed line on the chart is your copy.
      </p>
      <button className="btn mt-2 text-xs" onClick={paper.stop}>
        Stop following
      </button>
    </div>
  );
}
