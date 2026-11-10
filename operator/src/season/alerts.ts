// Alerts that leak nothing: vault-level events computed from public chain state
// each tick, delivered to the public alerts log, ntfy.sh topics (push to a phone,
// no account) and, once a bot token exists, Telegram. Never a position.

export type Snapshot = { vault: string; name: string; price: number; lastNavMs: number; emergency: boolean; pending: number; claimsPaid: number };
export type VaultState = { price: number; peak: number; ddLevel: number; silent: boolean; emergency: boolean; pending: number; claimsPaid: number };
export type Kind = "move" | "high" | "drawdown" | "withdrawal" | "paid" | "silent" | "emergency";
export type AlertEvent = { vault: string; kind: Kind; text: string; at: string };

export const MOVE = 0.02;
export const DD_LEVELS = [0.05, 0.1];
export const SILENT_MS = 12 * 3600_000;
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}%`;

/** Events since the last tick, and the state to keep. A vault seen for the first time only sets its baseline. */
export function computeAlerts(prev: Record<string, VaultState>, snaps: Snapshot[], nowMs: number): { events: AlertEvent[]; state: Record<string, VaultState> } {
  const at = new Date(nowMs).toISOString();
  const events: AlertEvent[] = [];
  const state: Record<string, VaultState> = { ...prev };
  for (const s of snaps) {
    const p = prev[s.vault];
    const peak = Math.max(p?.peak ?? 1, s.price);
    const dd = peak > 0 ? 1 - s.price / peak : 0;
    const ddLevel = DD_LEVELS.filter((l) => dd >= l).length;
    const silent = nowMs - s.lastNavMs > SILENT_MS;
    state[s.vault] = { price: s.price, peak, ddLevel, silent, emergency: s.emergency, pending: s.pending, claimsPaid: s.claimsPaid };
    if (!p) continue;
    const e = (kind: Kind, text: string) => events.push({ vault: s.vault, kind, text: `${s.name}: ${text}`, at });
    const move = p.price > 0 ? s.price / p.price - 1 : 0;
    if (s.emergency && !p.emergency) e("emergency", "emergency mode is on. Every holder can exit at the last NAV without the operator.");
    if (silent && !p.silent) e("silent", "no NAV posted for over 12 hours. After 24 hours anyone can open the emergency exit.");
    if (s.price > p.peak && p.peak >= 1) e("high", `new high, share price ${s.price.toFixed(4)}.`);
    else if (Math.abs(move) >= MOVE) e("move", `share price ${pct(move)} since the last post (${s.price.toFixed(4)}).`);
    if (ddLevel > p.ddLevel) e("drawdown", `drawdown crossed −${(DD_LEVELS[ddLevel - 1] * 100).toFixed(0)}% from its high.`);
    if (s.pending > p.pending) e("withdrawal", "a withdrawal was queued (a holder's request or a copy stop-loss).");
    if (s.claimsPaid > p.claimsPaid) e("paid", `${s.claimsPaid - p.claimsPaid === 1 ? "a withdrawal was" : `${s.claimsPaid - p.claimsPaid} withdrawals were`} paid out.`);
  }
  return { events, state };
}

/** Public ntfy.sh topic for a vault: anyone can subscribe, no account; it carries only vault-level numbers. */
export const ntfyTopic = (vault: string) => `silent-partner-${vault.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`;

export async function pushNtfy(ev: AlertEvent, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl(`https://ntfy.sh/${ntfyTopic(ev.vault)}`, {
    method: "POST",
    headers: { Title: "Silent Partner", Tags: ev.kind === "emergency" || ev.kind === "silent" ? "warning" : "chart_with_upwards_trend", Click: `https://amityadav0.github.io/silent-partner/vault/?id=${ev.vault}` },
    body: ev.text,
  });
}

// Telegram, once TELEGRAM_BOT_TOKEN exists: the tick reads new messages, handles
// /follow /unfollow /list, and sends each subscriber their vaults' events. Chat ids
// stay in the sealed state.
export type TgState = { offset: number; subs: Record<string, string[]> };

export function handleCommands(st: TgState, updates: { update_id: number; message?: { chat: { id: number }; text?: string } }[], known: Set<string>): { state: TgState; replies: { chat: string; text: string }[] } {
  const subs = { ...st.subs };
  const replies: { chat: string; text: string }[] = [];
  let offset = st.offset;
  for (const u of updates) {
    offset = Math.max(offset, u.update_id + 1);
    const chat = String(u.message?.chat.id ?? "");
    const [cmd, arg] = (u.message?.text ?? "").trim().split(/\s+/);
    if (!chat || !cmd) continue;
    const mine = new Set(subs[chat] ?? []);
    if (cmd === "/follow" && arg && known.has(arg)) {
      mine.add(arg);
      replies.push({ chat, text: `Following ${arg}. You'll get vault-level alerts only: price moves, new highs, drawdowns, withdrawals, operator silence, emergency.` });
    } else if (cmd === "/unfollow" && arg) {
      mine.delete(arg);
      replies.push({ chat, text: `Stopped alerts for ${arg}.` });
    } else if (cmd === "/list") {
      replies.push({ chat, text: mine.size ? [...mine].join("\n") : "No vaults yet. Send /follow <vault id>." });
    } else {
      replies.push({ chat, text: "Send /follow <vault id> (it's on the vault page), /unfollow <vault id> or /list." });
    }
    subs[chat] = [...mine];
  }
  return { state: { offset, subs }, replies };
}

export async function telegram(token: string, st: TgState, events: AlertEvent[], known: Set<string>, fetchImpl: typeof fetch = fetch): Promise<TgState> {
  const api = (m: string, body: object) => fetchImpl(`https://api.telegram.org/bot${token}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<any>);
  const up = await api("getUpdates", { offset: st.offset, timeout: 0 });
  const { state, replies } = handleCommands(st, up.ok ? up.result : [], known);
  for (const r of replies) await api("sendMessage", { chat_id: r.chat, text: r.text });
  for (const [chat, vaults] of Object.entries(state.subs)) for (const ev of events.filter((x) => vaults.includes(x.vault))) await api("sendMessage", { chat_id: chat, text: ev.text });
  return state;
}
