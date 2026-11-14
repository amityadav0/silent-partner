"use client";
// Landing: why a copied trade should be private, and the enforced facts behind it.
import Link from "next/link";
import { useEffect, useState } from "react";
import { VAULTS } from "@/lib/config";
import { loadVault, verifyNavs, view, type Claim, type SignalRec } from "@/lib/vault";
import { MAINNET_VAULT, metaOf } from "@/lib/vaults";
import { COPY_DEFAULT } from "@/lib/copy";
import { loadNear } from "@/lib/bench";
import { pickLeader, proofLine } from "@/lib/pick";
import { loadBoard } from "@/lib/board";
import type { VsNear } from "@/lib/bench";
import { WatchButton } from "./watch";
import { Redact } from "./ui";

type LiveEvent = { t: number; what: string; vault: string; id: string; ok: boolean; mainnet?: boolean };
const DRILL = "sp-drill-92991.testnet";

function useLive() {
  const [s, setS] = useState<{ navs: number; verified: number; signals: number; events: LiveEvent[] } | null>(null);
  const [main, setMain] = useState<{ epoch: number; ok: boolean; events: LiveEvent[] } | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [proof, setProof] = useState<VsNear | null>(null);
  const [proofOk, setProofOk] = useState(false);
  useEffect(() => {
    // B3: the pick and its proof line from the season's board.json at first paint (the same data
    // the leaderboard paints from); the verified pick below replaces it if it differs.
    let verifiedPick = false;
    Promise.all([loadBoard(), loadNear()]).then(([b, near]) => {
      if (!b || verifiedPick) return;
      const p = pickLeader(b.map((d) => ({ id: d.id, navs: d.navs, verified: d.navs.length, season: !!metaOf(d.id).season, benchmark: !!metaOf(d.id).benchmark })), near);
      setPick(p.id);
      setProof(p.v ?? null);
    });
    // never leave the button hidden: fall back to the default after 3 s
    const t = setTimeout(() => setPick((x) => x ?? COPY_DEFAULT), 3_000);
    // The mainnet vault, kept apart from the testnet paper season's numbers.
    loadVault(MAINNET_VAULT).then((d) => {
      const v = verifyNavs(d.id, d.cfg.attestation_key, d.navs);
      const n = d.navs.at(-1);
      const ev: LiveEvent[] = n ? [{ t: n.timestamp_ms, what: "Price post signed", vault: metaOf(d.id).name, id: d.id, ok: !v.bad.includes(n.epoch), mainnet: true }] : [];
      setMain({ epoch: d.vault.epoch, ok: v.bad.length === 0, events: ev });
    }, () => setMain(null));
    Promise.allSettled(VAULTS.map((v) => loadVault(v))).then(async (rs) => {
      const ok = rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const checked = ok.map((d) => ({ d, v: verifyNavs(d.id, d.cfg.attestation_key, d.navs) }));
      loadNear().then((near) => {
        const p = pickLeader(checked.map(({ d, v }) => ({ id: d.id, navs: d.navs, verified: v.ok, season: !!metaOf(d.id).season, benchmark: !!metaOf(d.id).benchmark })), near);
        verifiedPick = true;
        setPick(p.id);
        setProof(p.v ?? null);
        setProofOk(true);
      });
      // Recent verified events: times and ✓ only. No amounts, no holders.
      const posts: LiveEvent[] = checked
        .filter(({ d }) => d.id !== DRILL && d.navs.length)
        .map(({ d, v }) => {
          const n = d.navs.at(-1)!;
          return { t: n.timestamp_ms, what: "Price post signed", vault: metaOf(d.id).name, id: d.id, ok: !v.bad.includes(n.epoch) };
        });
      const ai = await Promise.all(
        ok.filter((d) => metaOf(d.id).leaderKind === "ai" && d.vault.signals > 0).map((d) =>
          view<SignalRec[]>(d.id, "get_signals", { from: Math.max(0, d.vault.signals - 1), limit: 1 })
            .then((xs) => xs.map((x) => ({ t: x.executed_ms, what: "AI decision recorded", vault: metaOf(d.id).name, id: d.id, ok: true })))
            .catch(() => [] as LiveEvent[]),
        ),
      );
      const drill = await view<Claim[]>(DRILL, "get_claims", { from: 0, limit: 5 })
        .then((cs) => cs.filter((c) => c.emergency && c.opened_ms && BigInt(c.paid) >= BigInt(c.amount)).map((c) => ({ t: c.opened_ms!, what: "Emergency exit paid, no operator", vault: metaOf(DRILL).name, id: DRILL, ok: true })))
        .catch(() => [] as LiveEvent[]);
      const recent = [...posts.sort((a, b) => b.t - a.t).slice(0, 4), ...ai.flat().sort((a, b) => b.t - a.t).slice(0, 2)].sort((a, b) => b.t - a.t);
      setS({
        navs: ok.reduce((a, d) => a + d.navs.length, 0),
        verified: checked.reduce((a, c) => a + c.v.ok, 0),
        signals: ok.reduce((a, d) => a + d.vault.signals, 0),
        events: [...recent, ...drill.slice(0, 1)],
      });
    });
    return () => clearTimeout(t);
  }, []);
  return { pick, proof, proofOk, live: s ? { ...s, main, events: [...(main?.events ?? []), ...s.events] } : null };
}

const when = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** Proof the system is alive, without FOMO: what happened and that it checks out. */
function RecentEvents({ events }: { events: LiveEvent[] }) {
  if (!events.length) return null;
  return (
    <section className="wrap pt-10" data-testid="recent-events">
      <div className="panel flex flex-col gap-3">
        <span className="eyebrow">Recent verified events</span>
        <ul className="flex flex-col">
          {events.map((e, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm" style={{ borderTop: i ? "1px solid var(--line)" : undefined }} data-testid="recent-event">
              <span>
                <span className={e.ok ? "pos" : "neg"} aria-label={e.ok ? "verified" : "failed check"}>{e.ok ? "✓" : "✗"}</span> {e.mainnet && <span className="chip chip-ok mr-1" data-testid="event-mainnet">MAINNET</span>}{e.what} · <Link href={`/vault/?id=${e.id}`}>{e.vault}</Link>
              </span>
              <span className="muted tabular-nums">{when(e.t)}</span>
            </li>
          ))}
        </ul>
        <p className="muted text-xs">Read from NEAR just now: rows marked MAINNET hold real funds, the rest are the testnet paper season. Price signatures are checked in your browser; no amounts or holders are shown.</p>
      </div>
    </section>
  );
}

function Ticket() {
  const [sealed, setSealed] = useState(true);
  const row = (k: string, v: string, bar: number) => (
    <div className="row-kv">
      <span>{k}</span>
      {sealed ? <span><Redact widths={[bar]} h={16} /></span> : <span className={/\d/.test(v) ? "num" : undefined}>{v}</span>}
    </div>
  );
  return (
    <div className="hero-side" id="ticket" data-testid="ticket">
      <div className="seg self-start" role="group" aria-label="Compare where the trade is copied">
        <button aria-pressed={!sealed} onClick={() => setSealed(false)} data-testid="ticket-public">On a public platform</button>
        <button aria-pressed={sealed} onClick={() => setSealed(true)} data-testid="ticket-sealed">On Silent Partner</button>
      </div>
      <div className="ticket">
        <div className="ticket-head"><span>Trade ticket</span><span>Example</span></div>
        {row("Side", "LONG", 64)}
        {row("Asset", "NEAR", 72)}
        {row("Size", "42,000", 104)}
        {row("Leader's price", "2.410", 80)}
        {sealed ? (
          <>
            <div className="row-kv"><span>Your price</span><span className="pos">the same one</span></div>
            <div className="note-wrap">
              <p className="ticket-note">Same trade, same price for everyone in the vault. Bots see nothing, and the leader has no copiers to sell into.</p>
              <span className="stamp" style={{ color: "var(--accent)" }} data-testid="stamp">SEALED</span>
            </div>
          </>
        ) : (
          <>
            <div className="row-kv"><span>Your copy&apos;s price</span><span className="neg"><span className="num">2.470</span> · after bots</span></div>
            <div className="note-wrap">
              <p className="ticket-note warn">The leader&apos;s LONG is visible. Bots front-run it, your copy fills worse, and the leader can sell into the copiers who follow.</p>
              <span className="stamp" style={{ color: "var(--warn)" }} data-testid="stamp">EXPOSED</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const SITE = "https://amityadav0.github.io/silent-partner";
const DRILL_TX = "https://testnet.nearblocks.io/txns/DhphuPPKd2CSu45dKwJdRrngzWj7ffD2iVfYKH4bCqDZ";
const TOUR: [string, string, string][] = [
  ["Flip the ticket", "The same trade on a public platform and on Silent Partner: exposed, then sealed.", "#ticket"],
  ["Check an AI trade", "Contrarian's latest trade on chain, matched in your browser to the hash of its sealed reasoning.", `${SITE}/vault/?id=sp-contra-8952.testnet#ai`],
  ["See an exit without us", "The drill: with the operator switched off, a follower still paid themselves out.", DRILL_TX],
];

const CARDS: [string, string, string][] = [
  ["Same fill as the leader", "0.00% copy slippage vs the leader", "There's no copy order to arrive late. The vault trades once, and your share is inside that trade."],
  ["Positions sealed", "Nothing to front-run", "The vault trades privately. Wallet trackers and bots can't read what it holds or when it moves."],
  ["The leader's money is in it", "≥ 10%, enforced by the contract", "At least 10% of the vault is the leader's own money, so every loss hits them too."],
  ["An exit that doesn't need us", "24 h without the operator", "If no price is posted for 24 hours, anyone can switch the vault to emergency and each holder can exit pro rata."],
  ["Verified, not screenshotted", "Signed and re-checked", "Every share price is signed and bounded by public prices, checked on chain. Your browser re-checks the signature."],
  ["Paid only for new highs", "Fee only on new highs", "The leader is paid only when the share price beats its best ever. Climbing back from a loss earns the leader nothing."],
];

const COMPARE: [string, string, string, string, string][] = [
  ["Positions visible to others", "Yes", "Yes", "That's the product", "Hidden from the market*"],
  ["Your price vs the leader's", "Later, usually worse", "Same", "Later, often much worse", "Same trade, same price"],
  ["Leader's money at stake", "Not required", "Sometimes", "Not required", "≥ 10%, enforced"],
  ["If the platform stops", "Platform decides", "Contract", "You're on your own", "Contract exit, 24 h"],
  ["Leader's edge", "Copied for free", "Copied for free", "Copied for free", "Stays private, gets paid"],
];

export default function Landing() {
  const { pick, proof, proofOk, live } = useLive();
  return (
    <div className="bleed" data-testid="landing">
      <section className="wrap hero">
        <div className="hero-copy">
          <span className="hero-tag">Private copy trading on NEAR</span>
          <h1>Copy the trader.<br /><em className="mark">Not the crowd.</em></h1>
          <p className="lede">On other platforms your copy is a public trade: bots see it first, you fill last. Here you share one sealed vault with the trader. Same trade, same price, nothing to front-run.</p>
          <div className="flex flex-wrap items-center gap-3">
            {pick ? (
              <Link href={`/copy/?id=${encodeURIComponent(pick)}&start=1`} className="btn btn-primary btn-lg" data-testid="hero-copy" data-pick={pick}>Copy {metaOf(pick).name} with $100: no wallet, 10 seconds</Link>
            ) : (
              <span className="btn btn-primary btn-lg" style={{ visibility: "hidden" }} aria-hidden="true">Copy a leader with $100: no wallet, 10 seconds</span>
            )}
            <WatchButton />
          </div>
          {proof && pick && <p className="num text-[15px]" style={{ color: "var(--ink-2)" }} data-testid="hero-proof">{proofLine(metaOf(pick).name, proof)} <span className="muted" data-testid="hero-proof-state">· paper · testnet{proofOk ? ", ✓ verified in your browser" : ", checking…"}</span></p>}
          <p className="muted text-sm" data-testid="hero-faq">Before you put money in: <Link href="/faq/">questions</Link> · <Link href="/trust/">risks</Link> · <Link href="/about/">who built it</Link></p>
        </div>
        <Ticket />
      </section>

      <section className="proof-strip" data-testid="proof-strip">
        <div className="wrap">
          <div><b>0.00%</b><span>copy slippage vs the leader&apos;s fill</span></div>
          <div><b>≥ 10%</b><span>leader&apos;s own money, enforced</span></div>
          <div><b>24 h</b><span>to an exit that doesn&apos;t need us</span></div>
          <div><b>0</b><span>positions on the public chain</span></div>
        </div>
      </section>

      <section className="wrap pt-6" data-testid="mainnet-line">
        <p className="text-sm">
          <span className="chip chip-ok mr-2">MAINNET</span>
          Live on NEAR mainnet with real USDC: <Link href={`/vault/?id=${MAINNET_VAULT}`}>Genesis vault</Link>. Real money went in, the leader traded privately, and a follower was paid out.{live?.main ? ` ${live.main.epoch} price posts, ${live.main.ok ? "all verified in your browser" : "a signature check failed"}.` : ""}
        </p>
      </section>

      {live && <RecentEvents events={live.events} />}

      <section id="tour" className="wrap pt-14" data-testid="tour">
        <span className="eyebrow">Try it in 60 seconds</span>
        <ol className="cards mt-4">
          {TOUR.map(([t, d, href], i) => (
            <li className="card" key={t}>
              <span className="card-n">0{i + 1}</span>
              <h3>{t}</h3>
              <p>{d}</p>
              <a href={href} className="btn mt-auto self-start text-sm" data-testid="tour-open" aria-label={`Open: ${t}`}>Open →</a>
            </li>
          ))}
        </ol>
      </section>

      <section id="why" className="wrap sect">
        <div className="flex max-w-3xl flex-col gap-3">
          <span className="eyebrow">The problem with copy trading</span>
          <h2>If you can see the trade, so can everyone faster than you.</h2>
        </div>
        <div className="cards" data-testid="proof-cards">
          {CARDS.map(([t, , d], i) => (
            <div className="card" key={t}>
              <span className="card-n">0{i + 1}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="exit" className="band">
        <div className="wrap">
          <div className="band-copy">
            <span className="eyebrow" style={{ color: "inherit" }}>The promise most platforms can&apos;t make</span>
            <h2>Your exit doesn&apos;t need our permission.</h2>
            <p className="max-w-xl text-lg leading-relaxed">If the operator goes quiet for 24 hours, anyone can open the contract&apos;s emergency exit and each holder can pay themselves their share. The vault key signs only transfers back to the vault or to a holder&apos;s own claim.</p>
          </div>
          <div className="band-side">
            <div className="band-row"><span>Operator silent</span><span>24 h</span></div>
            <div className="band-row"><span>Emergency mode</span><span>on</span></div>
            <div className="band-row"><span>Your payout</span><span>pro-rata ✓</span></div>
            <span className="pt-1 text-[13px]" style={{ fontFamily: "var(--sans)" }} data-testid="drill-line">Drilled on testnet with a 5-minute timeout: a follower paid themselves out with no operator online. <Link href="/vault/?id=sp-drill-92991.testnet&as=sp-follower-60270.testnet">See the drill</Link></span>
          </div>
        </div>
      </section>

      <section className="wrap sect">
        <h2>Side by side</h2>
        <div className="panel scroll-x p-0">
          <table className="compare" data-testid="compare">
            <thead>
              <tr><th aria-label="Question" /><th>Exchange copy trading</th><th>Public on-chain vaults</th><th>Wallet trackers</th><th className="us">Silent Partner</th></tr>
            </thead>
            <tbody>
              {COMPARE.map(([q, a, b, c, us]) => (
                <tr key={q}><td>{q}</td><td>{a}</td><td>{b}</td><td>{c}</td><td className="us">{us}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="foot-note">*Only the operator that executes trades sees positions.</p>
        </div>
        <p className="mt-4 max-w-3xl text-[17px] leading-relaxed" style={{ color: "var(--ink-2)" }} data-testid="compare-signals">
          <b>Signal-selling apps:</b> you see the trade, then copy it later, at your own price. <b>Silent Partner:</b> you&apos;re inside the trade, one fill, one price.
        </p>
      </section>

      <section className="wrap close">
        <div className="close-copy">
          <h2>No countdowns. No &quot;214 people just copied&quot;. <em style={{ color: "var(--accent)" }}>Just the numbers that protect you.</em></h2>
          <p className="max-w-2xl text-[17px] leading-relaxed" style={{ color: "var(--ink-2)" }}>Every leader opens with worst drawdown and how much of their own money is in, then returns. Pick someone you&apos;d trust with money, not someone who&apos;s trending.</p>
          {live && (
            <p className="muted text-sm tabular-nums" data-testid="live-stats">
              Live on testnet: {live.navs} price updates, {live.verified} signatures checked in your browser just now, {live.signals} leader signals recorded. Paper trades at real 1Click prices.
            </p>
          )}
        </div>
        <Link href="/leaderboard/" className="btn btn-primary btn-lg">Meet the leaders</Link>
      </section>
    </div>
  );
}
