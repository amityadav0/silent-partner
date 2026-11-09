// AI leader: each epoch it asks a model on NEAR AI Cloud (OpenAI-compatible,
// private TEE inference) for a target NEAR exposure, from public market data
// only. The rationale is private: it stays in the leader's sealed notebook, and
// the signal carries only memo_hash = sha256(rationale), so the leader can
// later prove what it was thinking without having published it in advance.
import { summary, type Series } from "./market.js";
import type { Decision } from "../season/tick.js";

export const NEARAI_URL = "https://cloud-api.near.ai/v1";
/** Served from NEAR AI's attested TEE infrastructure. */
export const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";

const SYSTEM = [
  "You lead a copy-trading vault that holds only USDC and NEAR. Every 15 minutes you set the vault's target NEAR exposure: the share of NAV held in NEAR, from 0 to 0.9.",
  "You see only the public market summary below. Trading costs about 0.3% per round trip, so change exposure only when you have a reason, and prefer holding.",
  'Reply with one JSON object and nothing else: {"target_exposure": <number 0..0.9, or null to hold>, "rationale": "<2-4 sentences>"}',
].join(" ");

export function prompt(s: Series, current: number) {
  return JSON.stringify({ market: { pair: "NEAR/USD", source: "CoinGecko, 5-minute points, last 24h", ...summary(s) }, vault: { current_near_exposure: +current.toFixed(3) } });
}

/** Parse the model's reply. Clamped to [0, 0.9], rounded to 0.05; anything unparseable holds. */
export function parseReply(text: string): { target: number | null; rationale: string } {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { target: null, rationale: `unparseable reply: ${text.slice(0, 200)}` };
  try {
    const j = JSON.parse(m[0]) as { target_exposure?: unknown; rationale?: unknown };
    const rationale = typeof j.rationale === "string" ? j.rationale.slice(0, 2000) : "";
    if (j.target_exposure === null || j.target_exposure === undefined) return { target: null, rationale };
    const t = Number(j.target_exposure);
    if (!Number.isFinite(t)) return { target: null, rationale };
    return { target: Math.round(Math.min(0.9, Math.max(0, t)) * 20) / 20, rationale };
  } catch {
    return { target: null, rationale: `unparseable reply: ${text.slice(0, 200)}` };
  }
}

export async function aiLeader(s: Series, current: number, o: { apiKey?: string; model?: string; fetchImpl?: typeof fetch }): Promise<Decision> {
  if (!o.apiKey) return { target: null, why: "NEARAI_API_KEY not set: holding" };
  const model = o.model || DEFAULT_MODEL;
  const f = o.fetchImpl ?? fetch;
  try {
    const r = await f(`${NEARAI_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt(s, current) }], max_tokens: 2000 }),
    });
    const j = (await r.json()) as { id?: string; choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    if (!r.ok) return { target: null, why: `NEAR AI ${r.status}: holding`, model };
    const { target, rationale } = parseReply(j.choices?.[0]?.message?.content ?? "");
    // chat id: lets the leader fetch NEAR AI's TEE signature for this completion when it discloses.
    return { target, why: target === null ? "model holds" : `model target ${target}`, rationale: JSON.stringify({ chat_id: j.id ?? null, model, rationale }), model };
  } catch (e) {
    return { target: null, why: `NEAR AI unreachable (${(e as Error).message.slice(0, 80)}): holding`, model };
  }
}
