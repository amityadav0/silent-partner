"use client";
// Alerts that leak nothing: vault-level events the season computes from public
// chain state. In this browser (while the site is open), on a phone through ntfy
// (no account), or on Telegram once the bot exists. Never a position.
import { useEffect, useState } from "react";
import { seasonUrl } from "@/lib/vault";
import { ntfyTopic } from "@/lib/community";

type AlertEvent = { vault: string; kind: string; text: string; at: string };
/** Set when the Telegram bot exists (needs the owner's BotFather token). */
export const TELEGRAM_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? "";
const SEEN = (vault: string) => `sp.alerts-seen.${vault}`;
const ON = (vault: string) => `sp.alerts-on.${vault}`;
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode: alerts last for this page */
    }
  },
};

async function fetchEvents(vault: string): Promise<AlertEvent[]> {
  const r = await fetch(seasonUrl("alerts.json"), { cache: "no-store" });
  if (!r.ok) return [];
  return ((await r.json()).events as AlertEvent[]).filter((e) => e.vault === vault);
}

export function Alerts({ vault }: { vault: string }) {
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [on, setOn] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    fetchEvents(vault).then(setEvents, () => setEvents([]));
    setOn(store.get(ON(vault)) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted");
  }, [vault]);

  // While the site is open: check every 5 minutes and notify anything new.
  useEffect(() => {
    if (!on) return;
    const check = async () => {
      const evs = await fetchEvents(vault).catch(() => []);
      const seen = store.get(SEEN(vault)) ?? "";
      const fresh = evs.filter((e) => e.at > seen);
      if (fresh.length && seen) for (const e of fresh.slice(0, 3)) new Notification("Silent Partner", { body: e.text, tag: `${e.vault}-${e.at}` });
      if (evs[0]) store.set(SEEN(vault), evs[0].at);
      setEvents(evs);
    };
    check();
    const t = setInterval(check, 5 * 60_000);
    return () => clearInterval(t);
  }, [on, vault]);

  async function toggle() {
    if (on) {
      store.set(ON(vault), null);
      return setOn(false);
    }
    if (typeof Notification === "undefined") return setNote("This browser can't show notifications. Use the phone option below.");
    const p = await Notification.requestPermission();
    if (p !== "granted") return setNote("Notifications are blocked for this site in your browser settings.");
    store.set(ON(vault), "1");
    setNote(null);
    setOn(true);
  }

  const topic = ntfyTopic(vault);
  return (
    <div className="panel flex flex-col gap-3" data-testid="alerts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>Alerts</h2>
        <button className="btn text-sm" onClick={toggle} aria-pressed={on} data-testid="alerts-toggle">{on ? "Notifying in this browser ✓" : "Notify me in this browser"}</button>
      </div>
      <p className="muted text-sm leading-normal">Share price moves of 2% or more, new highs, drawdowns past −5% and −10%, withdrawals, the operator going quiet for 12 hours, emergency mode. Vault-level numbers only: nothing about positions, and nothing about you.</p>
      <div>
        <div className="row-kv">
          <span>On your phone, no account</span>
          <span><a href={`https://ntfy.sh/${topic}`} data-testid="ntfy-link">Subscribe in ntfy</a></span>
        </div>
        {TELEGRAM_BOT && (
          <div className="row-kv">
            <span>Telegram</span>
            <span><a href={`https://t.me/${TELEGRAM_BOT}?text=${encodeURIComponent(`/follow ${vault}`)}`}>Send /follow to @{TELEGRAM_BOT}</a></span>
          </div>
        )}
      </div>
      {on && <p className="muted text-xs">Checks every 5 minutes while this site is open in a tab.</p>}
      {note && <p className="neg text-sm" role="status">{note}</p>}
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" data-testid="alert-list">
        {events === null && <li className="muted">Reading the alert log…</li>}
        {events?.length === 0 && <li className="muted">Nothing yet. A calm vault stays quiet.</li>}
        {events?.slice(0, 5).map((e) => (
          <li key={`${e.at}-${e.kind}`} className="flex justify-between gap-3">
            <span>{e.text.replace(/^[^:]+: /, "")}</span>
            <span className="num muted whitespace-nowrap text-xs">{new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
