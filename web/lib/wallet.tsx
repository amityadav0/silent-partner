"use client";
// Wallet selector: exactly MyNearWallet and Meteor (carried over from ~/scope/web).
// No access key is requested at sign-in, so this site never holds a key that
// could move funds: every deposit and withdrawal is confirmed in the wallet.
import { track } from "./funnel";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { NETWORK, RPC, TGAS } from "./config";

/** One function call, confirmed in the wallet: to a vault or to its base token. */
export type OwnerCall = { receiverId: string; method: string; args: Record<string, unknown>; deposit?: bigint; gas?: bigint };

type Ctx = {
  ready: boolean;
  accountId: string | null;
  signIn: () => void;
  signOut: () => Promise<void>;
  /** Sends one owner call. Browser-redirect wallets (MyNearWallet) navigate away and come back with ?transactionHashes=. */
  call: (c: OwnerCall) => Promise<string | null>;
  /** Several function calls to one contract in one transaction (one wallet confirmation). */
  callMany: (receiverId: string, calls: Omit<OwnerCall, "receiverId">[]) => Promise<string | null>;
  /** Several transactions, confirmed once in the wallet and sent in order. */
  sendMany: (txs: { receiverId: string; calls: Omit<OwnerCall, "receiverId">[] }[]) => Promise<string[]>;
};

const WalletCtx = createContext<Ctx>({ ready: false, accountId: null, signIn: () => {}, signOut: async () => {}, call: async () => null, callMany: async () => null, sendMany: async () => [] });
export const useWallet = () => useContext(WalletCtx);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const [{ setupWalletSelector }, { setupModal }, { setupMyNearWallet }, { setupMeteorWallet }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
      ]);
      const network =
        NETWORK === "mainnet"
          ? { networkId: "mainnet", nodeUrl: RPC, helperUrl: "https://helper.mainnet.near.org", explorerUrl: "https://nearblocks.io", indexerUrl: "https://api.kitwallet.app" }
          : { networkId: "testnet", nodeUrl: RPC, helperUrl: "https://helper.testnet.near.org", explorerUrl: "https://testnet.nearblocks.io", indexerUrl: "https://testnet-api.kitwallet.app" };
      const s = await setupWalletSelector({ network, modules: [setupMyNearWallet(), setupMeteorWallet()] });
      setSelector(s);
      setModal(setupModal(s, { theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light", description: "Silent Partner signs nothing for you. Your wallet confirms every deposit and withdrawal." }));
      const sub = s.store.observable.subscribe((st) => setAccountId(st.accounts.find((a) => a.active)?.accountId ?? null));
      // A2: one aggregate count per new sign-in (not per restored session); nothing about the account.
      const onIn = () => track("wallet_connect");
      s.on("signedIn", onIn);
      unsub = () => {
        sub.unsubscribe();
        s.off("signedIn", onIn);
      };
    })().catch((e) => console.error("wallet selector", e));
    return () => unsub?.();
  }, []);

  const call = useCallback(
    async (c: OwnerCall) => {
      if (!selector) throw new Error("wallet not ready");
      const [{ actionCreators }] = await Promise.all([import("@near-wallet-selector/core")]);
      const wallet = await selector.wallet();
      const deposit = c.deposit ?? 0n;
      const out = await wallet.signAndSendTransaction({
        receiverId: c.receiverId,
        actions: [actionCreators.functionCall(c.method, c.args, c.gas ?? 50n * TGAS, deposit)],
      });
      return (out as { transaction?: { hash?: string } } | undefined)?.transaction?.hash ?? null;
    },
    [selector],
  );

  const callMany = useCallback(
    async (receiverId: string, calls: Omit<OwnerCall, "receiverId">[]) => {
      if (!selector) throw new Error("wallet not ready");
      const [{ actionCreators }] = await Promise.all([import("@near-wallet-selector/core")]);
      const wallet = await selector.wallet();
      const out = await wallet.signAndSendTransaction({ receiverId, actions: calls.map((c) => actionCreators.functionCall(c.method, c.args, c.gas ?? 50n * TGAS, c.deposit ?? 0n)) });
      return (out as { transaction?: { hash?: string } } | undefined)?.transaction?.hash ?? null;
    },
    [selector],
  );

  const sendMany = useCallback(
    async (txs: { receiverId: string; calls: Omit<OwnerCall, "receiverId">[] }[]) => {
      if (!selector) throw new Error("wallet not ready");
      const [{ actionCreators }] = await Promise.all([import("@near-wallet-selector/core")]);
      const wallet = await selector.wallet();
      const out = await wallet.signAndSendTransactions({
        transactions: txs.map((t) => ({ receiverId: t.receiverId, actions: t.calls.map((c) => actionCreators.functionCall(c.method, c.args, c.gas ?? 50n * TGAS, c.deposit ?? 0n)) })),
      });
      return ((out ?? []) as { transaction?: { hash?: string } }[]).map((o) => o.transaction?.hash ?? "");
    },
    [selector],
  );

  const value = useMemo<Ctx>(
    () => ({
      ready: Boolean(selector),
      accountId,
      signIn: () => modal?.show(),
      signOut: async () => {
        if (selector) await (await selector.wallet()).signOut();
      },
      call,
      callMany,
      sendMany,
    }),
    [selector, modal, accountId, call, callMany, sendMany],
  );
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

/** The account a page shows: `?owner=` (read-only view) or the signed-in wallet. */
export function useOwner(): { owner: string | null; readOnly: boolean } {
  const { accountId } = useWallet();
  const [q, setQ] = useState<string | null>(null);
  useEffect(() => setQ(new URLSearchParams(window.location.search).get("owner")), []);
  if (q && q !== accountId) return { owner: q, readOnly: true };
  return { owner: accountId, readOnly: false };
}

/** Tx hashes a redirect wallet appended on return, if any. */
export function useReturnedTx(): { hashes: string[]; error: string | null } {
  const [v, setV] = useState<{ hashes: string[]; error: string | null }>({ hashes: [], error: null });
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setV({ hashes: (p.get("transactionHashes") ?? "").split(",").filter(Boolean), error: p.get("errorCode") ? `${p.get("errorCode")}: ${decodeURIComponent(p.get("errorMessage") ?? "")}` : null });
  }, []);
  return v;
}
