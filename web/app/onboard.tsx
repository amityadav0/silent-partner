"use client";
// Zero-friction testnet onboarding (V6): right after a testnet wallet connects, one button mints
// 100 test USDC (registering the account on the token in the same confirmation), a faucet link
// covers fees, and the next step is a real follow. Hidden once the wallet has both.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { NETWORK, TGAS } from "@/lib/config";
import { COPY_DEFAULT } from "@/lib/copy";
import { rpc, view } from "@/lib/vault";
import { useWallet } from "@/lib/wallet";

export const TEST_USDC = "usdc.fakes.testnet";
export const FAUCET = "https://near-faucet.io/";
const NEED_USDC = 100_000_000n; // 100 USDC (6 decimals)
const NEED_NEAR = 5n * 10n ** 23n; // ~0.5 NEAR covers storage and a handful of follows

export function Onboard() {
  const { accountId, callMany } = useWallet();
  const [bal, setBal] = useState<{ usdc: bigint; near: bigint; registered: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return setBal(null);
    const [usdc, reg, acct] = await Promise.all([
      view<string>(TEST_USDC, "ft_balance_of", { account_id: accountId }).catch(() => "0"),
      view<unknown>(TEST_USDC, "storage_balance_of", { account_id: accountId }).catch(() => null),
      rpc({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "optimistic", account_id: accountId } }).then((r) => r.json()).catch(() => null),
    ]);
    setBal({ usdc: BigInt(usdc ?? "0"), near: BigInt(acct?.result?.amount ?? "0"), registered: !!reg });
  }, [accountId]);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem("sp.onboard.hidden") === "1");
    } catch {
      /* show it */
    }
    load();
  }, [load]);

  if (NETWORK !== "testnet" || !accountId || !bal || hidden) return null;
  const needUsdc = bal.usdc < NEED_USDC;
  const needNear = bal.near < NEED_NEAR;
  if (!needUsdc && !needNear && !msg) return null;

  async function mint() {
    setBusy(true);
    setMsg(null);
    try {
      const calls = [
        ...(bal!.registered ? [] : [{ method: "storage_deposit", args: { account_id: accountId }, deposit: 1_250_000_000_000_000_000_000n, gas: 30n * TGAS }]),
        { method: "mint", args: { account_id: accountId, amount: NEED_USDC.toString() }, gas: 30n * TGAS },
      ];
      const tx = await callMany(TEST_USDC, calls);
      setMsg(tx ? "100 test USDC is in your wallet. Next: follow a leader for real." : "Confirm it in your wallet.");
      load();
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap" data-testid="onboard">
      <div className="panel onboard">
        <span className="eyebrow">Start on testnet: free, under a minute</span>
        <div className="flex flex-wrap items-center gap-2">
          {needUsdc && (
            <button className="btn btn-primary" disabled={busy || needNear} onClick={mint} data-testid="onboard-mint">
              {busy ? "Minting…" : "Get 100 test USDC"}
            </button>
          )}
          {needNear && (
            <span className="text-sm" data-testid="onboard-faucet">
              You need ~0.5 testnet NEAR for fees → <a href={FAUCET} target="_blank" rel="noopener noreferrer">get it free from the faucet</a>, then come back.
            </span>
          )}
          {!needUsdc && !needNear && (
            <Link href={`/vault/?id=${COPY_DEFAULT}`} className="btn btn-primary" data-testid="onboard-follow">Follow Contrarian for real</Link>
          )}
          <button
            className="quiet ml-auto text-sm"
            onClick={() => {
              setHidden(true);
              try {
                localStorage.setItem("sp.onboard.hidden", "1");
              } catch {
                /* this visit only */
              }
            }}
          >
            Hide
          </button>
        </div>
        {msg && <p className="text-sm" role="status">{msg}</p>}
      </div>
    </div>
  );
}
