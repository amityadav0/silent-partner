"use client";
// AI decisions: the leader's latest on-chain trade, matched in your browser to the
// season's public log (target bucket and rationale hash only; the rationale is sealed).
import { useEffect, useState } from "react";
import { seasonUrl, view, type SignalRec } from "@/lib/vault";
import { short } from "../ui";
import { checkReceipt, receiptOk, type AttestationDoc, type PublicReceipt } from "@/lib/receipt";

type RunRow = { vault: string; ai_model?: string; ai_status?: "ok" | "unavailable"; ai_error?: string; ai_tokens?: unknown; ai_target_band?: string; ai_rationale_hash?: string | null };
type Decision = { ranAt: string; ai_model: string; ai_status?: string; ai_target_band: string | null; ai_rationale_hash: string | null; signal_hash: string | null; ai_receipt?: PublicReceipt };
type Recent = { ranAt: string; epoch: number; signal_hash: string; ai_target_band: string | null; ai_rationale_hash: string | null; ai_model?: string; ai_receipt?: PublicReceipt };

const SEED = "https://raw.githubusercontent.com/amityadav0/silent-partner/master/operator/season/recent-signals.seed.json";
const when = (t: number | string) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function AiDecisions({ id }: { id: string }) {
  const [last, setLast] = useState<SignalRec | null | undefined>(undefined);
  const [signals, setSignals] = useState<SignalRec[]>([]);
  const [atts, setAtts] = useState<AttestationDoc | null>(null);
  const [run, setRun] = useState<{ ranAt: string; row: RunRow | undefined } | null>(null);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  useEffect(() => {
    fetch(seasonUrl("decisions.json")).then((r) => (r.ok ? r.json() : {})).then((j: Record<string, Decision[]>) => setDecisions(j[id] ?? []), () => setDecisions([]));
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
  const latestRow = run?.row;
  // A tick can end in a rejected NAV with no decision fields: show the last tick that decided.
  const decided = (r?: RunRow) => !!r && !!r.ai_model && (!!r.ai_target_band || r.ai_status === "unavailable");
  const lastDec = decisions.at(-1);
  const fallback = !decided(latestRow) && lastDec ? { ranAt: lastDec.ranAt, row: { vault: id, ai_model: lastDec.ai_model, ai_status: lastDec.ai_status as RunRow["ai_status"], ai_target_band: lastDec.ai_target_band ?? undefined, ai_rationale_hash: lastDec.ai_rationale_hash, ai_tokens: lastDec.ai_status === "ok" ? true : undefined } } : null;
  const shown = fallback ?? (run ? { ranAt: run.ranAt, row: latestRow } : null);
  const row = shown?.row;
  const down = row?.ai_status === "unavailable" || (row?.ai_model && !row.ai_tokens && !row.ai_rationale_hash);
  return (
    <div className="panel flex flex-col gap-3" id="ai" data-testid="ai-decisions">
      <h2>AI decisions</h2>
      <div>
        <div className="row-kv"><span>Model</span><span className="break-all">{row?.ai_model ?? "…"} · NEAR AI Cloud</span></div>
        <div className="row-kv" data-testid="ai-last-tick">
          <span>{fallback ? "Last decision" : "Last tick"}{shown ? `, ${when(shown.ranAt)}` : ""}</span>
          <span className={down ? "neg" : undefined}>{!shown ? "…" : down ? "NEAR AI unavailable: holding" : row?.ai_target_band ? `decided ${row.ai_target_band} NEAR` : "no decision this tick"}</span>
        </div>
        {fallback && run && <div className="row-kv muted text-sm" data-testid="ai-latest-tick-note"><span>Latest tick, {when(run.ranAt)}</span><span>no decision (the price post didn&apos;t go through)</span></div>}
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
      <Receipts recent={recent} decisions={decisions} signals={signals} atts={atts} />
      <p className="muted text-sm leading-normal">
        The exact target and the reasoning stay sealed. The leader-signed signal commits to the reasoning by its hash, and the contract checked the leader&apos;s signature when it recorded the trade. Your browser matched the season log&apos;s hash to the on-chain record just now.
      </p>
    </div>
  );
}

/** One line per recent AI decision: its NEAR AI TEE receipt, checked in this browser. */
function Receipts({ recent, decisions, signals, atts }: { recent: Recent[] | null; decisions: Decision[]; signals: SignalRec[]; atts: AttestationDoc | null }) {
  if (!recent) return null;
  // Executed trades (recent-signals) and every decision incl. holds (decisions.json), deduped by receipt signature.
  const all = [...recent.filter((x) => x.ai_receipt && x.ai_model), ...decisions.filter((x) => x.ai_receipt && x.ai_model).map((x) => ({ ...x, epoch: 0, signal_hash: x.signal_hash ?? "" }))] as Recent[];
  const seen = new Set<string>();
  const rows = all
    .sort((a, b) => Date.parse(a.ranAt) - Date.parse(b.ranAt))
    .filter((x) => (seen.has(x.ai_receipt!.signature) ? false : (seen.add(x.ai_receipt!.signature), true)))
    .slice(-5)
    .reverse();
  if (!rows.length) return <p className="muted text-sm" data-testid="ai-receipts">TEE receipts start with this leader&apos;s next decision.</p>;
  return (
    <div className="flex flex-col gap-1" data-testid="ai-receipts">
      <span className="text-sm font-medium">Decision receipts</span>
      {rows.map((x) => {
        const c = checkReceipt(x.ai_receipt!, x.ai_model!, x.ai_rationale_hash, atts);
        const ok = receiptOk(c);
        const idx = signals.find((s) => s.hash === x.signal_hash)?.index;
        return (
          <details key={x.ai_receipt!.signature} className="text-sm" data-testid="ai-receipt">
            <summary className="cursor-pointer">
              <span className={ok ? "pos" : "neg"}>{ok ? "✓" : "✗"}</span> {idx !== undefined ? `#${idx}` : x.signal_hash ? short(x.signal_hash, 4) : `hold, ${when(x.ranAt)}`} · signed in NEAR AI&apos;s TEE{x.ai_receipt!.gpu_evidence ? " (CPU + GPU attested)" : ""} · {x.ai_model!.split("/").pop()} · reasoning sealed
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

