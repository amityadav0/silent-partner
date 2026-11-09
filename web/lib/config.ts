import { DEFAULT_VAULTS } from "./vaults";
// Public build-time config. Nothing here is a secret.
export const NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet";
/** Vault contracts listed on the leaderboard. */
export const VAULTS = (process.env.NEXT_PUBLIC_VAULTS ?? DEFAULT_VAULTS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
export const OPERATOR_API = (process.env.NEXT_PUBLIC_OPERATOR_API ?? "http://localhost:8788").replace(/\/$/, "");
// rpc.{testnet,mainnet}.near.org are deprecated and rate-limit (429).
export const RPC = process.env.NEXT_PUBLIC_NEAR_RPC ?? (NETWORK === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com");
/** Read endpoints, tried in order: a rate-limited (429) or unreachable one falls through to the next. */
export const RPCS: string[] = process.env.NEXT_PUBLIC_NEAR_RPC
  ? [process.env.NEXT_PUBLIC_NEAR_RPC]
  : NETWORK === "mainnet"
    ? ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org", "https://rpc.mainnet.near.org"]
    : ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://rpc.testnet.near.org"];
export const NEAR_EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
export const TGAS = 1_000_000_000_000n;
/** Display names and decimals for intents asset ids. */
export const ASSETS: Record<string, { symbol: string; decimals: number }> = {
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": { symbol: "USDC", decimals: 6 },
  "nep141:wrap.near": { symbol: "wNEAR", decimals: 24 },
  "nep141:usdc.fakes.testnet": { symbol: "USDC", decimals: 6 },
  "nep141:wrap.testnet": { symbol: "wNEAR", decimals: 24 },
};
/** Set when the site is served from a sub-path (GitHub Pages). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
