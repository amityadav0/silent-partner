// Append-only, hash-chained operator log. 1Click history is invite-only, so
// this is the vault's own record of every deposit, shield, fill, payout and
// NAV. Each line: {seq, prev, ts, kind, data, hash}, where
// hash = sha256(canonicalJson({seq, prev, ts, kind, data})) and prev is the
// previous hash (genesis = sha256("silent-partner/fills/v1|<vault>")).
// The head hash is posted on-chain with every NAV, so the log can't be
// rewritten afterwards without the posted heads exposing it.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJson } from "./carry/receipt.js";

export type Kind = "deposit" | "shield" | "unshield" | "signal" | "fill" | "payout" | "nav" | "note";
export type Entry = { seq: number; prev: string; ts: number; kind: Kind; data: Record<string, unknown>; hash: string };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const genesis = (vault: string) => sha(`silent-partner/fills/v1|${vault}`);
export const entryHash = (e: Omit<Entry, "hash">) => sha(canonicalJson({ seq: e.seq, prev: e.prev, ts: e.ts, kind: e.kind, data: e.data }));

export class FillLog {
  readonly entries: Entry[] = [];
  constructor(private vault: string, private path: string | null) {
    if (path && existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) this.entries.push(JSON.parse(line));
      const bad = FillLog.verify(this.entries, vault);
      if (bad !== null) throw new Error(`fill log broken at seq ${bad}`);
    }
  }
  head(): string {
    return this.entries.at(-1)?.hash ?? genesis(this.vault);
  }
  append(kind: Kind, data: Record<string, unknown>, ts = Date.now()): Entry {
    const base = { seq: this.entries.length, prev: this.head(), ts, kind, data: JSON.parse(JSON.stringify(data)) };
    const e: Entry = { ...base, hash: entryHash(base) };
    if (this.path) appendFileSync(this.path, JSON.stringify(e) + "\n");
    this.entries.push(e);
    return e;
  }
  /** Index of the first bad entry, or null if the chain is intact. */
  static verify(entries: Entry[], vault: string): number | null {
    let prev = genesis(vault);
    for (const [i, e] of entries.entries()) {
      if (e.seq !== i || e.prev !== prev || entryHash(e) !== e.hash) return i;
      prev = e.hash;
    }
    return null;
  }
}
