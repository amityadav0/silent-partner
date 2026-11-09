// Selective disclosure of one season signal: prints the signal, its rationale
// (AI leader) and how to check them against the chain. Reads the sealed
// notebook with the state key (local data/season-keys.json or SEASON_STATE_KEY).
//   npx tsx scripts/season-disclose.ts <vault> <signal hash>
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { open } from "../src/season/state.js";
import { signalHash } from "../src/signal.js";
import { viewCall } from "../src/intents.js";

const [vault, hash] = process.argv.slice(2);
if (!vault || !hash) throw new Error("usage: season-disclose.ts <vault> <signal hash>");
const key = process.env.SEASON_STATE_KEY || JSON.parse(readFileSync("data/season-keys.json", "utf8")).state;
const dir = process.env.SEASON_STATE_DIR ?? "../season-state";
const notes = open(readFileSync(`${dir}/state/notes-${vault}.jsonl.enc`, "utf8").trim(), key).toString().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const n = notes.find((x) => x.signal_hash === hash);
if (!n) throw new Error("no such signal in the notebook");
const onChain = (await viewCall<any[]>("https://rpc.testnet.fastnear.com", vault, "get_signals", { from: 0, limit: 1000 }, fetch, "optimistic")).find((s) => s.hash === hash);
const checks = {
  signal_hash_matches: signalHash(n.signal).toString("hex") === hash,
  recorded_on_chain: !!onChain,
  memo_hash_matches_rationale: n.rationale ? createHash("sha256").update(n.rationale).digest("hex") === n.signal.memo_hash : null,
};
console.log(JSON.stringify({ vault, signal: n.signal, rationale: n.rationale ? JSON.parse(n.rationale) : null, on_chain: onChain ?? null, checks }, null, 2));
