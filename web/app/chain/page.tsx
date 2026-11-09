"use client";
// What the chain sees: one vault, three viewers. Observer and follower columns
// are read live from NEAR RPC. The leader/operator column comes from a fill log
// this site published for the demo (normally only the operator holds it) and is
// checked in your browser against every commitment the vault made on-chain.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ASSETS, BASE_PATH, NEAR_EXPLORER } from "@/lib/config";
import { checkDisclosure, holdings, type Check, type Disclosure } from "@/lib/disclosure";
import { fmtUnits, priceOf, view, type Claim, type SignalRec } from "@/lib/vault";
import { metaOf } from "@/lib/vaults";
import { ModeChip, short, useQueryParam, useVault } from "../ui";

const DEFAULT = "sp-manual-92991.testnet";
const DEFAULT_FOLLOWER = "sp-follower-60270.testnet";
type Position = { shares: string; locked: string; deposited: string; claimed: string };
const sym = (a: string) => ASSETS[a]?.symbol ?? short(a, 6);
const dec = (a: string) => ASSETS[a]?.decimals ?? 0;

function Row({ k, v, hint }: { k: string; v: React.ReactNode; hint?: string }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1 text-sm rule" title={hint}>
      <span className="muted">{k}</span>
      <span className="text-right tabular-nums">{v}</span>
    </div>
  );
}

export default function ChainPage() {
  const q = useQueryParam("id");
  const fq = useQueryParam("follower");
  const id = q === undefined ? undefined : q || DEFAULT;
  const follower = fq || DEFAULT_FOLLOWER;
  const { data, error } = useVault(id);
  const [extra, setExtra] = useState<{ publicBal: string | null; signals: SignalRec[]; claims: Claim[]; pos: Position | null } | null>(null);
  const [disc, setDisc] = useState<Disclosure | null | "none">(null);

  useEffect(() => {
    if (!data) return;
    const c = data.cfg, v = data.vault;
    Promise.all([
      c.intents_contract && v.vault_account ? view<string>(c.intents_contract, "mt_balance_of", { account_id: v.vault_account, token_id: c.base_asset_id }).catch(() => null) : Promise.resolve(null),
      view<SignalRec[]>(data.id, "get_signals", { from: 0, limit: 1000 }),
      view<Claim[]>(data.id, "get_claims", { from: 0, limit: 1000 }),
      view<Position>(data.id, "get_position", { account_id: follower }).catch(() => null),
    ]).then(([publicBal, signals, claims, pos]) => setExtra({ publicBal, signals, claims, pos }));
    fetch(`${BASE_PATH}/disclosures/${data.id}.json`).then((r) => (r.ok ? r.json() : "none")).then(setDisc, () => setDisc("none"));
  }, [data, follower]);

  const checks: Check[] | null = useMemo(() => (data && extra && disc && disc !== "none" ? checkDisclosure(disc, data.navs, extra.signals) : null), [data, extra, disc]);

  if (error) return <p className="neg">{error}</p>;
  if (!data) return <p className="muted">Reading vault from NEAR…</p>;
  const { vault, cfg, navs } = data;
  const b = cfg.base_asset_id, d = dec(b);
  const price = priceOf(vault.price);
  const pos = extra?.pos;
  const value = pos ? (BigInt(pos.shares) * BigInt(vault.price)) / 10n ** 18n : 0n;
  const pnl = pos ? value + BigInt(pos.claimed) - BigInt(pos.deposited) : 0n;
  const fills = disc && disc !== "none" ? disc.entries.filter((e) => e.kind === "fill") : [];
  const held = disc && disc !== "none" ? holdings(disc.entries, b) : null;
  const allOk = checks?.every((c) => c.ok);

  return (
    <section data-testid="chain">
      <h1 className="text-2xl font-semibold">What the chain sees</h1>
      <p className="muted mt-1 max-w-3xl text-sm">
        One vault, three viewers: <b>{metaOf(data.id).name}</b> <ModeChip id={data.id} /> <code className="text-xs">{data.id}</code>. The first two columns are live NEAR
        RPC reads. The third is private to the operator and leader. For this demo we published the vault&apos;s fill log, and your browser checks it against what the vault committed to on-chain.
      </p>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="panel" data-testid="observer">
          <h2 className="font-semibold">Observer</h2>
          <p className="muted text-xs">Anyone with an RPC endpoint.</p>
          <div className="mt-2">
            <Row k="Share price" v={price.toFixed(6)} />
            <Row k="Book NAV" v={`${fmtUnits(vault.book_nav, d)} ${sym(b)}`} hint="Exact, on-chain. The leaderboard shows only a bucket." />
            <Row k="Total shares" v={BigInt(vault.total_shares).toLocaleString()} />
            <Row k="Leader shares" v={`${((Number(vault.leader_shares) / Math.max(1, Number(vault.total_shares))) * 100).toFixed(1)}%`} />
            <Row k="NAV posts (signed)" v={navs.length} />
            <Row k="Signals (hash only)" v={extra?.signals.length ?? "…"} />
            <Row k="Claims" v={extra ? `${extra.claims.length} (amounts and exit accounts public)` : "…"} />
            <Row k="Allowed assets" v={cfg.allowed_assets.map(sym).join(", ")} />
            <Row k="Public intents balance" v={extra?.publicBal == null ? "–" : `${fmtUnits(extra.publicBal, d)} ${sym(b)}`} hint="mt_balance_of on the verifier for the vault's MPC account" />
          </div>
          <p className="mt-3 text-xs">
            <b>Sees:</b> who deposited and how much (NEP-141 transfers), share balances, every NAV with its fill-log head, signal hashes after execution, withdrawal claims.
          </p>
          <p className="mt-1 text-xs">
            <b>Doesn&apos;t see:</b> what the vault holds, its trades, signal contents, or any signal before it executes.
          </p>
          {metaOf(data.id).mode === "paper" && (
            <p className="muted mt-2 text-xs">
              Paper mode: shields and fills are paper entries, so the testnet funds stay in the vault&apos;s <i>public</i> intents balance, and the observer can read them. On mainnet they would be shielded into the confidential account on intents.far, and this line would read 0.
            </p>
          )}
        </div>

        <div className="panel" data-testid="follower">
          <h2 className="font-semibold">Follower</h2>
          <p className="muted text-xs">
            <code>{short(follower, 14)}</code>: their own position.{" "}
            <Link href={`/vault/?id=${data.id}&as=${follower}`}>open as this follower</Link>
          </p>
          {pos ? (
            <div className="mt-2">
              <Row k="Shares" v={BigInt(pos.shares).toLocaleString()} />
              <Row k="Value at book price" v={`${fmtUnits(value, d)} ${sym(b)}`} />
              <Row k="Deposited" v={`${fmtUnits(pos.deposited, d)} ${sym(b)}`} />
              <Row k="Withdrawn (claims)" v={`${fmtUnits(pos.claimed, d)} ${sym(b)}`} />
              <Row k="P&L" v={<span className={pnl >= 0n ? "pos" : "neg"}>{pnl >= 0n ? "+" : "−"}{fmtUnits(pnl >= 0n ? pnl : -pnl, d)} {sym(b)}</span>} />
            </div>
          ) : (
            <p className="muted mt-2 text-sm">{extra ? "This vault predates per-holder cost basis." : "Reading…"}</p>
          )}
          <p className="mt-3 text-xs">
            <b>Sees:</b> the same public data as the observer, plus the meaning of their own numbers. Note that their share balance is public too.
          </p>
          <p className="mt-1 text-xs">
            <b>Doesn&apos;t see:</b> holdings or trades. They gave the leader a mandate (allowed assets, 1% max slippage, 20% fee above the high-water mark), and the contract enforces it.
          </p>
        </div>

        <div className="panel" data-testid="leader">
          <h2 className="font-semibold">Leader &amp; operator</h2>
          <p className="muted text-xs">Private. Published here up to epoch {disc && disc !== "none" ? disc.upto_epoch : "–"} for the demo.</p>
          {disc === null && <p className="muted mt-2 text-sm">Loading disclosure…</p>}
          {disc === "none" && <p className="muted mt-2 text-sm">No disclosure published for this vault: only the operator has this view.</p>}
          {disc && disc !== "none" && held && (
            <>
              <div className="mt-2">
                {[...held.entries()].filter(([, x]) => x !== 0n).map(([a, x]) => <Row key={a} k={`Holds ${sym(a)}`} v={fmtUnits(x, dec(a), 4)} />)}
                <Row k="Fills" v={fills.length} />
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {fills.slice(-6).reverse().map((f) => (
                  <li key={f.hash} className="tabular-nums">
                    {new Date(f.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}: {fmtUnits(String(f.data.amount_in), dec(String(f.data.from)), 4)} {sym(String(f.data.from))} → {fmtUnits(String(f.data.amount_out), dec(String(f.data.to)), 4)} {sym(String(f.data.to))}
                    <span className="muted"> · paper, 1Click quote</span>
                  </li>
                ))}
              </ul>
              {disc.signals.length > 0 && (
                <p className="mt-2 text-xs">
                  Last signal: <code>{disc.signals.at(-1)!.signal.from === b ? "buy" : "sell"} {sym(disc.signals.at(-1)!.signal.from === b ? disc.signals.at(-1)!.signal.to : disc.signals.at(-1)!.signal.from)}, {disc.signals.at(-1)!.signal.size_bps / 100}% of NAV</code>
                  {disc.signals.at(-1)!.why && <span className="muted"> ({disc.signals.at(-1)!.why})</span>}
                </p>
              )}
              <h3 className="mt-3 text-sm font-semibold" data-testid="disclosure-verdict">
                {allOk ? <span className="pos">✓ Matches the chain</span> : checks ? <span className="neg">✗ Does not match</span> : "Checking…"}
              </h3>
              <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs" data-testid="checks">
                {checks?.map((c, i) => <li key={i} className={c.ok ? "" : "neg"}>{c.ok ? "✓" : "✗"} {c.label}{c.detail ? `: ${c.detail}` : ""}</li>)}
              </ul>
            </>
          )}
        </div>
      </div>
      <p className="muted mt-4 text-xs">
        Change the vault or follower with <code>?id=</code> and <code>?follower=</code>. Contract: <a href={`${NEAR_EXPLORER}/address/${data.id}`}>{data.id}</a>.
      </p>
    </section>
  );
}
