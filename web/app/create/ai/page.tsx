"use client";
// Lead a vault: write a strategy in your own words (AI) or sign by hand, pick a risk
// band, launch on testnet. The strategy is sealed in this browser to the season
// operator; only its hash goes on chain. Followers see the style line you approve.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BANDS, LAUNCH_DEPOSIT_NEAR, MAX_PROMPT, NAME_RE, REGISTRY, SEASON_SIGNAL_PK, bounds, loadLaunches, promptHash, seal, suggestStyle, type Launch, type Risk } from "@/lib/community";
import { TGAS } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { view, type Config } from "@/lib/vault";
import { short } from "../../ui";

const NEAR = 10n ** 24n;
const EXAMPLE = "Hold NEAR when it's above its 24-hour average and momentum is positive; otherwise sit mostly in USDC. Max 60%. Cut to 20% if NEAR drops 5% in six hours.";
const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function LeadAVault() {
  const { accountId, call, signIn } = useWallet();
  const [kind, setKind] = useState<"ai" | "human">("ai");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [risk, setRisk] = useState<Risk>("med");
  const [style, setStyle] = useState("");
  const [styleTouched, setStyleTouched] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Launch[] | null>(null);

  const b = useMemo(() => (kind === "ai" ? bounds(text, risk) : BANDS[risk]), [kind, text, risk]);
  const hash = useMemo(() => (text.trim() ? promptHash(text.trim()) : ""), [text]);
  useEffect(() => {
    if (!styleTouched) setStyle(kind === "ai" && text.trim() ? suggestStyle(text, risk) : kind === "human" ? "Trades NEAR by hand" : "");
  }, [text, risk, kind, styleTouched]);

  const refresh = useCallback(() => {
    if (!accountId) return setMine(null);
    loadLaunches().then((ls) => setMine(ls.filter((l) => l.leader === accountId)), () => setMine([]));
  }, [accountId]);
  useEffect(refresh, [refresh]);

  const problems = [
    !NAME_RE.test(name) && "Name: 3–32 letters, digits, spaces, - or '.",
    kind === "ai" && !text.trim() && "Write your strategy.",
    kind === "ai" && text.length > MAX_PROMPT && `Strategy: at most ${MAX_PROMPT} characters.`,
    kind === "ai" && text.trim() && !b && "Your limits contradict the risk band: pick a higher band or change the numbers.",
    (!style.trim() || style.length > 140) && "Style line: 1–140 characters.",
  ].filter(Boolean) as string[];

  async function launch() {
    setMsg(null);
    if (!accountId) return signIn();
    if (problems.length) return setMsg({ bad: true, text: problems[0] });
    setBusy(true);
    try {
      const strategy = text.trim();
      const args = kind === "ai"
        ? { kind, name: name.trim(), style: style.trim(), risk, prompt_hash: promptHash(strategy), sealed_prompt: await seal(strategy, "launch") }
        : { kind, name: name.trim(), style: style.trim(), risk, prompt_hash: null, sealed_prompt: null };
      const tx = await call({ receiverId: REGISTRY, method: "launch", args, deposit: BigInt(LAUNCH_DEPOSIT_NEAR) * NEAR, gas: 50n * TGAS });
      setMsg({ bad: false, text: tx ? `Filed (tx ${tx}). The season deploys your vault at its next tick, within 15 minutes; the steps below then light up.` : "Sent to your wallet." });
      refresh();
    } catch (e) {
      setMsg({ bad: true, text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-8" data-testid="create-ai">
      <div className="flex max-w-3xl flex-col gap-3">
        <span className="eyebrow">Open season · testnet</span>
        <h1>Lead a vault</h1>
        <p className="text-lg leading-relaxed" style={{ color: "var(--ink-2)" }}>Write your strategy in plain words and an AI on NEAR AI Cloud trades it every 15 minutes, inside limits the code enforces. Or lead by hand. Your strategy stays sealed: followers see only the style line you approve.</p>
      </div>

      <div className="vault-grid">
        <div className="vault-main">
          <div className="panel flex flex-col gap-5">
            <div className="seg self-start" role="group" aria-label="Who leads">
              <button aria-pressed={kind === "ai"} onClick={() => setKind("ai")} data-testid="kind-ai">AI, from my words</button>
              <button aria-pressed={kind === "human"} onClick={() => setKind("human")} data-testid="kind-human">By hand</button>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Calm Owl" maxLength={32} data-testid="f-name" />
            </label>
            {kind === "ai" && (
              <label className="flex flex-col gap-2">
                <span className="flex justify-between text-sm font-medium"><span>Your strategy, in your words</span><span className="muted num">{text.length}/{MAX_PROMPT}</span></span>
                <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} data-testid="f-strategy" style={{ fontFamily: "var(--sans)" }} />
                {!text && <button className="quiet self-start" onClick={() => setText(EXAMPLE)}>Use the example</button>}
              </label>
            )}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Risk band</span>
              <div className="seg self-start flex-wrap" role="group" aria-label="Risk band" style={{ borderRadius: 24 }}>
                {(Object.keys(BANDS) as Risk[]).map((r) => <button key={r} aria-pressed={risk === r} onClick={() => setRisk(r)} data-testid={`f-risk-${r}`}>{BANDS[r].label}</button>)}
              </div>
              <span className={`text-sm ${b ? "muted" : "neg"}`} data-testid="bounds">
                {b ? <>NEAR weight enforced between <span className="num">{pct(b.min)}</span> and <span className="num">{pct(b.max)}</span>{kind === "ai" ? ", whatever the model says." : "."}</> : "Your limits contradict this band."}
              </span>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Style line: all that followers see</span>
              <input value={style} onChange={(e) => { setStyle(e.target.value); setStyleTouched(true); }} maxLength={140} data-testid="f-style" style={{ fontFamily: "var(--sans)" }} />
            </label>
          </div>

          <MyLaunches mine={mine} accountId={accountId} onDone={refresh} />
        </div>

        <aside className="vault-aside" data-testid="launch-panel">
          <h2>Launch on testnet</h2>
          <div>
            <div className="row-kv"><span>Leader</span><span className="break-all">{accountId ?? "connect a wallet"}</span></div>
            <div className="row-kv"><span>Deposit</span><span><span className="num">{LAUNCH_DEPOSIT_NEAR}</span> testnet NEAR</span></div>
            <div className="row-kv"><span>Your stake</span><span>at least 10%, from faucet USDC</span></div>
            <div className="row-kv"><span>Fee</span><span><span className="num">20%</span> above HWM</span></div>
            <div className="row-kv"><span>Limit</span><span><span className="num">2</span> vaults per account</span></div>
          </div>
          {kind === "ai" && (
            <div className="stop-box text-[13px] leading-normal" data-testid="sealed-note">
              <span className="font-medium">Your strategy is sealed in this browser.</span>
              <span className="muted">Only the season operator can open it. The chain gets its fingerprint:</span>
              <code className="break-all text-xs" data-testid="hash">{hash ? short(hash, 10) : "–"}</code>
            </div>
          )}
          <button className="btn btn-primary btn-lg w-full" disabled={busy} onClick={launch} data-testid="launch-btn">{busy ? "Working…" : accountId ? `Launch for ${LAUNCH_DEPOSIT_NEAR} NEAR` : "Connect a wallet to launch"}</button>
          {problems.length > 0 && accountId && <span className="muted text-[13px]" data-testid="problems">{problems[0]}</span>}
          {msg && <p className={`break-words text-sm ${msg.bad ? "neg" : ""}`} role="status">{msg.text}</p>}
          <p className="muted text-[13px] leading-normal">Testnet only: no real money. New to testnet? A new MyNearWallet testnet account comes with NEAR to spend. Want to deploy the contract yourself? <Link href="/create/">Use the full wizard</Link>.</p>
        </aside>
      </div>
    </section>
  );
}

/** After a launch: the season deploys it; the leader then signs one or two transactions. */
function MyLaunches({ mine, accountId, onDone }: { mine: Launch[] | null; accountId: string | null; onDone: () => void }) {
  if (!accountId || !mine) return null;
  return (
    <div className="panel flex flex-col gap-4" data-testid="my-launches">
      <h2>Your launches</h2>
      {mine.length === 0 && <p className="muted text-sm">None yet. Your first one appears here as soon as it&apos;s filed.</p>}
      {mine.map((l) => <LaunchSteps key={l.id} l={l} onDone={onDone} />)}
    </div>
  );
}

function LaunchSteps({ l, onDone }: { l: Launch; onDone: () => void }) {
  const { accountId, call, callMany } = useWallet();
  const [state, setState] = useState<{ signer: boolean; staked: boolean; cfg: Config } | null>(null);
  const [amount, setAmount] = useState("100");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (l.status !== "live" || !l.vault) return;
    Promise.all([view<string | null>(l.vault, "get_signal_key"), view<{ leader_shares: string }>(l.vault, "get_vault"), view<Config>(l.vault, "get_config")]).then(([k, v, cfg]) =>
      setState({ signer: l.kind === "human" || k === SEASON_SIGNAL_PK, staked: BigInt(v.leader_shares) > 0n, cfg }),
    );
  }, [l]);
  const run = async (f: () => Promise<unknown>) => {
    setErr(null);
    try {
      await f();
      onDone();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  };
  async function stake() {
    const cfg = state!.cfg;
    const units = BigInt(Math.round(Number(amount) * 1e6)).toString();
    const registered = await view(cfg.base_token, "storage_balance_of", { account_id: accountId });
    await callMany(cfg.base_token, [
      ...(registered ? [] : [{ method: "storage_deposit", args: { account_id: accountId }, deposit: 1_250_000_000_000_000_000_000n, gas: 30n * TGAS }]),
      { method: "mint", args: { account_id: accountId, amount: units }, gas: 30n * TGAS },
      { method: "ft_transfer_call", args: { receiver_id: l.vault, amount: units, msg: "" }, deposit: 1n, gas: 150n * TGAS },
    ]);
  }
  const step = (n: number, done: boolean, label: string, action?: React.ReactNode) => (
    <li className="row-kv" data-testid={`step-${n}`}>
      <span>{done ? "✓ " : `${n}. `}{label}</span>
      <span>{done ? "done" : action}</span>
    </li>
  );
  return (
    <div className="stop-box" data-testid={`launch-${l.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{l.name} <span className="chip ml-1">{l.kind === "ai" ? "AI" : "Human"}</span></span>
        <span className={`chip ${l.status === "rejected" ? "chip-bad" : ""}`} data-testid="launch-status">{l.status}</span>
      </div>
      {l.status === "pending" && <p className="muted text-sm">Waiting for the season&apos;s next tick to deploy it (within 15 minutes).</p>}
      {l.status === "rejected" && <p className="neg text-sm">{l.note}</p>}
      {l.status === "live" && l.vault && (
        <>
          <ol className="m-0 list-none p-0">
            {l.kind === "ai" && step(1, !!state?.signer, "Let the season sign for your AI", <button className="btn text-sm" onClick={() => run(() => call({ receiverId: l.vault!, method: "set_signal_key", args: { public_key: SEASON_SIGNAL_PK }, gas: 30n * TGAS }))}>Confirm in wallet</button>)}
            {step(l.kind === "ai" ? 2 : 1, !!state?.staked, "Put in your stake (faucet USDC)", (
              <span className="flex items-center gap-2">
                <input aria-label="Stake in USDC" className="w-20" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
                <button className="btn text-sm" disabled={!state} onClick={() => run(stake)}>Mint and deposit</button>
              </span>
            ))}
            {l.kind === "human" && step(2, false, "Sign trades in the leader console", <Link href={`/leader/?id=${l.vault}`}>Open the console →</Link>)}
          </ol>
          <Link href={`/vault/?id=${l.vault}`} className="text-sm">Open your vault →</Link>
        </>
      )}
      {err && <p className="neg break-words text-sm" role="status">{err}</p>}
    </div>
  );
}
