// Selective disclosure: a vault's private fill log (and its leader's signals)
// published up to some epoch, checked in the browser against what the chain
// committed to. Normally only the operator holds this; see /chain/.
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { canonicalJson } from "./canonical";
import type { NavPost, SignalRec } from "./vault";
import type { Signal } from "./signal";

export type Entry = { seq: number; prev: string; ts: number; kind: string; data: Record<string, unknown>; hash: string };
export type Disclosure = { vault: string; upto_epoch: number; published_at: string; entries: Entry[]; signals: { hash: string; signal: Signal; why?: string }[] };

const hex = (s: string) => bytesToHex(sha256(new TextEncoder().encode(s)));
export const genesis = (vault: string) => hex(`silent-partner/fills/v1|${vault}`);
export const entryHash = (e: Omit<Entry, "hash">) => hex(canonicalJson({ seq: e.seq, prev: e.prev, ts: e.ts, kind: e.kind, data: e.data }));
export const signalHashHex = (s: Signal) => hex(canonicalJson(s));

export type Check = { label: string; ok: boolean; detail?: string };

export function checkDisclosure(d: Disclosure, navs: NavPost[], signals: SignalRec[]): Check[] {
  const out: Check[] = [];
  let prev = genesis(d.vault), broken: number | null = null;
  for (const [i, e] of d.entries.entries()) {
    if (e.seq !== i || e.prev !== prev || entryHash(e) !== e.hash) { broken = i; break; }
    prev = e.hash;
  }
  out.push({ label: `Hash chain intact from genesis (${d.entries.length} entries)`, ok: broken === null, detail: broken === null ? undefined : `breaks at seq ${broken}` });
  const byHash = new Map(d.entries.map((e) => [e.hash, e]));
  for (const n of navs.filter((n) => n.epoch <= d.upto_epoch)) {
    const e = byHash.get(n.fills_head);
    const ok = !!e && e.kind === "nav" && String(e.data.nav) === n.nav && Number(e.data.epoch) === n.epoch;
    out.push({ label: `NAV epoch ${n.epoch}: on-chain head is the log's NAV entry with the same value`, ok, detail: ok ? undefined : e ? "head found but values differ" : "head not in the log" });
  }
  const disclosed = new Map(d.signals.map((s) => [s.hash, s]));
  for (const s of signals) {
    const fill = byHash.get(s.fill_hash);
    if (!fill) continue; // executed after the disclosed range
    const ds = disclosed.get(s.hash);
    out.push({ label: `Signal #${s.index}: fill in the log, and the disclosed signal hashes to the on-chain hash`, ok: fill.kind === "fill" && fill.data.signal === s.hash && !!ds && signalHashHex(ds.signal) === s.hash, detail: ds ? undefined : "signal content not disclosed" });
  }
  return out;
}

/** Holdings by asset after folding the log up to `seq` (what the operator's NAV valued). */
export function holdings(entries: Entry[], base: string): Map<string, bigint> {
  const h = new Map<string, bigint>();
  const add = (a: string, x: bigint) => h.set(a, (h.get(a) ?? 0n) + x);
  for (const e of entries) {
    if (e.kind === "shield") add(base, BigInt(String(e.data.amount)));
    if (e.kind === "fill") { add(String(e.data.from), -BigInt(String(e.data.amount_in))); add(String(e.data.to), BigInt(String(e.data.amount_out))); }
    if (e.kind === "payout") add(base, -BigInt(String(e.data.amount)));
  }
  return h;
}
