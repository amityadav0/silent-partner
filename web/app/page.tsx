"use client";
// Landing page. Live numbers come from the listed vaults over NEAR RPC.
import Link from "next/link";
import { useEffect, useState } from "react";
import { VAULTS } from "@/lib/config";
import { loadVault, priceOf, verifyNavs } from "@/lib/vault";

const REPO = "https://github.com/amityadav0/silent-partner";

function useLive() {
  const [s, setS] = useState<{ vaults: number; navs: number; verified: number; signals: number } | null>(null);
  useEffect(() => {
    Promise.allSettled(VAULTS.map((v) => loadVault(v))).then((rs) => {
      const ok = rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      setS({
        vaults: ok.length,
        navs: ok.reduce((a, d) => a + d.navs.length, 0),
        verified: ok.reduce((a, d) => a + verifyNavs(d.id, d.cfg.attestation_key, d.navs).ok, 0),
        signals: ok.reduce((a, d) => a + d.vault.signals, 0),
      });
    });
  }, []);
  return s;
}

const STEPS: [string, string][] = [
  ["Deposit", "Followers send USDC to a leader's vault. The contract mints shares at the last attested NAV and forwards the funds to the vault's account on NEAR Intents, which belongs to an MPC key derived for the contract. Nobody holds that key."],
  ["Copy", "The leader signs a trade signal. The operator executes it once, for the whole pool, through one 1Click confidential quote. Everyone gets the same price, and there is no follower order left to front-run."],
  ["Exit", "Withdrawals burn at the next NAV. The contract signs a payout only to your own exit account. If the operator disappears, emergency mode after 24h lets every holder exit pro rata without it."],
];

export default function Landing() {
  const live = useLive();
  return (
    <section data-testid="landing">
      <div className="py-6 sm:py-10">
        <p className="muted text-xs uppercase tracking-wide">NEAR Confidential Intents · copy trading</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">Follow a trader without anyone following you.</h1>
        <p className="mt-4 max-w-2xl text-base sm:text-lg">
          Silent Partner vaults pool a leader and their followers in one confidential account. Trades fill once, at one price, for everyone. The world sees attested returns.
          Nobody sees the positions.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/leaderboard/" className="btn btn-primary no-underline">See the leaderboard</Link>
          <Link href="/chain/" className="btn no-underline">What the chain sees</Link>
          <a href={`${REPO}#readme`} className="btn no-underline">Docs</a>
        </div>
        {live && (
          <p className="muted mt-4 text-sm tabular-nums" data-testid="live-stats">
            Live on testnet now: {live.vaults} vaults · {live.navs} NAV posts ({live.verified} signatures checked in your browser just now) · {live.signals} leader signals recorded on-chain. Paper trading at real 1Click prices.
          </p>
        )}
      </div>

      <h2 className="mt-4 text-xl font-semibold">How it works</h2>
      <ol className="mt-3 grid gap-4 sm:grid-cols-3">
        {STEPS.map(([t, d], i) => (
          <li key={t} className="panel">
            <div className="muted text-xs">Step {i + 1}</div>
            <div className="font-semibold">{t}</div>
            <p className="muted mt-1 text-sm">{d}</p>
          </li>
        ))}
      </ol>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="panel">
          <h2 className="font-semibold">For leaders</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>Your book stays private. Followers can't copy your trades outside the vault, and nobody can trade ahead of you on your size.</li>
            <li>Earn a 20% performance fee above a high-water mark, paid in vault shares on-chain.</li>
            <li>Keep at least 10% of the vault: skin in the game that followers can verify.</li>
            <li>Sign signals from the <Link href="/leader/">leader console</Link>, a script, or a bot. The paper season includes an AI leader that decides on NEAR AI Cloud.</li>
          </ul>
          <Link href="/create/" className="btn mt-3 inline-block no-underline">Create a vault</Link> <Link href="/track/" className="btn mt-3 ml-2 inline-block no-underline">Bring your track record</Link>
        </div>
        <div className="panel">
          <h2 className="font-semibold">For followers</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>The same fill as the leader, never a worse one. There's one order for the whole pool.</li>
            <li>Every NAV is signed and pinned to a hash-chained fill log. Your browser checks each signature.</li>
            <li>The operator can choose trades but can&apos;t take the money: the vault key only signs transfers back into the vault or out to your own claim.</li>
            <li>If the operator stops, emergency mode lets you exit at the last NAV with no one&apos;s permission. <Link href="/vault/?id=sp-drill-92991.testnet">See the drill</Link>.</li>
          </ul>
          <Link href="/leaderboard/" className="btn mt-3 inline-block no-underline">Pick a leader</Link>
        </div>
      </div>

      <div className="mt-8 grid gap-4 text-sm sm:grid-cols-3">
        <a className="panel no-underline" href={`${REPO}/blob/master/docs/architecture.md`}><div className="font-semibold">Architecture →</div><p className="muted mt-1">Contract, operator and web; the vault key and what it signs.</p></a>
        <a className="panel no-underline" href={`${REPO}/blob/master/docs/threat-model.md`}><div className="font-semibold">Threat model →</div><p className="muted mt-1">What you still trust the operator for, and the mitigations.</p></a>
        <a className="panel no-underline" href={`${REPO}/blob/master/docs/testnet.md`}><div className="font-semibold">Testnet record →</div><p className="muted mt-1">Every transaction behind the claims on this page.</p></a>
      </div>
    </section>
  );
}
