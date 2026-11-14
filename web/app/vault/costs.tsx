"use client";
// "What you pay" (D2) and "What happens after I click Follow" (D3). Contract
// parameters and the vault's own update cadence; nothing estimated that we can measure.
import Link from "next/link";
import { useEffect, useState } from "react";
import { EMERGENCY_MS, SWAP_FEE_BPS, durationWords, feeExample, loadCosts, medianGapMs, withdrawEta } from "@/lib/costs";

export function CostBox({ feeBps, quoteFee }: { feeBps: number; quoteFee?: string | null }) {
  // measured per-trade cost (fee plus spread) once the season has published it (T2)
  const [bps, setBps] = useState<number | null>(null);
  useEffect(() => {
    loadCosts().then((d) => setBps(d?.cost_bps ?? null));
  }, []);
  return (
    <div className="cost-box" data-testid="cost-box">
      <span className="text-[15px] font-medium">What you pay</span>
      <div className="row-kv"><span>Performance fee</span><span><span className="num">{feeBps / 100}%</span> of new gains</span></div>
      <div className="row-kv"><span>Trading cost</span><span data-testid="cost-per-trade"><span className="num">≈{(Math.round(bps ?? SWAP_FEE_BPS) / 100).toFixed(2)}%</span> per trade, shared{bps ? <span className="muted"> (measured)</span> : null}</span></div>
      <div className="row-kv"><span>From another chain</span><span>{quoteFee ? <span className="num">{quoteFee}</span> : "1Click fee, in your quote"}</span></div>
      <div className="row-kv"><span>Deposit or withdrawal fee</span><span className="num">none</span></div>
      <div className="row-kv"><span>Network gas</span><span>a few cents</span></div>
      <p className="muted text-[13px] leading-normal">The fee is charged only when the share price beats its best ever. The trading cost (1Click&apos;s {SWAP_FEE_BPS / 100}% fee plus the quote spread, measured on the season&apos;s fills) is paid by the vault, so every holder shares it pro rata; it&apos;s already in the share price.</p>
      <p className="muted text-[13px] leading-normal" data-testid="fee-example">Example: {feeExample(feeBps)}</p>
    </div>
  );
}

export function FollowTimeline({ times, price, sym }: { times: number[]; price: number; sym: string }) {
  const gap = medianGapMs(times);
  const eta = withdrawEta(times);
  return (
    <div className="timeline" data-testid="follow-timeline">
      <span className="text-[15px] font-medium">What happens after you click Follow</span>
      <ol>
        <li><b>Seconds later:</b> your deposit lands and you get shares at today&apos;s price ({price.toFixed(4)} {sym} each). If a rule refuses it, the same transaction refunds you.</li>
        <li><b>Every trade:</b> fills once for the whole vault, so you get the leader&apos;s price, not a worse one after them.</li>
        <li data-testid="timeline-exit"><b>When you want out:</b> ask to withdraw. It&apos;s priced at the next price update and paid at the one after{eta ? <>: about <b>{eta}</b> here{gap ? `, where prices update every ${durationWords(gap)}` : ""}.</> : "."}</li>
        <li><b>If we stop:</b> no price update for {Math.round(EMERGENCY_MS / 3_600_000)}&nbsp;h and anyone can open the emergency exit. Every holder takes their share at the last price, without us. <Link href="/trust/">Risks &amp; trust →</Link></li>
      </ol>
    </div>
  );
}
