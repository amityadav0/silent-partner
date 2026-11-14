// The leaderboard's first paint (Z5): every listed vault's views and its price posts (only the
// fields the board draws: epoch, time, price), all already public on chain. The browser shows
// this at once, then re-reads the chain and verifies every signature itself.
import { viewCall } from "../intents.js";

export type BoardNav = [epoch: number, timestamp_ms: number, price: string];
export type BoardVault = { id: string; vault: Record<string, unknown>; cfg: Record<string, unknown>; navs: BoardNav[] };
export type Board = { ranAt: string; vaults: BoardVault[] };

/** Refresh one vault: views every time, posts only past the ones already held. */
export async function refreshVault(rpc: string, id: string, prev: BoardVault | undefined, f: typeof fetch = fetch): Promise<BoardVault> {
  const view = <T>(m: string, a: object = {}) => viewCall<T>(rpc, id, m, a, f, "optimistic");
  const [vault, cfg] = await Promise.all([view<Record<string, unknown>>("get_vault"), view<Record<string, unknown>>("get_config")]);
  const navs = [...(prev?.navs ?? [])];
  for (;;) {
    const page = await view<{ epoch: number; timestamp_ms: number; price: string }[]>("get_navs", { from: navs.length, limit: 100 });
    navs.push(...page.map((n) => [n.epoch, n.timestamp_ms, n.price] as BoardNav));
    if (page.length < 100) break;
  }
  return { id, vault, cfg, navs };
}
