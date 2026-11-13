// FAQ (D7): the ten questions a depositor asks first. Each has an anchor so other pages can link it.
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CHAINS } from "@/lib/crosschain";

export const metadata: Metadata = {
  title: "FAQ · Silent Partner",
  description: "Can the leader steal? Can you see my trades? How fast can I exit? Ten straight answers.",
};

const QA: [string, string, ReactNode][] = [
  ["steal", "Can the leader steal my money?", <>No. The leader only sends trade signals. They can&apos;t withdraw your shares, trade outside the vault&apos;s allowed assets, or fill worse than its slippage limit, and they must keep at least 10% of the vault in their own money. The contract checks all of it.</>],
  ["see", "Can you see my trades? Can anyone?", <>Your deposit is public, like any NEAR token transfer. What the vault holds and trades is sealed from the public, from other followers and from the leader&apos;s audience. The operator (us) does see the vault&apos;s positions, because it places the trades, but it can&apos;t move funds anywhere except back into the vault or to a holder&apos;s payout. <Link href="/chain/">What the chain shows →</Link></>],
  ["ai-down", "What if NEAR AI is down?", <>AI leaders hold. If the model can&apos;t be reached, there&apos;s no decision, so there&apos;s no trade. Share prices keep updating as usual.</>],
  ["nearblocks", "Why do I see deposits on NearBlocks?", <>Because deposits and withdrawals are ordinary token transfers into and out of the vault contract, and those are public on NEAR. What&apos;s sealed is everything that happens inside: holdings, trades and timing.</>],
  ["exit", "How fast can I exit?", <>Ask to withdraw, and you&apos;re priced at the next price update and paid at the one after. That&apos;s about 30 minutes on the testnet season (updates every 15 min) and about 6 hours on the mainnet vault (updates every 3 h). Each vault page shows its own estimate. If prices stop for 24 hours, anyone can open the emergency exit.</>],
  ["minimum", "What's the minimum?", <>1 USDC on the current vaults. A partial withdrawal must also be at least that much, or you withdraw everything.</>],
  ["maximum", "Is there a maximum vault size?", <>Not in the contract. In practice a vault can only grow as large as 1Click can trade for it within its 1% slippage limit, so very large vaults would fill worse and trade less.</>],
  ["chains", "What chains can I deposit from?", <>NEAR directly, or USDC on {CHAINS.map((c) => c.name).join(", ")} through 1Click, which delivers it into the vault in one step. The quote shows the fee and timing before you send, and a failed route refunds you on the chain you sent from.</>],
  ["advice", "Is this investment advice?", <>No. Silent Partner is open-source software from a hackathon. Nothing here is a recommendation to put money in any vault, and past returns, especially short ones, say little about the future.</>],
  ["testnet", "What's testnet vs mainnet?", <>The leaderboard is a paper season on NEAR testnet: testnet tokens, real market prices, real signed price updates, but no real money. One vault, Genesis, runs on mainnet with real USDC to prove the whole path works. It isn&apos;t open to deposits; real-money vaults open after the hackathon review.</>],
];

export default function Faq() {
  return (
    <section className="flex max-w-3xl flex-col gap-6" data-testid="faq">
      <div className="flex flex-col gap-3">
        <h1>Questions</h1>
        <p className="lede">The ten things people ask before they put money in.</p>
      </div>
      <div className="panel flex flex-col gap-5">
        {QA.map(([id, q, a]) => (
          <div key={id} id={id} className="faq-item" data-testid="faq-item">
            <h2 className="text-[18px]">{q}</h2>
            <p className="mt-1 leading-relaxed" style={{ color: "var(--ink-2)" }}>{a}</p>
          </div>
        ))}
      </div>
      <p className="muted text-sm">More: <Link href="/trust/">Risks &amp; trust</Link> · <Link href="/how/">How it works</Link> · <Link href="/about/">Who&apos;s behind it</Link></p>
    </section>
  );
}
