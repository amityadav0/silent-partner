// Silent Partner operator service.
//   POST /v1/signals   leader-signed signal envelope → verify → execute (or hold, for limits)
//   GET  /v1/health    mode, vault, log head
//   GET  /v1/vault     public vault state (no positions)
//   GET  /v1/log/head  fill-log head and length (contents stay private)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { KeyPair } from "near-api-js";
import { NearVault, type VaultChain } from "./chain.js";
import { Confidential } from "./confidential.js";
import { FillLog } from "./filllog.js";
import { Operator } from "./operator.js";
import { loadEnv } from "./config.js";

export function makeApp(op: Operator | null, chain: VaultChain | null, mode: Record<string, unknown>) {
  const app = new Hono();
  app.use("/v1/*", cors());
  app.get("/health", (c) => c.json({ ok: true, dryRun: process.env.DRY_RUN !== "0", ...mode }));
  app.get("/v1/health", (c) => c.json({ ok: true, ...mode, head: op?.log.head() ?? null }));
  app.get("/v1/log/head", (c) => c.json({ head: op?.log.head() ?? null, length: op?.log.entries.length ?? 0 }));
  app.get("/v1/vault", async (c) => (chain ? c.json(await chain.getVault()) : c.json({ error: "not configured" }, 503)));
  app.post("/v1/signals", async (c) => {
    if (!op) return c.json({ ok: false, error: "not configured" }, 503);
    const body = await c.req.json().catch(() => null);
    try {
      const r = await op.submitSignal(body);
      return c.json(r, r.ok ? 200 : 400);
    } catch (e) {
      return c.json({ ok: false, error: String((e as Error).message).slice(0, 300) }, 500);
    }
  });
  return app;
}

export const app = makeApp(null, null, { dryRun: process.env.DRY_RUN !== "0" });

export async function main() {
  const env = loadEnv();
  if (!env.contractId || !env.attestationKey) {
    console.log("VAULT_CONTRACT_ID / ATTESTATION_PRIVATE_KEY not set: serving health only");
    serve({ fetch: app.fetch, port: env.port });
    return;
  }
  mkdirSync(env.dataDir, { recursive: true });
  const chain = new NearVault(env.contractId, env.rpc, env.network, env.operatorId, env.operatorKey);
  const v = await chain.getVault();
  if (!v.vault_account) throw new Error("vault not active");
  const { base58 } = await import("@scure/base");
  const vaultPk = "ed25519:" + base58.encode(Buffer.from(v.vault_account, "hex"));
  const op = new Operator(chain, new Confidential(env.oneclickUrl, env.oneclickJwt, fetch, env.oneclickKey), new FillLog(env.contractId, join(env.dataDir, `fills-${env.contractId}.jsonl`)), KeyPair.fromString(env.attestationKey as `ed25519:${string}`), vaultPk, env.op);
  const mode = { network: env.network, vault: env.contractId, dryRun: env.op.dryRun, chainWrites: env.op.chainWrites };
  serve({ fetch: makeApp(op, chain, mode).fetch, port: env.port });
  console.log(`operator ${JSON.stringify(mode)} on :${env.port}`);
  const safe = (name: string, f: () => Promise<unknown>) => f().catch((e) => console.error(`${name}: ${(e as Error).message}`));
  setInterval(() => safe("limits", () => op.tickLimits()), 30_000);
  setInterval(() => safe("shield", () => op.shieldPending()), 60_000);
  setInterval(() => safe("epoch", async () => console.log("epoch", await op.epoch())), env.epochMs);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
