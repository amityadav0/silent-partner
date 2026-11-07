// Testnet only: 1Click has no testnet, so testnet vaults are initialised with a
// test quote key and the operator signs quotes itself, exactly the way 1Click
// does (ed25519 over base58(sha256(json-stable-stringify(message)))). A mainnet
// vault's oneclick_key is 1Click's key (immutable at init), so these never verify there.
import stringify from "json-stable-stringify";
import { sha256 } from "@noble/hashes/sha256";
import { base58 } from "@scure/base";
import { KeyPair } from "near-api-js";

export type TestQuoteFields = {
  originAsset: string; destinationAsset: string; amount: string; minAmountOut: string; slippageTolerance: number;
  depositType: string; recipientType: string; refundType: string; recipient: string; refundTo: string;
  depositAddress: string; deadline: string;
};

export function signTestQuote(f: TestQuoteFields, key: KeyPair): { message: string; signature: string } {
  const message = stringify({ dry: false, swapType: "EXACT_INPUT", amountIn: f.amount, amountOut: f.minAmountOut, timestamp: new Date().toISOString(), ...f }) as string;
  const digest = base58.encode(sha256(new TextEncoder().encode(message)));
  const sig = key.sign(new TextEncoder().encode(digest));
  return { message, signature: "ed25519:" + base58.encode(sig.signature) };
}
