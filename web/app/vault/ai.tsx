"use client";
// AI decisions: the leader's latest on-chain trade, matched in your browser to the
// season's public log (target bucket and rationale hash only; the rationale is sealed).
import { useEffect, useState } from "react";
import { seasonUrl, view, type SignalRec } from "@/lib/vault";
import { short } from "../ui";
import { checkReceipt, receiptOk, type AttestationDoc, type PublicReceipt } from "@/lib/receipt";

type RunRow = { vault: string; ai_model?: string; ai_status?: "ok" | "unavailable"; ai_error?: string; ai_tokens?: unknown; ai_target_band?: string; ai_rationale_hash?: string | null };
type Recent = { ranAt: string; epoch: number; signal_hash: string; ai_target_band: string | null; ai_rationale_hash: string | null; ai_model?: string; ai_receipt?: PublicReceipt };

const SEED = "https://raw.githubusercontent.com/amityadav0/silent-partner/master/operator/season/recent-signals.seed.json";
const when = (t: number | string) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function AiDecisions({ id }: { id: string }) {
  const [last, setLast] = useState<SignalRec | null | undefined>(undefined);
  const [signals, setSignals] = useState<SignalRec[]>([]);
  const [atts, setAtts] = useState<AttestationDoc | null>(null);
  const [run, setRun] = useState<{ ranAt: string; row: RunRow | undefined } | null>(null);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  useEffect(() => {
    view<SignalRec[]>(id, "get_signals", { from: 0, limit: 1000 }).then((s) => (setSignals(s), setLast(s.at(-1) ?? null)), () => setLast(null));
    fetch(seasonUrl("attestations.json")).then((r) => (r.ok ? r.json() : null)).then(setAtts, () => setAtts(null));
    fetch(seasonUrl("last-run.json")).then((r) => r.json()).then((j: { ranAt: string; results: RunRow[] }) => setRun({ ranAt: j.ranAt, row: j.results.find((x) => x.vault === id) }), () => setRun(null));
    // The season writes recent-signals.json each tick; before its first run, the seed built from past ticks' public logs.
    const get = (u: string) => fetch(u).then((r) => (r.ok ? (r.json() as Promise<Record<string, Recent[]>>) : Promise.reject(new Error(String(r.status)))));
    get(seasonUrl("recent-signals.json"))
      .catch(() => get(SEED))
      .then((j) => setRecent(j[id] ?? []), () => setRecent([]));
  }, [id]);
  const match = last && recent ? recent.find((x) => x.signal_hash === last.hash) : undefined;
  const row = run?.row;
  const down = row?.ai_status === "unavailable" || (row?.ai_model && !row.ai_tokens && !row.ai_rationale_hash);
  return (
    <div className="panel flex flex-col gap-3" id="ai" data-testid="ai-decisions">
      <h2>AI decisions</h2>
      <div>
        <div className="row-kv"><span>Model</span><span className="break-all">{row?.ai_model ?? "…"} · NEAR AI Cloud</span></div>
        <div className="row-kv" data-testid="ai-last-tick">
          <span>Last tick{run ? `, ${when(run.ranAt)}` : ""}</span>
          <span className={down ? "neg" : undefined}>{!run ? "…" : down ? "NEAR AI unavailable: holding" : `decided ${row?.ai_target_band ?? "–"} NEAR`}</span>
        </div>
        <div className="row-kv" data-testid="ai-latest">
          <span>Latest trade</span>
          <span>{last === undefined ? "…" : last ? `signal #${last.index}, ${when(last.executed_ms)}` : "none yet"}</span>
        </div>
        {last && <div className="row-kv"><span>Signal hash on chain</span><span><code>{short(last.hash, 8)}</code></span></div>}
        {last && (
          <div className="row-kv" data-testid="ai-hash-check">
            <span>Season log</span>
            <span className={match ? "pos" : "muted"}>
              {recent === null ? "…" : match ? `✓ same hash · target ${match.ai_target_band ?? "–"} · rationale ${short(match.ai_rationale_hash ?? "–", 6)}` : "no log entry for this trade yet"}
            </span>
          </div>
        )}
      </div>
      <Receipts recent={recent} signals={signals} atts={atts} />
      <p className="muted text-sm leading-normal">
        The exact target and the reasoning stay sealed. The leader-signed signal commits to the reasoning by its hash, and the contract checked the leader&apos;s signature when it recorded the trade. Your browser matched the season log&apos;s hash to the on-chain record just now.
      </p>
    </div>
  );
}

/** One line per recent AI decision: its NEAR AI TEE receipt, checked in this browser. */
function Receipts({ recent, signals, atts }: { recent: Recent[] | null; signals: SignalRec[]; atts: AttestationDoc | null }) {
  if (!recent) return null;
  const rows = recent.filter((x) => x.ai_receipt && x.ai_model).slice(-5).reverse();
  if (!rows.length) return <p className="muted text-sm" data-testid="ai-receipts">TEE receipts start with this leader&apos;s next decision.</p>;
  return (
    <div className="flex flex-col gap-1" data-testid="ai-receipts">
      <span className="text-sm font-medium">Decision receipts</span>
      {rows.map((x) => {
        const c = checkReceipt(x.ai_receipt!, x.ai_model!, x.ai_rationale_hash, atts);
        const ok = receiptOk(c);
        const idx = signals.find((s) => s.hash === x.signal_hash)?.index;
        return (
          <details key={x.signal_hash} className="text-sm" data-testid="ai-receipt">
            <summary className="cursor-pointer">
              <span className={ok ? "pos" : "neg"}>{ok ? "✓" : "✗"}</span> {idx !== undefined ? `#${idx}` : short(x.signal_hash, 4)} · signed in NEAR AI&apos;s TEE{x.ai_receipt!.gpu_evidence ? " (CPU + GPU attested)" : ""} · {x.ai_model!.split("/").pop()} · reasoning sealed
            </summary>
            <ul className="muted mt-1 flex flex-col gap-0.5 pl-4 text-xs">
              <li>{c.signature ? "✓" : "✗"} NEAR AI&apos;s enclave key <code>{short(x.ai_receipt!.signing_address, 6)}</code> signed this exact request and response</li>
              <li>{c.quote === null ? "…" : c.quote ? "✓" : "✗"} the attestation quote binds that key and a fresh nonce (quote digest <code>{short(x.ai_receipt!.quote_sha256, 6)}</code>)</li>
              <li>{c.model ? "✓" : "✗"} model {x.ai_model}</li>
              <li>{c.memo ? "✓" : "✗"} the hash in the leader-signed signal is sha256(receipt : quote digest), so the sealed reasoning can be disclosed and checked later</li>
            </ul>
          </details>
        );
      })}
      <p className="muted text-xs">Checked in your browser. It doesn&apos;t verify Intel&apos;s and NVIDIA&apos;s certificate chains for the quote; the quotes are published in the season log for anyone to run them.</p>
    </div>
  );
}

