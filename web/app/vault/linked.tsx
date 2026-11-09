"use client";
// A leader's linked public track record, shown only if their signed proof verifies here.
import { useEffect, useState } from "react";
import { TRACK_PROOFS } from "@/lib/track-proofs";
import { hyperliquidStats, verifyProof, type HlStats } from "@/lib/trackrecord";

export function LinkedTrackRecord({ vault }: { vault: string }) {
  const proof = TRACK_PROOFS.find((p) => p.vault === vault && verifyProof(p));
  const [stats, setStats] = useState<HlStats | null>(null);
  useEffect(() => {
    if (proof) hyperliquidStats(proof.address).then(setStats, () => setStats(null));
  }, [proof]);
  if (!proof) return null;
  return (
    <div className="panel mt-3 text-sm" data-testid="linked-track-record">
      <h2 className="font-semibold">Linked public track record</h2>
      <p className="muted text-xs">The leader signed for {proof.address} on {proof.issued.slice(0, 10)}. Signature verified in your browser; stats live from Hyperliquid.</p>
      {stats && <p className="mt-1 tabular-nums">All-time PnL ${Math.round(stats.pnl).toLocaleString("en-US")} · volume ${Math.round(stats.volume).toLocaleString("en-US")} · max drawdown {(stats.maxDrawdown * 100).toFixed(1)}%</p>}
    </div>
  );
}
