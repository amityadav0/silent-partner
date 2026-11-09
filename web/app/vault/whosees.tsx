"use client";
// "Who sees what": both views keep holdings and trades redacted. Only the
// follower's own numbers are added, and only the follower's own numbers exist here.
import { useEffect, useState } from "react";
import { fmtUnits, view, type VaultView } from "@/lib/vault";
import { Redact } from "../ui";

type Stop = { drawdown_bps: number };

export function WhoSeesWhat({ id, viewer, shares, vault, dec, sym }: { id: string; viewer: string | null | undefined; shares: bigint | null; vault: VaultView; dec: number; sym: string }) {
  const [you, setYou] = useState(false);
  const [stop, setStop] = useState<Stop | null | "n/a">(null);
  useEffect(() => {
    if (!viewer) return setStop(null);
    view<Stop | null>(id, "get_stop_loss", { account_id: viewer }).then(setStop, () => setStop("n/a"));
  }, [id, viewer]);
  const price = (Number(BigInt(vault.price)) / 1e18).toFixed(4);
  return (
    <div className="panel flex flex-col gap-3" data-testid="who-sees">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>Who sees what</h2>
        <div className="seg" role="group" aria-label="View as">
          <button aria-pressed={!you} onClick={() => setYou(false)} data-testid="who-world">The world</button>
          <button aria-pressed={you} onClick={() => setYou(true)} data-testid="who-you">You, following</button>
        </div>
      </div>
      <div>
        <div className="row-kv"><span>Holdings</span><span><Redact widths={[72, 40]} label="Holdings redacted" /></span></div>
        <div className="row-kv"><span>Trades</span><span><Redact widths={[110]} label="Trades redacted" /></span></div>
        <div className="row-kv"><span>Share price</span><span>{price} ✓</span></div>
        {you ? (
          viewer && shares !== null ? (
            <>
              <div className="row-kv"><span>Your shares</span><span className="pos" data-testid="your-shares">{shares.toLocaleString()}</span></div>
              <div className="row-kv"><span>Your value</span><span className="pos">{fmtUnits((shares * BigInt(vault.price)) / 10n ** 18n, dec)} {sym}</span></div>
              <div className="row-kv"><span>Your stop-loss</span><span className="pos" data-testid="your-stop">{stop === "n/a" ? "not on this vault" : stop ? `exit at −${stop.drawdown_bps / 100}%` : "none set"}</span></div>
            </>
          ) : (
            <div className="row-kv"><span>Your shares</span><span className="muted">connect a wallet</span></div>
          )
        ) : (
          <div className="row-kv"><span>Who follows</span><span data-testid="who-follows">not shown</span></div>
        )}
      </div>
      <p className="muted text-sm leading-normal">The vault&apos;s positions stay with the operator that executes them. This site lists no followers, but deposits are ordinary NEAR transfers, so an account&apos;s deposit and share balance can be read on chain. <a href="../chain/">What the chain sees</a></p>
    </div>
  );
}
