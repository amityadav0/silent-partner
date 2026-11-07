// Record real 1Click dry-quote responses for operator tests. Dry only; nothing signed.
//   npx tsx --env-file-if-exists=../.env scripts/record-fixtures.ts
import { writeFileSync } from "node:fs";
import { USDC, WNEAR } from "../src/intents.js";

const JWT = process.env.ONECLICK_JWT ?? "";
if (!JWT) throw new Error("ONECLICK_JWT not set");
const R = "7164eb86180b4bfefcc6cc906aff0673c80f49b9d3837f0916b93dee7bb12a8f"; // testnet vault's derived account, a valid implicit id
const body = (o: string, d: string, amount: string, dep: string, rec: string, ref: string, recipient = R) => ({
  dry: true, swapType: "EXACT_INPUT", slippageTolerance: 50, originAsset: o, destinationAsset: d, amount,
  depositType: dep, recipientType: rec, refundType: ref, recipient, refundTo: R,
  deadline: new Date(Date.now() + 10 * 60_000).toISOString(), ...(dep === "CONFIDENTIAL_INTENTS" && rec === "CONFIDENTIAL_INTENTS" ? { confidentiality: "advanced" } : {}),
});
const cases: Record<string, unknown> = {
  "trade-usdc-wnear": body(USDC, WNEAR, "10000000", "CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS"),
  "trade-wnear-usdc": body(WNEAR, USDC, "1000000000000000000000000", "CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS"),
  "shield-usdc": body(USDC, USDC, "5000000", "INTENTS", "CONFIDENTIAL_INTENTS", "INTENTS"),
  "unshield-usdc": body(USDC, USDC, "5000000", "CONFIDENTIAL_INTENTS", "INTENTS", "CONFIDENTIAL_INTENTS"),
};
for (const [name, b] of Object.entries(cases)) {
  const r = await fetch("https://1click.chaindefuser.com/v0/quote", { method: "POST", headers: { "content-type": "application/json", "X-API-Key": JWT }, body: JSON.stringify(b) });
  const text = await r.text();
  if (text.includes(JWT)) throw new Error("JWT echoed");
  writeFileSync(`test/fixtures/quote-${name}.json`, text);
  const j = JSON.parse(text);
  console.log(name, r.status, j.quote?.amountOut ?? j.message, JSON.stringify(j.quoteRequest?.appFees ?? null));
}
