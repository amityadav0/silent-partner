// Public metadata for listed vaults: who leads them and how honest the numbers
// are. Season vaults mirror operator/season/vaults.json.
export type Mode = "paper" | "live";
export type Risk = "low" | "med" | "high";
export type VaultMeta = { name: string; leaderKind: "bot" | "ai" | "human" | "drill" | "benchmark"; style: string; risk?: Risk; blurb: string; mode: Mode; network: "testnet" | "mainnet"; season?: boolean; community?: boolean; near?: [number, number];
  /** A house benchmark (T3): copyable, but never the hero pick or the week's highlight. */
  benchmark?: boolean;
  /** An old test vault (T4): listed under "Test vaults", never ranked. */
  test?: boolean;
  /** Holds a mix of several risky assets (T6): the strategy's rule, in words. */
  mix?: string };

const season = { mode: "paper" as const, network: "testnet" as const, season: true };
export const META: Record<string, VaultMeta> = {
  "sp-trend-8952.testnet": { ...season, near: [0, 100], name: "Trend Rider", leaderKind: "ai", risk: "high", style: "Rides momentum", blurb: "AI on NEAR AI Cloud. High NEAR weight when 1h and 6h momentum agree, low when they turn. Its reasoning stays private: each signal commits to it by hash." },
  "sp-convict-8952.testnet": { ...season, near: [20, 80], name: "Conviction", leaderKind: "ai", risk: "med", style: "50% NEAR, tilts by conviction", blurb: "AI on NEAR AI Cloud. Baseline 50% NEAR, tilting between 20% and 80% (enforced) by conviction." },
  "sp-voltgt-8952.testnet": { ...season, near: [20, 100], name: "Vol Target", leaderKind: "ai", risk: "med", style: "Targets 40% volatility", blurb: "AI on NEAR AI Cloud. Sizes NEAR to a 40% annualised volatility target, always 20–100% invested." },
  "sp-contra-8952.testnet": { ...season, near: [0, 100], name: "Contrarian", leaderKind: "ai", risk: "med", style: "Fades extremes", blurb: "AI on NEAR AI Cloud. Buys sharp drops toward the 24h low, trims spikes toward the high." },
  "sp-ai-92991.testnet": { ...season, near: [0, 100], name: "Allocator", leaderKind: "ai", risk: "med", style: "Momentum + volatility, own judgement", blurb: "AI on NEAR AI Cloud. Picks a NEAR weight 0–100% at each update from momentum, volatility and its own reasoning." },
  "sp-momo-92991.testnet": { ...season, near: [0, 80], name: "Momentum bot", leaderKind: "bot", risk: "high", style: "EMA crossover", blurb: "Rule-based: long NEAR when the 1h EMA is above the 6h EMA, flat when below." },
  "sp-meanrev-92991.testnet": { ...season, near: [0, 80], name: "Mean-reversion bot", leaderKind: "bot", risk: "med", style: "Buys −1.5σ, sells +1.5σ", blurb: "Rule-based: buys NEAR 1.5σ below its 6h mean, sells 1.5σ above." },
  "sp-manual-92991.testnet": { ...season, name: "Steady Hand", leaderKind: "human", risk: "med", style: "A person trading by hand, signs every trade", blurb: "Run by a person, not a bot: every trade is signed by hand with the leader's key." },
  "hold.sp-sop-92991.testnet": { ...season, benchmark: true, near: [100, 100], name: "Hold NEAR", leaderKind: "benchmark", risk: "high", style: "100% NEAR, never sells", blurb: "Benchmark: 100% NEAR from day one. It buys only to invest new deposits and never sells, so it is exactly \"holding NEAR\", with the same fees as every vault." },
  "half.sp-sop-92991.testnet": { ...season, benchmark: true, near: [50, 50], name: "Half & Half", leaderKind: "benchmark", risk: "low", style: "50/50, rebalanced weekly", blurb: "Benchmark: 50% NEAR and 50% USDC, put back to 50/50 once a week. The cautious way to hold NEAR." },
  "majors.sp-sop-92991.testnet": { ...season, mix: "any of BTC, ETH, SOL and NEAR that are up over 24 h, equal weights, 80% at most (its code)", name: "Majors", leaderKind: "bot", risk: "high", style: "BTC, ETH, SOL, NEAR: holds what's up", blurb: "Bot, multi-asset: holds whichever of BTC, ETH, SOL and NEAR rose more than 1% over 24 hours, at equal weights, never more than 80% of the vault. Its price updates are bounded by 1Click-signed quotes for all four." },
  "sp-drill-92991.testnet": { test: true, mode: "paper", network: "testnet", name: "Emergency drill", leaderKind: "drill", style: "Exit drill", blurb: "Test build whose price goes out of date after 5 minutes. The operator was stopped and a follower exited through the emergency path." },
  "sp-vault-60270.testnet": { test: true, mode: "paper", network: "testnet", name: "First test vault", leaderKind: "human", style: "First end-to-end run", blurb: "The P2/P3 end-to-end vault: hand-posted prices and one browser-signed signal." },
};

/** The live mainnet vault (real funds, D-P5-11). Never listed with the testnet
 *  paper season, so the two networks' numbers are never mixed. */
export const MAINNET_VAULT = "1f80f62c945eec98005dac38ab9db5f95c44ef1258cf5ca9606fb8c7dd4da36e";
export const MAINNET_META: Record<string, VaultMeta> = {
  [MAINNET_VAULT]: { mode: "live", network: "mainnet", name: "Genesis (mainnet)", leaderKind: "human", risk: "med", style: "The first live vault on NEAR mainnet", blurb: "Real USDC. Deployed from the reviewed reproducible build. Shield, a confidential leader trade and a follower payout all ran through the vault's MPC key." },
};

export const DEFAULT_VAULTS = Object.keys(META);

export const metaOf = (id: string): VaultMeta =>
  META[id] ?? MAINNET_META[id] ?? { name: id, leaderKind: "human", style: "", blurb: "", mode: id.endsWith(".testnet") ? "paper" : "live", network: id.endsWith(".testnet") ? "testnet" : "mainnet" };

/** The honest label shown next to every number from this vault. */
export const modeLabel = (m: VaultMeta) => (m.mode === "paper" ? `paper · ${m.network}` : m.network === "mainnet" ? "MAINNET · real funds" : `live · ${m.network}`);

/** Leader badge: who decides the trades. */
export const badgeOf = (m: VaultMeta) => ({ ai: "AI", bot: "Bot", human: "Human", drill: "Drill", benchmark: "BENCHMARK" })[m.leaderKind];
