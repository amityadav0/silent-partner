"use client";
// The follow panel: amount and origin chain, copy stop-loss, the facts, then one
// primary action. From NEAR it deposits directly; from another chain 1Click
// delivers USDC into the vault in one step, no bridging.
import { useEffect, useState } from "react";
import { NETWORK, TGAS } from "@/lib/config";
import { CHAINS, crossQuote, crossQuoteBody, type CrossQuote } from "@/lib/crosschain";
import { useWallet } from "@/lib/wallet";
import { fmtUnits, toUnits, view, type VaultData } from "@/lib/vault";
import { PaperFollowPanel, usePaper } from "./paper";
import { CostBox, FollowTimeline } from "./costs";

/** On testnet the price, fee and ETA come from a real 1Click dry quote for the mainnet
 *  route; the vault is a testnet account, so the quote's recipient is a stand-in
 *  mainnet account and arrival is simulated as a paper follow. */
const TESTNET_STANDIN_RECIPIENT = "intents.near";
const NEAR_CHAIN = "near";
const STOP_PCT = 10;

// set_stop_loss needs shares, so it can only follow the deposit. The intent is kept
// across the wallet redirect and offered as the next step once the shares exist.
const PENDING = (vault: string) => `sp.pending-stop.${vault}`;
function readPending(vault: string) {
  try {
    return localStorage.getItem(PENDING(vault)) === "1";
  } catch {
    return false;
  }
}
function writePending(vault: string, on: boolean) {
  try {
    if (on) localStorage.setItem(PENDING(vault), "1");
    else localStorage.removeItem(PENDING(vault));
  } catch {
    /* private mode: the stop-loss can still be set under Your position */
  }
}

export function FollowPanel({ name, data, price, dec, sym, active, shares, paper, onDone }: { name: string; data: VaultData; price: number; dec: number; sym: string; active: boolean; shares: bigint; paper: ReturnType<typeof usePaper>; onDone: () => void }) {
  const { accountId, call, signIn } = useWallet();
  const { id, cfg, navs } = data;
  const [chain, setChain] = useState(NEAR_CHAIN);
  const [amount, setAmount] = useState("100");
  const [refundTo, setRefundTo] = useState("");
  const [q, setQ] = useState<CrossQuote | null>(null);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopOn, setStopOn] = useState(true);
  const [stopSupported, setStopSupported] = useState(false);
  const [offerStop, setOfferStop] = useState(false);
  const mainnet = NETWORK === "mainnet";
  const c = CHAINS.find((x) => x.id === chain);

  useEffect(() => {
    view(id, "get_stop_loss", { account_id: cfg.leader }).then(() => setStopSupported(true), () => setStopSupported(false)); // older vaults have no stop-loss
  }, [id, cfg.leader]);

  useEffect(() => {
    if (!accountId || shares <= 0n || !stopSupported || !readPending(id)) return setOfferStop(false);
    view<unknown>(id, "get_stop_loss", { account_id: accountId }).then((s) => {
      if (s) writePending(id, false);
      setOfferStop(!s);
    }, () => setOfferStop(false));
  }, [id, accountId, shares, stopSupported]);

  const showStop = stopSupported && accountId !== cfg.leader;
  // Invite credit (D-G-7): kept in this browser only, first touch wins.
  const [ref, setRef] = useState<string | null>(null);
  useEffect(() => {
    const k = `sp.ref.${id}`;
    try {
      const q = new URLSearchParams(window.location.search).get("ref");
      if (q && !localStorage.getItem(k)) localStorage.setItem(k, q);
      setRef(localStorage.getItem(k));
    } catch {
      setRef(new URLSearchParams(window.location.search).get("ref"));
    }
  }, [id]);

  async function follow() {
    setMsg(null);
    setQ(null);
    if (c) return quote(true);
    if (!accountId) return signIn();
    const units = toUnits(amount, dec);
    if (!units || units < BigInt(cfg.min_deposit)) return setMsg({ bad: true, text: `Minimum is ${fmtUnits(cfg.min_deposit, dec)} ${sym}.` });
    writePending(id, showStop && stopOn);
    try {
      setBusy(true);
      const tx = await call({ receiverId: cfg.base_token, method: "ft_transfer_call", args: { receiver_id: id, amount: units.toString(), msg: "" }, deposit: 1n, gas: 100n * TGAS });
      setMsg({ bad: false, text: tx ? `Deposited. Tx ${tx}. If the leader-stake or price-freshness rules refuse it, the deposit is refunded in the same transaction.` : "Sent to your wallet." });
      onDone();
    } catch (e) {
      writePending(id, false);
      setMsg({ bad: true, text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  async function quote(dry: boolean) {
    if (!c) return;
    setMsg(null);
    setQ(null);
    const usdc = Number(amount);
    if (!(usdc >= 1)) return setMsg({ bad: true, text: "At least 1 USDC." });
    if (!dry && !accountId) return setMsg({ bad: true, text: "Connect your NEAR wallet: the shares are minted to that account." });
    if (!dry && !refundTo) return setMsg({ bad: true, text: `Your ${c.name} address, for a refund if the route fails.` });
    setBusy(true);
    try {
      const body = crossQuoteBody({ chain: c, usdc, dry, nowMs: Date.now(), vault: mainnet ? id : TESTNET_STANDIN_RECIPIENT, beneficiary: accountId ?? "follower.near", refundTo: refundTo || c.placeholder });
      setQ(await crossQuote(body));
      writePending(id, showStop && stopOn);
    } catch (e) {
      setMsg({ bad: true, text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  async function confirmStop() {
    try {
      await call({ receiverId: id, method: "set_stop_loss", args: { drawdown_bps: STOP_PCT * 100, exit_account: accountId }, gas: 30n * TGAS });
      writePending(id, false);
      setOfferStop(false);
      onDone();
    } catch (e) {
      setMsg({ bad: true, text: String((e as Error).message ?? e) });
    }
  }

  const arrived = q ? Number(q.amountOut) / 1e6 : 0;
  return (
    <aside className="vault-aside" data-testid="follow-panel">
      <h2>Follow {name}</h2>
      {ref && <span className="muted -mt-3 text-[13px]" data-testid="invited-by">Invited by {ref}</span>}

      <div className="flex flex-col gap-2">
        <label htmlFor="follow-amount" className="muted text-sm">Amount</label>
        <div className="amount">
          <input id="follow-amount" value={amount} inputMode="decimal" onChange={(e) => { setAmount(e.target.value); setQ(null); }} />
          <span className="num muted">USDC</span>
        </div>
        <label className="muted mt-1 text-sm" htmlFor="follow-chain">From</label>
        <select id="follow-chain" aria-label="Origin chain" value={chain} onChange={(e) => { setChain(e.target.value); setQ(null); }} data-testid="cc-chain">
          <option value={NEAR_CHAIN}>NEAR</option>
          {CHAINS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {mainnet && c && <input aria-label="Refund address" placeholder={`your ${c.name} address (${c.addressHint}) for refunds`} value={refundTo} onChange={(e) => setRefundTo(e.target.value)} />}
        <span className="muted text-[13px]">{c ? "1Click delivers USDC into this vault in one step, no bridging." : `Minimum ${fmtUnits(cfg.min_deposit, dec)} ${sym}.`}</span>
      </div>

      {showStop && (
        <div className="stop-box">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-medium" id="stop-label">Copy stop-loss</span>
            <button className="switch" role="switch" aria-checked={stopOn} aria-labelledby="stop-label" onClick={() => setStopOn(!stopOn)} data-testid="stop-toggle"><span /></button>
          </div>
          <span className="muted text-[13px] leading-normal">The contract exits you automatically if the share price falls {STOP_PCT}% from when you set it. Your wallet confirms this once your deposit lands.</span>
        </div>
      )}

      <div data-testid="follow-facts">
        <div className="row-kv"><span>You enter at</span><span className="num">{price.toFixed(4)} / share</span></div>
        <div className="row-kv"><span>Copy slippage vs leader</span><span className="num pos">0.00%</span></div>
      </div>

      <CostBox feeBps={cfg.perf_fee_bps} quoteFee={q && c ? `${(Number(amount) - Number(q.amountOut) / 1e6).toFixed(4)} USDC` : null} />

      {offerStop && (
        <div className="stop-box" data-testid="stop-offer">
          <span className="text-sm font-medium">Last step: set your {STOP_PCT}% stop-loss.</span>
          <div className="flex flex-wrap gap-3">
            <button className="btn" onClick={confirmStop}>Confirm in wallet</button>
            <button className="quiet" onClick={() => { writePending(id, false); setOfferStop(false); }}>Not now</button>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-2">
        <button className="btn btn-primary btn-lg w-full" disabled={busy || (!c && !active)} onClick={follow} data-testid="follow-cta">{busy ? "Working…" : "Follow privately"}</button>
        {!c && !active && <span className="muted text-[13px]">Deposits are closed on this vault.</span>}
        <PaperFollowPanel navs={navs} paper={paper} />
        <a href="../partners/" className="quiet">All your partners, or blend several →</a>
      </div>

      <FollowTimeline times={navs.map((n) => n.timestamp_ms)} price={price} sym={sym} />

      {q && c && (
        <div className="text-sm" data-testid="cc-result">
          <p className="num text-[13px] leading-relaxed">
            {amount} USDC on {c.name} → <b>{q.amountOutFormatted} USDC</b> into the vault in ~{q.timeEstimate} s · fee {(Number(amount) - arrived).toFixed(4)} USDC · ≈ {(arrived / (price || 1)).toFixed(2)} shares at today&apos;s book price
          </p>
          <p className="muted mt-1 text-xs">A real 1Click quote ({q.depositAddress ? "live" : "dry: nothing to send"}).</p>
          {q.depositAddress ? (
            <p className="mt-2">Send exactly {amount} USDC on {c.name} to <code className="break-all">{q.depositAddress}</code> before {new Date(q.deadline).toLocaleTimeString()}.</p>
          ) : mainnet ? (
            <button className="btn btn-primary mt-2" disabled={busy} onClick={() => quote(false)}>Get my deposit address</button>
          ) : (
            <button className="btn mt-2" data-testid="cc-simulate" onClick={() => paper.start(navs.at(-1), Math.round(arrived * 100) / 100)}>Simulate arrival (paper)</button>
          )}
          {!mainnet && <p className="muted mt-2 text-xs">Testnet: the price, fee and ETA are real, for the mainnet route. 1Click has no testnet, so arrival here starts a simulated copy with the amount that would arrive.</p>}
        </div>
      )}
      {msg && <p className={`text-sm ${msg.bad ? "neg" : ""} break-words`} role="status">{msg.text}</p>}
    </aside>
  );
}
