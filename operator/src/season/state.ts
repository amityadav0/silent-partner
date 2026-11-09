// Encrypted season state. The CI runner keeps each vault's private fill log
// and bot notes in an orphan git branch, encrypted with AES-256-GCM under a
// repo secret: the public repo holds only ciphertext. Format per file:
// "sp1:" + base64(iv[12] | tag[16] | ciphertext).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function key(hex: string): Buffer {
  const k = Buffer.from(hex, "hex");
  if (k.length !== 32) throw new Error("state key must be 32 bytes hex");
  return k;
}

export function seal(plain: Buffer, keyHex: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(keyHex), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return "sp1:" + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

export function open(sealed: string, keyHex: string): Buffer {
  if (!sealed.startsWith("sp1:")) throw new Error("not a sealed state file");
  const b = Buffer.from(sealed.slice(4), "base64");
  const d = createDecipheriv("aes-256-gcm", key(keyHex), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

/** Decrypt every `*.enc` in `sealedDir` into `plainDir` (without the suffix). */
export function unsealDir(sealedDir: string, plainDir: string, keyHex: string): string[] {
  mkdirSync(plainDir, { recursive: true });
  if (!existsSync(sealedDir)) return [];
  const names = readdirSync(sealedDir).filter((n) => n.endsWith(".enc"));
  for (const n of names) writeFileSync(join(plainDir, n.slice(0, -4)), open(readFileSync(join(sealedDir, n), "utf8"), keyHex));
  return names;
}

/** Encrypt the named files of `plainDir` into `sealedDir` as `<name>.enc`. */
export function sealDir(plainDir: string, sealedDir: string, names: string[], keyHex: string) {
  mkdirSync(sealedDir, { recursive: true });
  for (const n of names) if (existsSync(join(plainDir, n))) writeFileSync(join(sealedDir, n + ".enc"), seal(readFileSync(join(plainDir, n)), keyHex) + "\n");
}
