// Inbox for manual leader signals while the season loop runs: stores the
// already-sealed envelope (from scripts/season-signal.ts) in the season-state
// branch's inbox/; the loop picks it up at its next tick. The workflow input
// is ciphertext, so nothing about the signal is public before it executes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { open } from "../src/season/state.js";

const sealed = (process.env.SEASON_SIGNAL ?? "").trim();
const key = process.env.SEASON_STATE_KEY ?? "";
if (!sealed.startsWith("sp1:")) throw new Error("expected a sealed envelope (sp1:…) from scripts/season-signal.ts");
JSON.parse(open(sealed, key).toString()); // must decrypt under the season key and be JSON
const dir = join(process.env.SEASON_STATE_DIR ?? "../season-state", "inbox");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${Date.now()}.enc`), sealed + "\n");
console.log("queued for the next tick");
