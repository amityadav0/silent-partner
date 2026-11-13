// Mainnet keeper policy (D-P5-12). Pure, so it can be tested.
export const KEEPER = { minAgeMs: 2.5 * 3_600_000, contractMinMs: 3_600_000, staleMs: 24 * 3_600_000 };

export type KeeperDecision = { post: boolean; why: string };

/** Post when the last accepted post is older than `minAgeMs` (cron runs every 3 h, so a post lands
 *  each run and is never more than ~6 h old even if one run fails), never inside the contract's 1 h minimum, never in emergency. */
export function keeperDecision(v: { last_nav_ms: number; emergency: boolean }, now: number, minAgeMs = KEEPER.minAgeMs): KeeperDecision {
  if (v.emergency) return { post: false, why: "vault is in emergency mode: posting is over, holders exit at the last price" };
  const age = now - v.last_nav_ms;
  if (age < KEEPER.contractMinMs) return { post: false, why: `last post ${Math.round(age / 60_000)} min ago, inside the contract's 1 h minimum` };
  if (age < minAgeMs) return { post: false, why: `last post ${Math.round(age / 60_000)} min ago, not due yet` };
  return { post: true, why: `last post ${Math.round(age / 60_000)} min ago` };
}

export type LogEntryLite = { hash: string; kind: string; data: Record<string, unknown> };
export type ChainLogFacts = { lastHead: string | null; fillHashes: string[]; paidTotal: bigint };

/** K3: refuse to post a NAV from a stale fill log. The keeper's log must contain the head of the
 *  last accepted post (a manual `op.ts epoch` moves it), every fill a recorded leader signal points
 *  to (a manual trade), and payouts adding up to what the claims show as paid (a manual payout).
 *  Returns why it's stale, or null when it's current. */
export function staleLogReason(entries: LogEntryLite[], c: ChainLogFacts): string | null {
  const hashes = new Set(entries.map((e) => e.hash));
  if (c.lastHead && !hashes.has(c.lastHead)) return `the last accepted post pins fill-log head ${c.lastHead.slice(0, 12)}…, which isn't in the keeper's log`;
  const missing = c.fillHashes.filter((h) => !hashes.has(h));
  if (missing.length) return `${missing.length} on-chain trade fill(s) missing from the keeper's log (first ${missing[0].slice(0, 12)}…)`;
  const paid = entries.filter((e) => e.kind === "payout" && !e.data.dry && e.data.status === "paid").reduce((s, e) => s + BigInt(String(e.data.amount)), 0n);
  if (paid !== c.paidTotal) return `payouts in the keeper's log (${paid}) don't match what the claims show as paid (${c.paidTotal})`;
  return null;
}
