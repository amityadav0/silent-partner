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
    start: (latest: NavPost | undefined, usd = 1000) => {
      const p = startPaper(id, usd, latest);
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

/** Quiet and secondary: for trying the product without a wallet. */
export function PaperFollowPanel({ navs, paper }: { navs: NavPost[]; paper: ReturnType<typeof usePaper> }) {
  const latest = navs.at(-1);
  const f = paper.follow;
  if (!f) {
    return (
      <button className="quiet" data-testid="paper-start" disabled={!latest} onClick={() => paper.start(latest)}>
        Try it with $1,000 simulated, no wallet
      </button>
    );
  }
  const pos = paperPosition(f, latest?.price ?? f.entry_price);
  const since = navs.filter((n) => n.epoch > f.entry_epoch).length;
  return (
    <div className="muted w-full text-[13px]" data-testid="paper-follow">
      <div className="row-kv"><span>Simulated copy, {usd(f.usd)} in</span><span data-testid="paper-value">{usd(pos.value)}</span></div>
      <div className="row-kv">
        <span>Since joining, {since} price update{since === 1 ? "" : "s"}</span>
        <span data-testid="paper-pnl">{pos.pct >= 0 ? "+" : "−"}{Math.abs(pos.pct * 100).toFixed(2)}%</span>
      </div>
      <p className="mt-1">Entered at {(Number(BigInt(f.entry_price)) / 1e18).toFixed(6)}, the signed share price at price update #{f.entry_epoch}. Kept only in this browser. <button className="quiet" onClick={paper.stop}>Stop following</button></p>
    </div>
  );
}
