"use client";
// First visit to the landing page: three short steps (what's sealed, what you see, your
// exit). Any close (Skip, Escape, backdrop, the last step) counts as seen, in this browser.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Redact } from "./ui";

const KEY = "sp.welcomed";
const STEPS = [
  { title: "What's sealed", body: "A leader and their followers share one vault. Its positions and trades never go on chain. Bots and rivals see this:", art: true },
  { title: "What you see", body: "Worst drawdown first, then return and how much of their own money the leader has in. Every price is signed, and your browser checks the signature." },
  { title: "Your exit", body: "Withdraw at a fair price over two posts. If the operator goes quiet for 24 hours, anyone can open the emergency exit and you pay yourself out." },
];

export function Welcome() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Only on the landing page, first visit. A deep link (a vault, the leaderboard, a
    // shared /v/ link or an invite with ?ref=) opens on the thing that was clicked, and
    // headless browsers and screenshot bots never get the sheet.
    if (path !== "/" || new URLSearchParams(window.location.search).has("ref") || navigator.webdriver) return;
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      /* no storage: don't nag on every visit */
    }
  }, [path]);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });
  function close() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* fine */
    }
    setOpen(false);
  }
  if (!open) return null;
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <div className="welcome-backdrop" onClick={close}>
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" onClick={(e) => e.stopPropagation()} data-testid="welcome">
        <div className="flex items-center justify-between">
          <span className="eyebrow">{`${i + 1} of ${STEPS.length}`}</span>
          <button className="quiet" onClick={close} data-testid="welcome-skip">Skip</button>
        </div>
        <h2 id="welcome-title" className="display" style={{ fontSize: 44, lineHeight: 1.02 }}>{s.title}</h2>
        <p className="leading-relaxed" style={{ color: "var(--ink-2)" }}>{s.body}</p>
        {s.art && <div className="row-kv"><span>Position</span><span><Redact widths={[96, 48]} label="Position sealed" /></span></div>}
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="flex gap-1.5" aria-hidden="true">{STEPS.map((_, j) => <i key={j} className="welcome-dot" data-on={j === i} />)}</span>
          {last ? (
            <Link href="/leaderboard/" className="btn btn-primary" onClick={close} data-testid="welcome-done">Meet the leaders</Link>
          ) : (
            <button ref={first} className="btn btn-primary" onClick={() => setI(i + 1)} data-testid="welcome-next">Next</button>
          )}
        </div>
      </div>
    </div>
  );
}
