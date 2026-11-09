"use client";
import { useEffect, useState } from "react";
import { ASSETS, OPERATOR_API, TGAS, VAULTS } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { feeEarned, fmtUnits, priceOf, view, type SignalRec } from "@/lib/vault";
import { newSignalKey, publicKeyOf, randomNonce, signSignal, type Signal } from "@/lib/signal";
import { Redact, short, useQueryParam, useVault } from "../ui";
import { metaOf } from "@/lib/vaults";

const KEY_STORE = (vault: string) => `sp.signal-key.${vault}`;
const sym = (id: string) => ASSETS[id]?.symbol ?? id.replace(/^nep141:/, "");

function getLocalKey(vault: string): string | null {
  try {
    return localStorage.getItem(KEY_STORE(vault));
  } catch {
    return null;
  }
}

export default function LeaderConsole() {
  const q = useQueryParam("id");
  const id = q === undefined ? undefined : q ?? VAULTS[0];
  const { data } = useVault(id);
  const { accountId, call, signIn } = useWallet();
  const [onchainKey, setOnchainKey] = useState<string | null | undefined>(undefined);
  const [secret, setSecret] = useState<string | null>(null);
  const [signals, setSignals] = useState<SignalRec[]>([]);
  const [form, setForm] = useState({ from: "", to: "", pct: "25", type: "market" as "market" | "limit" | "target", limit: "" });
  // ?target=40: "move the vault to 40% NEAR" (from the IronClaw tool's tap-to-sign link)
  const targetParam = useQueryParam("target");
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string>("");

  useEffect(() => {
    if (!id) return;
    setSecret(getLocalKey(id));
    view<string | null>(id, "get_signal_key").then(setOnchainKey);
    view<SignalRec[]>(id, "get_signals", { from: 0, limit: 200 }).then(setSignals);
  }, [id, out]);
  useEffect(() => {
    if (data && !form.from) setForm((f) => ({ ...f, from: data.cfg.allowed_assets[0], to: data.cfg.allowed_assets[1] ?? data.cfg.allowed_assets[0] }));
  }, [data, form.from]);

  useEffect(() => {
    if (!data || !targetParam) return;
    const base = data.cfg.base_asset_id, risk = data.cfg.allowed_assets.find((a) => a !== base) ?? base;
    setForm((f) => ({ ...f, type: "target", from: base, to: risk, pct: targetParam }));
  }, [data, targetParam]);

  if (!id || !data) return <p className="muted">Reading vault…</p>;
  const isLeader = accountId === data.cfg.leader;
  const keyMatches = secret && onchainKey && publicKeyOf(secret) === onchainKey;
  const baseSym = sym(data.cfg.base_asset_id), baseDec = ASSETS[data.cfg.base_asset_id]?.decimals ?? 6;

  async function registerKey() {
    const k = newSignalKey();
    try {
      localStorage.setItem(KEY_STORE(id!), k.secret);
    } catch {
      return setOut({ ok: false, text: "This browser can't store the key (private mode?)." });
    }
    setSecret(k.secret);
    await call({ receiverId: id!, method: "set_signal_key", args: { public_key: k.publicKey }, gas: 30n * TGAS });
    setOnchainKey(await view<string | null>(id!, "get_signal_key"));
  }

  function build(): Signal | string {
    const bps = Math.round(Number(form.pct) * 100);
    if (form.from === form.to) return "Pick two different assets.";
    if (form.type === "target") {
      if (!(bps >= 0 && bps <= 10_000)) return "Target weight must be 0–100%.";
      return { v: 1, vault: id!, from: form.from, to: form.to, size_bps: 10_000, type: "target", target_bps: bps, nonce: randomNonce(), created_ms: Date.now() };
    }
    if (!(bps >= 1 && bps <= 10_000)) return "Size must be between 0.01% and 100% of NAV.";
    if (form.type === "limit" && !/^\d+(\.\d+)?$/.test(form.limit)) return "Enter a limit price.";
    return { v: 1, vault: id!, from: form.from, to: form.to, size_bps: bps, type: form.type, ...(form.type === "limit" ? { limit_price: form.limit, expires_ms: Date.now() + 24 * 3600_000 } : {}), nonce: randomNonce(), created_ms: Date.now() };
  }

  async function send() {
    setOut(null);
    const s = build();
    if (typeof s === "string") return setOut({ ok: false, text: s });
    const env = signSignal(s, secret!);
    setPreview(JSON.stringify(env, null, 2));
    try {
      const r = await fetch(`${OPERATOR_API}/v1/signals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(env) });
      const j = await r.json();
      setOut(j.ok ? { ok: true, text: j.status === "pending" ? `Limit held by the operator. Signal ${short(j.hash, 8)}.` : `Executed for the whole vault. Signal ${short(j.hash, 8)}, fill ${short(j.fill, 8)}.` } : { ok: false, text: j.error });
    } catch (e) {
      setOut({ ok: false, text: `Operator unreachable at ${OPERATOR_API}: ${(e as Error).message}` });
    }
  }

  return (
    <section>
      <span className="eyebrow">Private desk</span>
      <h1 className="mt-2">{metaOf(id).name}</h1>
      <p className="muted mt-2 break-words text-sm">Leader console · vault <code>{id}</code> · leader <code>{data.cfg.leader}</code></p>

      <div className="stats mt-6" data-testid="desk">
        <div className="tile" data-testid="desk-key">
          <div className="tile-l">Signal key</div>
          <div className="tile-v">{keyMatches ? "Ready" : "Not ready"}</div>
          <div className="tile-h">{keyMatches ? "Signing in this browser" : onchainKey ? "Registered on the vault, not in this browser" : "Register one to sign"}</div>
        </div>
        <div className="tile" data-testid="desk-fee">
          <div className="tile-l">Fee earned above high-water mark</div>
          <div className="tile-v">{fmtUnits(feeEarned(data.navs), baseDec)} {baseSym}</div>
          <div className="tile-h">paid in vault shares · mark {priceOf(data.vault.hwm).toFixed(4)}</div>
        </div>
        <div className="tile" data-testid="desk-private">
          <div className="tile-l">Your book</div>
          <div className="tile-v"><Redact widths={[72, 40]} h={18} label="Your positions are sealed" /></div>
          <div className="tile-h">Your positions are visible only to you and the operator that fills them. They never go on chain.</div>
        </div>
      </div>

      {!accountId && <div className="panel mt-4 text-sm">Connect the leader&apos;s wallet to manage the signal key. <button className="btn ml-2" onClick={signIn}>Connect</button></div>}
      {accountId && !isLeader && <div className="panel mt-4 text-sm">Signed in as <code>{accountId}</code>, who is not this vault&apos;s leader. Signals are only accepted from the leader&apos;s registered key.</div>}

      <div className="panel mt-4" data-testid="signal-key">
        <h2 className="font-semibold">Signal key</h2>
        <p className="muted mt-1 text-xs">
          Signals are signed in this browser with a key your NEAR account registers on the vault (<code>set_signal_key</code>, one wallet transaction). The operator checks the signature, and the contract checks it again when it records the signal.
        </p>
        <p className="mt-2 text-sm">
          On the vault: <code>{onchainKey === undefined ? "…" : onchainKey ? short(onchainKey, 8) : "none"}</code>
          {" · "}In this browser: <code>{secret ? short(publicKeyOf(secret), 8) : "none"}</code>
          {keyMatches ? <span className="chip chip-ok ml-2">ready</span> : <span className="chip chip-warn ml-2">not ready</span>}
        </p>
        {isLeader && !keyMatches && <button className="btn btn-primary mt-3" onClick={registerKey}>Create and register a signal key</button>}
      </div>

      <div className="panel mt-4" data-testid="signal-form">
        <h2 className="font-semibold">Send a signal</h2>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-5">
          <label className="flex flex-col gap-1">Sell
            <select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>{data.cfg.allowed_assets.map((a) => <option key={a} value={a}>{sym(a)}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1">Buy
            <select value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>{data.cfg.allowed_assets.map((a) => <option key={a} value={a}>{sym(a)}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1">{form.type === "target" ? `Target weight of ${sym(form.to)}, %` : "Size, % of NAV"}
            <input aria-label="Size percent of NAV" value={form.pct} onChange={(e) => setForm({ ...form, pct: e.target.value })} inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">Order
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "market" | "limit" | "target" })} data-testid="order-type"><option value="market">Market</option><option value="limit">Limit</option><option value="target">Target weight</option></select>
          </label>
          <label className="flex flex-col gap-1">Limit ({sym(form.to)} per {sym(form.from)})
            <input aria-label="Limit price" disabled={form.type !== "limit"} value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} inputMode="decimal" />
          </label>
        </div>
        <button className="btn btn-primary mt-3" disabled={!keyMatches} onClick={send}>Sign and send</button>
        <p className="muted mt-2 text-xs">One confidential 1Click quote fills the whole vault at one price. Max slippage {data.cfg.max_slippage_bps / 100}%. A limit order waits in the operator until the price crosses (24h expiry).</p>
        {out && <p className={`mt-2 text-sm ${out.ok ? "pos" : "neg"}`} role="status">{out.text}</p>}
        {preview && <details className="mt-2 text-xs"><summary className="muted">Signed envelope</summary><pre className="scroll-x">{preview}</pre></details>}
      </div>

      <h2 className="mt-8">Recorded signals</h2>
      <p className="muted text-xs">Hashes only, recorded after execution. The trades themselves stay private.</p>
      <div className="panel scroll-x mt-2 p-0">
        <table className="t" data-testid="signals-table">
          <thead><tr><th>#</th><th>Trade</th><th>Signal hash</th><th>Fill record</th><th>Executed</th><th>Epoch</th></tr></thead>
          <tbody>
            {signals.length === 0 && <tr><td colSpan={6} className="muted">None yet.</td></tr>}
            {[...signals].reverse().map((s) => (
              <tr key={s.index}><td>{s.index}</td><td><Redact widths={[56, 28]} h={12} label="Trade sealed" /></td><td><code className="text-xs">{short(s.hash, 8)}</code></td><td><code className="text-xs">{short(s.fill_hash, 8)}</code></td><td>{new Date(s.executed_ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td><td>{s.epoch}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
