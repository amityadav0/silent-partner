// Track-record card per vault: worst drawdown, return, Sharpe-like ratio, epochs
// live and the leader's share of the vault, all from on-chain NAV posts, rendered
// as a PNG for sharing (the season job regenerates it every tick, in the clear on
// the season-state branch: it holds only public chain data).
import { fileURLToPath } from "node:url";
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

/** Where the worst drawdown happened, as indexes into [inception, ...navs]. */
export function drawdownWindow(prices: number[]): { peak: number; trough: number } | null {
  let peakI = 0, best: { peak: number; trough: number } | null = null, bestDd = 0;
  prices.forEach((x, i) => {
    if (x > prices[peakI]) peakI = i;
    else if ((prices[peakI] - x) / prices[peakI] > bestDd) {
      bestDd = (prices[peakI] - x) / prices[peakI];
      best = { peak: peakI, trough: i };
    }
  });
  return best;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (x: number, d = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%`;

// The site's light theme: paper and ultramarine post better on X than dark cards.
const C = { paper: "#F5F0E6", card: "#FFFDF8", line: "#E3D9C6", ink: "#17140F", ink2: "#3B352C", muted: "#655D50", accent: "#2F3FD8", warn: "#B9401F", warnBg: "#FBE3DA" };
const SERIF = "Instrument Serif", MONO = "JetBrains Mono";

export function cardSvg(o: { name: string; badge: string; style: string; vault: string; navs: NavPoint[]; leaderShares: string; totalShares: string; asOf: Date }): string {
  const t = trackRecord(o.navs, o.leaderShares, o.totalShares);
  const W = 1200, H = 630, X0 = 60, X1 = W - 60;
  const prices = [1, ...o.navs.map(p)];
  const lo = Math.min(...prices), hi = Math.max(...prices), span = hi - lo || 0.01;
  const chartTop = 418, chartBottom = 548;
  const cx = (i: number) => X0 + (i / Math.max(1, prices.length - 1)) * (X1 - X0);
  const cy = (v: number) => chartBottom - ((v - lo) / span) * (chartBottom - chartTop);
  const line = prices.map((v, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${cy(v).toFixed(1)}`).join(" ");
  const win = drawdownWindow(prices);
  const tileW = 255, gap = 20;
  const tile = (i: number, label: string, value: string, risk = false) => {
    const x = X0 + i * (tileW + gap);
    return `<rect x="${x}" y="252" width="${tileW}" height="128" rx="16" fill="${risk ? C.warnBg : C.card}"${risk ? "" : ` stroke="${C.line}"`}/>
  <text x="${x + 22}" y="292" font-family="${MONO}" font-size="19" fill="${risk ? C.ink2 : C.muted}">${label}</text>
  <text x="${x + 22}" y="350" font-family="${MONO}" font-size="40" fill="${risk ? C.warn : C.ink}">${esc(value)}</text>`;
  };
  const badgeW = o.badge.length * 15 + 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  <rect x="${X0}" y="44" width="30" height="16" rx="2" fill="${C.ink}"/><rect x="${X0 + 35}" y="44" width="13" height="16" rx="2" fill="${C.accent}"/>
  <text x="${X0 + 60}" y="62" font-family="${SERIF}" font-size="30" fill="${C.ink}">Silent Partner</text>
  <text x="${X1}" y="60" text-anchor="end" font-family="${MONO}" font-size="19" fill="${C.muted}">paper · testnet</text>
  <text x="${X0}" y="160" font-family="${SERIF}" font-size="84" fill="${C.ink}">${esc(o.name)}</text>
  <rect x="${X0}" y="186" rx="17" width="${badgeW}" height="34" fill="${C.accent}"/><text x="${X0 + badgeW / 2}" y="210" text-anchor="middle" font-family="${MONO}" font-size="19" fill="#FFFFFF">${esc(o.badge)}</text>
  <text x="${X0 + badgeW + 16}" y="210" font-family="${MONO}" font-size="21" fill="${C.ink2}">${esc(o.style)}</text>
  <g transform="rotate(-8 1010 150)"><rect x="900" y="118" width="220" height="64" rx="7" fill="none" stroke="${C.accent}" stroke-width="3"/><text x="1010" y="164" text-anchor="middle" font-family="${MONO}" font-size="36" letter-spacing="6" fill="${C.accent}">SEALED</text></g>
  ${tile(0, "Worst drawdown", t.maxDrawdown === 0 ? "0%" : `−${(t.maxDrawdown * 100).toFixed(2)}%`, true)}
  ${tile(1, "Return, after fees", pct(t.ret))}
  ${tile(2, "Leader's own money", `${(t.leaderPct * 100).toFixed(1)}%`)}
  ${tile(3, "Sharpe-like", t.sharpe === null ? "after 24h" : t.sharpe.toFixed(2))}
  ${win ? `<rect x="${cx(win.peak).toFixed(1)}" y="${chartTop - 14}" width="${Math.max(3, cx(win.trough) - cx(win.peak)).toFixed(1)}" height="${chartBottom - chartTop + 28}" fill="${C.warnBg}"/>` : ""}
  <path d="${line}" fill="none" stroke="${C.accent}" stroke-width="5" stroke-linejoin="round"/>
  <text x="${X0}" y="598" font-family="${MONO}" font-size="19" fill="${C.muted}">Holdings</text>
  <rect x="${X0 + 112}" y="583" width="86" height="18" rx="2" fill="${C.ink}"/><rect x="${X0 + 205}" y="583" width="46" height="18" rx="2" fill="${C.ink}"/>
  <text x="${X1}" y="598" text-anchor="end" font-family="${MONO}" font-size="19" fill="${C.muted}">${t.epochs} signed epochs · ${esc(o.vault)} · ${o.asOf.toISOString().slice(0, 16).replace("T", " ")} UTC</text>
</svg>`;
}

/** A small badge for a leader's site or profile: "Silent Partner ✓ | −4.1% worst DD · 58 epochs". */
export function badgeSvg(o: { navs: NavPoint[] }): string {
  const t = trackRecord(o.navs, "0", "0");
  const right = `${t.maxDrawdown === 0 ? "0%" : `−${(t.maxDrawdown * 100).toFixed(1)}%`} worst DD · ${t.epochs} epochs`;
  const lw = 36 + 16 * 7.9 + 12, rw = right.length * 7.9 + 24, W = lw + rw, H = 28;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="6" fill="${C.ink}"/><rect x="${lw}" width="${rw}" height="${H}" rx="6" fill="${C.accent}"/><rect x="${lw}" width="8" height="${H}" fill="${C.accent}"/>
  <rect x="10" y="10" width="11" height="8" rx="1.5" fill="${C.paper}"/><rect x="23" y="10" width="5" height="8" rx="1.5" fill="${C.accent}"/>
  <text x="36" y="19" font-family="${MONO}" font-size="13" fill="${C.paper}">Silent Partner ✓</text>
  <text x="${lw + 12}" y="19" font-family="${MONO}" font-size="13" fill="#FFFFFF">${esc(right)}</text>
</svg>`;
}

// Bundled so the card looks the same on the season runner as anywhere else.
const font = (f: string) => fileURLToPath(new URL(`../../assets/fonts/${f}`, import.meta.url));

export function cardPng(svg: string, width = 1200): Buffer {
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false, fontFiles: [font("InstrumentSerif-Regular.ttf"), font("JetBrainsMono-Regular.ttf")], defaultFontFamily: MONO } }).render().asPng());
}
