// The leaderboard's first paint (Z5): the season's board.json (views and price posts, all public
// on chain) renders at once; the page then re-reads the chain and verifies every signature.
import { seasonUrl, type Config, type NavPost, type VaultData, type VaultView } from "./vault";

type BoardDoc = { ranAt: string; vaults: { id: string; vault: VaultView; cfg: Config; navs: [number, number, string][] }[] };

export function expand(doc: BoardDoc): VaultData[] {
  return doc.vaults.map((v) => ({
    id: v.id,
    vault: v.vault,
    cfg: v.cfg,
    navs: v.navs.map(([epoch, timestamp_ms, price]): NavPost => ({ epoch, timestamp_ms, price, block_ms: timestamp_ms, nav: "", total_shares: "", fee_shares: "", withdrawn: "", fills_head: "", signature: "" })),
  }));
}

let cache: Promise<VaultData[] | null> | null = null;
export function loadBoard(): Promise<VaultData[] | null> {
  cache ??= fetch(seasonUrl("board.json"))
    .then((r) => (r.ok ? r.json() : null))
    .then((d: BoardDoc | null) => (d ? expand(d) : null))
    .catch(() => null);
  return cache;
}
