// Who's behind it (D6). One person, named; no invented team.
import type { Metadata } from "next";
import Link from "next/link";
import { X_HANDLE } from "../ui";
import { NEAR_HUNT } from "@/lib/config";

const REPO = "https://github.com/amityadav0/silent-partner";

export const metadata: Metadata = {
  title: "About · Silent Partner",
  description: "Who built Silent Partner, how the code was checked, and how to reach them.",
};

export default function About() {
  return (
    <section className="flex max-w-3xl flex-col gap-8" data-testid="about-page">
      <div className="flex flex-col gap-3">
        <h1>Who&apos;s behind it</h1>
        <p className="lede">One builder, at the NEAR hackathon. No team or advisors to list.</p>
      </div>

      <div className="panel flex flex-col gap-3" data-testid="about-who">
        <h2>Amit Yadav</h2>
        <p className="leading-relaxed">Built Silent Partner at the NEAR HACKATHON, November 2026: the contract, the operator, the AI leaders and this site.</p>
        <div className="flex flex-wrap gap-4">
          <a href={`https://x.com/${X_HANDLE}`}>@{X_HANDLE} on X</a>
          <a href="https://github.com/amityadav0">github.com/amityadav0</a>
          <a href={REPO}>Source code</a>
        </div>
      </div>

      <div className="panel flex flex-col gap-3" data-testid="about-review">
        <h2>How the code was checked</h2>
        <p className="leading-relaxed">Much of the code was written with an AI coding assistant. That makes checking it more important, not less, so:</p>
        <ul className="ml-5 flex list-disc flex-col gap-2 leading-relaxed">
          <li><b>Two independent security reviews</b> by fresh reviewers given only the code and docs: one of the whole contract and operator, one of the share-price path. Every finding and its status, including the ones still open, is in the <a href={`${REPO}/blob/master/docs/threat-model.md#7-independent-review-2026-11-09`}>threat model</a>.</li>
          <li><b>Property and fuzz tests</b> that throw thousands of random cases at the contract&apos;s money rules, plus unit tests and a browser test suite that runs on every change.</li>
          <li><b>A reproducible build</b>: the mainnet contract&apos;s code hash matches a build anyone can rerun from commit <code>624f3ba</code> (see <a href={`${REPO}/blob/master/docs/mainnet.md`}>docs/mainnet.md</a>).</li>
          <li><b>No professional audit yet.</b> See <Link href="/trust/">Risks &amp; trust</Link>.</li>
        </ul>
      </div>

      <div className="panel flex flex-col gap-2" data-testid="about-contact">
        <h2>Contact</h2>
        <p className="leading-relaxed">DM <a href={`https://x.com/${X_HANDLE}`}>@{X_HANDLE}</a> on X. Bugs and security issues: open an issue on <a href={`${REPO}/issues`}>GitHub</a>, or DM first if it&apos;s sensitive.</p>
        <p className="leading-relaxed">If you like it, <a href={NEAR_HUNT} data-testid="nearhunt-about">upvote Silent Partner on NEAR Hunt</a>.</p>
      </div>
    </section>
  );
}
