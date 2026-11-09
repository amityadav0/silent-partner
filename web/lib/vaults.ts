// Public metadata for listed vaults: who leads them and how honest the numbers
// are. Season vaults mirror operator/season/vaults.json.
export type Mode = "paper" | "live";
export type VaultMeta = { name: string; leaderKind: "bot" | "ai" | "human" | "drill"; blurb: string; mode: Mode; network: "testnet" | "mainnet"; season?: boolean };

export const META: Record<string, VaultMeta> = {
  "sp-momo-92991.testnet": { name: "Momentum bot", leaderKind: "bot", mode: "paper", network: "testnet", season: true, blurb: "Rule-based: long NEAR when the 1h EMA is above the 6h EMA, flat when below." },
  "sp-meanrev-92991.testnet": { name: "Mean-reversion bot", leaderKind: "bot", mode: "paper", network: "testnet", season: true, blurb: "Rule-based: buys NEAR 1.5σ below its 6h mean, sells 1.5σ above." },
  "sp-ai-92991.testnet": { name: "AI leader", leaderKind: "ai", mode: "paper", network: "testnet", season: true, blurb: "An LLM on NEAR AI Cloud decides each epoch from public market data; it commits to its rationale by hash only." },
  "sp-manual-92991.testnet": { name: "Manual leader", leaderKind: "human", mode: "paper", network: "testnet", season: true, blurb: "A human leader signing signals by hand." },
  "sp-drill-92991.testnet": { name: "Emergency drill", leaderKind: "drill", mode: "paper", network: "testnet", blurb: "Test build with a 5-minute NAV timeout. The operator was stopped and a follower exited through the emergency path." },
  "sp-vault-60270.testnet": { name: "First testnet vault", leaderKind: "human", mode: "paper", network: "testnet", blurb: "The P2/P3 end-to-end vault: hand-posted NAVs and one browser-signed signal." },
};

export const DEFAULT_VAULTS = Object.keys(META);

export const metaOf = (id: string): VaultMeta =>
  META[id] ?? { name: id, leaderKind: "human", blurb: "", mode: id.endsWith(".testnet") ? "paper" : "live", network: id.endsWith(".testnet") ? "testnet" : "mainnet" };

/** The honest label shown next to every number from this vault. */
export const modeLabel = (m: VaultMeta) => (m.mode === "paper" ? `paper · ${m.network}` : m.network === "mainnet" ? "live · mainnet" : `live · ${m.network}`);
