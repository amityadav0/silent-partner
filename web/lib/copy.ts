// "Your silent copy" (V1/V2): the words a follower shares. Only the simulated copy's real change
// goes in; no personal data, no invented numbers.
export const COPY_DEFAULT = "sp-contra-8952.testnet";
const SITE = "https://amityadav0.github.io/silent-partner";

export const pctWords = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(2)}%`;

/** "in 3 days", "in 5 hours", "in 12 min": how long the copy has run. */
export function sinceWords(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h} hour${h === 1 ? "" : "s"}`;
  return `in ${Math.round(h / 24)} days`;
}

export function shareText(name: string, p: number, sinceMs: number): string {
  return `silently copying ${name} on @NEARProtocol: ${pctWords(p)} ${sinceWords(sinceMs)}. i can't see their trades. neither can bots.`;
}

/** The pre-rendered vault link (its own X/Telegram card), opening straight into a $100 copy. */
export const shareUrl = (id: string) => `${SITE}/v/${encodeURIComponent(id)}/?ref=copy&copy=1`;
