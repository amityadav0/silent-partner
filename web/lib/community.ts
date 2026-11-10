// Open season: launch a vault from the site (registry contract on testnet), and
// seal a strategy or a signal so only the season operator can read it. Same format
// as operator/src/season/community.ts; the shared vector in test/lib.test.ts keeps them in step.
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { base64urlnopad } from "@scure/base";
import { view } from "./vault";
import type { VaultMeta } from "./vaults";

export const REGISTRY = process.env.NEXT_PUBLIC_REGISTRY ?? "registry.sp-sop-92991.testnet";
/** The season operator's community key (X25519, base64url). Derived from its state key; see operator/src/season/community.ts. */
export const SEASON_SEAL_PK = "OVrb9rswAlQA8aoyu0pr2sgW503shXchJyw0w9A2U2o";
/** The season's signer for community AI leaders: the leader registers it on their vault. */
export const SEASON_SIGNAL_PK = "ed25519:6n2Un2R6gKrZ6pciZvanXRpUu1v3ZLcZgPa1SVpmFjUd";
export const LAUNCH_DEPOSIT_NEAR = 5;
export const MAX_PROMPT = 1500;

export type Risk = "low" | "med" | "high";
export type Launch = {
  id: number; leader: string; kind: "ai" | "human"; name: string; style: string; risk: Risk;
  prompt_hash: string | null; sealed_prompt: string | null; created_ms: string; status: "pending" | "live" | "rejected"; vault: string | null; note: string | null;
};

const te = new TextEncoder();
const ab = (u: Uint8Array) => new Uint8Array(u) as Uint8Array<ArrayBuffer>;

/** Seal text to an X25519 public key. `context` binds it to its use: "launch" or "signal:<vault>". */
export async function seal(text: string, context: string, pkB64 = SEASON_SEAL_PK, fixed?: { esk: Uint8Array; iv: Uint8Array }): Promise<string> {
  const pk = base64urlnopad.decode(pkB64);
  const esk = fixed?.esk ?? x25519.utils.randomPrivateKey();
  const epk = x25519.getPublicKey(esk);
  const iv = fixed?.iv ?? crypto.getRandomValues(new Uint8Array(12));
  const raw = hkdf(sha256, x25519.getSharedSecret(esk, pk), new Uint8Array([...epk, ...pk]), te.encode("silent-partner/seal/v1"), 32);
  const key = await crypto.subtle.importKey("raw", ab(raw), "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: ab(iv), additionalData: te.encode(context) }, key, te.encode(text)));
  return base64urlnopad.encode(new Uint8Array([...epk, ...iv, ...ct]));
}

export const promptHash = (text: string) => bytesToHex(sha256(te.encode(text)));

/** Target-weight band per risk level (the season enforces it in code). */
export const BANDS: Record<Risk, { min: number; max: number; label: string }> = {
  low: { min: 0, max: 0.4, label: "Low: 0–40% NEAR" },
  med: { min: 0, max: 0.7, label: "Medium: 0–70% NEAR" },
  high: { min: 0, max: 1, label: "High: 0–100% NEAR" },
};

/** The limits a strategy states, narrowed to its band. Null if they contradict it. Same rules as the season. */
export function bounds(text: string, risk: Risk): { min: number; max: number } | null {
  const pct = (re: RegExp) => {
    const m = text.match(re);
    return m ? Math.min(100, Number(m[1])) / 100 : null;
  };
  const max = pct(/\b(?:max(?:imum)?|at most|up to|no more than|cap(?:ped)? at)\s*(?:of\s*)?(\d{1,3})\s*%/i);
  const min = pct(/\b(?:min(?:imum)?|at least|never below|floor of)\s*(?:of\s*)?(\d{1,3})\s*%/i);
  const b = BANDS[risk];
  const lo = Math.max(b.min, min ?? b.min), hi = Math.min(b.max, max ?? b.max);
  return lo <= hi ? { min: lo, max: hi } : null;
}

/** A first draft of the public style line, for the leader to edit and approve. Never the strategy itself. */
export function suggestStyle(text: string, risk: Risk): string {
  const t = text.toLowerCase();
  const traits = [
    /average|ema|trend|momentum|breakout/.test(t) && "follows the trend",
    /dip|revert|oversold|mean/.test(t) && "buys weakness",
    /volatil|vol\b|calm/.test(t) && "sizes by volatility",
    /cut|stop|drop|protect/.test(t) && "cuts risk fast",
  ].filter(Boolean) as string[];
  const base = traits.length ? traits.slice(0, 2).join(", ") : "trades NEAR against USDC";
  return `${base[0].toUpperCase()}${base.slice(1)}; ${BANDS[risk].label.split(":")[0].toLowerCase()} risk`;
}

export const NAME_RE = /^[A-Za-z0-9'-][A-Za-z0-9 '-]{1,30}[A-Za-z0-9'-]$/;

export async function loadLaunches(): Promise<Launch[]> {
  const out: Launch[] = [];
  for (let from = 0; ; from += 50) {
    const page = await view<Launch[]>(REGISTRY, "get_launches", { from, limit: 50 });
    out.push(...page);
    if (page.length < 50) return out;
  }
}

export const launchOfVault = (vault: string) => view<Launch | null>(REGISTRY, "launch_of_vault", { vault });

/** Public metadata for a live community vault. */
export function communityMeta(l: Launch): VaultMeta {
  return { name: l.name, leaderKind: l.kind, style: l.style, risk: l.risk, blurb: `Community ${l.kind === "ai" ? "AI leader on NEAR AI Cloud: its strategy is sealed, only its hash is on chain" : "leader trading by hand"}. Led by ${l.leader}.`, mode: "paper", network: "testnet", season: true, community: true };
}

/** Public ntfy.sh topic for a vault's alerts (same as operator/src/season/alerts.ts). */
export const ntfyTopic = (vault: string) => `silent-partner-${vault.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`;
