// Silent Partner operator. P0 entry point: health only; P3 adds the watcher,
// signal intake, execution, fill log, NAV posting and withdrawals.
import { serve } from "@hono/node-server";
import { Hono } from "hono";

export const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, dryRun: process.env.DRY_RUN !== "0" }));

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8788);
  serve({ fetch: app.fetch, port });
  console.log(`operator listening on :${port}`);
}
