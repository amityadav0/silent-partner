// The browser check of an AI decision's NEAR AI receipt, on a real receipt (operator fixture).
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import { checkReceipt, receiptOk, type AttestationDoc, type PublicReceipt } from "../lib/receipt";

const fx = JSON.parse(readFileSync(new URL("../../operator/test/fixtures/nearai-receipt.json", import.meta.url), "utf8"));
const r: PublicReceipt = fx.receipt;
const model: string = fx.receipt.model;
const memo = bytesToHex(sha256(new TextEncoder().encode(`${r.text}:${r.quote_sha256}`)));
const atts: AttestationDoc = { [r.quote_sha256]: { ...fx.attestation, seen: "2026-11-12T09:00:00Z" } };

describe("AI decision receipts in the browser", () => {
  it("a real receipt passes every check", () => {
    const c = checkReceipt(r, model, memo, atts);
    expect(c).toEqual({ signature: true, model: true, memo: true, quote: true });
    expect(receiptOk(c)).toBe(true);
  });
  it("without the quote, the binding is unknown, not failed", () => {
    expect(checkReceipt(r, model, memo, null).quote).toBeNull();
  });
  it("a wrong memo, model, signer or quote fails", () => {
    expect(checkReceipt(r, model, "00".repeat(32), atts).memo).toBe(false);
    expect(checkReceipt(r, "other/model", memo, atts).model).toBe(false);
    expect(checkReceipt({ ...r, signing_address: "0x" + "11".repeat(20) }, model, memo, atts).signature).toBe(false);
    expect(checkReceipt({ ...r, nonce: "00".repeat(32) }, model, memo, atts).quote).toBe(false);
  });
});
