// Track-record card per vault: return, max drawdown, Sharpe-like ratio, epochs
// live and the leader's share of the vault, all from on-chain NAV posts, rendered
// as a PNG for sharing (the season job regenerates it every tick, in the clear on
// the season-state branch: it holds only public chain data).
import { Resvg } from "@resvg/resvg-js";

export type NavPoint = { epoch: number; timestamp_ms: number; price: string };
const SCALE = 1e18;
const p = (n: NavPoint) => Number(BigInt(n.price)) / SCALE;

export function trackRecord(navs: NavPoint[], leaderShares: string, totalShares: string) {
  const prices = [1, ...navs.map(p)];
  let peak = 1, dd = 0;
  for (const x of prices) {
    peak = Math.max(peak, x);
    dd = Math.max(dd, (peak - x) / peak);
  }
  const ret = prices[prices.length - 1] - 1;
  return { ret, maxDrawdown: dd, sharpe: sharpeLike(navs), epochs: navs.length, leaderPct: Number(totalShares) > 0 ? Number(leaderShares) / Number(totalShares) : 0, since: navs[0]?.timestamp_ms ?? null };
}

/** Annualised mean / volatility of per-post returns (no risk-free rate). Null until there is
 *  at least a day and 20 posts of history (fewer would annualise noise), or with no variance. */
export function sharpeLike(navs: NavPoint[]): number | null {
  if (navs.length < 20 || navs[navs.length - 1].timestamp_ms - navs[0].timestamp_ms < 86_400_000) return null;
  const rs = navs.slice(1).map((n, i) => p(n) / p(navs[i]) - 1);
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (rs.length - 1));
  const span = navs[navs.length - 1].timestamp_ms - navs[0].timestamp_ms;
  if (sd === 0 || span <= 0) return null;
  const perYear = (365 * 86_400_000) / (span / (navs.length - 1));
  return (mean / sd) * Math.sqrt(perYear);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (x: number, d = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%`;

export function cardSvg(o: { name: string; badge: string; style: string; vault: string; navs: NavPoint[]; leaderShares: string; totalShares: string; asOf: Date }): string {
  const t = trackRecord(o.navs, o.leaderShares, o.totalShares);
  const W = 1200, H = 630;
  const prices = [1, ...o.navs.map(p)];
  const lo = Math.min(...prices), hi = Math.max(...prices), span = hi - lo || 0.01;
  const cx = (i: number) => 60 + (i / Math.max(1, prices.length - 1)) * (W - 120);
  const cy = (v: number) => 560 - ((v - lo) / span) * 160;
  const line = prices.map((v, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${cy(v).toFixed(1)}`).join(" ");
  const up = t.ret >= 0;
  const stat = (x: number, label: string, value: string) =>
    `<text x="${x}" y="300" font-size="26" fill="#6b7280">${label}</text><text x="${x}" y="350" font-size="44" font-weight="700" fill="#111827">${esc(value)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="60" y="80" font-size="26" fill="#6b7280">Silent Partner · private copy-trading on NEAR · paper · testnet</text>
  <text x="60" y="150" font-size="64" font-weight="700" fill="#111827">${esc(o.name)}</text>
  <rect x="60" y="172" rx="8" width="${o.badge.length * 20 + 24}" height="40" fill="${o.badge === "AI" ? "#ede9fe" : "#e5e7eb"}"/><text x="72" y="201" font-size="26" fill="#111827">${esc(o.badge)}</text>
  <text x="${60 + o.badge.length * 20 + 40}" y="201" font-size="26" fill="#374151">${esc(o.style)}</text>
  ${stat(60, "Return (after fees)", pct(t.ret))}
  ${stat(380, "Max drawdown", t.maxDrawdown === 0 ? "0%" : `−${(t.maxDrawdown * 100).toFixed(2)}%`)}
  ${stat(640, "Sharpe-like", t.sharpe === null ? "after 24h" : t.sharpe.toFixed(2))}
  ${stat(880, "Leader holds", `${(t.leaderPct * 100).toFixed(1)}%`)}
  <path d="${line}" fill="none" stroke="${up ? "#16a34a" : "#dc2626"}" stroke-width="5" stroke-linejoin="round"/>
  <text x="60" y="610" font-size="22" fill="#6b7280">${t.epochs} attested NAV epochs · positions never public · ${esc(o.vault)} · ${o.asOf.toISOString().slice(0, 16).replace("T", " ")} UTC</text>
</svg>`;
}

export function cardPng(svg: string): Buffer {
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" } }).render().asPng());
}
