// One paper-season tick for one vault: optional leader decision → signal →
// paper fill at a real 1Click dry-quote price → NAV epoch posted on testnet.
import { createHash } from "node:crypto";
import { receiptMemo, type Attestation, type Receipt } from "../leaders/receipt.js";
import { appendFileSync } from "node:fs";
import { KeyPair } from "near-api-js";
import type { Operator } from "../operator.js";
import { signSignal, type BasketSignal } from "../signal.js";
import { randomBytes } from "node:crypto";
import { rebalance } from "../leaders/strategies.js";

export type Decision = {
  target: number | null;
  why: string;
  /** private, never published; only its hash goes in the signal */
  rationale?: string;
  model?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  /** NEAR AI's TEE receipt for the completion (public: hashes, signature, quote digest). */
  receipt?: Receipt;
  receipt_error?: string;
  attestation?: Attestation;
};
export type Decide = (current: number) => Promise<Decision>;
/** Multi-asset leaders (T6): current weights by asset → target weights (0..1), or null to hold. */
export type DecideBasket = (current: Record<string, number>) => Promise<{ targets: Record<string, number> | null; why: string; rationale?: string }>;
// minStep: smallest weight change worth a trade for this leader (bots 0.1, AI 0.05).

export type TickResult = { vault: string; exposureBefore: number; decision?: Omit<Decision, "rationale" | "attestation"> & { memo_hash?: string }; signal?: { hash: string; status: string; size_bps: number; from: string; to: string } | { error: string }; epoch?: number; nav?: string; tx?: string | null; error?: string };

export async function exposure(op: Operator, risk: string): Promise<{ nav: bigint; current: number }> {
  const n = await op.nav();
  const rv = BigInt(n.holdings[risk]?.value ?? "0");
  return { nav: n.nav, current: n.nav > 0n ? Number((rv * 10_000n) / n.nav) / 10_000 : 0 };
}

/**
 * `notesPath` is the bot's private notebook (encrypted at rest): every decision
 * with its full rationale. The public chain sees only the signal hash, which
 * covers `memo_hash = sha256(rationale)`.
 */
export async function tick(o: { op: Operator; vault: string; base: string; risk: string; decide?: Decide; signalKey?: string; manual?: unknown; notesPath: string; now?: () => number; minStep?: number; allow?: (current: number, target: number) => string | null; due?: boolean;
  decideBasket?: DecideBasket; allowBasket?: (current: Record<string, number>, targets: Record<string, number>) => string | null }): Promise<TickResult> {
  const now = o.now ?? Date.now;
  const out: TickResult = { vault: o.vault, exposureBefore: 0 };
  await o.op.shieldPending();
  const { current } = await exposure(o.op, o.risk);
  out.exposureBefore = current;
  if (o.decideBasket && o.signalKey && !o.manual) {
    // Multi-asset: weights per asset from the private holdings; one basket signal (T6).
    const n = await o.op.nav();
    const cur = Object.fromEntries(Object.entries(n.holdings).filter(([a]) => a !== o.base).map(([a, h]) => [a, n.nav > 0n ? Number((BigInt(h.value) * 10_000n) / n.nav) / 10_000 : 0]));
    const d = await o.decideBasket(cur);
    const stop = d.targets ? o.allowBasket?.(cur, d.targets) ?? null : null;
    const memo = d.rationale ? createHash("sha256").update(d.rationale).digest("hex") : undefined;
    out.decision = { target: null, why: stop ? `${d.why}; held: ${stop}` : d.why, memo_hash: memo };
    let s: BasketSignal | null = null;
    if (d.targets && !stop) {
      s = { v: 1, vault: o.vault, type: "basket", targets_bps: Object.fromEntries(Object.entries(d.targets).map(([a, w]) => [a, Math.round(w * 10_000)])), nonce: randomBytes(8).toString("hex"), created_ms: now(), ...(memo ? { memo_hash: memo } : {}) };
      const r = await o.op.submitSignal(signSignal(s, KeyPair.fromString(o.signalKey as `ed25519:${string}`)));
      out.signal = r.ok ? { hash: r.hash, status: r.status, size_bps: 0, from: o.base, to: "basket" } : { error: r.error };
    }
    appendFileSync(o.notesPath, JSON.stringify({ ts: now(), current: cur, ...d, memo_hash: memo, signal: s, signal_hash: out.signal && "hash" in out.signal ? out.signal.hash : null }) + "\n");
  } else if (o.manual) {
    const r = await o.op.submitSignal(o.manual);
    out.signal = r.ok ? { hash: r.hash, status: r.status, size_bps: (o.manual as any).signal.size_bps, from: (o.manual as any).signal.from, to: (o.manual as any).signal.to } : { error: r.error };
  } else if (o.decide && o.signalKey && o.due !== false) {
    const d = await o.decide(current);
    // The turnover rule (T1): a target the gate blocks is kept in the notebook as a hold.
    const stop = d.target === null ? null : o.allow?.(current, d.target) ?? null;
    if (stop) d.why = `${d.why}; held: ${stop}`;
    // With a TEE receipt the memo commits to the model, the exact request and response
    // (hence the reasoning) and the attestation; without one, to the sealed rationale.
    const memo = d.receipt ? receiptMemo(d.receipt) : d.rationale ? createHash("sha256").update(d.rationale).digest("hex") : undefined;
    out.decision = { target: d.target, why: d.why, model: d.model, usage: d.usage, memo_hash: memo, receipt: d.receipt, receipt_error: d.receipt_error };
    const s = d.target === null || stop ? null : rebalance(o.vault, o.base, o.risk, current, d.target, now(), memo, o.minStep);
    if (s) {
      const r = await o.op.submitSignal(signSignal(s, KeyPair.fromString(o.signalKey as `ed25519:${string}`)));
      out.signal = r.ok ? { hash: r.hash, status: r.status, size_bps: s.size_bps, from: s.from, to: s.to } : { error: r.error };
    }
    // Private notebook entry: the full signal and rationale, so either can be disclosed and checked later.
    appendFileSync(o.notesPath, JSON.stringify({ ts: now(), current, ...d, memo_hash: memo, signal: s, signal_hash: out.signal && "hash" in out.signal ? out.signal.hash : null }) + "\n");
  }
  const e = await o.op.epoch();
  Object.assign(out, { epoch: e.epoch, nav: e.nav, tx: e.tx });
  return out;
}
