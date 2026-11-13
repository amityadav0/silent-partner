"use client";
// "Share your sealed track record" (V5): the leader's loop. A post for X, the vault's badge and an
// invite link that credits the leader and opens with the vault's own preview card.
import { useState } from "react";
import { seasonUrl } from "@/lib/vault";
import { track } from "@/lib/funnel";

const SITE = "https://amityadav0.github.io/silent-partner";
export const leaderPost = "my trades are sealed. my returns are verified on chain. copy me without seeing me →";
export const inviteUrl = (id: string, leader: string) => `${SITE}/v/${encodeURIComponent(id)}/?ref=${encodeURIComponent(leader)}`;

export function ShareKit({ id, leader }: { id: string; leader: string }) {
  const url = inviteUrl(id, leader);
  const [copied, setCopied] = useState<string | null>(null);
  const [badgeOk, setBadgeOk] = useState(true);
  const copy = (what: string, text: string) => {
    track("share_click");
    navigator.clipboard?.writeText(text).then(() => setCopied(what), () => window.prompt("Copy", text));
  };
  return (
    <div className="panel mt-4 flex flex-col gap-3" data-testid="share-kit">
      <h2>Share your sealed track record</h2>
      <p className="muted text-sm">Followers come from your audience. Post this on X: the link opens with your vault&apos;s card and credits you for every follower it brings.</p>
      <blockquote className="share-quote" data-testid="share-kit-text">{leaderPost} <span className="muted">{url}</span></blockquote>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {badgeOk && <img src={seasonUrl(`badges/${id}.png`)} alt="Silent Partner badge for this vault" style={{ height: 28, width: "auto", alignSelf: "flex-start" }} onError={() => setBadgeOk(false)} />}
      <div className="flex flex-wrap gap-2">
        <a className="btn btn-primary" href={`https://x.com/intent/post?text=${encodeURIComponent(leaderPost)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" onClick={() => track("share_click")} data-testid="share-kit-x">Post on X</a>
        <button className="btn" onClick={() => copy("post", `${leaderPost} ${url}`)}>{copied === "post" ? "Post copied" : "Copy post"}</button>
        <button className="btn" onClick={() => copy("link", url)} data-testid="share-kit-link" data-url={url}>{copied === "link" ? "Invite link copied" : "Copy invite link"}</button>
      </div>
    </div>
  );
}
