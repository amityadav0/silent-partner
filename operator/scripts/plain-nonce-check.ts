// D-H-2 pre-payout check, read-only: does mainnet intents.near still accept a
// transfer signed with a plain (legacy, non-versioned) NEP-413 nonce? Payouts
// use plain nonces so `is_nonce_used` remembers them forever. Signed by an
// implicit account's own key; simulate_intents executes nothing.
//   npx tsx scripts/plain-nonce-check.ts <implicit-account> <receiver> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { USDC, nep413Prehash, versionedNonce, viewCall } from "../src/intents.js";

const [acct, receiver, out] = process.argv.slice(2);
const key = KeyPair.fromString(JSON.parse(readFileSync(`${homedir()}/.near-credentials/mainnet/${acct}.json`, "utf8")).private_key);
const RPC = "https://rpc.mainnet.fastnear.com";
const message = JSON.stringify({ deadline: new Date(Date.now() + 10 * 60_000).toISOString(), intents: [{ intent: "transfer", receiver_id: receiver, tokens: { [USDC]: "1" } }], signer_id: acct });
const sim = async (nonce: Buffer) => {
  const payload = { message, nonce: nonce.toString("base64"), recipient: "intents.near" };
  const signed = { standard: "nep413", payload, public_key: key.getPublicKey().toString(), signature: "ed25519:" + base58.encode(key.sign(nep413Prehash(payload)).signature) };
  try { return { ok: true, result: await viewCall(RPC, "intents.near", "simulate_intents", { signed: [signed] }) }; } catch (e) { return { ok: false, error: String((e as Error).message).slice(0, 400) }; }
};
const salt = await viewCall<string>(RPC, "intents.near", "current_salt", {}).catch(() => null);
const result = { ranAt: new Date().toISOString(), signer: acct, plain: await sim(randomBytes(32)), versioned: salt ? await sim(versionedNonce(salt, Date.now() + 10 * 60_000)) : "no current_salt view" };
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1).slice(0, 1500));
