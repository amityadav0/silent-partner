// "TEE ✓" on the leaderboard (U13): an AI leader's latest decision carries a NEAR AI receipt that
// checks out in this browser (same check as the vault's AI panel). Holds count: decisions.json has
// every decision, recent-signals.json the executed ones.
import { checkReceipt, receiptOk, type AttestationDoc, type PublicReceipt } from "./receipt";
import { seasonUrl } from "./vault";

type Dec = { ranAt: string; ai_model?: string; ai_rationale_hash: string | null; ai_receipt?: PublicReceipt };
type Doc = Record<string, Dec[]>;

/** The latest decision for a vault across both logs, and whether its receipt verifies. */
export function latestTee(id: string, decisions: Doc, recent: Doc, atts: AttestationDoc | null): boolean {
  const all = [...(decisions[id] ?? []), ...(recent[id] ?? [])].filter((d) => d.ai_model);
  const last = all.sort((a, b) => Date.parse(a.ranAt) - Date.parse(b.ranAt)).at(-1);
  if (!last?.ai_receipt) return false;
  return receiptOk(checkReceipt(last.ai_receipt, last.ai_model!, last.ai_rationale_hash, atts));
}

const json = <T,>(f: string, fallback: T): Promise<T> => fetch(seasonUrl(f)).then((r) => (r.ok ? (r.json() as Promise<T>) : fallback), () => fallback);

/** Vault id → latest decision verified, for the given AI vaults. */
export async function loadTee(ids: string[]): Promise<Record<string, boolean>> {
  if (!ids.length) return {};
  const [decisions, recent, atts] = await Promise.all([json<Doc>("decisions.json", {}), json<Doc>("recent-signals.json", {}), json<AttestationDoc | null>("attestations.json", null)]);
  return Object.fromEntries(ids.map((id) => [id, latestTee(id, decisions, recent, atts)]));
}
