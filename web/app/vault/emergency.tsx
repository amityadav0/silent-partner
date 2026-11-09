"use client";
// Emergency mode, from the holder's side. No operator and no 1Click needed:
// trigger → exit at the last NAV → the vault's MPC key signs a payout of the
// claim from the vault's public intents balance → execute it on the verifier →
// withdraw to the wallet → mark it paid. Each step is one wallet transaction.
import { useEffect, useState } from "react";
import { TGAS } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { emergencyExitValue, fmtUnits, openOfClaim, publicPayoutPayload, signatureFromLogs, txOutcome, type Claim, type Config, type VaultView } from "@/lib/vault";
import { base58 } from "@scure/base";

type Flow = { claim: number; payload: { message: string; nonce: string; recipient: string }; signTx?: string; signature?: string; executed?: string; withdrawn?: string };
const KEY = (vault: string, claim: number) => `sp.payout.${vault}.${claim}`;
const load = (vault: string, claim: number): Flow | null => {
  try { return JSON.parse(localStorage.getItem(KEY(vault, claim)) ?? "null"); } catch { return null; }
};
const save = (vault: string, f: Flow) => {
  try { localStorage.setItem(KEY(vault, f.claim), JSON.stringify(f)); } catch { /* private mode: flow still works within the page */ }
};

export function EmergencyBanner({ id, vault, cfg, shares, dec, sym, onDone }: { id: string; vault: VaultView; cfg: Config; shares: bigint; dec: number; sym: string; onDone: () => void }) {
  const { accountId, call } = useWallet();
  const [msg, setMsg] = useState<string | null>(null);
  if (!vault.emergency && !vault.stale) return null;
  const run = async (f: () => Promise<string | null>, ok: string) => {
    setMsg(null);
    try { const tx = await f(); setMsg(tx ? `${ok} Tx ${tx}.` : "Sent to your wallet."); onDone(); } catch (e) { setMsg(String((e as Error).message ?? e)); }
  };
  const value = emergencyExitValue(shares, vault.book_nav, vault.total_shares);
  return (
    <div className={`panel mt-4 ${vault.emergency ? "panel-bad" : "panel-warn"}`} data-testid="emergency">
      {vault.emergency ? (
        <>
          <h2 className="font-semibold">Emergency mode</h2>
          <p className="mt-1 text-sm">
            No NAV was posted within the timeout, so this vault is in emergency mode for good. Deposits are refunded. Every holder can exit at the last NAV,
            pro rata, and pay themselves out from the vault&apos;s public intents balance. Neither the operator nor 1Click is needed.
          </p>
          {shares > 0n && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-sm tabular-nums">Your {shares.toLocaleString()} shares → claim of about <b>{fmtUnits(value, dec)} {sym}</b></span>
              <button className="btn btn-primary ml-auto" data-testid="emergency-exit" disabled={!accountId} onClick={() => run(() => call({ receiverId: id, method: "emergency_exit", args: { exit_account: accountId }, gas: 50n * TGAS }), "Exited: your claim is open below.")}>Exit at last NAV</button>
            </div>
          )}
          {!accountId && <p className="muted mt-2 text-sm">Connect a wallet to exit.</p>}
        </>
      ) : (
        <>
          <h2 className="font-semibold">NAV is stale</h2>
          <p className="mt-1 text-sm">The operator hasn&apos;t posted a NAV within the timeout. Deposits are paused. Anyone can now switch the vault to emergency mode, which lets holders exit without the operator.</p>
          <button className="btn mt-3" data-testid="trigger-emergency" disabled={!accountId} onClick={() => run(() => call({ receiverId: id, method: "trigger_emergency", args: {}, gas: 50n * TGAS }), "Emergency mode on.")}>Trigger emergency</button>
        </>
      )}
      {msg && <p className="mt-2 text-sm" role="status">{msg}</p>}
    </div>
  );
}

/** Self-service payout of one emergency claim, in four wallet steps. */
export function EmergencyPayout({ id, vault, cfg, claim, dec, sym, onDone }: { id: string; vault: VaultView; cfg: Config; claim: Claim; dec: number; sym: string; onDone: () => void }) {
  const { accountId, call } = useWallet();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const verifier = cfg.intents_contract ?? "intents.near";
  useEffect(() => setFlow(load(id, claim.id)), [id, claim.id]);
  const open = openOfClaim(claim);
  const paid = BigInt(claim.paid) >= BigInt(claim.amount);
  const update = (f: Flow) => { save(id, f); setFlow(f); };
  const step = async (f: () => Promise<void>) => {
    setMsg(null);
    try { await f(); onDone(); } catch (e) { setMsg(String((e as Error).message ?? e)); }
  };

  async function sign() {
    const payload = publicPayoutPayload(vault.vault_account!, claim.exit_account, cfg.base_asset_id, open.toString(), verifier, Date.now(), crypto.getRandomValues(new Uint8Array(32)));
    update({ claim: claim.id, payload });
    const tx = await call({ receiverId: id, method: "sign_intent", args: { kind: { PublicPayout: { claim_id: claim.id } }, payload, quote: null }, gas: 300n * TGAS });
    if (!tx) return setMsg("Sent to your wallet. Come back to this page after confirming.");
    const o = await txOutcome(tx, accountId!);
    const signature = signatureFromLogs(o.logs);
    if (!signature) throw new Error(`The vault refused or MPC failed (tx ${tx}).`);
    update({ claim: claim.id, payload, signTx: tx, signature });
  }
  async function execute() {
    const pk = "ed25519:" + base58.encode(Uint8Array.from(vault.vault_account!.match(/../g)!.map((h) => parseInt(h, 16))));
    const tx = await call({ receiverId: verifier, method: "execute_intents", args: { signed: [{ standard: "nep413", payload: flow!.payload, public_key: pk, signature: flow!.signature }] }, gas: 300n * TGAS });
    update({ ...flow!, executed: tx ?? "sent" });
  }
  async function withdraw() {
    const amount = JSON.parse(flow!.payload.message).intents[0].tokens[cfg.base_asset_id] as string;
    const tx = await call({ receiverId: verifier, method: "ft_withdraw", args: { token: cfg.base_token, receiver_id: claim.exit_account, amount }, deposit: 1n, gas: 100n * TGAS });
    update({ ...flow!, withdrawn: tx ?? "sent" });
  }
  async function settle() {
    const f = claim.in_flight[0];
    if (!f) throw new Error("no payout in flight");
    await call({ receiverId: id, method: "settle_payout", args: { claim_id: claim.id, prehash: f.prehash }, gas: 60n * TGAS });
  }

  if (paid) return <span className="chip chip-ok">paid</span>;
  const mine = accountId === claim.account;
  const steps: [string, boolean, () => Promise<void>, boolean][] = [
    ["1. Vault signs the payout", !!flow?.signature || claim.in_flight.length > 0, sign, open > 0n && mine],
    ["2. Execute on the verifier", !!flow?.executed, execute, !!flow?.signature && !flow?.executed],
    ["3. Withdraw to wallet", !!flow?.withdrawn, withdraw, !!flow?.executed && !flow?.withdrawn],
    ["4. Settle on-chain", false, settle, claim.in_flight.length > 0],
  ];
  return (
    <div className="mt-2" data-testid={`payout-${claim.id}`}>
      <div className="flex flex-wrap gap-2">
        {steps.map(([label, done, f, enabled]) => (
          <button key={label} className={`btn text-xs ${done ? "opacity-60" : ""}`} disabled={!accountId || done || !enabled} onClick={() => step(f)}>
            {done ? "✓ " : ""}{label}
          </button>
        ))}
      </div>
      <p className="muted mt-1 text-xs">Pays {fmtUnits(open > 0n ? open : 0n, dec)} {sym} from the vault&apos;s public intents balance to <code>{claim.exit_account}</code>. Step 1 is for the claimant. Anyone may run steps 2–4. Settling asks the verifier whether the payout executed, so nobody has to vouch for it.</p>
      {msg && <p className="neg mt-1 text-xs" role="status">{msg}</p>}
    </div>
  );
}
