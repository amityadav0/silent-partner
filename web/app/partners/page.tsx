"use client";
// My partners: every vault you hold as one portfolio, plus your simulated copies,
// and a one-click blend across two or three leaders.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ASSETS, TGAS, VAULTS } from "@/lib/config";
import { communityMeta, loadLaunches } from "@/lib/community";
import { loadPaper, paperPosition, savePaper, startPaper } from "@/lib/paper";
import { BLEND, blendPick, mixDrawdown, split, type Band } from "@/lib/portfolio";
import { fmtUnits, loadVault, maxDrawdown, priceOf, status, view, type Position, type VaultData } from "@/lib/vault";
import { metaOf, type VaultMeta } from "@/lib/vaults";
import { useWallet } from "@/lib/wallet";
import { SkeletonRows, useQueryParam } from "../ui";

type V = { d: VaultData; m: VaultMeta; ret: number; dd: number };
type Holding = { v: V; shares: bigint; value: bigint; deposited: bigint | null; claimed: bigint };

const usd = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}%`;

export default function Partners() {
  const { accountId, sendMany, signIn } = useWallet();
  const asParam = useQueryParam("as");
  const viewer = accountId ?? asParam ?? null;
  const [vaults, setVaults] = useState<V[] | null>(null);
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      const community = await loadLaunches().then((ls) => ls.filter((l) => l.status === "live" && l.vault), () => []);
      const metas = new Map(community.map((l) => [l.vault!, communityMeta(l)]));
      const ids = [...VAULTS, ...community.map((l) => l.vault!)];
      const rs = await Promise.allSettled(ids.map((id) => loadVault(id)));
      setVaults(rs.flatMap((r) => (r.status === "fulfilled" ? [{ d: r.value, m: metas.get(r.value.id) ?? metaOf(r.value.id), ret: r.value.navs.length ? priceOf(r.value.navs.at(-1)!.price) - 1 : 0, dd: maxDrawdown(r.value.navs) }] : [])));
    })();
  }, []);

  useEffect(() => {
    if (!vaults || !viewer) return setHoldings(viewer ? null : []);
    Promise.all(
      vaults.map(async (v) => {
        const pos = await view<Position>(v.d.id, "get_position", { account_id: viewer }).catch(() => null);
        const shares = pos ? BigInt(pos.shares) : BigInt((await view<[string, string]>(v.d.id, "get_shares", { account_id: viewer }))[0]);
        if (shares === 0n) return null;
        return { v, shares, value: (shares * BigInt(v.d.vault.price)) / 10n ** 18n, deposited: pos ? BigInt(pos.deposited) : null, claimed: pos ? BigInt(pos.claimed) : 0n };
      }),
    ).then((hs) => setHoldings(hs.filter(Boolean) as Holding[]), () => setHoldings([]));
  }, [vaults, viewer, tick]);

  const paper = useMemo(() => (vaults ?? []).flatMap((v) => {
    const f = loadPaper(v.d.id);
    const last = v.d.navs.at(-1);
    return f && last ? [{ v, f, pos: paperPosition(f, last.price) }] : [];
  }), [vaults, tick]);

  const dec = 6;
  const total = holdings?.reduce((a, h) => a + h.value, 0n) ?? 0n;
  const withBasis = holdings?.filter((h) => h.deposited !== null) ?? [];
  const pnl = withBasis.reduce((a, h) => a + h.value + h.claimed - h.deposited!, 0n);
  const dep = withBasis.reduce((a, h) => a + h.deposited!, 0n);
  const mixDd = holdings?.length ? mixDrawdown(holdings.map((h) => ({ units: Number(h.shares), navs: h.v.d.navs }))) : 0;
  const paperTotal = paper.reduce((a, p) => a + p.pos.value, 0), paperIn = paper.reduce((a, p) => a + p.f.usd, 0);

  return (
    <section className="flex flex-col gap-8" data-testid="partners">
      <div className="flex max-w-3xl flex-col gap-3">
        <span className="eyebrow">Your portfolio</span>
        <h1>My partners</h1>
        <p className="text-lg leading-relaxed" style={{ color: "var(--ink-2)" }}>Every leader you follow, as one portfolio. Each vault&apos;s positions stay sealed; these are your own numbers, from each vault&apos;s cost basis on chain.</p>
      </div>

      {!viewer && (
        <div className="panel flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm">Connect a wallet to see the vaults you hold. Your simulated copies are below either way.</span>
          <button className="btn" onClick={signIn}>Connect wallet</button>
        </div>
      )}
      {viewer && (
        <div className="flex flex-col gap-4">
          {!accountId && asParam && <p className="muted text-sm">Viewing <code>{asParam}</code> read-only.</p>}
          <div className="stats" data-testid="partner-stats">
            <div className="tile"><div className="tile-l">Total value</div><div className="tile-v" data-testid="total">{holdings ? `${fmtUnits(total, dec)} USDC` : "…"}</div></div>
            <div className="tile"><div className="tile-l">Return on what you put in</div><div className="tile-v">{holdings ? (dep > 0n ? signed(Number((pnl * 1_000_000n) / dep) / 1e6) : "–") : "…"}</div><div className="tile-h">{dep > 0n ? `${pnl >= 0n ? "+" : "−"}${fmtUnits(pnl >= 0n ? pnl : -pnl, dec)} USDC` : ""}</div></div>
            <div className="tile tile-risk"><div className="tile-l">Worst drawdown of this mix</div><div className="tile-v" data-testid="mix-dd">{holdings ? `−${(mixDd * 100).toFixed(2)}%` : "…"}</div><div className="tile-h">today&apos;s holdings, replayed over each vault&apos;s history</div></div>
            <div className="tile"><div className="tile-l">Leaders</div><div className="tile-v">{holdings?.length ?? "…"}</div></div>
          </div>
          <div className="panel scroll-x p-0">
            <table className="t" data-testid="holdings">
              <thead><tr><th>Leader</th><th>Value</th><th>Share of total</th><th>Your P&amp;L</th><th>Vault worst drawdown</th><th /></tr></thead>
              <tbody>
                {holdings === null && <SkeletonRows cols={6} rows={3} />}
                {holdings?.length === 0 && <tr><td colSpan={6} className="muted">No vaults yet. Pick a leader, or try a blend below.</td></tr>}
                {holdings?.map((h) => {
                  const p = h.deposited !== null ? h.value + h.claimed - h.deposited : null;
                  return (
                    <tr key={h.v.d.id} data-testid={`holding-${h.v.d.id}`}>
                      <td style={{ fontFamily: "var(--sans)" }}>{h.v.m.name}</td>
                      <td>{fmtUnits(h.value, dec)} USDC</td>
                      <td>
                        {total > 0n ? `${(Number((h.value * 10_000n) / total) / 100).toFixed(1)}%` : "–"}
                        <span className="stake-bar"><i style={{ width: `${total > 0n ? Number((h.value * 100n) / total) : 0}%` }} /></span>
                      </td>
                      <td>{p === null ? "–" : `${p >= 0n ? "+" : "−"}${fmtUnits(p >= 0n ? p : -p, dec)}`}</td>
                      <td>−{(h.v.dd * 100).toFixed(2)}%</td>
                      <td><Link href={`/vault/?id=${h.v.d.id}`} className="view-link">Open →</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {paper.length > 0 && (
        <div className="panel flex flex-col gap-2" data-testid="simulated">
          <h2>Simulated copies</h2>
          <p className="muted text-sm">Kept only in this browser. {usd(paperIn)} in, worth {usd(paperTotal)} now ({signed(paperIn ? paperTotal / paperIn - 1 : 0)}).</p>
          {paper.map((p) => (
            <div className="row-kv" key={p.v.d.id}>
              <span>{p.v.m.name}</span>
              <span><span className="num">{usd(p.pos.value)}</span> <button className="quiet" onClick={() => { savePaper(null, p.v.d.id); setTick((t) => t + 1); }}>remove</button></span>
            </div>
          ))}
        </div>
      )}

      <Blend vaults={vaults} accountId={accountId} sendMany={sendMany} onDone={() => setTick((t) => t + 1)} />
    </section>
  );
}

function Blend({ vaults, accountId, sendMany, onDone }: { vaults: V[] | null; accountId: string | null; sendMany: ReturnType<typeof useWallet>["sendMany"]; onDone: () => void }) {
  const [band, setBand] = useState<Band>("calm");
  const [amount, setAmount] = useState("300");
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const picks = useMemo(() => {
    if (!vaults) return [];
    const rows = vaults.filter((v) => v.m.season).map((v) => ({ id: v.d.id, ret: v.ret, dd: v.dd, epochs: v.d.navs.length, active: status(v.d.vault) === "active" }));
    return blendPick(rows, band).map((id) => vaults.find((v) => v.d.id === id)!);
  }, [vaults, band]);
  const units = BigInt(Math.max(0, Math.round(Number(amount) * 1e6)));
  const parts = split(units, picks.length);

  function simulate() {
    picks.forEach((v, i) => {
      const f = startPaper(v.d.id, Number(parts[i]) / 1e6, v.d.navs.at(-1));
      if (f) savePaper(f, v.d.id);
    });
    setMsg({ bad: false, text: `Simulated: ${picks.map((v) => v.m.name).join(", ")}. Kept in this browser.` });
    onDone();
  }

  async function deposit() {
    setMsg(null);
    if (!accountId) return simulate();
    if (units < 3_000_000n) return setMsg({ bad: true, text: "At least 1 USDC per leader." });
    setBusy(true);
    try {
      const token = picks[0].d.cfg.base_token;
      const registered = await view(token, "storage_balance_of", { account_id: accountId });
      // testnet: mint the faucet USDC in the same confirmation
      const first = { receiverId: token, calls: [...(registered ? [] : [{ method: "storage_deposit", args: { account_id: accountId }, deposit: 1_250_000_000_000_000_000_000n, gas: 30n * TGAS }]), { method: "mint", args: { account_id: accountId, amount: units.toString() }, gas: 30n * TGAS }] };
      const deposits = picks.map((v, i) => ({ receiverId: token, calls: [{ method: "ft_transfer_call", args: { receiver_id: v.d.id, amount: parts[i].toString(), msg: "" }, deposit: 1n, gas: 150n * TGAS }] }));
      const hashes = await sendMany([first, ...deposits]);
      setMsg({ bad: false, text: hashes.length ? `Deposited across ${picks.length} leaders (${hashes.filter(Boolean).length} transactions).` : "Sent to your wallet." });
      onDone();
    } catch (e) {
      setMsg({ bad: true, text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel flex flex-col gap-4" data-testid="blend">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>Blend: one deposit, several leaders</h2>
        <div className="seg" role="group" aria-label="Blend">
          {(Object.keys(BLEND) as Band[]).map((b) => <button key={b} aria-pressed={band === b} onClick={() => setBand(b)} data-testid={`blend-${b}`}>{BLEND[b].label}</button>)}
        </div>
      </div>
      <p className="muted text-sm">{BLEND[band].label}: {BLEND[band].why}, split evenly.</p>
      <div>
        {picks.map((v, i) => (
          <div className="row-kv" key={v.d.id} data-testid="blend-pick">
            <span>{v.m.name} <span className="muted">· −{(v.dd * 100).toFixed(2)}% worst, {signed(v.ret)}</span></span>
            <span className="num">{fmtUnits(parts[i] ?? 0n, 6)} USDC</span>
          </div>
        ))}
        {!vaults && <p className="muted text-sm">Reading leaders…</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="amount max-w-[220px]">
          <input aria-label="Blend amount" value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} />
          <span className="num muted">USDC</span>
        </div>
        <button className="btn btn-primary" disabled={busy || picks.length === 0} onClick={deposit} data-testid="blend-go">{accountId ? "Mint test USDC and deposit" : "Simulate this blend"}</button>
        {accountId && <button className="quiet" onClick={simulate}>or simulate it</button>}
      </div>
      <p className="muted text-xs">{accountId ? `One wallet confirmation for ${picks.length + 1} transactions: mint ${ASSETS[picks[0]?.d.cfg.base_asset_id ?? ""]?.symbol ?? "USDC"} on testnet, then one deposit per leader.` : "No wallet: each part becomes a simulated copy in this browser, at today's share price."}</p>
      {msg && <p className={`text-sm ${msg.bad ? "neg" : ""}`} role="status">{msg.text}</p>}
    </div>
  );
}
