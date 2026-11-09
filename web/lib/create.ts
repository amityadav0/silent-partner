// Create-vault wizard: form → the exact `new(cfg)` init args, checked with the
// same rules as the contract, plus the commands to deploy and activate.
export type Net = "testnet" | "mainnet";
export type Form = {
  network: Net; vault: string; leader: string; owner: string;
  operatorMode: "silent-partner" | "own"; operator: string; attestationKey: string;
  feePct: string; minLeaderPct: string; slippagePct: string; minDeposit: string; extraAssets: string[];
};

export const PRESET: Record<Net, { base_token: string; base_asset_id: string; intents_contract: string; mpc_contract: string; oneclick_key: string; operator: string | null; attestation_key: string | null; assets: Record<string, string>; quoteKeyNote: string }> = {
  testnet: {
    base_token: "usdc.fakes.testnet", base_asset_id: "nep141:usdc.fakes.testnet", intents_contract: "sp-intents-61557.testnet", mpc_contract: "v1.signer-prod.testnet",
    oneclick_key: "ed25519:69cTtzfbgnT5B77Y93w3kViU3ygeUHYjVTiz3jGs8rBg", operator: "sp-sop-92991.testnet", attestation_key: "ed25519:HWV2beAEvYTHB8iht32uxfi5EmJJVYgqPj4WeZVvwz5n",
    assets: { "nep141:wrap.testnet": "wNEAR" },
    quoteKeyNote: "1Click has no testnet, so testnet vaults use the project's test quote key and trade on paper.",
  },
  mainnet: {
    base_token: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", base_asset_id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", intents_contract: "intents.near", mpc_contract: "v1.signer",
    oneclick_key: "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc", operator: null, attestation_key: "ed25519:4mm15GiMGtZSfQnSy14N2N2D114sUcSSSc3qBdyasgih",
    assets: { "nep141:wrap.near": "wNEAR" },
    quoteKeyNote: "1Click's quote-signing key. It is immutable after init: the vault only signs transfers bound to quotes under this key.",
  },
};

const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const B58 = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const pctToBps = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? NaN : Math.round(Number(s) * 100));

export function buildInit(f: Form): { cfg: Record<string, unknown> | null; errors: string[] } {
  const p = PRESET[f.network];
  const errors: string[] = [];
  const operator = f.operatorMode === "silent-partner" ? p.operator : f.operator.trim();
  const att = f.operatorMode === "silent-partner" ? p.attestation_key : f.attestationKey.trim();
  const sfx = f.network === "testnet" ? ".testnet" : ".near";
  for (const [k, v] of [["Vault account", f.vault], ["Leader", f.leader], ["Owner", f.owner || f.leader]] as const) {
    if (!ACCOUNT.test(v.trim())) errors.push(`${k}: not a valid NEAR account id`);
    else if (!v.trim().endsWith(sfx) && !/^[0-9a-f]{64}$/.test(v.trim())) errors.push(`${k}: should end in ${sfx} on ${f.network}`);
  }
  if (!operator) errors.push("Operator: there's no Silent Partner operator on mainnet yet. Choose your own.");
  else if (!ACCOUNT.test(operator)) errors.push("Operator: not a valid NEAR account id");
  if (!att || !B58.test(att)) errors.push("Attestation key: expected ed25519:<base58 public key>");
  const fee = pctToBps(f.feePct), lead = pctToBps(f.minLeaderPct), slip = pctToBps(f.slippagePct);
  // Same limits as the contract's `new`.
  if (!(fee >= 0 && fee <= 5000)) errors.push("Performance fee: 0–50%");
  if (!(lead >= 0 && lead <= 10_000)) errors.push("Leader stake: 0–100%");
  if (!(slip >= 0 && slip <= 500)) errors.push("Max slippage: 0–5%");
  const dep = Number(f.minDeposit);
  if (!(dep >= 0.000001)) errors.push("Minimum deposit: at least 0.000001 USDC");
  if (errors.length) return { cfg: null, errors };
  return {
    errors,
    cfg: {
      owner: (f.owner || f.leader).trim(), operator, leader: f.leader.trim(),
      base_token: p.base_token, base_asset_id: p.base_asset_id, intents_contract: p.intents_contract,
      mpc_contract: p.mpc_contract, mpc_path: "silent-partner/vault", oneclick_key: p.oneclick_key, attestation_key: att,
      perf_fee_bps: fee, min_leader_bps: lead, max_slippage_bps: slip, min_deposit: String(Math.round(dep * 1e6)),
      allowed_assets: [p.base_asset_id, ...f.extraAssets.filter((a) => a in p.assets)],
    },
  };
}

/** near-cli-rs commands: deploy + init, activate (learns the vault's MPC key), then the leader's first steps. */
export function commands(f: Form, cfg: Record<string, unknown>): string[] {
  const n = f.network, v = f.vault.trim();
  const json = JSON.stringify({ cfg });
  return [
    `# 1. build (reproducible) — or download the release wasm\ncargo near build reproducible-wasm   # in contract/`,
    `# 2. deploy and initialise (signed by the vault account)\nnear contract deploy ${v} use-file target/near/silent_partner.wasm with-init-call new json-args '${json}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config ${n} sign-with-keychain send`,
    `# 3. activate: the contract asks MPC for its own vault key (anyone may call)\nnear contract call-function as-transaction ${v} activate json-args '{}' prepaid-gas '50 Tgas' attached-deposit '0 NEAR' sign-as ${cfg.operator} network-config ${n} sign-with-keychain send`,
    `# 4. leader: register a signal key in the Leader console, then seed the vault from its page (the leader deposits first)`,
  ];
}
