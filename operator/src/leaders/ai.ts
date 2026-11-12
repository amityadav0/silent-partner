// AI leader: each epoch it asks a model on NEAR AI Cloud (OpenAI-compatible,
// private TEE inference) for a target NEAR exposure, from public market data
// only. The rationale is private: it stays in the leader's sealed notebook, and
// the signal carries only memo_hash = sha256(rationale), so the leader can
// later prove what it was thinking without having published it in advance.
import { summary, type Series } from "./market.js";
import type { Decision } from "../season/tick.js";
import { fetchReceipt, sha256hex, type Attestation } from "./receipt.js";

export const NEARAI_URL = "https://cloud-api.near.ai/v1";
/** Served from NEAR AI's attested TEE infrastructure. */
export const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";

/** House AI leaders: one model, different mandates. Bounds are enforced in code, not only asked for. */
export type Persona = { name: string; mandate: string; min: number; max: number };
export const PERSONAS: Record<string, Persona> = {
  ai: {
    name: "Allocator",
    min: 0, max: 1,
    mandate: "Decide from the summary and your own judgement: lean into momentum when it is strong, cut exposure when volatility spikes against you, and size by conviction.",
  },
  "ai-trend": {
    name: "Trend Rider",
    min: 0, max: 1,
    mandate: "You are a trend follower. Hold a high NEAR weight (70-100%) when the 1h and 6h returns and the EMAs agree upward, cut to a low weight (0-20%) when they turn down, and stay in between when they disagree.",
  },
  "ai-contrarian": {
    name: "Contrarian",
    min: 0, max: 1,
    mandate: "You fade extremes. Buy NEAR after sharp drops toward the bottom of the 24h range, trim after spikes toward the top, and drift back toward 40% when price is mid-range.",
  },
  "ai-voltarget": {
    name: "Vol Target",
    min: 0.2, max: 1,
    mandate: "Keep the vault's risk near a 40% annualised volatility target: weight ≈ 0.40 / vol_annual (NEAR's annualised volatility), between 20% and 100%. Shade it ±10 points by trend.",
  },
  "ai-conviction": {
    name: "Conviction",
    min: 0.2, max: 0.8,
    mandate: "Your baseline is 50% NEAR. Tilt between 20% and 80% by how convinced you are about the next few hours; never outside that range.",
  },
};

export function systemPrompt(p: Persona): string {
  return [
    `You are "${p.name}", an AI leader of a copy-trading vault that holds only USDC and NEAR. Every 15 minutes you choose the vault's target NEAR weight: the share of NAV held in NEAR, from ${p.min} to ${p.max}.`,
    p.mandate,
    "You see only the public market summary below (returns at 1h/6h/24h, EMAs, volatility, range) and the vault's current weight.",
    "Always give a target, even if it equals the current weight. The vault trades only when your target is at least 5 points away from the current weight; nothing forces a trade. A round trip costs about 0.3%.",
    'Reply with one JSON object and nothing else: {"target_weight": <number>, "rationale": "<2-4 sentences>"}',
  ].join(" ");
}

/** The AI trades only on moves of at least this much NAV weight. */
export const AI_MIN_STEP = 0.05;

/** Public bucket of a target weight (the log shows this, never the exact target). */
export function weightBucket(w: number | null): string {
  if (w === null) return "hold";
  const lo = Math.min(80, Math.floor((w * 100) / 20) * 20);
  return `${lo}–${lo + 20}%`;
}

export function prompt(s: Series, current: number) {
  return JSON.stringify({ market: { pair: "NEAR/USD", source: "CoinGecko, 5-minute points, last 24h", ...summary(s) }, vault: { current_near_exposure: +current.toFixed(3) } });
}

/** Parse the model's reply. Clamped to [0, 1], rounded to 1 point; anything unparseable holds.
 *  Accepts `target_weight` (current prompt) or `target_exposure` (earlier prompt). */
export function parseReply(text: string): { target: number | null; rationale: string } {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { target: null, rationale: `unparseable reply: ${text.slice(0, 200)}` };
  try {
    const j = JSON.parse(m[0]) as { target_weight?: unknown; target_exposure?: unknown; rationale?: unknown };
    const rationale = typeof j.rationale === "string" ? j.rationale.slice(0, 2000) : "";
    const raw = j.target_weight ?? j.target_exposure;
    if (raw === null || raw === undefined) return { target: null, rationale };
    const t = Number(raw);
    if (!Number.isFinite(t)) return { target: null, rationale };
    return { target: Math.round(Math.min(1, Math.max(0, t)) * 100) / 100, rationale };
  } catch {
    return { target: null, rationale: `unparseable reply: ${text.slice(0, 200)}` };
  }
}

/** One retry for a server error or a network failure, so a blip doesn't cost a tick's decision. */
async function withRetry(call: () => Promise<Response>, retryMs: number): Promise<Response> {
  try {
    const r = await call();
    if (r.status < 500) return r;
  } catch {
    /* network: retry below */
  }
  await new Promise((ok) => setTimeout(ok, retryMs));
  return call();
}

export async function aiLeader(s: Series, current: number, o: { apiKey?: string; model?: string; fetchImpl?: typeof fetch; persona?: string | Persona; retryMs?: number; attestation?: Attestation & { report: { gpu: boolean } } }): Promise<Decision> {
  const persona = typeof o.persona === "object" ? o.persona : PERSONAS[o.persona ?? "ai"] ?? PERSONAS.ai;
  if (!o.apiKey) return { target: null, why: "NEARAI_API_KEY not set: holding" };
  const model = o.model || DEFAULT_MODEL;
  const f = o.fetchImpl ?? fetch;
  try {
    // The exact bytes sent and received are what NEAR AI's TEE signs, so keep both.
    // The canonical model id (no aliasing) is part of the signed text.
    const body = JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt(persona) }, { role: "user", content: prompt(s, current) }], max_tokens: 2000 });
    const r = await withRetry(() => f(`${NEARAI_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}`, "x-no-aliasing": "true", "accept-encoding": "identity" },
      body,
    }), o.retryMs ?? 3000);
    const raw = await r.text().catch(() => "");
    let j: { id?: string; choices?: { message?: { content?: string } }[]; error?: { message?: string }; usage?: { prompt_tokens: number; completion_tokens: number } } = {};
    try {
      j = JSON.parse(raw);
    } catch {
      /* not JSON */
    }
    if (!r.ok) return { target: null, why: `NEAR AI ${r.status}: holding`, model };
    const parsed = parseReply(j.choices?.[0]?.message?.content ?? "");
    const target = parsed.target === null ? null : Math.min(persona.max, Math.max(persona.min, parsed.target));
    const rationale = parsed.rationale;
    const usage = j.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens } : undefined;
    // TEE receipt: NEAR AI's enclave signature over these exact bytes, and the attestation that binds its key.
    const rc = j.id ? await fetchReceipt({ url: NEARAI_URL, apiKey: o.apiKey, model, chatId: j.id, requestSha: sha256hex(body), responseSha: sha256hex(raw), fetchImpl: f, attestation: o.attestation, retryMs: o.retryMs }).catch((e) => ({ error: String((e as Error).message).slice(0, 80) })) : { error: "no completion id" };
    // The sealed notebook keeps the exact request and response, so a disclosure can be rechecked against the receipt.
    const sealed = JSON.stringify({ chat_id: j.id ?? null, model, rationale, request: body, response: raw });
    return {
      target,
      why: target === null ? "model holds" : `model target ${target}`,
      rationale: sealed,
      model,
      usage,
      ...("error" in rc ? { receipt_error: rc.error } : { receipt: rc.receipt, attestation: rc.attestation }),
    };
  } catch (e) {
    return { target: null, why: `NEAR AI unreachable (${(e as Error).message.slice(0, 80)}): holding`, model };
  }
}
