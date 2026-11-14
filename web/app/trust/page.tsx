// Risks & trust (D1): what can go wrong, who controls what, what's public. Plain words, no spin.
import type { Metadata } from "next";
import Link from "next/link";

const REPO = "https://github.com/amityadav0/silent-partner";

export const metadata: Metadata = {
  title: "Risks & trust · Silent Partner",
  description: "What can go wrong, who controls what, and what the public can see. Read this before you deposit.",
};

const RISKS: [string, string][] = [
  ["A bug in the contract", "The contract hasn't had a professional audit. It has had two independent security reviews and property tests that throw thousands of random cases at it. That's not the same as an audit, so put in only what you could lose."],
  ["We stop running", "If no new share price is posted for 24 hours, or a withdrawal goes unpaid for 24 hours, anyone can switch the vault to emergency mode. Every holder then takes their share out at the last price. You don't need us for that. In emergency, payouts come from what's actually in the vault, in rounds: anyone can start a round, the vault reads its own balance and splits it pro rata over everyone owed, so the last one out gets the same fraction as the first. That's live on testnet (the drill2 vault); the mainnet vault still runs the earlier build, where emergency payouts are fixed at the last price."],
  ["A swap fails", "Trades go through 1Click, NEAR's swap service. A trade that doesn't fill just doesn't happen; the vault keeps what it had. A deposit from another chain that fails is refunded to the address you gave."],
  ["NEAR AI is down", "AI leaders ask a model running in a secure enclave what to do. If it can't be reached, they hold: no answer, no trade."],
  ["Testnet isn't real money", "The leaderboard is a paper season: testnet tokens, real market prices. One small mainnet vault holds real USDC to prove the full path works. This site shows it read-only."],
];

const ROLES: [string, string, string][] = [
  ["The vault's key", "Can sign only trades that bring the money back into the vault at a 1Click-signed price, and payouts to a holder's own account.", "Nobody holds it. It's split across NEAR's MPC network and tied to the contract."],
  ["The operator (us)", "Sees what the vault holds, places the leader's trades and posts share prices. The contract rejects any price that doesn't fit two 1Click-signed market quotes.", "Can't send funds anywhere else. If we stop, the emergency exit opens."],
  ["The leader", "Sends trade signals. Must keep at least 10% of the vault in their own money, and the contract checks.", "Can't withdraw your money, see who you are, or trade outside the vault's allowed assets and slippage."],
];

export default function Trust() {
  return (
    <section className="flex max-w-3xl flex-col gap-8" data-testid="trust">
      <div className="flex flex-col gap-3">
        <h1>Risks &amp; trust</h1>
        <p className="lede">What can go wrong, who controls what, and what anyone can see. Read it before you put money in.</p>
      </div>

      <div className="panel flex flex-col gap-4" data-testid="trust-risks">
        <h2>What can go wrong</h2>
        {RISKS.map(([h, p]) => (
          <div key={h}>
            <h3 className="text-[16px] font-medium">{h}</h3>
            <p className="mt-1 leading-relaxed" style={{ color: "var(--ink-2)" }}>{p}</p>
          </div>
        ))}
      </div>

      <div className="panel flex flex-col gap-4" data-testid="trust-roles">
        <h2>Who controls what</h2>
        {ROLES.map(([w, can, cant]) => (
          <div key={w} className="role-card">
            <h3 className="text-[16px] font-medium">{w}</h3>
            <p className="mt-1 leading-relaxed" style={{ color: "var(--ink-2)" }}><b>Can:</b> {can}</p>
            <p className="mt-1 leading-relaxed" style={{ color: "var(--ink-2)" }}><b>Can&apos;t:</b> {cant}</p>
          </div>
        ))}
        <div className="stop-box" data-testid="trust-upgrade-key">
          <span className="text-[15px] font-medium">One thing we can still change: the code</span>
          <p className="text-sm leading-relaxed">
            The mainnet vault&apos;s account still has a full-access key, held by the builder, until <b>November 25, 2026</b>. With it the contract code can be redeployed, and new code could change what the vault&apos;s key will sign. We kept it so a bug found during the hackathon review can be fixed. After November 25 the demo vault is wound down: holders are paid out and the account is deleted. A real-money vault would launch with that key deleted and its build hash published, so anyone can check the code can&apos;t change. The testnet vaults keep their keys too; they hold paper money.
          </p>
        </div>
      </div>

      <div className="panel flex flex-col gap-3" data-testid="trust-public">
        <h2>What&apos;s public, and what isn&apos;t</h2>
        <p className="leading-relaxed"><b>Public:</b> deposits and withdrawals (they&apos;re ordinary NEAR token transfers, so amounts and accounts show on NearBlocks), share balances, the share price, the leader&apos;s stake and the vault&apos;s size, rounded.</p>
        <p className="leading-relaxed"><b>Sealed:</b> what the vault holds, every trade and fill, and when the leader trades. Not even followers see them. <Link href="/chain/">See exactly what the chain shows →</Link></p>
        <p className="leading-relaxed" data-testid="trust-counting">We count page views, with no cookies and nothing about you. <span className="muted">Totals per page and per day only, skipped under Do Not Track; the counts are published in the season log.</span></p>
      </div>

      <div className="panel flex flex-col gap-2">
        <h2>The detail</h2>
        <p className="leading-relaxed">Every attack we considered and what stops it is in the <a href={`${REPO}/blob/master/docs/threat-model.md`}>threat model</a>. Every mainnet transaction is listed in <a href={`${REPO}/blob/master/docs/mainnet.md`}>docs/mainnet.md</a>. The code is open source.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/leaderboard/" className="btn btn-primary btn-lg">See the leaders</Link>
        <Link href="/how/" className="btn btn-lg">How it works</Link>
      </div>
    </section>
  );
}
