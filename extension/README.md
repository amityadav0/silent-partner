# Silent Partner IronClaw extension

Lead a vault from chat. Third-party WASM extension (`reborn.extension_manifest.v3`, the same structure as Scope's extension) with two tools:

| Tool | Egress | What it does |
|---|---|---|
| `silent_partner.signal` | NEAR RPC, the operator API | "Move the vault to 40% NEAR" → a **target-weight** leader signal. If the leader's signal key is in the workspace (`silent-partner/signal-key/<vault>`, the 64-hex seed the leader console stores), the tool signs locally and sends it to the operator, which executes it once for the whole vault and records the hash on-chain. Without a key it returns a one-tap link into the leader console instead. |
| `silent_partner.status` | NEAR RPC | Public vault state: share price, book NAV, epoch, signals recorded, emergency. |

- **No funds at stake.** The tool holds no funds key. The signal key can only signal; the contract and operator bound what a signal can do (allowed assets, max slippage, one fill for the whole vault).
- **Off by default.** Keeping the key in the workspace is opt-in: without it, a human taps to sign.
- **Target signals** are a signal type (`type: "target"`, `target_bps`). The leader names a weight, and the operator, which holds the private positions, sizes the trade.

**Build.**

```bash
cd wasm-src && cargo test && cargo check --features typecheck
cargo build --release --target wasm32-wasip2 && cp target/wasm32-wasip2/release/silent_partner_tool.wasm ../wasm/
```

**Local harness** (`harness/`, adapted from Scope's). It runs the component in wasmtime with the manifest's per-tool egress allowlist, IronClaw's test rewrite map, and a workspace directory:

```bash
cd harness && cargo build --release
./target/release/sp-harness silent_partner.status '{"vault":"sp-convict-8952.testnet"}'
SP_HARNESS_WORKSPACE=/path/to/ws IRONCLAW_REBORN_TEST_HTTP_REWRITE_MAP="operator.silent-partner.invalid=127.0.0.1:8788" \
  ./target/release/sp-harness silent_partner.signal '{"vault":"sp-vault-60270.testnet","target_pct":40}'
```

The operator host is `operator.silent-partner.invalid`. It never resolves, so without a rewrite map nothing leaves the machine.
