// P1(a) probe: can an MPC-controlled ed25519 key (Chain Signatures, EdDSA domain)
// sign a NEP-413 intents payload that NEAR Intents accepts?
//
//   1. Derive the EdDSA key for (predecessor, path) on testnet MPC (view).
//   2. Call MPC `sign` from a testnet faucet account (testnet gas only).
//   3. Verify the signature locally against the derived key.
//   4. Read-only on mainnet: `simulate_intents` on intents.near with the signed,
//      empty intent. Nothing is executed or broadcast on mainnet. A tampered
//      copy is simulated too, as a control.
//
// The signer in step 2 is an EOA. A contract calling `sign` gets a key derived
// the same way from its own account id, so the result transfers to the vault.
//
//   npx tsx scripts/p1-mpc-eddsa-probe.ts <testnet-account> <out.json>
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { connect, keyStores, providers, utils } from "near-api-js";
import { base58 } from "@scure/base";
import nacl from "tweetnacl";

const account = process.argv[2];
const out = process.argv[3] ?? "p1-mpc-eddsa.json";
if (!account) throw new Error("usage: p1-mpc-eddsa-probe.ts <testnet-account> [out.json]");
const MPC = "v1.signer-prod.testnet";
const PATH = "silent-partner/vault/probe";
const TESTNET_RPC = "https://rpc.testnet.fastnear.com";
const MAINNET_RPC = "https://rpc.mainnet.fastnear.com";

async function view(rpc: string, contract: string, method: string, args: unknown) {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
  const j = await r.json();
  if (j.error || j.result?.error) return { error: j.error?.data ?? j.result?.error };
  return { value: JSON.parse(Buffer.from(j.result.result).toString()) };
}

/** NEP-413 prehash, as in defuse crates/signatures/nep413: sha256(borsh((tag, payload))). */
function nep413Prehash(message: string, nonce: Buffer, recipient: string): Buffer {
  const str = (s: string) => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  return createHash("sha256").update(Buffer.concat([tag, str(message), nonce, str(recipient), Buffer.from([0])])).digest();
}

async function versionedNonce(deadlineMs: number): Promise<Buffer> {
  const salt = await view(MAINNET_RPC, "intents.near", "current_salt", {});
  const dl = Buffer.alloc(8); dl.writeBigUInt64LE(BigInt(deadlineMs) * 1_000_000n);
  const ts = Buffer.alloc(8); ts.writeBigUInt64LE(BigInt(Date.now()) * 1_000_000n);
  return Buffer.concat([Buffer.from([0x56, 0x28, 0xf6, 0xc6, 0]), Buffer.from(salt.value as string, "hex"), dl, ts, randomBytes(7)]);
}

const result: Record<string, unknown> = { ranAt: new Date().toISOString(), mpc: MPC, path: PATH, predecessor: account };

// 1. derive
const derived = await view(TESTNET_RPC, MPC, "derived_public_key", { path: PATH, predecessor: account, domain_id: 1 });
const pkStr = derived.value as string;
const pk = base58.decode(pkStr.replace(/^ed25519:/, ""));
const implicit = Buffer.from(pk).toString("hex");
result.derivedPublicKey = pkStr;
result.implicitAccount = implicit;

// 2. payload: an empty intent from the derived implicit account
const deadline = Date.now() + 10 * 60_000;
const message = JSON.stringify({ signer_id: implicit, deadline: new Date(deadline).toISOString(), intents: [] });
const nonce = await versionedNonce(deadline);
const recipient = "intents.near";
const prehash = nep413Prehash(message, nonce, recipient);
result.prehash = prehash.toString("hex");

// 3. MPC sign (testnet)
const near = await connect({ networkId: "testnet", nodeUrl: TESTNET_RPC, keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`) });
const acct = await near.account(account);
const t0 = Date.now();
const outcome = await acct.functionCall({
  contractId: MPC, methodName: "sign",
  args: { request: { path: PATH, payload_v2: { Eddsa: prehash.toString("hex") }, domain_id: 1 } },
  gas: 300_000_000_000_000n, attachedDeposit: 1n,
});
const resp = providers.getTransactionLastResult(outcome) as { scheme: string; signature: number[] };
result.signTx = outcome.transaction.hash;
result.signMs = Date.now() - t0;
result.signScheme = resp.scheme;
const sig = Uint8Array.from(resp.signature);
result.localVerify = nacl.sign.detached.verify(prehash, sig, pk);

// 4. mainnet read-only simulation
const signed = { standard: "nep413", payload: { message, nonce: nonce.toString("base64"), recipient }, public_key: pkStr, signature: "ed25519:" + base58.encode(sig) };
result.simulate = await view(MAINNET_RPC, "intents.near", "simulate_intents", { signed: [signed] });
const bad = Uint8Array.from(sig); bad[0] ^= 1;
result.simulateTampered = await view(MAINNET_RPC, "intents.near", "simulate_intents", { signed: [{ ...signed, signature: "ed25519:" + base58.encode(bad) }] });
result.publicKeyHelper = utils.PublicKey.fromString(pkStr).toString() === pkStr;

writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ implicit, localVerify: result.localVerify, signMs: result.signMs, simulate: result.simulate, simulateTampered: result.simulateTampered }, null, 2).slice(0, 2500));
