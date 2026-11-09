"use client";
// Bring your track record: prove you own a public trading address, then show
// its Hyperliquid stats on your private vault's profile. Consent only.
import Link from "next/link";
import { useState } from "react";
import { hyperliquidStats, proofMessage, verifyProof, type HlStats, type TrackProof } from "@/lib/trackrecord";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const usd = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function Track() {
  const [vault, setVault] = useState("");
  const [address, setAddress] = useState("");
  const [signature, setSignature] = useState("");
  const [issued, setIssued] = useState(() => new Date().toISOString().slice(0, 19) + "Z");
  const [proof, setProof] = useState<TrackProof | null>(null);
  const [stats, setStats] = useState<HlStats | null | "none">(null);
  const [err, setErr] = useState<string | null>(null);
  const message = address ? proofMessage(vault, address, issued) : "";

  async function signWithWallet() {
    setErr(null);
    const eth = (window as unknown as { ethereum?: Eth }).ethereum;
    if (!eth) return setErr("No EVM wallet in this browser. Sign the message elsewhere and paste the signature.");
    try {
      const [a] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const now = new Date().toISOString().slice(0, 19) + "Z";
      setAddress(a);
      setIssued(now);
      const sig = (await eth.request({ method: "personal_sign", params: [proofMessage(vault, a, now), a] })) as string;
      setSignature(sig);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }

  async function verify() {
    setErr(null);
    setProof(null);
    setStats(null);
    const p: TrackProof = { vault: vault.trim(), address: address.trim().toLowerCase(), issued, message: proofMessage(vault.trim(), address.trim(), issued), signature: signature.trim() };
    if (!verifyProof(p)) return setErr("The signature doesn't match this message and address.");
    setProof(p);
    setStats((await hyperliquidStats(p.address).catch(() => null)) ?? "none");
  }

  return (
    <section className="max-w-2xl" data-testid="track">
      <h1>Bring your track record</h1>
      <p className="muted mt-1 text-sm">
        Already trading in public? Prove you own the address by signing one message. Your vault&apos;s page can then show that address&apos;s Hyperliquid record, while your new trades stay private. Nobody is listed without signing.
      </p>
      <div className="panel mt-4 space-y-3 text-sm">
        <label className="block">Your vault<input className="mt-1 w-full" placeholder="my-vault.near" value={vault} onChange={(e) => setVault(e.target.value)} data-testid="tr-vault" /></label>
        <button className="btn" disabled={!vault} onClick={signWithWallet}>Sign with an EVM wallet</button>
        <details>
          <summary className="muted cursor-pointer">Or sign elsewhere and paste</summary>
          <label className="mt-2 block">Address<input className="mt-1 w-full" value={address} onChange={(e) => setAddress(e.target.value)} data-testid="tr-address" /></label>
          <label className="mt-2 block">Issued<input className="mt-1 w-full" value={issued} onChange={(e) => setIssued(e.target.value)} data-testid="tr-issued" /></label>
          <label className="mt-2 block">Signature (personal_sign, 0x…)<input className="mt-1 w-full" value={signature} onChange={(e) => setSignature(e.target.value)} data-testid="tr-signature" /></label>
        </details>
        {message && <pre className="scroll-x text-xs" data-testid="tr-message">{message}</pre>}
        <button className="btn btn-primary" disabled={!signature || !address || !vault} onClick={verify} data-testid="tr-verify">Verify</button>
        {err && <p className="neg" role="status">{err}</p>}
      </div>
      {proof && (
        <div className="panel mt-4 text-sm" data-testid="tr-result">
          <p className="pos">✓ {proof.address} signed for {proof.vault}</p>
          {stats === "none" && <p className="muted mt-1">No Hyperliquid history for this address.</p>}
          {stats && stats !== "none" && (
            <div className="mt-2 grid grid-cols-2 gap-2 tabular-nums sm:grid-cols-4">
              <div><div className="muted text-xs">All-time PnL</div>{usd(stats.pnl)}</div>
              <div><div className="muted text-xs">Volume</div>{usd(stats.volume)}</div>
              <div><div className="muted text-xs">Account value</div>{usd(stats.accountValue)}</div>
              <div><div className="muted text-xs">Max drawdown</div>{(stats.maxDrawdown * 100).toFixed(1)}%</div>
            </div>
          )}
          <p className="mt-3">To show it on your vault, open a pull request adding this proof to <code>web/lib/track-proofs.ts</code>. Every visitor&apos;s browser re-checks the signature.</p>
          <pre className="scroll-x mt-2 text-xs">{JSON.stringify(proof, null, 2)}</pre>
        </div>
      )}
      <p className="muted mt-4 text-xs">Hyperliquid stats are read live from its public API. <Link href="/leaderboard/">Back to the leaderboard</Link></p>
    </section>
  );
}
