"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ASSETS, NEAR_EXPLORER, TGAS } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { aumBucket, fmtUnits, maxDrawdown, priceOf, returns, status, toUnits, verifyNavs, view, type Claim } from "@/lib/vault";
import { LeaderChips, Ret, ReturnsChart, Stat, ModeChip, StatusChip, short, useQueryParam, useVault } from "../ui";
import { metaOf } from "@/lib/vaults";
import { EmergencyBanner } from "./emergency";
import { PositionDetails } from "./position";

export default function VaultPage() {
  const id = useQueryParam("id");
  const { data, error, reload } = useVault(id);
  const { accountId, call } = useWallet();
  // Read-only "view as" any account: positions are public on-chain data; actions still need the wallet.
  const asParam = useQueryParam("as");
  const viewer = accountId ?? asParam;
  const [mine, setMine] = useState<{ shares: bigint; locked: bigint; claims: Claim[] } | null>(null);
  const [amount, setAmount] = useState("10");
  const [wShares, setWShares] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

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
    return { dec, sym: ASSETS[data.cfg.base_asset_id]?.symbol ?? "base", ret: last ? priceOf(last.price) - 1 : 0, dd: maxDrawdown(data.navs), v: verifyNavs(data.id, data.cfg.attestation_key, data.navs), price: priceOf(data.vault.price) };
  }, [data]);

  if (id === null) return <p>Missing <code>?id=</code>. Pick a vault on the <Link href="/leaderboard/">leaderboard</Link>.</p>;
  if (error) return <p className="neg">{error}</p>;
  if (!data || !m) return <p className="muted">Reading vault from NEAR…</p>;
  const { vault, cfg, navs } = data;

  async function deposit() {
    setMsg(null);
    const units = toUnits(amount, m!.dec);
    if (!units || units < BigInt(cfg.min_deposit)) return setMsg(`Minimum deposit is ${fmtUnits(cfg.min_deposit, m!.dec)} ${m!.sym}.`);
    try {
      const tx = await call({ receiverId: cfg.base_token, method: "ft_transfer_call", args: { receiver_id: data!.id, amount: units.toString(), msg: "" }, deposit: 1n, gas: 100n * TGAS });
      setMsg(tx ? `Deposited. Tx ${tx}. If the leader stake or the NAV age rules refuse it, the deposit is refunded in the same transaction.` : "Sent to your wallet.");
      reload();
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  }
  async function withdraw() {
    setMsg(null);
    const s = toUnits(wShares || "0", 0);
    if (!s || s <= 0n) return setMsg("Enter a number of shares.");
    try {
      const tx = await call({ receiverId: data!.id, method: "request_withdraw", args: { shares: s.toString(), exit_account: accountId }, gas: 30n * TGAS });
      setMsg(tx ? `Withdrawal requested (tx ${tx}). Your shares burn at the next NAV, then the payout goes to your intents account.` : "Sent to your wallet.");
      reload();
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  }

  const st = status(vault);
  const free = mine ? mine.shares - mine.locked : 0n;
  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{metaOf(data.id).name}</h1>
        <LeaderChips id={data.id} />
        <ModeChip id={data.id} />
        <StatusChip s={st} />
        <code className="muted text-xs">{short(data.id, 14)}</code>
        <Link href={`/s/?id=${data.id}`} className="text-sm">Share</Link>
      </div>
      {metaOf(data.id).blurb && <p className="mt-1 text-sm">{metaOf(data.id).blurb}</p>}
      <p className="muted mt-1 text-sm">
        Led by <code>{cfg.leader}</code> · performance fee {cfg.perf_fee_bps / 100}% above the high-water mark · leader stake ≥ {cfg.min_leader_bps / 100}%
      </p>
      <EmergencyBanner id={data.id} vault={vault} cfg={cfg} shares={mine?.shares ?? 0n} dec={m.dec} sym={m.sym} onDone={reload} />

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Return" value={<Ret r={m.ret} />} hint="since inception, after fees" testid="stat-return" />
        <Stat label="Max drawdown" value={m.dd === 0 ? "0%" : `−${(m.dd * 100).toFixed(2)}%`} />
        <Stat label="AUM" value={aumBucket(vault.book_nav, m.dec)} hint="bucketed" />
        <Stat label="Attested" value={`${m.v.ok}/${navs.length}`} hint={m.v.bad.length ? `bad: epochs ${m.v.bad.join(", ")}` : "verified in your browser"} testid="stat-attested" />
      </div>

      <div className="mt-5"><ReturnsChart points={returns(navs)} /></div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="panel">
          <h2 className="font-semibold">Deposit</h2>
          <p className="muted mt-1 text-xs">Mints shares at the last NAV ({m.price.toFixed(6)} {m.sym}/share). Minimum {fmtUnits(cfg.min_deposit, m.dec)} {m.sym}.</p>
          <div className="mt-3 flex gap-2">
            <input aria-label="Deposit amount" className="w-32" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            <span className="self-center text-sm">{m.sym}</span>
            <button className="btn btn-primary ml-auto" disabled={!accountId || st !== "active"} onClick={deposit}>Deposit</button>
          </div>
        </div>
        <div className="panel" data-testid="my-position">
          <h2 className="font-semibold">Your position</h2>
          {!accountId && asParam && <p className="muted text-xs">Viewing <code>{asParam}</code> read-only.</p>}
          {!viewer ? (
            <p className="muted mt-1 text-sm">Connect a wallet to see your shares.</p>
          ) : !mine ? (
            <p className="muted mt-1 text-sm">Reading…</p>
          ) : (
            <>
              <p className="mt-1 text-sm tabular-nums">
                {mine.shares.toLocaleString()} shares ≈ {fmtUnits((mine.shares * BigInt(vault.price)) / 10n ** 18n, m.dec)} {m.sym}
                {mine.locked > 0n && <span className="muted"> · {mine.locked.toLocaleString()} locked for withdrawal</span>}
              </p>
              <div className="mt-3 flex gap-2">
                <input aria-label="Shares to withdraw" className="w-40" placeholder={free.toString()} value={wShares} onChange={(e) => setWShares(e.target.value)} inputMode="numeric" />
                <button className="btn ml-auto" disabled={free <= 0n || st === "emergency"} onClick={withdraw}>Request withdrawal</button>
              </div>
              <PositionDetails id={data.id} viewer={viewer} vault={vault} cfg={cfg} dec={m.dec} sym={m.sym} claims={mine.claims} refresh={data} onDone={reload} />
            </>
          )}
        </div>
      </div>
      {msg && <p className="panel mt-3 text-sm" role="status">{msg}</p>}

      <h2 className="mt-8 font-semibold">NAV posts</h2>
      <p className="muted text-xs">Each post is signed by the operator&apos;s attestation key <code>{short(cfg.attestation_key, 8)}</code> and pins the head of its hash-chained fill log.</p>
      <div className="panel scroll-x mt-2 p-0">
        <table className="t" data-testid="nav-table">
          <thead><tr><th>Epoch</th><th>Time</th><th>Share price</th><th>Fee shares</th><th>Withdrawn</th><th>Fill log head</th><th>Sig</th></tr></thead>
          <tbody>
            {[...navs].reverse().map((n) => (
              <tr key={n.epoch}>
                <td>{n.epoch}</td>
                <td>{new Date(n.timestamp_ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{priceOf(n.price).toFixed(6)}</td>
                <td>{BigInt(n.fee_shares) > 0n ? BigInt(n.fee_shares).toLocaleString() : "–"}</td>
                <td>{BigInt(n.withdrawn) > 0n ? `${fmtUnits(n.withdrawn, m.dec)} ${m.sym}` : "–"}</td>
                <td><code className="text-xs">{short(n.fills_head, 6)}</code></td>
                <td>{m.v.bad.includes(n.epoch) ? <span className="neg">✗</span> : <span className="pos">✓</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted mt-3 text-xs">
        Contract <a href={`${NEAR_EXPLORER}/address/${data.id}`}>{data.id}</a> · confidential account (MPC-derived) <code>{vault.vault_account ? short(vault.vault_account, 8) : "–"}</code> · {vault.signals} leader signals recorded
      </p>
    </section>
  );
}
