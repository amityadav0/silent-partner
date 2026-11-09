"use client";
import { metaOf, modeLabel } from "@/lib/vaults";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NETWORK } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { loadVault, pct, type VaultData } from "@/lib/vault";

export function Nav() {
  const { accountId, ready, signIn, signOut } = useWallet();
  const path = usePathname();
  const link = (href: string, label: string) => {
    const on = href === "/" ? path === "/" : path?.startsWith(href);
    return (
      <Link href={href} className={`no-underline ${on ? "font-semibold" : "muted"}`} style={{ color: on ? "CanvasText" : undefined }}>
        {label}
      </Link>
    );
  };
  return (
    <header className="rule border-b">
      <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
        <Link href="/" className="font-bold no-underline" style={{ color: "CanvasText" }}>
          Silent Partner
        </Link>
        {link("/leaderboard/", "Leaderboard")}
        {link("/chain/", "What the chain sees")}
        {link("/leader/", "Leader console")}
        {link("/create/", "Create")}
        <span className="ml-auto flex items-center gap-3">
          {NETWORK === "testnet" && <span className="chip chip-warn">testnet</span>}
          {accountId ? (
            <>
              <span className="muted max-w-[14rem] truncate" data-testid="account">{accountId}</span>
              <button className="btn" onClick={() => signOut()}>Sign out</button>
            </>
          ) : (
            <button className="btn" disabled={!ready} onClick={signIn}>Connect wallet</button>
          )}
        </span>
      </nav>
    </header>
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

export function Stat({ label, value, hint, testid }: { label: string; value: ReactNode; hint?: string; testid?: string }) {
  return (
    <div className="panel min-w-0" data-testid={testid}>
      <div className="muted text-xs uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="muted mt-0.5 text-xs">{hint}</div>}
    </div>
  );
}

export function Ret({ r }: { r: number }) {
  return <span className={r >= 0 ? "pos" : "neg"}>{pct(r)}</span>;
}

/** Honest provenance label: "paper · testnet" or "live · mainnet". */
export function ModeChip({ id }: { id: string }) {
  const m = metaOf(id);
  return <span className={`chip ${m.mode === "paper" ? "chip-paper" : "chip-ok"}`} data-testid="mode" title={m.mode === "paper" ? "Paper trades priced by real 1Click dry quotes; testnet tokens, no real funds" : "Real funds"}>{modeLabel(m)}</span>;
}

export function StatusChip({ s }: { s: string }) {
  const cls = s === "active" ? "chip-ok" : s === "emergency" ? "chip-bad" : "chip-warn";
  return <span className={`chip ${cls}`} data-testid="status">{s}</span>;
}

/** Tiny return line for table rows: last 96 epochs, colored by the latest sign. */
export function Sparkline({ points, w = 96, h = 24 }: { points: { t: number; r: number }[]; w?: number; h?: number }) {
  const p = points.slice(-96);
  if (p.length < 2) return <span className="muted text-xs">–</span>;
  const rs = p.map((x) => x.r), lo = Math.min(0, ...rs), hi = Math.max(0, ...rs), span = hi - lo || 1;
  const y = (r: number) => h - 2 - ((r - lo) / span) * (h - 4);
  const d = p.map((x, i) => `${i ? "L" : "M"}${((i / (p.length - 1)) * (w - 2) + 1).toFixed(1)},${y(x.r).toFixed(1)}`).join("");
  const up = rs[rs.length - 1] >= 0;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`return trend, last ${(rs[rs.length - 1] * 100).toFixed(2)}%`} data-testid="sparkline">
      <line x1="0" x2={w} y1={y(0)} y2={y(0)} className="zero" />
      <path d={d} fill="none" strokeWidth="1.5" className={up ? "line-pos" : "line-neg"} />
    </svg>
  );
}

/** Return since inception per NAV epoch: a line with a zero baseline. */
export function ReturnsChart({ points, height = 180 }: { points: { t: number; r: number }[]; height?: number }) {
  // Draw at the container's real width so axis text stays 11px on phones.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height, L = 48, R = 12, T = 12, B = 26;
  if (points.length === 0) return <div className="panel muted text-sm">No NAV posted yet.</div>;
  const all = [{ t: points[0].t, r: 0 }, ...points];
  const rs = all.map((p) => p.r);
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
  return (
    <figure className="panel" data-testid="returns-chart">
      <div ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Return since inception: ${pct(last.r)} over ${points.length} epochs`}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="axis">{pct(v, 1)}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="zero" />
        <path d={path} className={last.r >= 0 ? "line-pos" : "line-neg"} fill="none" strokeWidth={2} strokeLinejoin="round" />
        {all.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.r)} r={i === all.length - 1 ? 4 : 2.5} className={last.r >= 0 ? "dot-pos" : "dot-neg"}>
            <title>{i === 0 ? "inception" : `epoch ${i}: ${pct(p.r)}`}</title>
          </circle>
        ))}
        <text x={L} y={H - 6} className="axis">{fmtDate(all[0].t)}</text>
        <text x={W - R} y={H - 6} textAnchor="end" className="axis">{fmtDate(last.t)}</text>
      </svg>
      </div>
      <figcaption className="muted mt-1 text-xs">Return since inception, from the post-fee share price in each operator-attested NAV post.</figcaption>
    </figure>
  );
}

/** Shorten hashes and long implicit ids; readable account ids (≤ 28 chars) stay whole. */
export function short(s: string, n = 6) {
  if (/^[a-z0-9_.-]{2,28}$/.test(s) && /[a-z]/.test(s) && s.includes(".")) return s;
  return s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
}
