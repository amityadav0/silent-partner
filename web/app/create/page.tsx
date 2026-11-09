"use client";
// Create-vault wizard. Produces the init args and the commands to deploy them;
// it never deploys anything itself (a deploy is signed by the vault account's
// own key, in your CLI).
import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { buildInit, commands, PRESET, type Form, type Net } from "@/lib/create";
import { NETWORK } from "@/lib/config";

const STEPS = ["Roles", "Economics", "Assets", "Review"] as const;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="muted mt-0.5 block text-xs">{hint}</span>}
    </label>
  );
}

export default function CreateVault() {
  const { accountId } = useWallet();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>({
    network: NETWORK, vault: "", leader: "", owner: "", operatorMode: "silent-partner", operator: "", attestationKey: "",
    feePct: "20", minLeaderPct: "10", slippagePct: "1", minDeposit: "1", extraAssets: Object.keys(PRESET[NETWORK].assets),
  });
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const leader = f.leader || accountId || "";
  const form = { ...f, leader };
  const { cfg, errors } = buildInit(form);
  const p = PRESET[f.network];
  const [copied, setCopied] = useState(false);

  return (
    <section className="max-w-2xl" data-testid="create">
      <h1>Create a vault</h1>
      <p className="muted mt-1 text-sm">You lead; followers copy you at your fill. This builds the contract&apos;s init arguments and the commands to deploy them. Nothing is deployed from this page.</p>

      <ol className="track mt-4" aria-label="wizard steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? "done" : i === step ? "now" : ""}>
            <button className="sort" onClick={() => setStep(i)}>{i + 1}. {s}</button>
          </li>
        ))}
      </ol>

      <div className="panel mt-3 space-y-4">
        {step === 0 && (
          <>
            <Field label="Network">
              <select value={f.network} onChange={(e) => setF({ ...f, network: e.target.value as Net, extraAssets: Object.keys(PRESET[e.target.value as Net].assets) })}>
                <option value="testnet">testnet (paper, free)</option>
                <option value="mainnet">mainnet (real funds)</option>
              </select>
            </Field>
            <Field label="Vault account" hint="A fresh account that will hold the contract. Its MPC-derived intents account is created at activation.">
              <input className="w-full" placeholder={`my-vault.${f.network === "testnet" ? "testnet" : "near"}`} value={f.vault} onChange={set("vault")} data-testid="f-vault" />
            </Field>
            <Field label="Leader" hint="Signs the trade signals, earns the fee, seeds the vault and must keep the minimum stake.">
              <input className="w-full" placeholder={accountId ?? "you.testnet"} value={f.leader} onChange={set("leader")} data-testid="f-leader" />
            </Field>
            <Field label="Operator">
              <div className="flex flex-col gap-1 text-sm">
                <label><input type="radio" checked={f.operatorMode === "silent-partner"} onChange={() => setF({ ...f, operatorMode: "silent-partner" })} /> Silent Partner&apos;s operator {p.operator ? <code className="text-xs">{p.operator}</code> : <span className="muted">(not on mainnet yet)</span>}</label>
                <label><input type="radio" checked={f.operatorMode === "own"} onChange={() => setF({ ...f, operatorMode: "own" })} /> My own operator (run <code className="text-xs">operator/</code>)</label>
              </div>
            </Field>
            {f.operatorMode === "own" && (
              <>
                <Field label="Operator account"><input className="w-full" value={f.operator} onChange={set("operator")} /></Field>
                <Field label="Attestation public key" hint="The key your operator signs NAV with (ed25519:…). Followers' browsers verify every NAV against it.">
                  <input className="w-full" value={f.attestationKey} onChange={set("attestationKey")} />
                </Field>
              </>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <Field label="Performance fee (%)" hint="Charged only on gains above the high-water mark, as new leader shares. Contract limit: 50%.">
              <input className="w-24" inputMode="decimal" value={f.feePct} onChange={set("feePct")} data-testid="f-fee" />
            </Field>
            <Field label="Minimum leader stake (%)" hint="Follower deposits that would push you under this are refunded, and you can't withdraw below it.">
              <input className="w-24" inputMode="decimal" value={f.minLeaderPct} onChange={set("minLeaderPct")} />
            </Field>
            <Field label="Max slippage per trade (%)" hint="The vault refuses to sign any quote with more slippage. Contract limit: 5%.">
              <input className="w-24" inputMode="decimal" value={f.slippagePct} onChange={set("slippagePct")} />
            </Field>
            <Field label="Minimum deposit (USDC)"><input className="w-24" inputMode="decimal" value={f.minDeposit} onChange={set("minDeposit")} /></Field>
          </>
        )}
        {step === 2 && (
          <>
            <p className="text-sm">Base asset: <b>USDC</b> <code className="text-xs">{p.base_asset_id.slice(0, 24)}…</code>. NAV, deposits and payouts are in USDC.</p>
            <Field label="Also tradable" hint="The vault refuses to sign trades into anything else, so this is your followers' mandate.">
              {Object.entries(p.assets).map(([id, sym]) => (
                <label key={id} className="mr-4 text-sm">
                  <input type="checkbox" checked={f.extraAssets.includes(id)} onChange={(e) => setF({ ...f, extraAssets: e.target.checked ? [...f.extraAssets, id] : f.extraAssets.filter((x) => x !== id) })} /> {sym}
                </label>
              ))}
            </Field>
            <p className="muted text-xs">Quote key: <code>{p.oneclick_key.slice(0, 20)}…</code>. {p.quoteKeyNote}</p>
          </>
        )}
        {step === 3 && (
          <>
            {errors.length > 0 ? (
              <ul className="neg list-disc pl-5 text-sm" data-testid="create-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
            ) : (
              <>
                <p className="pos text-sm" data-testid="create-ok">✓ Passes every check the contract&apos;s <code>new</code> makes.</p>
                {f.network === "mainnet" && <p className="panel panel-warn text-xs">Mainnet holds real funds. Read the threat model first, and keep the vault account&apos;s full-access key only as long as you need it: anyone with it can redeploy the code the MPC key trusts.</p>}
                <h3 className="text-sm font-semibold">Init args</h3>
                <pre className="scroll-x text-xs" data-testid="create-json">{JSON.stringify({ cfg }, null, 2)}</pre>
                <h3 className="text-sm font-semibold">Commands</h3>
                <pre className="scroll-x whitespace-pre text-xs" data-testid="create-commands">{commands(form, cfg!).join("\n\n")}</pre>
                <button className="btn" onClick={() => navigator.clipboard?.writeText(commands(form, cfg!).join("\n\n")).then(() => setCopied(true))}>{copied ? "Copied" : "Copy commands"}</button>
                <p className="muted text-xs">After step 4, your vault shows up on its own page: <code>/vault/?id={f.vault || "…"}</code>. To list it on the leaderboard, open a PR adding it to <code>web/lib/vaults.ts</code>.</p>
              </>
            )}
          </>
        )}
      </div>
      <div className="mt-3 flex justify-between">
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
        {step < 3 ? <button className="btn btn-primary" onClick={() => setStep(step + 1)} data-testid="next">Next</button> : <Link href="/leader/" className="btn no-underline">Leader console →</Link>}
      </div>
    </section>
  );
}
