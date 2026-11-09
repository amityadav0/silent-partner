// Manual leader: build and sign a signal for a season vault with the leader's
// local signal key (data/season-keys.json), and print the envelope.
//   npx tsx scripts/season-signal.ts <vault> <buy|sell> <size_bps>
//   gh workflow run season.yml -f signal="$(npx tsx scripts/season-signal.ts sp-manual-92991.testnet buy 3000)"
import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
import { signSignal } from "../src/signal.js";

const [vault, side, bps] = process.argv.slice(2);
if (!vault || !["buy", "sell"].includes(side) || !Number(bps)) throw new Error("usage: season-signal.ts <vault> <buy|sell> <size_bps>");
const S = JSON.parse(readFileSync("season/vaults.json", "utf8"));
const key = JSON.parse(readFileSync("data/season-keys.json", "utf8"))[`signal:${vault}`];
if (!key) throw new Error(`no local signal key for ${vault}`);
const [from, to] = side === "buy" ? [S.base, S.risk] : [S.risk, S.base];
const env = signSignal({ v: 1, vault, from, to, size_bps: Number(bps), type: "market", nonce: randomBytes(8).toString("hex"), created_ms: Date.now() }, KeyPair.fromString(key));
// The leader's own private record (gitignored), for later disclosure.
appendFileSync("data/season-manual-signals.jsonl", JSON.stringify({ ts: Date.now(), ...env }) + "\n");
process.stdout.write(JSON.stringify(env));
