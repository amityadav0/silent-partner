// A real NEAR AI Cloud receipt (2026-11-12): TEE signature over a completion's exact
// bytes, and the model attestation's TDX quote. Public data, no key.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { quoteBinds, receiptMemo, recoverSigner, sha256hex, tdxReportData, verifyReceipt, type Attestation, type Receipt } from "../src/leaders/receipt.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/nearai-receipt.json", import.meta.url), "utf8")) as { receipt: Receipt; attestation: Attestation };
const { receipt: r, attestation: a } = fx;
const quote = Buffer.from(a.intel_quote.replace(/^0x/, ""), "hex");

describe("NEAR AI TEE receipts", () => {
  it("the enclave signature recovers to the attested signing address and names the model", () => {
    expect(recoverSigner(r.text, r.signature)).toBe(r.signing_address);
    expect(verifyReceipt(r)).toBe(true);
    expect(r.text.startsWith(`${r.model}:`)).toBe(true);
  });
  it("the TDX quote's report_data binds that address and our nonce", () => {
    expect(sha256hex(quote)).toBe(r.quote_sha256);
    expect(quoteBinds(quote, r.signing_address, r.nonce)).toBe(true);
    expect(quoteBinds(quote, "0x" + "11".repeat(20), r.nonce)).toBe(false);
    expect(quoteBinds(quote, r.signing_address, "00".repeat(32))).toBe(false);
    expect(tdxReportData(quote.subarray(0, 100))).toBeNull();
  });
  it("a tampered text, a different model or other bytes fail", () => {
    expect(verifyReceipt({ ...r, text: r.text.replace(/.$/, r.text.endsWith("0") ? "1" : "0") })).toBe(false);
    expect(verifyReceipt({ ...r, model: "other/model" })).toBe(false);
    const [req, res] = r.text.slice(r.model.length + 1).split(":") as [string, string];
    expect(verifyReceipt(r, { requestSha: req, responseSha: res })).toBe(true);
    expect(verifyReceipt(r, { requestSha: req, responseSha: "00".repeat(32) })).toBe(false);
  });
  it("the on-chain memo commits to the signed text and the attestation digest", () => {
    expect(receiptMemo(r)).toBe(sha256hex(`${r.text}:${r.quote_sha256}`));
    expect(receiptMemo({ ...r, quote_sha256: "00".repeat(32) })).not.toBe(receiptMemo(r));
  });
});
