"use client";
// Your position: P&L from the vault's on-chain cost basis, and every withdrawal
// as a track: requested → burned at a NAV (claim) → paying → paid.
import { useEffect, useState } from "react";
import { TGAS } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { claimState, fmtUnits, pnl, view, W_STEPS, type Claim, type Config, type Position, type VaultView, type WithdrawRequest, type WState } from "@/lib/vault";
import { EmergencyPayout } from "./emergency";

const LABEL: Record<WState, string> = { requested: "Requested", burned: "Burned at NAV", paying: "Paying out", paid: "Paid" };

function Track({ at, testid }: { at: WState; testid?: string }) {
  const i = W_STEPS.indexOf(at);
  return (
    <ol className="track" data-testid={testid} aria-label={`withdrawal: ${LABEL[at]}`}>
      {W_STEPS.map((s, j) => <li key={s} className={j < i ? "done" : j === i ? "now" : ""}>{LABEL[s]}</li>)}
    </ol>
  );
}

export function PositionDetails({ id, viewer, vault, cfg, dec, sym, claims, refresh, onDone }: { id: string; viewer: string; vault: VaultView; cfg: Config; dec: number; sym: string; claims: Claim[]; refresh: unknown; onDone: () => void }) {
  const { accountId, call } = useWallet();
  const [pos, setPos] = useState<Position | null | "n/a">(null);
  const [pending, setPending] = useState<WithdrawRequest[]>([]);
  useEffect(() => {
    view<Position>(id, "get_position", { account_id: viewer }).then(setPos, () => setPos("n/a"));
    view<WithdrawRequest[]>(id, "get_pending").then((r) => setPending(r.filter((x) => x.account === viewer)), () => setPending([]));
  }, [id, viewer, refresh]);
  const p = pos && pos !== "n/a" ? pnl(pos, vault.price) : null;
  return (
    <div className="mt-3">
      {p && pos && pos !== "n/a" && (
        <div className="grid grid-cols-3 gap-2 text-sm tabular-nums" data-testid="pnl">
          <div><div className="muted text-xs">Deposited</div>{fmtUnits(pos.deposited, dec)} {sym}</div>
          <div><div className="muted text-xs">Withdrawn</div>{fmtUnits(pos.claimed, dec)} {sym}</div>
          <div>
            <div className="muted text-xs">P&amp;L</div>
            <span className={p.abs >= 0n ? "pos" : "neg"}>{p.abs >= 0n ? "+" : "−"}{fmtUnits(p.abs >= 0n ? p.abs : -p.abs, dec)} {sym}{p.pct !== null && ` (${p.pct >= 0 ? "+" : "−"}${Math.abs(p.pct * 100).toFixed(2)}%)`}</span>
          </div>
        </div>
      )}
      {pos === "n/a" && <p className="muted text-xs">P&amp;L needs per-holder cost basis, which this vault&apos;s contract version predates.</p>}
      {(pending.length > 0 || claims.length > 0) && <h3 className="mt-4 text-sm font-semibold">Withdrawals</h3>}
      <ul className="mt-1 space-y-3 text-xs">
        {pending.map((r) => (
          <li key={`r${r.id}`} data-testid={`request-${r.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums">{BigInt(r.shares).toLocaleString()} shares ≈ {fmtUnits((BigInt(r.shares) * BigInt(vault.price)) / 10n ** 18n, dec)} {sym} at today&apos;s price</span>
              {accountId === r.account && <button className="btn ml-auto text-xs" onClick={() => call({ receiverId: id, method: "cancel_withdraw", args: { id: r.id }, gas: 30n * TGAS }).then(onDone)}>Cancel</button>}
            </div>
            <Track at="requested" testid="track" />
            <p className="muted">Burns at the next NAV (epoch {vault.epoch + 1}), at that NAV&apos;s post-fee price. The payout then goes to <code>{r.exit_account}</code>.</p>
          </li>
        ))}
        {claims.map((c) => {
          const st = claimState(c);
          return (
            <li key={`c${c.id}`} data-testid={`claim-${c.id}`}>
              <div className="tabular-nums">
                Claim #{c.id}{c.emergency ? " (emergency)" : ""}: {fmtUnits(c.amount, dec)} {sym}, burned at epoch {c.epoch}
                {st !== "paid" && BigInt(c.paid) > 0n && <>, {fmtUnits(c.paid, dec)} paid</>}
              </div>
              <Track at={st} testid="track" />
              {st === "burned" && !c.emergency && <p className="muted">The operator pays open claims right after each NAV post.</p>}
              {st !== "paid" && !vault.emergency && c.opened_ms && Date.now() > c.opened_ms + 24 * 3600_000 && (
                <button className="btn mt-1 text-xs" data-testid={`overdue-${c.id}`} disabled={!accountId} onClick={() => call({ receiverId: id, method: "trigger_emergency", args: { overdue_claim: c.id }, gas: 50n * TGAS }).then(onDone)}>
                  Unpaid for 24h: trigger emergency
                </button>
              )}
              {st === "paying" && <p className="muted">{c.in_flight.length} payout{c.in_flight.length > 1 ? "s" : ""} signed by the vault and in flight; settles when 1Click confirms or the intent deadline passes.</p>}
              {c.emergency && <EmergencyPayout id={id} vault={vault} cfg={cfg} claim={c} dec={dec} sym={sym} onDone={onDone} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
