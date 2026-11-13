// One-off (D4): backfill season/stake.json from archival get_vault views, one point per 6 h
// since each vault's first price update. Read-only. Usage: npx tsx scripts/stake-backfill.ts out.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { addStake, stakeBps, type StakeDoc } from "../src/season/stake.js";

const RPC = "https://archival-rpc.testnet.fastnear.com";
const out = process.argv[2] ?? "stake.json";
const S = JSON.parse(readFileSync("season/vaults.json", "utf8")) as { vaults: { id: string; strategy: string }[] };

async function rpc<T>(method: string, params: unknown): Promise<T> {
  for (let i = 0; ; i++) {
    const r = (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((x) => x.json())) as { result?: T; error?: { message: string; data?: string; cause?: { name: string } } };
    if (r.result) return r.result;
    const name = r.error?.cause?.name ?? "";
    if (i >= 4 || ["UNKNOWN_BLOCK", "UNKNOWN_ACCOUNT"].includes(name)) throw new Error(`${name || r.error?.message} ${r.error?.data ?? ""}`.slice(0, 160));
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
}
const blockTime = async (h: number): Promise<number | null> => {
  for (let k = 0; k < 6; k++) {
    try {
      const b = await rpc<{ header: { timestamp: string } }>("block", { block_id: h + k });
      return Number(BigInt(b.header.timestamp) / 1_000_000n);
    } catch {
      /* skipped height */
    }
  }
  return null;
};
const head = await rpc<{ header: { height: number; timestamp: string } }>("block", { finality: "final" });
const H = head.header.height, T = Number(BigInt(head.header.timestamp) / 1_000_000n);
const back = H - 200_000;
const rate = (T - (await blockTime(back))!) / 200_000; // ms per block
async function heightAt(t: number): Promise<number> {
  let h = Math.round(H - (T - t) / rate);
  for (let i = 0; i < 2; i++) {
    const bt = await blockTime(h);
    if (bt === null) break;
    h = Math.round(h - (bt - t) / rate);
  }
  return h;
}
const view = async <T>(id: string, method: string, args: object, block_id: number | null) =>
  JSON.parse(Buffer.from((await rpc<{ result: number[] }>("query", { request_type: "call_function", account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), ...(block_id ? { block_id } : { finality: "final" }) })).result).toString()) as T;

let doc: StakeDoc = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { vaults: {} };
const heights = new Map<number, number>();
const STEP = 6 * 3_600_000;
for (const v of S.vaults.filter((x) => x.strategy !== "drill")) {
  const [first] = await view<{ timestamp_ms: number }[]>(v.id, "get_navs", { from: 0, limit: 1 }, null);
  if (!first) continue;
  const pts: [number, number][] = [];
  for (let t = Math.ceil(first.timestamp_ms / STEP) * STEP; t < T; t += STEP) {
    if (!heights.has(t)) heights.set(t, await heightAt(t));
    try {
      const g = await view<{ leader_shares: string; total_shares: string }>(v.id, "get_vault", {}, heights.get(t)!);
      pts.push([t, stakeBps(g.leader_shares, g.total_shares)]);
    } catch (e) {
      console.log(JSON.stringify({ vault: v.id, t, skip: String((e as Error).message).slice(0, 80) }));
    }
  }
  const g = await view<{ leader_shares: string; total_shares: string }>(v.id, "get_vault", {}, null);
  pts.push([T, stakeBps(g.leader_shares, g.total_shares)]);
  doc = addStake(doc, v.id, pts, T);
  console.log(v.id, pts.length, pts.map((p) => p[1]).join(" "));
}
writeFileSync(out, JSON.stringify({ ...doc, ranAt: new Date(T).toISOString() }) + "\n");
