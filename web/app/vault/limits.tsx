"use client";
// Track record and limits (D4): record length, the leader's stake over time, and what the
// strategy is allowed to do, in numbers, with who enforces each one.
import { useEffect, useState } from "react";
import { ASSETS } from "@/lib/config";
import { isNewLeader, loadStake, recordWords, tradeRateWords, type StakeSeries } from "@/lib/record";
import type { VaultMeta } from "@/lib/vaults";
import type { Config, VaultView } from "@/lib/vault";
import { leaderStake } from "@/lib/vault";
import { Sparkline } from "../ui";
import { cost24Words, costWords, loadCosts, tradesDay, type VaultCost } from "@/lib/costs";

export function RecordChips({ times }: { times: number[] }) {
  return (
    <>
      <span className="chip" data-testid="record-length">{recordWords(times)}</span>
      {isNewLeader(times) && <span className="chip chip-warn" data-testid="new-leader" title="Under 14 days of history: judge it on more than its return.">New leader: short history</span>}
    </>
  );
}

const pctB = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export function Limits({ id, meta, cfg, vault, times }: { id: string; meta: VaultMeta; cfg: Config; vault: VaultView; times: number[] }) {
  const [stake, setStake] = useState<StakeSeries | null | undefined>(undefined);
  const [cost, setCost] = useState<VaultCost | null>(null);
  useEffect(() => {
    loadStake().then((d) => setStake(d?.[id] ?? null));
    loadCosts().then((d) => setCost(d?.vaults[id] ?? null));
  }, [id]);
  const syms = [...new Set(cfg.allowed_assets.map((a) => ASSETS[a]?.symbol ?? a.replace(/^nep141:/, "")))];
  const assets = syms.length > 1 ? `${syms.slice(0, -1).join(", ")} and ${syms.at(-1)}` : syms.join("");
  const near = meta.near
    ? <><span className="num">{meta.near[0]}–{meta.near[1]}%</span> {meta.leaderKind === "ai" ? "(every AI answer is clamped to this by the operator's code)" : "(set by its code)"}</>
    : meta.leaderKind === "human" ? "the leader's call, 0–100%" : "0–100%";
  // a fixed benchmark rule rather than a range (T3)
  const fixed = meta.benchmark && meta.near ? <><span className="num">{meta.near[0]}%</span> (a fixed rule in the operator&apos;s code)</> : null;
  const mix = meta.mix ? <>{meta.mix}. No leverage, no shorting: it can only hold the assets themselves <span className="muted">(enforced by the contract)</span></> : null;
  const now = leaderStake(vault);
  const first = stake && stake.bps.length > 1 ? stake.bps[0] : null;
  return (
    <div className="panel limits" data-testid="limits">
      <h2>Track record and limits</h2>
      <div className="mt-2">
        <div className="row-kv"><span>Record</span><span data-testid="limits-record">{recordWords(times)}{isNewLeader(times) ? ": short, so judge it on more than its return" : ""}</span></div>
        <div className="row-kv"><span>{mix ? "What it holds" : "NEAR in the vault"}</span><span data-testid="limits-near">{mix ?? fixed ?? near}</span></div>
        <div className="row-kv"><span>How often it trades</span><span data-testid="limits-rate">{cost ? <>{tradesDay(cost)} <span className="muted">· the 4-hour rule (from Nov 14) allows 6 at most</span></> : tradeRateWords(vault.signals, times)}</span></div>
        {cost && (
          <div className="row-kv" data-testid="limits-cost">
            <span>Trading cost so far</span>
            <span><span className="num">{costWords(cost)}</span>{cost24Words(cost) && <> · <span className="num" data-testid="limits-cost-24h">{cost24Words(cost)}</span></>} <span className="muted">· ≈{(Math.round(cost.cost_bps) / 100).toFixed(2)}% of each trade, measured across the season&apos;s fills</span></span>
          </div>
        )}
        <div className="row-kv"><span>What it can hold</span><span>{assets} only <span className="muted">(enforced by the contract)</span></span></div>
        <div className="row-kv"><span>Worst fill per trade</span><span><span className="num">{cfg.max_slippage_bps / 100}%</span> slippage at most <span className="muted">(enforced by the contract)</span></span></div>
        <div className="row-kv" data-testid="limits-stake">
          <span>Leader&apos;s own money</span>
          <span className="flex flex-wrap items-center justify-end gap-3">
            {stake && stake.bps.length > 1 && <Sparkline values={stake.bps} width={110} height={28} label="Leader's share of the vault over time" />}
            <span>
              <span className="num">{(now * 100).toFixed(1)}%</span> now
              {first !== null && <span className="muted">, from {pctB(first)} on {new Date(stake!.t[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
              <span className="muted"> · at least {cfg.min_leader_bps / 100}%, enforced</span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
