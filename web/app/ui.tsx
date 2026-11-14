"use client";
import { badgeOf, metaOf, modeLabel, type VaultMeta } from "@/lib/vaults";
import Link from "next/link";
import { SystemStatus } from "./status";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NETWORK, networkOf } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { loadVault, pct, type VaultData } from "@/lib/vault";
import { loadNear, ptsWords, type NearSeries, type VsNear } from "@/lib/bench";

const REPO = "https://github.com/amityadav0/silent-partner";

/** Redaction bar: where a position, trade, size or follower list would be. */
export function Redact({ widths, h = 15, label = "Redacted" }: { widths: number[]; h?: number; label?: string }) {
  return (
    <span className="redacted" role="img" aria-label={label} title="sealed" data-testid="redacted">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="4.5" width="7" height="5" rx="1" fill="currentColor" /><path d="M3 4.5V3.2a2 2 0 0 1 4 0v1.3" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
      {widths.map((w, i) => <span key={i} className="redact" style={{ width: w, height: h }} />)}
    </span>
  );
}

export function Logo() {
  return <span className="logo" aria-hidden="true"><i /><i /></span>;
}

function ThemeToggle() {
  const flip = () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("sp.theme", next);
    } catch {
      /* private mode: the choice lasts for this page */
    }
  };
  return (
    <button className="theme-btn" onClick={flip} aria-label="Switch between light and dark" data-testid="theme-toggle">
      <svg className="ic-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      <svg className="ic-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
    </button>
  );
}

export function Nav() {
  const { accountId, ready, signIn, signOut } = useWallet();
  const path = usePathname();
  // The chip names the network this page reads: the mainnet vault shows MAINNET even on the testnet site.
  const [net, setNet] = useState<"testnet" | "mainnet">(NETWORK);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id") ?? path?.match(/^\/v\/([^/]+)/)?.[1];
    setNet(id ? networkOf(id) : NETWORK);
  }, [path]);
  const link = (match: string, label: string, href = match) => (
    <Link href={href} aria-current={path?.startsWith(match) ? "page" : undefined}>{label}</Link>
  );
  return (
    <header className="wrap site-head">
      <Link href="/" className="brand"><Logo />Silent Partner</Link>
      <nav className="site-links" aria-label="Main">
        {link("/leaderboard/", "Leaders")}
        {link("/how/", "How it works")}
        {link("/trust/", "Risks")}
        {link("/create/", "Lead a vault", "/create/ai/")}
      </nav>
      <div className="site-tools">
        <span className={`chip ${net === "mainnet" ? "chip-ok" : ""}`} data-testid="net-chip">{net === "mainnet" ? "MAINNET" : "testnet"}</span>
        <ThemeToggle />
        {accountId ? (
          <details className="wallet-menu">
            <summary className="btn" data-testid="account"><span className="max-w-[9rem] truncate">{accountId}</span></summary>
            <div className="wallet-menu-list">
              <Link href="/partners/">My partners</Link>
              <Link href="/leader/">Leader console</Link>
              <button onClick={() => signOut()}>Sign out</button>
            </div>
          </details>
        ) : (
          <button className="btn" disabled={!ready} onClick={signIn} aria-label="Connect wallet"><span className="connect-long">Connect wallet</span><span className="connect-short">Connect</span></button>
        )}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-foot">
      <div className="wrap">
        <span>Built at NEAR HACKATHON · NEAR Intents · Chain Signatures · NEAR AI</span>
        <span className="flex flex-wrap gap-4">
          <Link href="/partners/">My partners</Link>
          <Link href="/trust/">Risks &amp; trust</Link>
          <Link href="/faq/">FAQ</Link>
          <Link href="/about/">About</Link>
          <Link href="/chain/">What the chain sees</Link>
          <Link href="/leader/">Leader console</Link>
          <a href={`${REPO}#readme`}>Docs</a>
          <a href={`${REPO}/blob/master/docs/architecture.md`}>Architecture</a>
          <a href={`${REPO}/blob/master/docs/threat-model.md`}>Threat model</a>
          <a href={`${REPO}/blob/master/docs/testnet.md`}>Testnet record</a>
          <Link href="/track/">Bring your track record</Link>
        </span>
        <SystemStatus />
        <p className="terms" data-testid="terms">
          <b>Terms, in short.</b> The leaderboard is a testnet paper season: no real money. This is not investment advice: no promise of returns, no guarantees. The software is open source under the <a href={`${REPO}/blob/master/LICENSE`}>MIT license</a>, provided as is; if you use it with real funds, you do so at your own risk. <Link href="/trust/">Read the risks.</Link>
        </p>
      </div>
    </footer>
  );
}

/** `?id=` of a static-exported page (no dynamic routes in a static export). */
export function useQueryParam(name: string): string | null | undefined {
  const [v, setV] = useState<string | null | undefined>(undefined);
  useEffect(() => setV(new URLSearchParams(window.location.search).get(name)), [name]);
  return v;
}

export function useVault(id: string | null | undefined) {
  const [data, setData] = useState<VaultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!id) return;
    let live = true;
    loadVault(id).then((d) => live && setData(d), (e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [id, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

/** NEAR/USD history for "vs holding NEAR"; undefined while loading, null if unavailable. */
export function useNear(): NearSeries | null | undefined {
  const [s, setS] = useState<NearSeries | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadNear().then((x) => live && setS(x));
    return () => {
      live = false;
    };
  }, []);
  return s;
}

/** "+1.23 pts vs NEAR", with what NEAR itself did in the title. */
export function VsNearTag({ v, testid = "vs-near", compact = false }: { v: VsNear | null | undefined; testid?: string; compact?: boolean }) {
  if (!v) return <span className="muted" data-testid={testid}>—</span>;
  return (
    <span className={v.pts > 0 ? "vs-up" : undefined} data-testid={testid} data-pts={v.pts.toFixed(4)} title={`Holding NEAR over the same window: ${pct(v.near)}`}>
      {compact ? ptsWords(v.pts).replace(" vs NEAR", "") : ptsWords(v.pts)}
    </span>
  );
}

export function Stat({ label, value, hint, testid, risk }: { label: string; value: ReactNode; hint?: string; testid?: string; risk?: boolean }) {
  return (
    <div className={`tile ${risk ? "tile-risk" : ""}`} data-testid={testid}>
      <div className="tile-l">{label}</div>
      <div className="tile-v">{value}</div>
      {hint && <div className="tile-h">{hint}</div>}
    </div>
  );
}

/** Returns stay ink: the sign is the only signal, no green and red scoreboard. */
export function Ret({ r }: { r: number }) {
  return <span>{pct(r)}</span>;
}

/** Risk as a 3-dot meter, with the word for screen readers. */
export function RiskDots({ risk }: { risk?: "low" | "med" | "high" }) {
  if (!risk) return null;
  const n = { low: 1, med: 2, high: 3 }[risk];
  return (
    <span className="risk-dots" role="img" aria-label={`${RISK_WORD[risk]} risk`} title={`${RISK_WORD[risk]} risk`} data-testid="risk">
      {[1, 2, 3].map((i) => <i key={i} className={i <= n ? "on" : undefined} />)}
    </span>
  );
}

/** Honest provenance label: "paper · testnet" or "MAINNET · real funds". */
export function ModeChip({ id, meta }: { id: string; meta?: VaultMeta }) {
  const m = meta ?? metaOf(id);
  return <span className={`chip ${m.mode === "paper" ? "chip-paper" : "chip-ok"}`} data-testid="mode" title={m.mode === "paper" ? "Paper trades priced by real 1Click dry quotes; testnet tokens, no real funds" : "Real funds on NEAR mainnet"}>{modeLabel(m)}</span>;
}

const RISK_WORD = { low: "low", med: "medium", high: "high" } as const;

/** Who leads (AI / Bot / Human) and the leader's risk level. */
export function LeaderChips({ id, meta }: { id: string; meta?: VaultMeta }) {
  const m = meta ?? metaOf(id);
  return (
    <>
      {m.community && <span className="chip" data-testid="community">Community</span>}
      <span className={`chip ${m.leaderKind === "ai" ? "chip-ai" : "chip-kind"}`} data-testid="badge" title={m.leaderKind === "ai" ? "Decides on NEAR AI Cloud; its reasoning stays private (hash only)" : undefined}>{badgeOf(m)}</span>
      {m.risk && <span className={`chip chip-risk-${m.risk}`} data-testid="risk">Risk · {RISK_WORD[m.risk]}</span>}
    </>
  );
}

export function StatusChip({ s }: { s: string }) {
  const cls = s === "active" ? "chip-ok" : s === "emergency" ? "chip-bad" : "chip-warn";
  return <span className={`chip ${cls}`} data-testid="status">{s}</span>;
}

/** Return since inception per NAV epoch, with the worst drawdown shaded. */
export function ReturnsChart({ points, height = 220, copy, drawdown, title, note }: { points: { t: number; r: number }[]; height?: number; copy?: { fromIndex: number; r: number[] }; drawdown?: { peak: number; trough: number; dd: number } | null; title?: ReactNode; note?: ReactNode }) {
  // Draw at the container's real width so axis text stays 11px on phones.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [points.length]);
  const H = height, L = 48, R = 12, T = 12, B = 26;
  if (points.length === 0) return <div className="panel muted text-sm">No price posted yet. The first one lands at the next tick, signed.</div>;
  const all = [{ t: points[0].t, r: 0 }, ...points];
  const rs = [...all.map((p) => p.r), ...(copy?.r ?? [])];
  let lo = Math.min(0, ...rs), hi = Math.max(0, ...rs);
  if (hi - lo < 0.01) { hi += 0.005; lo -= 0.005; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const x = (i: number) => L + (all.length === 1 ? 0 : (i / (all.length - 1)) * (W - L - R));
  const y = (r: number) => T + ((hi - r) / (hi - lo)) * (H - T - B);
  const path = all.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join(" ");
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad];
  const last = all[all.length - 1];
  const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const label = drawdown ? `worst drawdown −${(drawdown.dd * 100).toFixed(2)}%` : "";
  // Keep the label inside the plot when the window is near the right edge.
  const labelAnchor = drawdown && x(drawdown.peak) + label.length * 7.5 > W - R ? "end" : "start";
  return (
    <figure className="panel" data-testid="returns-chart">
      {title}
      <div ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Return since inception: ${pct(last.r)} over ${points.length} price updates${drawdown ? `, ${label}` : ""}`}>
        {drawdown && (
          <g data-testid="dd-window">
            <rect x={x(drawdown.peak)} y={0} width={Math.max(2, x(drawdown.trough) - x(drawdown.peak))} height={H - B} className="dd-window" />
            <text x={labelAnchor === "end" ? W - R - 4 : x(drawdown.peak) + 6} y={16} textAnchor={labelAnchor} className="dd-label">{label}</text>
          </g>
        )}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="axis">{pct(v, 1)}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="zero" />
        <path d={path} className="line-main" fill="none" strokeWidth={2.5} strokeLinejoin="round" />
        {copy && copy.r.length > 0 && (
          <path
            data-testid="copy-line"
            d={copy.r.map((r, k) => `${k ? "L" : "M"}${x(copy.fromIndex + k).toFixed(1)},${y(r).toFixed(1)}`).join(" ")}
            className="line-copy"
            fill="none"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        )}
        <circle cx={x(all.length - 1)} cy={y(last.r)} r={4} className="dot-main"><title>{`latest: ${pct(last.r)}`}</title></circle>
        <text x={L} y={H - 6} className="axis">{fmtDate(all[0].t)}</text>
        <text x={W - R} y={H - 6} textAnchor="end" className="axis">{fmtDate(last.t)}</text>
      </svg>
      </div>
      <figcaption className="muted mt-2 text-xs">Return since the start, from the share price after fees at each signed price update.{copy ? " Dashed: your simulated copy since you joined." : ""}{note}</figcaption>
    </figure>
  );
}

/** Shorten hashes and long implicit ids; readable account ids (≤ 28 chars) stay whole. */
export function short(s: string, n = 6) {
  if (/^[a-z0-9_.-]{2,28}$/.test(s) && /[a-z]/.test(s) && s.includes(".")) return s;
  return s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
}

/** V7: the page's shape while its signed data loads from NEAR, so nothing jumps when it arrives. */
export function PageSkeleton({ label = "Reading signed data from NEAR…", tiles = 4 }: { label?: string; tiles?: number }) {
  return (
    <section aria-busy="true" data-testid="skeleton">
      <span className="sr-only">{label}</span>
      <div className="skeleton" style={{ height: 22, width: 140 }} />
      <div className="skeleton mt-3" style={{ height: 44, width: "min(420px, 80%)" }} />
      <div className="stats mt-6">
        {Array.from({ length: tiles }, (_, i) => <div key={i} className="tile"><div className="skeleton" style={{ height: 12, width: "60%" }} /><div className="skeleton mt-3" style={{ height: 28, width: "45%" }} /></div>)}
      </div>
      <div className="skeleton mt-6" style={{ height: 220, width: "100%" }} />
      <p className="muted mt-3 text-sm" aria-hidden="true">{label}</p>
    </section>
  );
}

export function SkeletonRows({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true" data-testid="skeleton-row">
          {Array.from({ length: cols }, (_, c) => <td key={c}><div className="skeleton" style={{ height: 14, width: c === 0 ? 120 : 56 }} /></td>)}
        </tr>
      ))}
    </>
  );
}

/** A tiny share-price line (no axes): the shape of the record at a glance. */
export function Sparkline({ values, width = 140, height = 36, label = "Share price" }: { values: number[]; width?: number; height?: number; label?: string }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 1 - ((v - lo) / span) * (height - 2)).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} data-testid="sparkline" preserveAspectRatio="none" style={{ display: "block", flex: "none" }}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** A label that reads "done ✓" for 2 s after a copy, then goes back. */
export function useFlash(ms = 2000): [string | null, (what: string) => void] {
  const [v, setV] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return [v, (what: string) => {
    setV(what);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setV(null), ms);
  }];
}

/** Clipboard with a prompt fallback (old Safari, insecure contexts). Resolves true when copied. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copy", text);
    return false;
  }
}

/** D5: the one line every testnet page carries. */
export function PaperLine() {
  return (
    <p className="paper-line" data-testid="paper-line">
      Paper season: testnet tokens, real prices. <Link href="/faq/#testnet">What does that mean?</Link>
    </p>
  );
}

export const X_HANDLE = "amit29199";
/** D5: real-money vaults aren't open yet. The waitlist is an X follow: no email, nothing stored. */
export function RealMoneySoon() {
  return (
    <div className="stop-box" data-testid="real-money-soon">
      <span className="text-[15px] font-medium">Real-money vaults open after the hackathon review</span>
      <span className="text-sm leading-relaxed">Genesis proves the full path with real USDC, but it isn&apos;t open to deposits. To hear when vaults open, follow <a href={`https://x.com/${X_HANDLE}`}>@{X_HANDLE} on X</a>. We don&apos;t collect emails, so there&apos;s nothing to sign up for and nothing stored about you.</span>
    </div>
  );
}
