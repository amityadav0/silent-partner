// One paper-season tick for one vault: optional leader decision → signal →
// paper fill at a real 1Click dry-quote price → NAV epoch posted on testnet.
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { KeyPair } from "near-api-js";
import type { Operator } from "../operator.js";
import { signSignal } from "../signal.js";
import { rebalance } from "../leaders/strategies.js";

export type Decision = { target: number | null; why: string; /** private, never published; only its hash goes in the signal */ rationale?: string; model?: string; usage?: { prompt_tokens: number; completion_tokens: number } };
export type Decide = (current: number) => Promise<Decision>;

export type TickResult = { vault: string; exposureBefore: number; decision?: Omit<Decision, "rationale">; signal?: { hash: string; status: string; size_bps: number; from: string; to: string } | { error: string }; epoch?: number; nav?: string; tx?: string | null; error?: string };

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
export async function tick(o: { op: Operator; vault: string; base: string; risk: string; decide?: Decide; signalKey?: string; manual?: unknown; notesPath: string; now?: () => number }): Promise<TickResult> {
  const now = o.now ?? Date.now;
  const out: TickResult = { vault: o.vault, exposureBefore: 0 };
  await o.op.shieldPending();
  const { current } = await exposure(o.op, o.risk);
  out.exposureBefore = current;
  if (o.manual) {
    const r = await o.op.submitSignal(o.manual);
    out.signal = r.ok ? { hash: r.hash, status: r.status, size_bps: (o.manual as any).signal.size_bps, from: (o.manual as any).signal.from, to: (o.manual as any).signal.to } : { error: r.error };
  } else if (o.decide && o.signalKey) {
    const d = await o.decide(current);
    out.decision = { target: d.target, why: d.why, model: d.model, usage: d.usage };
    const memo = d.rationale ? createHash("sha256").update(d.rationale).digest("hex") : undefined;
    const s = d.target === null ? null : rebalance(o.vault, o.base, o.risk, current, d.target, now(), memo);
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
