"use client";
// "Deposit from another chain": one step via 1Click, no bridging.
import { useState } from "react";
import { NETWORK } from "@/lib/config";
import { CHAINS, crossQuote, crossQuoteBody, type CrossQuote } from "@/lib/crosschain";
import { useWallet } from "@/lib/wallet";

/** On testnet the price, fee and ETA come from a real 1Click dry quote for the mainnet
 *  route; the vault is a testnet account, so the quote's recipient is a stand-in
 *  mainnet account and arrival is simulated as a paper follow. */
const TESTNET_STANDIN_RECIPIENT = "intents.near";

export function CrossChainDeposit({ vault, bookPrice, onSimulate }: { vault: string; bookPrice: number; onSimulate: (usdcArrived: number) => void }) {
  const { accountId } = useWallet();
  const [chain, setChain] = useState(CHAINS[0].id);
  const [amount, setAmount] = useState("100");
  const [refundTo, setRefundTo] = useState("");
  const [q, setQ] = useState<CrossQuote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = CHAINS.find((x) => x.id === chain)!;
  const mainnet = NETWORK === "mainnet";

  async function quote(dry: boolean) {
    setErr(null);
    setQ(null);
    const usdc = Number(amount);
    if (!(usdc >= 1)) return setErr("At least 1 USDC.");
    if (!dry && !accountId) return setErr("Connect your NEAR wallet: the shares are minted to that account.");
    if (!dry && !refundTo) return setErr(`Your ${c.name} address, for a refund if the route fails.`);
    setBusy(true);
    try {
      const body = crossQuoteBody({
        chain: c, usdc, dry, nowMs: Date.now(),
        vault: mainnet ? vault : TESTNET_STANDIN_RECIPIENT,
        beneficiary: accountId ?? "follower.near",
        refundTo: refundTo || c.placeholder,
      });
      setQ(await crossQuote(body));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const arrived = q ? Number(q.amountOut) / 1e6 : 0;
  return (
    <div className="panel" data-testid="crosschain">
      <h2 className="font-semibold">Deposit from another chain</h2>
      <p className="muted mt-1 text-sm">
        Send USDC on {CHAINS.map((x) => x.name).join(", ")}. 1Click delivers USDC on NEAR straight into this vault, and the vault mints the shares to your NEAR account. One step, no bridging.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select aria-label="Origin chain" value={chain} onChange={(e) => { setChain(e.target.value); setQ(null); }} data-testid="cc-chain">
          {CHAINS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <input aria-label="USDC amount" className="w-24" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setQ(null); }} />
        <span className="text-sm">USDC</span>
        <button className="btn ml-auto" disabled={busy} onClick={() => quote(true)} data-testid="cc-quote">{busy ? "Quoting…" : "Get a quote"}</button>
      </div>
      {mainnet && (
        <input aria-label="Refund address" className="mt-2 w-full" placeholder={`your ${c.name} address (${c.addressHint}) for refunds`} value={refundTo} onChange={(e) => setRefundTo(e.target.value)} />
      )}
      {q && (
        <div className="mt-3 text-sm" data-testid="cc-result">
          <p className="tabular-nums">
            {amount} USDC on {c.name} → <b>{q.amountOutFormatted} USDC</b> into the vault in ~{q.timeEstimate} s · fee {(Number(amount) - arrived).toFixed(4)} USDC · ≈ {(arrived / (bookPrice || 1)).toFixed(2)} shares at today&apos;s book price
          </p>
          <p className="muted text-xs">A real 1Click quote ({q.depositAddress ? "live" : "dry: nothing to send"}).</p>
          {q.depositAddress ? (
            <p className="mt-2">Send exactly {amount} USDC on {c.name} to <code className="break-all">{q.depositAddress}</code> before {new Date(q.deadline).toLocaleTimeString()}.</p>
          ) : mainnet ? (
            <button className="btn btn-primary mt-2" disabled={busy} onClick={() => quote(false)}>Get my deposit address</button>
          ) : (
            <button className="btn btn-primary mt-2" data-testid="cc-simulate" onClick={() => onSimulate(arrived)}>Simulate arrival (paper)</button>
          )}
          {!mainnet && <p className="muted mt-1 text-xs">Testnet: the price, fee and ETA are real, for the mainnet route. 1Click has no testnet, so arrival here starts a paper follow with the amount that would arrive.</p>}
        </div>
      )}
      {err && <p className="neg mt-2 text-sm" role="status">{err}</p>}
    </div>
  );
}
