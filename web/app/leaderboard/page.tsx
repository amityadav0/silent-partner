"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { VAULTS } from "@/lib/config";
import { calmScore, leaderStake, loadVault, maxDrawdown, priceOf, status, verifyNavs, windowStats, type VaultData } from "@/lib/vault";
import { metaOf as houseMeta, type VaultMeta } from "@/lib/vaults";
import { communityMeta, loadLaunches } from "@/lib/community";
import { PaperLine, Redact, Ret, RiskDots, SkeletonRows, StatusChip, useNear, VsNearTag } from "../ui";
import { ratio2, vsNear, type NearSeries, type VsNear } from "@/lib/bench";
import { loadTee } from "@/lib/tee";
import { useRouter } from "next/navigation";
import { badgeOf } from "@/lib/vaults";
import { loadCosts, type CostDoc } from "@/lib/costs";

type Row = { d: VaultData; m: VaultMeta; ret: number; dd: number; stake: number; ok: number; bad: number; vs?: VsNear | null };
const WEEK = 7 * 24 * 3600_000;
type Key = "dd" | "stake" | "ret" | "vs";
const SORTS: Record<Key, { label: string; by: (a: Row, b: Row) => number }> = {
  dd: { label: "Calmest first", by: (a, b) => a.dd - b.dd },
  stake: { label: "Most skin in the game", by: (a, b) => b.stake - a.stake },
  ret: { label: "Return", by: (a, b) => b.ret - a.ret },
  vs: { label: "vs holding NEAR", by: (a, b) => (b.vs?.pts ?? -1e9) - (a.vs?.pts ?? -1e9) },
};

/** A vault is ranked once it has this many browser-verified price posts; newer ones wait in "New this week". */
const MIN_POSTS = 12;
// Old test vaults (the drill, the first test vault) are never ranked: they sit in "Test vaults" (T4).
const ranked = (r: Row) => !r.m.test && (r.ok >= MIN_POSTS || !r.m.season);
const rank = (r: Row) => (r.m.season ? 0 : 1);

// Avatar colour by who leads, so the kind reads at a glance.
const KIND_TINT = { ai: "#2F3FD8", bot: "#2E7D6B", human: "#7A5C00", drill: "#655D50", benchmark: "#4A4A4A" } as const;

export default function Leaderboard() {
  const [raw, setRows] = useState<Row[] | null>(null);
  const near = useNear();
  const [tee, setTee] = useState<Record<string, boolean>>({});
  // the benchmark: the same signed price updates, against holding NEAR over the same window
  const rows = useMemo(() => raw?.map((r) => ({ ...r, vs: vsNear(r.d.navs, near ?? null) })) ?? null, [raw, near]);
  const [errors, setErrors] = useState<string[]>([]);
  const [sort, setSort] = useState<Key>("dd");
  const router = useRouter();
  const worst = useMemo(() => Math.max(0.0001, ...(rows ?? []).map((r) => r.dd)), [rows]);
  const sorted = useMemo(() => (rows ? rows.filter(ranked).sort((a, b) => rank(a) - rank(b) || SORTS[sort].by(a, b)) : null), [rows, sort]);
  const fresh = useMemo(() => (rows ?? []).filter((r) => !ranked(r) && !r.m.test).sort((a, b) => b.ok - a.ok), [rows]);
  const tests = useMemo(() => (rows ?? []).filter((r) => r.m.test), [rows]);
  const [costs, setCosts] = useState<CostDoc | null>(null);
  useEffect(() => {
    loadCosts().then(setCosts);
  }, []);
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
      loadTee(ok.filter((r) => r.m.leaderKind === "ai").map((r) => r.d.id)).then(setTee, () => {});
      setErrors(errs);
    })();
  }, []);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex max-w-2xl flex-col gap-3">
          <h1>Leaders</h1>
          <p className="text-lg leading-relaxed" style={{ color: "var(--ink-2)" }}>Calmest first. Every number is checked by your browser, and no one&apos;s positions are published, not even to followers.</p>
          <PaperLine />
        </div>
        <div className="seg flex-wrap" role="group" aria-label="Sort leaders" style={{ borderRadius: 24 }}>
          {(Object.keys(SORTS) as Key[]).map((k) => (
            <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)} data-testid={`sort-${k}`}>{SORTS[k].label}</button>
          ))}
        </div>
      </div>

      <Calmest rows={rows} near={near ?? null} />

      <div className="panel p-0">
        <table className="lb" data-testid="leaderboard">
          <thead>
            <tr><th>Leader</th><th>Worst drawdown</th><th>Return</th><th title="The same window, if you had simply held NEAR">vs holding NEAR</th><th>Own money in</th><th>Holdings</th><th>Verified</th><th><span className="sr-only">Open</span></th></tr>
          </thead>
          <tbody>
            {rows === null && <SkeletonRows cols={8} rows={6} />}
            {rows?.length === 0 && <tr><td colSpan={8} className="muted">No leaders yet. The first one could be you: <Link href="/create/ai/">lead a vault</Link>.</td></tr>}
            {sorted?.map((r) => {
              const m = r.m, st = status(r.d.vault);
              return (
                <tr key={r.d.id} data-testid={`row-${r.d.id}`} data-href={`/vault/?id=${r.d.id}`} onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(`/vault/?id=${r.d.id}`); }}>
                  <td className="lb-who">
                    <div className="who">
                      <span className="tile-initial" style={{ background: KIND_TINT[m.leaderKind] }} aria-hidden="true">{m.name.charAt(0)}</span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <Link href={`/vault/?id=${r.d.id}`} className="who-name" title={`${r.d.id} · leader ${r.d.cfg.leader}`}>{m.name}</Link>
                        <span className="muted text-sm">{m.style}{costs?.vaults[r.d.id] && <span data-testid="trades-day" title="Trades in the last 24 hours. Each one costs the vault about the measured trading cost."> · {costs.vaults[r.d.id].trades_24h} trade{costs.vaults[r.d.id].trades_24h === 1 ? "" : "s"}/day</span>}</span>
                        <div className="who-chips"><span className={`chip ${m.leaderKind === "ai" ? "chip-ai" : "chip-kind"}`} data-testid="badge" title={m.benchmark ? "A house benchmark: a fixed rule, no leader decisions. Compare any leader with it, or copy it." : undefined}>{badgeOf(m)}</span>{tee[r.d.id] && <Link href={`/vault/?id=${r.d.id}#ai`} className="chip chip-ok no-underline" title="This AI leader's latest decision has a NEAR AI TEE receipt, checked in your browser just now" data-testid="tee-chip">TEE ✓</Link>}{m.community && <span className="chip" data-testid="community">Community</span>}<RiskDots risk={m.risk} />{st !== "active" && <StatusChip s={st} />}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num text-[17px]" data-label="Worst drawdown">
                    <span data-testid="dd">{r.dd === 0 ? "0%" : `−${(r.dd * 100).toFixed(2)}%`}</span>
                    <span className="dd-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (r.dd / worst) * 100)}%` }} /></span>
                  </td>
                  <td className="num text-[17px]" data-label="Return" data-testid="ret"><Ret r={r.ret} /></td>
                  <td className="num whitespace-nowrap text-[15px]" data-label="vs holding NEAR"><VsNearTag compact v={near === undefined ? undefined : r.vs} /></td>
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

      {tests.length > 0 && (
        <details className="panel flex flex-col gap-3" data-testid="test-vaults">
          <summary className="cursor-pointer text-[15px] font-medium">Test vaults ({tests.length})</summary>
          <p className="muted mt-2 text-sm">Vaults we used to test the contract end to end. Not leaders, not ranked.</p>
          <ul className="mt-2 flex flex-col gap-2">
            {tests.map((r) => (
              <li key={r.d.id} data-testid={`test-${r.d.id}`}><Link href={`/vault/?id=${r.d.id}`}>{r.m.name}</Link> <span className="muted text-sm">· {r.m.style}</span></li>
            ))}
          </ul>
        </details>
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

/**
 * This week's highlight, not a prize. When someone made money: the calmest return (return per unit
 * of worst dip). When nobody did: who held up best against simply holding NEAR, per unit of worst dip.
 */
function Calmest({ rows, near }: { rows: Row[] | null; near: NearSeries | null }) {
  const best = useMemo(() => {
    if (!rows) return null;
    const since = Date.now() - WEEK;
    const scored = rows.filter((r) => r.m.season && !r.m.benchmark && ranked(r)).flatMap((r) => {
      const s = windowStats(r.d.navs, since);
      return s && s.posts >= 4 ? [{ r, s, v: vsNear(r.d.navs, near, since) }] : [];
    });
    const up = scored.filter((x) => x.s.ret > 0).map((x) => ({ ...x, score: calmScore(x.s), held: false }));
    if (up.length) return up.sort((a, b) => b.score - a.score)[0];
    const held = scored.filter((x) => x.v).map((x) => ({ ...x, score: x.v!.pts / 100 / Math.max(x.s.dd, 0.0005), held: true }));
    return held.sort((a, b) => b.score - a.score)[0] ?? null;
  }, [rows, near]);
  if (!best) return null;
  const { r, s, v, held, score } = best;
  const p = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}%`;
  return (
    <Link href={`/vault/?id=${r.d.id}`} className="panel flex flex-wrap items-center justify-between gap-4 no-underline" style={{ color: "var(--ink)" }} data-testid="calmest">
      <span className="flex flex-col gap-1">
        <span className="eyebrow" data-testid="calmest-title">{held ? "Held up best this week" : "Calmest return this week"}</span>
        <span className="text-xl font-semibold">{r.m.name}</span>
      </span>
      <span className="num text-[15px]">
        {held && v ? <>{p(s.ret)} while NEAR {p(v.near)} · −{(s.dd * 100).toFixed(2)}% worst dip</> : <>{p(s.ret)} for −{(s.dd * 100).toFixed(2)}% worst dip{v ? <span className="muted"> · NEAR {p(v.near)}</span> : null}</>}
        <span className="muted" data-testid="calmest-ratio"> · ratio {ratio2(score)}</span>
      </span>
    </Link>
  );
}
