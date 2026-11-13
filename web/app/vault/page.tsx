"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ASSETS, NETWORK, TGAS, explorerFor, networkOf } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { aumBucket, drawdownWindow, fmtUnits, leaderStake, maxDrawdown, priceOf, returns, status, toUnits, verifyNavs, view, type Claim } from "@/lib/vault";
import { LeaderChips, PageSkeleton, PaperLine, RealMoneySoon, Redact, Ret, ReturnsChart, Stat, ModeChip, StatusChip, short, useNear, useQueryParam, useVault, VsNearTag } from "../ui";
import { vsNear } from "@/lib/bench";
import { META, metaOf, type VaultMeta } from "@/lib/vaults";
import { communityMeta, launchOfVault } from "@/lib/community";
import { EmergencyBanner } from "./emergency";
import { PositionDetails } from "./position";
import { usePaper } from "./paper";
import { FollowPanel } from "./follow";
import { WhoSeesWhat } from "./whosees";
import { AiDecisions } from "./ai";
import { Term } from "../term";
import { Alerts } from "./alerts";
import { Letters } from "./letters";
import { LinkedTrackRecord } from "./linked";
import { CostBox, FollowTimeline } from "./costs";
import { Limits, RecordChips } from "./limits";
import { SystemStatus } from "../status";
import { copyLine, type PaperFollow } from "@/lib/paper";

/** Chart overlay for a paper follow: index into [inception, ...navs] where it starts. */
function copyOverlay(navs: { epoch: number; timestamp_ms: number; price: string }[], f: PaperFollow | null) {
  if (!f) return undefined;
  const k = navs.findIndex((n) => n.epoch === f.entry_epoch);
  if (k < 0) return undefined;
  return { fromIndex: k + 1, r: copyLine(navs, f).map((p) => p.r) };
}

const SITE = "https://amityadav0.github.io/silent-partner";

/** "Invite to this vault": a link that previews with the vault's card and credits its leader. */
function InviteButton({ id, leader }: { id: string; leader: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${SITE}/v/${id}/?ref=${encodeURIComponent(leader)}`;
  return (
    <button className="quiet" data-testid="invite" data-url={url} onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true), () => window.prompt("Copy this invite link", url))}>
      {copied ? "Invite link copied" : "Invite to this vault"}
    </button>
  );
}

export default function VaultPage() {
  const id = useQueryParam("id");
  const { data, error, reload } = useVault(id);
  const paper = usePaper(id ?? "");
  const { accountId, call } = useWallet();
  // Read-only "view as" any account: positions are public on-chain data; actions still need the wallet.
  const asParam = useQueryParam("as");
  const viewer = accountId ?? asParam;
  const [mine, setMine] = useState<{ shares: bigint; locked: bigint; claims: Claim[] } | null>(null);
  const [wShares, setWShares] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [allNavs, setAllNavs] = useState(false);
  // Community vaults get their name and style from the open season registry.
  const [cmeta, setCmeta] = useState<VaultMeta | null>(null);
  useEffect(() => {
    if (!id || META[id]) return;
    launchOfVault(id).then((l) => setCmeta(l ? communityMeta(l) : null), () => setCmeta(null));
  }, [id]);

  useEffect(() => {
    if (!id || !viewer) return setMine(null);
    Promise.all([view<[string, string]>(id, "get_shares", { account_id: viewer }), view<Claim[]>(id, "get_claims", { from: 0, limit: 500 })]).then(([[s, l], cs]) =>
      setMine({ shares: BigInt(s), locked: BigInt(l), claims: cs.filter((c) => c.account === viewer) }),
    );
  }, [id, viewer, data]);

  const m = useMemo(() => {
    if (!data) return null;
    const dec = ASSETS[data.cfg.base_asset_id]?.decimals ?? 6;
    const last = data.navs.at(-1);
    return { dec, sym: ASSETS[data.cfg.base_asset_id]?.symbol ?? "base", ret: last ? priceOf(last.price) - 1 : 0, dd: maxDrawdown(data.navs), win: drawdownWindow(data.navs), stake: leaderStake(data.vault), v: verifyNavs(data.id, data.cfg.attestation_key, data.navs), price: priceOf(data.vault.price) };
  }, [data]);
  const near = useNear();
  const vs = useMemo(() => (data ? vsNear(data.navs, near ?? null) : null), [data, near]);
  // #ai and other anchors: the panels render after the chain read, so scroll once they exist
  useEffect(() => {
    if (!data || !location.hash) return;
    const t = setTimeout(() => document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "start" }), 300);
    return () => clearTimeout(t);
  }, [data]);

  if (id === null) return <p>Missing <code>?id=</code>. Pick a vault on the <Link href="/leaderboard/">leaderboard</Link>.</p>;
  if (error) return <p className="neg">{error}</p>;
  if (!data || !m) return <PageSkeleton label="Reading the vault&apos;s signed prices from NEAR…" />;
  const { vault, cfg, navs } = data;

  async function withdraw() {
    setMsg(null);
    const s = toUnits(wShares || "0", 0);
    if (!s || s <= 0n) return setMsg("Enter a number of shares.");
    try {
      const tx = await call({ receiverId: data!.id, method: "request_withdraw", args: { shares: s.toString(), exit_account: accountId }, gas: 30n * TGAS });
      setMsg(tx ? `Withdrawal requested (tx ${tx}). Your shares are paid out at the price update after next, to your NEAR Intents account.` : "Sent to your wallet.");
      reload();
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  }

  const st = status(vault);
  const free = mine ? mine.shares - mine.locked : 0n;
  const meta = cmeta ?? metaOf(data.id);
  // A vault on the other network (the mainnet vault on the testnet site) is read-only here.
  const foreign = networkOf(data.id) !== NETWORK;
  return (
    <section>
      {!foreign && meta.mode === "paper" && <PaperLine />}
      <div className="mb-4"><SystemStatus /></div>
      <div className="vault-grid">
        <div className="vault-main">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <LeaderChips id={data.id} meta={meta} />
              <ModeChip id={data.id} meta={meta} />
              {st !== "active" && <StatusChip s={st} />}
              <RecordChips times={navs.map((n) => n.timestamp_ms)} />
              <Link href={`/s/?id=${data.id}`} className="text-sm">Share</Link>
              <InviteButton id={data.id} leader={cfg.leader} />
            </div>
            <h1>{meta.name}</h1>
            <p className="max-w-2xl text-lg leading-relaxed" style={{ color: "var(--ink-2)" }}>{meta.style}. What it holds right now is sealed.</p>
            {!foreign && <a href="#follow" className="btn btn-primary follow-jump self-start" data-testid="follow-jump">Follow {meta.name}: cost and steps ↓</a>}
          </div>
          <EmergencyBanner id={data.id} vault={vault} cfg={cfg} shares={mine?.shares ?? 0n} dec={m.dec} sym={m.sym} onDone={reload} />

          <div className="stats" data-testid="stats">
            <Stat risk label="Worst drawdown" value={m.dd === 0 ? "0%" : `−${(m.dd * 100).toFixed(2)}%`} testid="stat-drawdown" />
            <Stat label="Return since start" value={<Ret r={m.ret} />} hint="after fees" testid="stat-return" />
            <Stat label="vs holding NEAR" value={<VsNearTag compact v={near === undefined ? undefined : vs} />} hint={vs ? `NEAR ${vs.near >= 0 ? "+" : "−"}${Math.abs(vs.near * 100).toFixed(2)}% over the same updates` : "same window, same updates"} testid="stat-vs-near" />
            <Stat label="Leader's own money" value={<span className="pos">{(m.stake * 100).toFixed(1)}%</span>} hint={`at least ${cfg.min_leader_bps / 100}%, enforced`} testid="stat-stake" />
            <Stat label="Verified price updates" value={<span className="whitespace-nowrap">{m.v.ok} / {navs.length}</span>} hint={m.v.bad.length ? `bad: updates ${m.v.bad.join(", ")}` : "verified in your browser"} testid="stat-attested" />
          </div>

          <ReturnsChart
            points={returns(navs)}
            copy={foreign ? undefined : copyOverlay(navs, paper.follow)}
            drawdown={m.win}
            title={
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <h2>Share price</h2>
                <span className="num muted text-[13px]">{m.price.toFixed(4)} {m.sym} · {m.v.bad.length ? "signature check failed" : "✓ re-checked in your browser"}</span>
              </div>
            }
          />

          <Limits id={data.id} meta={meta} cfg={cfg} vault={vault} times={navs.map((n) => n.timestamp_ms)} />

          {meta.leaderKind === "ai" && <AiDecisions id={data.id} />}

          <WhoSeesWhat id={data.id} viewer={viewer} shares={mine?.shares ?? null} vault={vault} dec={m.dec} sym={m.sym} />

          {meta.community && <Letters vault={data.id} />}
          {!foreign && <Alerts vault={data.id} />}

          <p className="muted text-sm leading-relaxed" data-testid="about">
            {meta.blurb} Led by <code>{cfg.leader}</code>. AUM {aumBucket(vault.book_nav, m.dec)} (bucketed).
          </p>
          <LinkedTrackRecord vault={data.id} />

          {foreign ? (
            <div className="panel" data-testid="mainnet-readonly">
              <h2>Real funds on NEAR mainnet</h2>
              <p className="muted mt-1 text-sm leading-relaxed">
                Everything on this page is read live from NEAR mainnet and checked in your browser. This site&apos;s wallet is on testnet, so deposits and withdrawals for this vault aren&apos;t offered here. Every mainnet transaction is listed in <a href="https://github.com/amityadav0/silent-partner/blob/master/docs/mainnet.md">docs/mainnet.md</a>.
              </p>
              <div className="mt-4"><RealMoneySoon /></div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <CostBox feeBps={cfg.perf_fee_bps} />
                <FollowTimeline times={navs.map((n) => n.timestamp_ms)} price={m.price} sym={m.sym} />
              </div>
            </div>
          ) : (
          <div className="panel" data-testid="my-position">
            <h2>Your position</h2>
            {!accountId && asParam && <p className="muted text-xs">Viewing <code>{asParam}</code> read-only.</p>}
            {!viewer ? (
              <p className="muted mt-1 text-sm">Connect a wallet to see your shares. Only you and the chain know them; the leader never sees a list.</p>
            ) : !mine ? (
              <div className="skeleton mt-2" style={{ height: 18, width: 220 }} aria-label="Reading your position" />
            ) : (
              <>
                <p className="mt-1 text-sm tabular-nums">
                  {mine.shares.toLocaleString()} shares ≈ {fmtUnits((mine.shares * BigInt(vault.price)) / 10n ** 18n, m.dec)} {m.sym}
                  {mine.locked > 0n && <span className="muted"> · {mine.locked.toLocaleString()} locked for withdrawal</span>}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input aria-label="Shares to withdraw" className="w-40" placeholder={free.toString()} value={wShares} onChange={(e) => setWShares(e.target.value)} inputMode="numeric" />
                  <button className="btn ml-auto" disabled={free <= 0n || st === "emergency"} onClick={withdraw}>Request withdrawal</button>
                </div>
                <PositionDetails id={data.id} viewer={viewer} vault={vault} cfg={cfg} dec={m.dec} sym={m.sym} claims={mine.claims} refresh={data} onDone={reload} />
              </>
            )}
            {msg && <p className="mt-3 break-words text-sm" role="status">{msg}</p>}
          </div>
          )}
        </div>

        {!foreign && <FollowPanel name={meta.name} data={data} price={m.price} dec={m.dec} sym={m.sym} active={st === "active"} shares={mine && accountId ? mine.shares : 0n} paper={paper} onDone={reload} />}
      </div>

      <details className="tech-record" data-testid="tech-record">
        <summary><span>Technical record</span><span className="muted text-sm">every signed price update, fill-log heads and signatures</span></summary>
        <h2 className="mt-4">Price updates</h2>
        <p className="muted mt-1 text-xs">Each post is signed by the operator&apos;s attestation key <code>{short(cfg.attestation_key, 8)}</code> and pins the head of its hash-chained fill log.</p>
        <div className="panel scroll-x mt-3 p-0">
          <table className="t" data-testid="nav-table">
            <thead><tr><th>#</th><th>Time</th><th>Share price</th><th>Positions</th><th>Fee shares</th><th>Withdrawn</th><th>Fill log head</th><th>Sig</th></tr></thead>
            <tbody>
              {[...navs].reverse().slice(0, allNavs ? undefined : 20).map((n) => (
                <tr key={n.epoch}>
                  <td>{n.epoch}</td>
                  <td>{new Date(n.timestamp_ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{priceOf(n.price).toFixed(6)}</td>
                  <td><Redact widths={[44, 24]} h={12} label="Positions sealed" /></td>
                  <td>{BigInt(n.fee_shares) > 0n ? BigInt(n.fee_shares).toLocaleString() : "–"}</td>
                  <td>{BigInt(n.withdrawn) > 0n ? `${fmtUnits(n.withdrawn, m.dec)} ${m.sym}` : "–"}</td>
                  <td><code className="text-xs">{short(n.fills_head, 6)}</code></td>
                  <td>{m.v.bad.includes(n.epoch) ? <span className="neg">✗</span> : <span className="pos">✓</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {navs.length > 20 && (
          <button className="quiet mt-2" onClick={() => setAllNavs(!allNavs)} data-testid="nav-all">{allNavs ? "Show the latest 20" : `Show all ${navs.length} posts`}</button>
        )}
      </details>
      <p className="muted mt-3 break-words text-xs">
        Contract <a href={`${explorerFor(data.id)}/address/${data.id}`}>{data.id}</a> · <Term tip="A NEAR Confidential Intents account whose key is an MPC key derived for this contract (NEAR Chain Signatures). No person holds it; the contract signs only transfers back into the vault or to a holder's own payout.">private trading account</Term> <code>{vault.vault_account ? short(vault.vault_account, 8) : "–"}</code> · {vault.signals} leader signals recorded
      </p>
    </section>
  );
}
