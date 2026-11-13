// How it works, in plain words (V3): three pictures and a short glossary. No jargon in the
// sentences; the technical names live in the "?" notes for people who want them.
import type { Metadata } from "next";
import Link from "next/link";
import { COPY_DEFAULT } from "@/lib/copy";
import { Term } from "../term";

export const metadata: Metadata = {
  title: "How Silent Partner works",
  description: "One vault you share with the trader. Trades nobody can see coming. An exit that doesn't need us.",
};

function OneVault() {
  return (
    <svg viewBox="0 0 320 170" role="img" aria-label="A leader and three followers put money into one shared vault" className="how-art">
      <rect x="95" y="55" width="130" height="90" rx="14" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2" />
      <text x="160" y="96" textAnchor="middle" fontSize="15" fill="var(--ink)" fontWeight="600">one vault</text>
      <text x="160" y="118" textAnchor="middle" fontSize="12" fill="var(--muted)">same trade, same price</text>
      <circle cx="160" cy="22" r="14" fill="var(--accent)" />
      <text x="160" y="27" textAnchor="middle" fontSize="12" fill="#fff" fontWeight="700">L</text>
      <line x1="160" y1="37" x2="160" y2="55" stroke="var(--ink)" strokeWidth="2" />
      {[30, 290, 30].map((x, i) => (
        <g key={i}>
          <circle cx={i === 2 ? 30 : x} cy={i === 2 ? 140 : 70} r="12" fill="var(--row)" stroke="var(--ink-2)" />
          <line x1={i === 1 ? 278 : 42} y1={i === 2 ? 140 : 72} x2={i === 1 ? 225 : 95} y2={i === 2 ? 125 : 85} stroke="var(--ink-2)" strokeWidth="1.5" />
        </g>
      ))}
    </svg>
  );
}

function SealedTrades() {
  return (
    <svg viewBox="0 0 320 170" role="img" aria-label="The vault's trade is sealed, so a bot watching the chain sees nothing to jump ahead of" className="how-art">
      <rect x="40" y="30" width="170" height="110" rx="12" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2" />
      {[56, 82, 108].map((y, i) => (
        <g key={y}>
          <rect x="58" y={y} width="44" height="10" rx="2" fill="var(--muted)" opacity="0.5" />
          <rect x={120} y={y} width={[60, 44, 52][i]} height="12" rx="2" fill="var(--redact)" />
        </g>
      ))}
      <text x="250" y="70" textAnchor="middle" fontSize="28">🤖</text>
      <text x="250" y="100" textAnchor="middle" fontSize="12" fill="var(--muted)">sees nothing</text>
      <line x1="222" y1="40" x2="278" y2="120" stroke="var(--warn, #c0392b)" strokeWidth="2.5" />
    </svg>
  );
}

function ExitWithoutUs() {
  return (
    <svg viewBox="0 0 320 170" role="img" aria-label="With the operator switched off for a day, a holder still takes their share out" className="how-art">
      <rect x="20" y="50" width="90" height="70" rx="12" fill="var(--row)" stroke="var(--ink-2)" strokeDasharray="5 4" />
      <text x="65" y="82" textAnchor="middle" fontSize="13" fill="var(--muted)">operator</text>
      <text x="65" y="100" textAnchor="middle" fontSize="12" fill="var(--muted)">off for 24 h</text>
      <rect x="140" y="50" width="90" height="70" rx="12" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2" />
      <text x="185" y="90" textAnchor="middle" fontSize="14" fill="var(--ink)" fontWeight="600">vault</text>
      <path d="M232 85 H280" stroke="var(--accent)" strokeWidth="3" markerEnd="url(#arr)" />
      <defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--accent)" /></marker></defs>
      <circle cx="298" cy="85" r="12" fill="var(--accent)" />
      <text x="298" y="135" textAnchor="middle" fontSize="12" fill="var(--muted)">you, paid</text>
    </svg>
  );
}

const STEPS = [
  { art: <OneVault />, h: "1. One vault, shared with the trader", p: "You don't copy the trader's orders after the fact. You put money into the same vault they trade, next to their own money (at least 10% of it is theirs, and the contract checks). Every trade fills once, for everyone, at one price." },
  { art: <SealedTrades />, h: "2. Trades nobody can see coming", p: "On public copy platforms, everyone can watch the trader and jump in first, so followers fill last at a worse price. Here what the vault holds and when it trades stay sealed. The public sees only the share price, and your browser checks every one of them." },
  { art: <ExitWithoutUs />, h: "3. An exit that doesn't need us", p: "If the people running the vault stop posting prices for a day, anyone can switch it to emergency mode, and every holder takes out their share at the last price. No permission, no support ticket." },
];

export default function How() {
  return (
    <section className="flex max-w-3xl flex-col gap-8" data-testid="how">
      <div className="flex flex-col gap-3">
        <h1>How it works</h1>
        <p className="lede">Copy a trader without anyone seeing the trades, including you.</p>
      </div>
      {STEPS.map((s) => (
        <div key={s.h} className="panel how-step">
          {s.art}
          <div className="flex flex-col gap-2">
            <h2>{s.h}</h2>
            <p className="leading-relaxed" style={{ color: "var(--ink-2)" }}>{s.p}</p>
          </div>
        </div>
      ))}
      <div className="panel flex flex-col gap-2" data-testid="glossary">
        <h2>Words you&apos;ll see</h2>
        <p><b>Share price</b>: what one share of the vault is worth, after fees. Your money moves with it.</p>
        <p><b>Price update</b>: a new share price, signed by the operator and accepted by the contract only if it fits how the market moved. <Term tip="Called a NAV post in the code. The contract checks it against two price quotes signed by 1Click, NEAR's swap service.">Under the hood</Term></p>
        <p><b>Only paid on new highs</b>: the leader&apos;s fee is charged only when the share price beats its best ever, so a leader earns nothing for winning back a loss.</p>
        <p><b>Sealed</b>: what the vault holds is kept in a private account. <Term tip="NEAR Confidential Intents: a private balance on NEAR's intents system. The vault's key is an MPC key derived for the contract (NEAR Chain Signatures), so no person holds it.">How?</Term></p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href={`/copy/?id=${COPY_DEFAULT}&start=1`} className="btn btn-primary btn-lg">Copy Contrarian with $100: no wallet</Link>
        <Link href="/leaderboard/" className="btn btn-lg">See the leaders</Link>
      </div>
    </section>
  );
}
