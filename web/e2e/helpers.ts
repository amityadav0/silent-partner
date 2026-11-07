import { existsSync, readFileSync } from "node:fs";
import { base58 } from "@scure/base";
import type { Page } from "@playwright/test";

export const VAULT = process.env.E2E_VAULT ?? "sp-vault-60270.testnet";
const KEYS = new URL("../../operator/data/testnet-keys.json", import.meta.url);

/** The testnet leader's signal key as the console stores it (hex 32-byte seed), if present locally. */
export function leaderSeedHex(): string | null {
  if (!existsSync(KEYS)) return null;
  const k = JSON.parse(readFileSync(KEYS, "utf8")).signal as string;
  return Buffer.from(base58.decode(k.replace(/^ed25519:/, ""))).subarray(0, 32).toString("hex");
}

export async function withLeaderKey(page: Page, seed: string) {
  await page.addInitScript(([v, s]) => localStorage.setItem(`sp.signal-key.${v}`, s), [VAULT, seed]);
}
