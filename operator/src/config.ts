// Operator configuration from the environment. Secrets are read, never logged.
import { USDC, WNEAR } from "./intents.js";
import type { OperatorCfg } from "./operator.js";

export type Env = {
  network: "testnet" | "mainnet"; rpc: string; contractId: string; operatorId: string; operatorKey?: string;
  attestationKey?: string; oneclickUrl: string; oneclickJwt: string; oneclickKey?: string;
  dataDir: string; port: number; epochMs: number; op: OperatorCfg;
};

export function loadEnv(e: NodeJS.ProcessEnv = process.env): Env {
  const network = (e.NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet";
  const dryRun = e.DRY_RUN !== "0";
  // Chain writes: free on testnet; mainnet needs MAINNET_WRITES=1 (Amit's OK).
  const chainWrites = network === "testnet" ? e.CHAIN_WRITES !== "0" : e.MAINNET_WRITES === "1";
  if (network === "mainnet" && !dryRun && e.MAINNET_LIVE_OK !== "1") throw new Error("live mainnet needs MAINNET_LIVE_OK=1 (Amit's explicit OK)");
  const testnetMap: Record<string, string> = { "nep141:usdc.fakes.testnet": USDC, "nep141:wrap.testnet": WNEAR };
  return {
    network,
    rpc: e.NEAR_RPC_URL ?? (network === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com"),
    contractId: e.VAULT_CONTRACT_ID ?? "",
    operatorId: e.OPERATOR_ACCOUNT_ID ?? "",
    operatorKey: e.OPERATOR_PRIVATE_KEY,
    attestationKey: e.ATTESTATION_PRIVATE_KEY,
    oneclickUrl: e.ONECLICK_URL ?? "https://1click.chaindefuser.com",
    oneclickJwt: e.ONECLICK_JWT ?? "",
    oneclickKey: e.ONECLICK_PUBLIC_KEY,
    dataDir: e.DATA_DIR ?? "./data",
    port: Number(e.PORT ?? 8788),
    epochMs: Number(e.EPOCH_MS ?? 60 * 60 * 1000),
    op: {
      dryRun, chainWrites,
      slippageBps: Number(e.SLIPPAGE_BPS ?? 50),
      minShield: BigInt(e.MIN_SHIELD ?? "1000000"),
      assetMap: network === "testnet" ? testnetMap : {},
      decimals: { [USDC]: 6, [WNEAR]: 24, "nep141:usdc.fakes.testnet": 6, "nep141:wrap.testnet": 24 },
      signalMaxAgeMs: 5 * 60_000,
      pollMs: 3000,
      pollTries: 60,
    },
  };
}
