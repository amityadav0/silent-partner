"use client";
// Partner letters: notes from the leader that only current followers can read.
// The public sees how many there are, redacted. A follower creates a reading key in
// this browser (one transaction registers its public half); the leader's browser
// wraps each letter's key for every registered reader who holds shares.
import { useCallback, useEffect, useState } from "react";
import { REGISTRY, newReadingKey, openLetter, readingPk, sealLetter, type Letter, type Reader } from "@/lib/community";
import { TGAS } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { view } from "@/lib/vault";
import { Redact } from "../ui";

const KEY = (vault: string, account: string) => `sp.reading-key.${vault}.${account}`;
const getKey = (vault: string, account: string) => {
  try {
    return localStorage.getItem(KEY(vault, account));
  } catch {
    return null;
  }
};
const when = (ms: string) => new Date(Number(ms)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function useLetters(vault: string) {
  const [letters, setLetters] = useState<Letter[] | null>(null);
  const [readers, setReaders] = useState<Reader[]>([]);
  const load = useCallback(() => {
    view<Letter[]>(REGISTRY, "get_letters", { vault }).then(setLetters, () => setLetters([]));
    view<Reader[]>(REGISTRY, "get_readers", { vault }).then(setReaders, () => setReaders([]));
  }, [vault]);
  useEffect(load, [load]);
  return { letters, readers, reload: load };
}

export function Letters({ vault }: { vault: string }) {
  const { accountId, call } = useWallet();
  const { letters, readers, reload } = useLetters(vault);
  const [opened, setOpened] = useState<Record<number, string | null>>({});
  const [err, setErr] = useState<string | null>(null);
  const sk = accountId ? getKey(vault, accountId) : null;
  const mine = accountId ? readers.find((r) => r.account === accountId) : undefined;
  const keyHere = !!(sk && mine && readingPk(sk) === mine.key);

  useEffect(() => {
    if (!letters || !accountId || !sk || !keyHere) return;
    Promise.all(letters.map(async (l) => [l.id, await openLetter(l.sealed, vault, accountId, sk).catch(() => null)] as const)).then((xs) => setOpened(Object.fromEntries(xs)));
  }, [letters, accountId, sk, keyHere, vault]);

  async function register() {
    setErr(null);
    const k = newReadingKey();
    try {
      localStorage.setItem(KEY(vault, accountId!), k.sk);
    } catch {
      return setErr("This browser can't keep a key (private mode?).");
    }
    try {
      await call({ receiverId: REGISTRY, method: "register_reader", args: { vault, key: k.pk }, deposit: 10_000_000_000_000_000_000_000n, gas: 30n * TGAS });
      reload();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }

  const n = letters?.length ?? 0;
  return (
    <div className="panel flex flex-col gap-3" data-testid="letters">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>Partner letters</h2>
        <span className="muted text-sm" data-testid="letter-count">{letters === null ? "…" : `${n} letter${n === 1 ? "" : "s"}`}</span>
      </div>
      <p className="muted text-sm leading-normal">Notes from the leader, readable only by the followers holding shares when each was written. Everyone else sees that they exist.</p>
      <ul className="m-0 flex list-none flex-col p-0">
        {letters?.slice().reverse().map((l) => (
          <li key={l.id} className="row-kv" data-testid={`letter-${l.id}`}>
            <span className="num">{when(l.posted_ms)}</span>
            {opened[l.id] ? <span className="whitespace-pre-wrap text-left" style={{ color: "var(--ink)", maxWidth: "60ch" }}>{opened[l.id]}</span> : <span><Redact widths={[120, 64]} label="Letter sealed" /></span>}
          </li>
        ))}
      </ul>
      {accountId && !keyHere && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn text-sm" onClick={register} data-testid="reader-register">{mine ? "Create a reading key in this browser" : "Read letters: create a reading key"}</button>
          <span className="muted text-xs">One transaction (0.01 NEAR storage). Letters written after it are sealed for you while you hold shares.</span>
        </div>
      )}
      {err && <p className="neg text-sm" role="status">{err}</p>}
    </div>
  );
}

/** Leader console: write a letter, sealed in the browser for every registered reader who holds shares now. */
export function WriteLetter({ vault }: { vault: string }) {
  const { call } = useWallet();
  const { letters, readers, reload } = useLetters(vault);
  const [text, setText] = useState("");
  const [holders, setHolders] = useState<Reader[] | null>(null);
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    Promise.all(readers.map(async (r) => [r, BigInt((await view<[string, string]>(vault, "get_shares", { account_id: r.account }))[0]) > 0n] as const)).then((xs) => setHolders(xs.filter(([, h]) => h).map(([r]) => r)));
  }, [readers, vault]);
  async function post() {
    setOut(null);
    if (!text.trim() || !holders) return;
    try {
      const { sealed, text_hash } = await sealLetter(text.trim(), vault, holders);
      const tx = await call({ receiverId: REGISTRY, method: "post_letter", args: { vault, text_hash, readers: holders.length, sealed }, deposit: 200_000_000_000_000_000_000_000n, gas: 30n * TGAS });
      setOut({ ok: true, text: tx ? `Posted, sealed for ${holders.length} follower${holders.length === 1 ? "" : "s"}.` : "Sent to your wallet." });
      setText("");
      reload();
    } catch (e) {
      setOut({ ok: false, text: String((e as Error).message ?? e) });
    }
  }
  return (
    <div className="panel mt-4 flex flex-col gap-3" data-testid="write-letter">
      <h2>Partner letter</h2>
      <p className="muted text-sm">Explain your thinking to the people who back you, and nobody else. Sealed in this browser for the {holders?.length ?? "…"} registered follower{holders?.length === 1 ? "" : "s"} holding shares now; the chain keeps the ciphertext and the text&apos;s hash. {letters?.length ?? 0} posted so far.</p>
      <textarea rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Why I cut risk this week…" style={{ fontFamily: "var(--sans)" }} />
      <button className="btn btn-primary self-start" disabled={!text.trim() || !holders || holders.length === 0} onClick={post}>Seal and post (0.2 NEAR storage)</button>
      {holders?.length === 0 && <p className="muted text-xs">No follower has registered a reading key yet; they can from your vault page.</p>}
      {out && <p className={`text-sm ${out.ok ? "pos" : "neg"}`} role="status">{out.text}</p>}
    </div>
  );
}
