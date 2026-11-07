// Public build-time config. Nothing here is a secret.
export const NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const CONTRACT_ID = process.env.NEXT_PUBLIC_VAULT_CONTRACT_ID ?? "";
export const OPERATOR_API = (process.env.NEXT_PUBLIC_OPERATOR_API ?? "http://localhost:8788").replace(/\/$/, "");
// rpc.{testnet,mainnet}.near.org are deprecated and rate-limit (429).
export const RPC = process.env.NEXT_PUBLIC_NEAR_RPC ?? (NETWORK === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com");
export const NEAR_EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
export const TGAS = 1_000_000_000_000n;
