"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { VAULTS } from "@/lib/config";
import { calmScore, leaderStake, loadVault, maxDrawdown, priceOf, status, verifyNavs, windowStats, type VaultData } from "@/lib/vault";
import { metaOf as houseMeta, type VaultMeta } from "@/lib/vaults";
import { communityMeta, loadLaunches } from "@/lib/community";
import { Redact, Ret, RiskDots, SkeletonRows, StatusChip } from "../ui";
import { useRouter } from "next/navigation";
import { badgeOf } from "@/lib/vaults";

type Row = { d: VaultData; m: VaultMeta; ret: number; dd: number; stake: number; ok: number; bad: number };
const WEEK = 7 * 24 * 3600_000;
type Key = "dd" | "stake" | "ret";
const SORTS: Record<Key, { label: string; by: (a: Row, b: Row) => number }> = {
  dd: { label: "Calmest first", by: (a, b) => a.dd - b.dd },
  stake: { label: "Most skin in the game", by: (a, b) => b.stake - a.stake },
  ret: { label: "Return", by: (a, b) => b.ret - a.ret },
};

/** A vault is ranked once it has this many browser-verified price posts; newer ones wait in "New this week". */
const MIN_POSTS = 12;
// Old test vaults (not in the season) keep their place at the bottom instead.
const ranked = (r: Row) => r.ok >= MIN_POSTS || !r.m.season;

// The drill and first test vaults barely traded, so they can't rank above real leaders.
const rank = (r: Row) => (r.m.season ? 0 : 1);

// Avatar colour by who leads, so the kind reads at a glance.
const KIND_TINT = { ai: "#2F3FD8", bot: "#2E7D6B", human: "#7A5C00", drill: "#655D50" } as const;

export default function Leaderboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [sort, setSort] = useState<Key>("dd");
  const router = useRouter();
  const worst = useMemo(() => Math.max(0.0001, ...(rows ?? []).map((r) => r.dd)), [rows]);
  const sorted = useMemo(() => (rows ? rows.filter(ranked).sort((a, b) => rank(a) - rank(b) || SORTS[sort].by(a, b)) : null), [rows, sort]);
  const fresh = useMemo(() => (rows ?? []).filter((r) => !ranked(r)).sort((a, b) => b.ok - a.ok), [rows]);
  useEffect(() => {
    (async () => {
      // House leaders plus every live community vault from the open season registry.
      const community = await loadLaunches().then((ls) => ls.filter((l) => l.status === "live" && l.vault), () => []);
      const ids = [...VAULTS, ...community.map((l) => l.vault!)];
      const metas = new Map<string, VaultMeta>(community.map((l) => [l.vault!, communityMeta(l)]));
      const rs = await Promise.allSettled(ids.map((v) => loadVault(v)));
      const ok: Row[] = [];
      const errs: string[] = [];
      rs.forEach((r, i) => {
        if (r.status === "rejected") return errs.push(`${ids[i]}: ${String(r.reason?.message ?? r.reason)}`);
        const d = r.value;
        const last = d.navs.at(-1);
        const v = verifyNavs(d.id, d.cfg.attestation_key, d.navs);
        ok.push({ d, m: metas.get(d.id) ?? houseMeta(d.id), ret: last ? priceOf(last.price) - 1 : 0, dd: maxDrawdown(d.navs), stake: leaderStake(d.vault), ok: v.ok, bad: v.bad.length });
      });
      setRows(ok);
      setErrors(errs);
    })();
  }, []);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex max-w-2xl flex-col gap-3">
          <h1>Leaders</h1>
          <p className="text-lg leading-relaxed" style={{ color: "var(--ink-2)" }}>Calmest first. Every number is checked by your browser, and no one&apos;s positions are published, not even to followers.</p>
        </div>
        <div className="seg flex-wrap" role="group" aria-label="Sort leaders" style={{ borderRadius: 24 }}>
          {(Object.keys(SORTS) as Key[]).map((k) => (
            <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)} data-testid={`sort-${k}`}>{SORTS[k].label}</button>
          ))}
        </div>
      </div>

      <Calmest rows={rows} />

      <div className="panel p-0">
        <table className="lb" data-testid="leaderboard">
          <thead>
            <tr><th>Leader</th><th>Worst drawdown</th><th>Return</th><th>Own money in</th><th>Holdings</th><th>Verified</th><th><span className="sr-only">Open</span></th></tr>
          </thead>
          <tbody>
            {rows === null && <SkeletonRows cols={7} rows={6} />}
            {rows?.length === 0 && <tr><td colSpan={7} className="muted">No leaders yet. The first one could be you: <Link href="/create/ai/">lead a vault</Link>.</td></tr>}
            {sorted?.map((r) => {
              const m = r.m, st = status(r.d.vault);
              return (
                <tr key={r.d.id} data-testid={`row-${r.d.id}`} data-href={`/vault/?id=${r.d.id}`} onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(`/vault/?id=${r.d.id}`); }}>
                  <td className="lb-who">
                    <div className="who">
                      <span className="tile-initial" style={{ background: KIND_TINT[m.leaderKind] }} aria-hidden="true">{m.name.charAt(0)}</span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <Link href={`/vault/?id=${r.d.id}`} className="who-name" title={`${r.d.id} · leader ${r.d.cfg.leader}`}>{m.name}</Link>
                        <span className="muted text-sm">{m.style}</span>
                        <div className="who-chips"><span className={`chip ${m.leaderKind === "ai" ? "chip-ai" : "chip-kind"}`} data-testid="badge">{badgeOf(m)}</span>{m.community && <span className="chip" data-testid="community">Community</span>}<RiskDots risk={m.risk} />{st !== "active" && <StatusChip s={st} />}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num text-[17px]" data-label="Worst drawdown">
                    <span data-testid="dd">{r.dd === 0 ? "0%" : `−${(r.dd * 100).toFixed(2)}%`}</span>
                    <span className="dd-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (r.dd / worst) * 100)}%` }} /></span>
                  </td>
                  <td className="num text-[17px]" data-label="Return" data-testid="ret"><Ret r={r.ret} /></td>
                  <td className="num" data-label="Own money in" data-testid="stake">
                    <span className="pos">{(r.stake * 100).toFixed(1)}%</span>
                    <span className="stake-bar"><i style={{ width: `${Math.min(100, r.stake * 100)}%` }} /></span>
                  </td>
                  <td data-label="Holdings"><Redact widths={[52, 28]} h={13} label="Holdings sealed" /></td>
                  <td className="num text-sm" data-label="Verified" title="Every price update's signature, checked in your browser" style={{ color: "var(--ink-2)" }}>
                    {r.bad > 0 ? <span className="neg">✗ {r.ok}/{r.d.navs.length}</span> : <>✓ {r.ok}/{r.d.navs.length}</>}
                  </td>
                  <td className="lb-view"><Link href={`/vault/?id=${r.d.id}`} className="view-link" aria-label={`View ${m.name}`}>View →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted -mt-5 text-xs" data-testid="honesty">
        Numbers marked <b>paper · testnet</b> are paper trades: fills are priced by real 1Click dry quotes, but no real funds move and the vaults hold testnet tokens. Price updates and trade signals are real testnet transactions.
      </p>
      {errors.map((e) => <p key={e} className="neg text-sm">{e}</p>)}

      {fresh.length > 0 && (
        <div className="panel flex flex-col gap-3" data-testid="new-leaders">
          <span className="eyebrow">New this week</span>
          <p className="muted text-sm">Ranked after {MIN_POSTS} signed price posts, so a leader with no history can&apos;t top &ldquo;Calmest first&rdquo;.</p>
          <div className="flex flex-wrap gap-2">
            {fresh.map((r) => (
              <Link key={r.d.id} href={`/vault/?id=${r.d.id}`} className="chip no-underline" style={{ color: "var(--ink)", padding: "6px 12px", fontSize: 13 }} data-testid={`new-${r.d.id}`}>
                {r.m.name} · ranking after {MIN_POSTS} price posts ({Math.min(r.ok, MIN_POSTS)}/{MIN_POSTS})
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <div className="panel lead-card flex min-w-0 flex-[1_1_320px] flex-col items-start gap-3" data-testid="lead-card">
          <h2 className="text-[32px]">Trade well? Lead a vault.</h2>
          <p className="text-[15px] leading-relaxed">Keep your edge private and get paid for followers without publishing your book. Put in at least 10% yourself; earn only on new highs.</p>
          <Link href="/create/ai/" className="underline underline-offset-4">Launch one on testnet</Link>
        </div>
        <div className="panel flex min-w-0 flex-[1_1_320px] flex-col items-start gap-3">
          <h2 className="text-[32px]">Bring your track record</h2>
          <p className="muted text-[15px] leading-relaxed">Sign once to prove an address is yours and we show its history on your vault. We never list a trader who hasn&apos;t signed.</p>
          <Link href="/track/" className="underline underline-offset-4">Prove an address</Link>
        </div>
      </div>
    </section>
  );
}

/** This week's calmest return: return per unit of worst drawdown over 7 days. A highlight, not a prize. */
function Calmest({ rows }: { rows: Row[] | null }) {
  const best = useMemo(() => {
    if (!rows) return null;
    const since = Date.now() - WEEK;
    const scored = rows.filter((r) => r.m.season && ranked(r)).flatMap((r) => {
      const s = windowStats(r.d.navs, since);
      return s && s.posts >= 4 ? [{ r, s, score: calmScore(s) }] : [];
    });
    return scored.sort((a, b) => b.score - a.score)[0] ?? null;
  }, [rows]);
  if (!best) return null;
  const { r, s } = best;
  return (
    <Link href={`/vault/?id=${r.d.id}`} className="panel flex flex-wrap items-center justify-between gap-4 no-underline" style={{ color: "var(--ink)" }} data-testid="calmest">
      <span className="flex flex-col gap-1">
        <span className="eyebrow">Calmest return this week</span>
        <span className="text-xl font-semibold">{r.m.name}</span>
      </span>
      <span className="num text-[15px]">
        {s.ret >= 0 ? "+" : "−"}{Math.abs(s.ret * 100).toFixed(2)}% for −{(s.dd * 100).toFixed(2)}% worst drawdown
        <span className="muted"> · ratio {calmScore(s).toFixed(1)}</span>
      </span>
    </Link>
  );
}
