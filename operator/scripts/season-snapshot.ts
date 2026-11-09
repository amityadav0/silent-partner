// Publish a selective disclosure of one season vault for the "What the chain
// sees" page: its fill log up to the latest NAV epoch, and the full content of
// its executed signals. Reads the sealed state (git pull the season-state
// worktree first). Writes web/public/disclosures/<vault>.json.
//   npx tsx scripts/season-snapshot.ts <vault>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { open } from "../src/season/state.js";
import { FillLog } from "../src/filllog.js";

const vault = process.argv[2];
if (!vault) throw new Error("usage: season-snapshot.ts <vault>");
const key = process.env.SEASON_STATE_KEY || JSON.parse(readFileSync("data/season-keys.json", "utf8")).state;
const dir = process.env.SEASON_STATE_DIR ?? "../season-state";
const read = (n: string) => open(readFileSync(`${dir}/state/${n}.enc`, "utf8").trim(), key).toString().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const entries = read(`fills-${vault}.jsonl`);
if (FillLog.verify(entries, vault) !== null) throw new Error("sealed log is broken");
// cut right after the last NAV entry, so every disclosed epoch is complete
let cut = entries.length;
while (cut > 0 && entries[cut - 1].kind !== "nav") cut--;
const shown = entries.slice(0, cut);
const upto = shown.length ? Number(shown[shown.length - 1].data.epoch) : 0;
let notes: any[] = [];
try { notes = read(`notes-${vault}.jsonl`); } catch { notes = []; }
// The manual leader's own record of what it signed (scripts/season-signal.ts).
try {
  const { signalHash } = await import("../src/signal.js");
  for (const l of readFileSync("data/season-manual-signals.jsonl", "utf8").split("\n").filter(Boolean)) {
    const e = JSON.parse(l);
    if (e.signal.vault === vault) notes.push({ signal: e.signal, signal_hash: signalHash(e.signal).toString("hex"), why: "manual" });
  }
} catch { /* no manual record */ }
const inLog = new Set(shown.filter((e) => e.kind === "signal").map((e) => e.data.hash));
const signals = notes.filter((n) => n.signal && n.signal_hash && inLog.has(n.signal_hash)).map((n) => ({ hash: n.signal_hash, signal: n.signal, why: n.why }));
mkdirSync("../web/public/disclosures", { recursive: true });
writeFileSync(`../web/public/disclosures/${vault}.json`, JSON.stringify({ vault, upto_epoch: upto, published_at: new Date().toISOString(), entries: shown, signals }, null, 1) + "\n");
console.log(`${vault}: ${shown.length} entries up to epoch ${upto}, ${signals.length} signals`);
