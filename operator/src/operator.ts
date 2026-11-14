// The operator: one service per vault.
//
//   signals  → verify (leader key on the vault) → size against NAV → one
//              confidential 1Click quote for the whole pool → contract signs
//              (Trade) → submit → record fill → record_signal on-chain.
//   deposits → the contract mints on ft_transfer_call; the operator shields the
//              vault's public balance into its confidential account.
//   epochs   → NAV = public base + Σ confidential holdings valued by 1Click
//              quotes into the base asset; append to the log; post NAV with the
//              log head, signed by the attestation key.
//   claims   → unshield into the vault's own public balance if needed, pay the
//              claim from there (PublicPayout, executed on intents.near), then
//              settle on-chain against the verifier's nonce record.
//
// DRY mode (default): quotes are dry, nothing is signed by the vault key or
// submitted to 1Click; fills, shields and payouts are "paper" entries in the
// log so the ledger and NAV behave as if they happened. Chain writes (NAV,
// signals) happen only when `chainWrites` is on (testnet, or mainnet with
// Amit's OK).
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { NavRejected, type VaultChain, type Claim, type SignKind } from "./chain.js";
import { Confidential, TERMINAL, type Leg, type VerifiedQuote } from "./confidential.js";
import { FillLog } from "./filllog.js";
import { fold } from "./ledger.js";
import { verifySignal, type BasketSignal, type Signal, type SignedSignal } from "./signal.js";
import { nep413Prehash, type Nep413Payload } from "./intents.js";
import { randomBytes } from "node:crypto";

export type OperatorCfg = {
  dryRun: boolean;
  chainWrites: boolean;
  slippageBps: number;
  /** Minimum public base balance worth shielding. */
  minShield: bigint;
  /** Vault asset id → 1Click asset id (identity on mainnet; testnet fakes → mainnet ids for pricing). */
  assetMap: Record<string, string>;
  decimals: Record<string, number>;
  signalMaxAgeMs: number;
  pollMs: number;
  pollTries: number;
};

type PendingLimit = { signal: Signal; hash: string; signature: string };

export class Operator {
  readonly limits: PendingLimit[] = [];
  private cache?: { vaultAccount: string; base: string; allowed: string[] };

  constructor(
    private chain: VaultChain,
    private oc: Confidential,
    readonly log: FillLog,
    private attestation: KeyPair,
    /** `ed25519:…` of the vault's MPC key, for submit-intent (public). */
    private vaultPublicKey: string,
    private cfg: OperatorCfg,
    private now: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async meta() {
    if (this.cache) return this.cache;
    const [v, c] = await Promise.all([this.chain.getVault(), this.chain.getConfig()]);
    if (!v.vault_account) throw new Error("vault not active");
    return (this.cache = { vaultAccount: v.vault_account, base: c.base_asset_id, allowed: c.allowed_assets });
  }
  private oneclickId = (a: string) => this.cfg.assetMap[a] ?? a;
  ledger() {
    return fold(this.log.entries, this.cache?.base ?? "");
  }

  private async quote(leg: Leg, from: string, to: string, amount: bigint, dry: boolean, recipient?: string): Promise<VerifiedQuote> {
    const { vaultAccount } = await this.meta();
    return this.oc.quote({ leg, from: this.oneclickId(from), to: this.oneclickId(to), amount: amount.toString(), slippageBps: leg === "trade" ? this.cfg.slippageBps : 0, vault: vaultAccount, recipient, deadlineMs: this.now() + 10 * 60_000, dry });
  }

  /** Value of `amount` of `asset` in base units, by a dry 1Click quote. */
  async value(asset: string, amount: bigint): Promise<bigint> {
    const { base } = await this.meta();
    if (amount === 0n) return 0n;
    if (asset === base) return amount;
    return (await this.quote("trade", asset, base, amount, true)).amountOut;
  }

  /** NAV in base units, and the parts it came from (private: positions). */
  /** NAV in base units: holdings minus what open claims are still owed (their
   *  shares are already burned). Returns the parts too (private: positions). */
  async nav(): Promise<{ nav: bigint; gross: bigint; liabilities: bigint; publicBase: bigint; holdings: Record<string, { amount: string; value: string }> }> {
    const { base } = await this.meta();
    const l = fold(this.log.entries, base);
    const publicBase = (await this.chain.publicBase()) - l.shieldedFromPublic;
    let gross = publicBase > 0n ? publicBase : 0n;
    const holdings: Record<string, { amount: string; value: string }> = {};
    for (const [asset, amount] of l.confidential) {
      const v = await this.value(asset, amount);
      holdings[asset] = { amount: amount.toString(), value: v.toString() };
      gross += v;
    }
    let liabilities = 0n;
    for (const c of await this.chain.getClaims()) {
      const owed = BigInt(c.amount) - BigInt(c.paid) - this.paperPaid(c.id);
      if (owed > 0n) liabilities += owed;
    }
    const nav = gross > liabilities ? gross - liabilities : 0n;
    return { nav, gross, liabilities, publicBase, holdings };
  }

  private paperPaid(claimId: number): bigint {
    return this.log.entries.filter((e) => e.kind === "payout" && e.data.claim_id === claimId && e.data.dry).reduce((s, e) => s + BigInt(e.data.amount as string), 0n);
  }

  // ---------------- signals ----------------

  async submitSignal(x: unknown): Promise<{ ok: true; hash: string; status: "executed" | "pending"; fill?: string } | { ok: false; error: string }> {
    const m = await this.meta();
    const chk = verifySignal(x, { vault: this.chain.contractId, signalKey: await this.chain.getSignalKey(), nowMs: this.now(), maxAgeMs: this.cfg.signalMaxAgeMs, seenNonces: this.ledger().seenNonces, allowedAssets: m.allowed });
    if (!chk.ok) return chk;
    const s = x as SignedSignal;
    this.log.append("signal", { hash: chk.hash, nonce: s.signal.nonce, type: s.signal.type }, this.now());
    if (s.signal.type === "basket") {
      const fill = await this.executeBasket(s.signal, chk.hash, s.signature);
      return { ok: true, hash: chk.hash, status: "executed", fill };
    }
    if (s.signal.type === "limit") {
      this.limits.push({ signal: s.signal, hash: chk.hash, signature: s.signature });
      return { ok: true, hash: chk.hash, status: "pending" };
    }
    if (s.signal.type === "target") {
      // The leader names a weight; the operator, which holds the private positions, sizes the trade.
      const trade = await this.targetTrade(s.signal);
      if (!trade) return { ok: true, hash: chk.hash, status: "executed", fill: this.log.append("note", { signal: chk.hash, msg: "already at target" }, this.now()).hash };
      const fill = await this.execute(trade, chk.hash, s.signature);
      return { ok: true, hash: chk.hash, status: "executed", fill };
    }
    const fill = await this.execute(s.signal, chk.hash, s.signature);
    return { ok: true, hash: chk.hash, status: "executed", fill };
  }

  /** The trade a target signal implies: from the current weight of `to` to target_bps,
   *  capped at size_bps of NAV. Null when already within 1 point. */
  async targetTrade(sig: Signal): Promise<Signal | null> {
    const { base } = await this.meta();
    const risk = sig.to === base ? sig.from : sig.to;
    const n = await this.nav();
    if (n.nav === 0n) return null;
    const riskValue = BigInt(n.holdings[risk]?.value ?? "0");
    const current = Number((riskValue * 10_000n) / n.nav);
    const target = sig.to === base ? 10_000 - (sig.target_bps ?? 0) : (sig.target_bps ?? 0);
    const d = target - current;
    if (Math.abs(d) < 100) return null;
    const size_bps = Math.min(Math.abs(d), sig.size_bps);
    return d > 0 ? { ...sig, type: "market", from: base, to: risk, size_bps } : { ...sig, type: "market", from: risk, to: base, size_bps: target === 0 ? 10_000 : size_bps };
  }

  /** Size of `from` to sell for a signal: size_bps of NAV, capped at the balance. */
  async size(sig: Signal): Promise<bigint> {
    const { base } = await this.meta();
    const bal = this.ledger().confidential.get(sig.from) ?? 0n;
    if (bal === 0n) return 0n;
    const { nav } = await this.nav();
    const target = (nav * BigInt(sig.size_bps)) / 10_000n;
    if (sig.from === base) return target < bal ? target : bal;
    const balValue = await this.value(sig.from, bal);
    if (balValue === 0n) return 0n;
    const amt = (bal * target) / balValue;
    return amt < bal ? amt : bal;
  }

  /**
   * Multi-asset target (T6): move every allowed risky asset to its target weight, through the
   * base (sells first, so the buys have the cash), one quote per leg for the whole vault. The
   * signal is recorded on chain once, after the last leg. Legs under 1 point are skipped.
   */
  async executeBasket(sig: BasketSignal, hash: string, leaderSig: string): Promise<string> {
    const { base, allowed } = await this.meta();
    if (sig.targets_bps[base] !== undefined) return this.log.append("note", { signal: hash, msg: "the base can't be a basket target" }, this.now()).hash;
    const n = await this.nav();
    if (n.nav === 0n) return this.log.append("note", { signal: hash, msg: "empty vault" }, this.now()).hash;
    const legs: Signal[] = [];
    const cur = (a: string) => Number((BigInt(n.holdings[a]?.value ?? "0") * 10_000n) / n.nav);
    const risky = allowed.filter((a) => a !== base);
    const leg = (from: string, to: string, size_bps: number): Signal => ({ v: 1, vault: sig.vault, type: "market", from, to, size_bps, nonce: sig.nonce, created_ms: sig.created_ms });
    for (const a of risky) {
      const d = (sig.targets_bps[a] ?? 0) - cur(a);
      if (d <= -100) legs.push(leg(a, base, (sig.targets_bps[a] ?? 0) === 0 ? 10_000 : -d));
    }
    for (const a of risky) {
      const d = (sig.targets_bps[a] ?? 0) - cur(a);
      if (d >= 100) legs.push(leg(base, a, Math.min(10_000, d)));
    }
    if (!legs.length) return this.log.append("note", { signal: hash, msg: "already at target" }, this.now()).hash;
    let last = "";
    for (const l of legs) last = await this.execute(l, hash, leaderSig, undefined, false);
    if (this.cfg.chainWrites) await this.chain.recordSignal(hash, leaderSig, last, this.now());
    return last;
  }

  /** One confidential quote for the whole vault. Returns the fill entry hash. */
  async execute(sig: Signal, hash: string, leaderSig: string, sized?: bigint, record = true): Promise<string> {
    const amount = sized ?? (await this.size(sig));
    if (amount === 0n) return this.log.append("note", { signal: hash, msg: "nothing to sell" }, this.now()).hash;
    const q = await this.quote("trade", sig.from, sig.to, amount, this.cfg.dryRun);
    if (sig.type === "limit" && this.humanPrice(sig, q) < Number(sig.limit_price)) {
      // The probe crossed but the executable quote didn't: keep waiting.
      this.limits.push({ signal: sig, hash, signature: leaderSig });
      return this.log.append("note", { signal: hash, msg: "limit not met on the live quote" }, this.now()).hash;
    }
    const base = { signal: hash, from: sig.from, to: sig.to, amount_in: q.amountIn.toString(), min_amount_out: q.minAmountOut.toString(), quote_signature: q.signed.signature };
    let entry;
    if (this.cfg.dryRun) {
      entry = this.log.append("fill", { ...base, amount_out: q.amountOut.toString(), dry: true, status: "PAPER" }, this.now());
    } else {
      const r = await this.liveTransfer("Trade", q);
      const out = r.status === "SUCCESS" ? BigInt(r.raw?.swapDetails?.amountOut ?? q.amountOut) : 0n;
      // A refund returns amount_in to the vault, so a non-success fill moves nothing.
      entry = this.log.append("fill", { ...base, amount_in: r.status === "SUCCESS" ? base.amount_in : "0", amount_out: out.toString(), dry: false, status: r.status, deposit_address: q.depositAddress, intent_hash: r.intentHash, sign_tx: r.tx }, this.now());
    }
    if (record && this.cfg.chainWrites) await this.chain.recordSignal(hash, leaderSig, entry.hash, this.now());
    return entry.hash;
  }

  /** Price of a quote in human units of `to` per 1 human `from`. */
  private humanPrice(sig: Signal, q: VerifiedQuote): number {
    const df = this.cfg.decimals[sig.from] ?? 0, dt = this.cfg.decimals[sig.to] ?? 0;
    return Number(q.amountOut) / 10 ** dt / (Number(q.amountIn) / 10 ** df);
  }

  /** Check pending limit signals; execute the ones whose price has crossed. */
  async tickLimits(): Promise<string[]> {
    const done: string[] = [];
    for (const p of [...this.limits]) {
      const drop = () => this.limits.splice(this.limits.indexOf(p), 1);
      if (p.signal.expires_ms && this.now() > p.signal.expires_ms) {
        this.log.append("note", { signal: p.hash, msg: "limit expired" }, this.now());
        drop();
        continue;
      }
      const amount = await this.size(p.signal);
      if (amount === 0n) continue;
      const probe = await this.quote("trade", p.signal.from, p.signal.to, amount, true);
      if (this.humanPrice(p.signal, probe) >= Number(p.signal.limit_price)) {
        drop();
        done.push(await this.execute(p.signal, p.hash, p.signature, amount));
      }
    }
    return done;
  }

  // ---------------- live path (vault key via the contract) ----------------

  private async liveTransfer(kind: SignKind, q: VerifiedQuote) {
    const { vaultAccount } = await this.meta();
    if (!q.depositAddress) throw new Error("live quote has no deposit address");
    const payload = await this.oc.generateIntent(vaultAccount, q.depositAddress);
    const { tx, signature } = await this.chain.signIntent(kind, payload, q.signed);
    if (!signature) throw new Error(`contract refused or MPC failed (tx ${tx})`);
    let intentHash: string;
    try {
      intentHash = await this.oc.submitIntent(payload, this.vaultPublicKey, signature);
    } catch (e) {
      // Keep what's needed to resubmit or reconcile by hand.
      this.log.append("note", { msg: "submit-intent failed after signing", kind: typeof kind === "string" ? kind : "PublicPayout", deposit_address: q.depositAddress, payload, signature, sign_tx: tx, error: String((e as Error).message).slice(0, 200) }, this.now());
      throw e;
    }
    let last = { status: "UNKNOWN", raw: null as any };
    for (let i = 0; i < this.cfg.pollTries; i++) {
      last = await this.oc.status(q.depositAddress);
      if (TERMINAL.has(last.status)) break;
      await this.sleep(this.cfg.pollMs);
    }
    return { tx, intentHash, status: last.status, raw: last.raw, payload };
  }

  // ---------------- deposits ----------------

  async shieldPending(): Promise<string | null> {
    const { base } = await this.meta();
    const pending = (await this.chain.publicBase()) - this.ledger().shieldedFromPublic;
    if (pending < this.cfg.minShield) return null;
    if (this.cfg.dryRun) return this.log.append("shield", { amount: pending.toString(), dry: true, status: "PAPER" }, this.now()).hash;
    const q = await this.quote("shield", base, base, pending, false);
    const r = await this.liveTransfer("Shield", q);
    if (r.status !== "SUCCESS") return this.log.append("note", { msg: "shield did not complete", status: r.status, amount: pending.toString() }, this.now()).hash;
    return this.log.append("shield", { amount: q.amountOut.toString(), dry: false, status: r.status, intent_hash: r.intentHash, sign_tx: r.tx }, this.now()).hash;
  }

  // ---------------- epochs ----------------

  /** Keeper post (D-P5-12): NAV only, signed over the fill log's current head. It never shields,
   *  trades or pays, and it doesn't append to the log, so the operator's own copy stays the one
   *  linear record. Needs only a `post_nav` function-call key and the attestation key. */
  async keeperPost(): Promise<{ epoch: number; nav: string; head: string; tx: string; liabilities: string }> {
    const v = await this.chain.getVault();
    const n = await this.nav();
    const epoch = v.epoch + 1;
    const ts = Math.max(this.now() - 1000, v.last_nav_ms + 1);
    const head = this.log.head();
    const signature = "ed25519:" + base58.encode(this.attestation.sign(new TextEncoder().encode(navMessage(this.chain.contractId, epoch, n.nav.toString(), ts, head))).signature);
    const tx = await this.chain.postNav(epoch, n.nav.toString(), ts, head, signature, await this.priceQuotes());
    return { epoch, nav: n.nav.toString(), head, tx, liabilities: n.liabilities.toString() };
  }

  async epoch(): Promise<{ epoch: number; nav: string; head: string; tx: string | null; signature: string }> {
    await this.shieldPending();
    const v = await this.chain.getVault();
    const { nav } = await this.nav();
    const epoch = v.epoch + 1;
    const ts = Math.max(this.now() - 1000, v.last_nav_ms + 1);
    this.log.append("nav", { epoch, nav: nav.toString(), timestamp_ms: ts }, this.now());
    const head = this.log.head();
    // Built here, not fetched: the attestation key signs only bytes we chose (= contract `nav_message`).
    const message = navMessage(this.chain.contractId, epoch, nav.toString(), ts, head);
    const signature = "ed25519:" + base58.encode(this.attestation.sign(new TextEncoder().encode(message)).signature);
    let tx: string | null = null;
    if (this.cfg.chainWrites) {
      try {
        const priceQuotes = await this.priceQuotes();
        tx = await this.chain.postNav(epoch, nav.toString(), ts, head, signature, priceQuotes);
      } catch (e) {
        if (!(e instanceof NavRejected)) throw e;
        // The bound refused it: record why; the next epoch posts afresh.
        this.log.append("note", { msg: "NAV rejected by the oracle bound", epoch, nav: nav.toString(), tx: e.tx, reason: e.log.slice(0, 200) }, this.now());
        throw e;
      }
    }
    if (tx) await this.payClaims();
    return { epoch, nav: nav.toString(), head, tx, signature };
  }

  /**
   * For vaults whose NAV band is priced by 1Click quotes: two fresh dry quotes,
   * base → risky for `PRICE_QUOTE_BASE` units, then risky → base for exactly
   * what that bought (same size both ways). Signed by 1Click; the contract
   * verifies them with its immutable `oneclick_key`.
   */
  async priceQuotes(): Promise<VerifiedQuote["signed"][] | undefined> {
    const { vaultAccount } = await this.meta();
    const q = (from: string, to: string, amount: bigint) => this.oc.quote({ leg: "trade", from, to, amount: amount.toString(), slippageBps: this.cfg.slippageBps, vault: vaultAccount, deadlineMs: this.now() + 10 * 60_000, dry: true });
    // Multi-asset bound (T6): a pair for every allowed risky asset, held or not, so the set
    // of quotes says nothing about the holdings.
    const basket = await this.chain.getNavBasket?.();
    if (basket) {
      const out: VerifiedQuote["signed"][] = [];
      for (const r of basket.risk_ids) {
        const buy = await q(basket.base_id, r, PRICE_QUOTE_BASE);
        const sell = await q(r, basket.base_id, buy.amountOut);
        out.push(buy.signed, sell.signed);
      }
      return out;
    }
    const nq = (await this.chain.getConfig()).nav_quotes;
    if (!nq) return undefined;
    const buy = await q(nq.base_id, nq.risk_id, PRICE_QUOTE_BASE);
    const sell = await q(nq.risk_id, nq.base_id, buy.amountOut);
    return [buy.signed, sell.signed];
  }

  // ---------------- withdrawals ----------------

  /** Amount still owed on a claim: on-chain open amount minus paper payouts already logged. */
  private openOf(c: Claim): bigint {
    const inFlight = c.in_flight.reduce((s, f) => s + BigInt(f.amount), 0n);
    return BigInt(c.amount) - BigInt(c.paid) - inFlight - this.paperPaid(c.id);
  }

  /**
   * Settle every in-flight payout against the public verifier's nonce record
   * (permissionless and safe: executed → paid; never executed and expired →
   * released; otherwise unchanged). Returns how many changed.
   */
  async settleInFlight(claims: Claim[]): Promise<number> {
    if (!this.cfg.chainWrites) return 0;
    let n = 0;
    for (const c of claims) {
      for (const f of c.in_flight) {
        try {
          const r = await this.chain.settlePayout(c.id, f.prehash);
          if (r.result === "paid" || r.result === "released") {
            this.log.append("note", { msg: `payout ${r.result}`, claim_id: c.id, prehash: f.prehash, settle_tx: r.tx }, this.now());
            n++;
          }
        } catch (e) {
          this.log.append("note", { msg: "settle failed", claim_id: c.id, prehash: f.prehash, error: String((e as Error).message).slice(0, 200) }, this.now());
        }
      }
    }
    return n;
  }

  /** A plain (non-versioned) NEP-413 nonce: the contract requires one for payouts. */
  private plainNonce(): Buffer {
    for (;;) {
      const n = randomBytes(32);
      if (!(n[0] === 0x56 && n[1] === 0x28 && n[2] === 0xf6 && n[3] === 0xc6)) return n;
    }
  }

  async payClaims(): Promise<string[]> {
    const { base, vaultAccount } = await this.meta();
    const out: string[] = [];
    let claims = await this.chain.getClaims();
    if (!this.cfg.dryRun && (await this.settleInFlight(claims)) > 0) claims = await this.chain.getClaims();
    for (const c of claims) {
      const open = this.openOf(c);
      if (open <= 0n) continue;
      try {
        if (this.cfg.dryRun) {
          out.push(this.log.append("payout", { claim_id: c.id, exit_account: c.exit_account, amount: open.toString(), dry: true, status: "PAPER" }, this.now()).hash);
          continue;
        }
        out.push(await this.payLive(c, open, base, vaultAccount));
      } catch (e) {
        // One bad claim (dust under 1Click's minimum, an odd exit account) must not block the rest.
        this.log.append("note", { msg: "payout failed", claim_id: c.id, amount: open.toString(), error: String((e as Error).message).slice(0, 200) }, this.now());
      }
    }
    return out;
  }

  /** Unshield what's missing into the vault's own public balance, then pay the claim from there. */
  private async payLive(c: Claim, open: bigint, base: string, vaultAccount: string): Promise<string> {
    const cfg = await this.chain.getConfig();
    const verifier = cfg.intents_contract ?? "intents.near";
    const pub = await this.chain.publicBalance(base);
    if (pub < open) {
      const need = open - pub;
      const q = await this.quote("unshield", base, base, need, false, vaultAccount);
      const r = await this.liveTransfer("Unshield", q);
      if (r.status !== "SUCCESS") throw new Error(`unshield ${r.status}`);
      this.log.append("unshield", { asset: base, amount: need.toString(), dry: false, status: r.status, intent_hash: r.intentHash, sign_tx: r.tx }, this.now());
    }
    const payload: Nep413Payload = {
      message: JSON.stringify({ deadline: new Date(this.now() + 20 * 60_000).toISOString(), intents: [{ intent: "transfer", receiver_id: c.exit_account, tokens: { [base]: open.toString() } }], signer_id: vaultAccount }),
      nonce: this.plainNonce().toString("base64"),
      recipient: verifier,
    };
    const { tx, signature } = await this.chain.signIntent({ PublicPayout: { claim_id: c.id } }, payload, null);
    if (!signature) throw new Error(`contract refused or MPC failed (tx ${tx})`);
    const prehash = nep413Prehash(payload).toString("hex");
    const execTx = await this.chain.executeIntents(verifier, [{ standard: "nep413", payload, public_key: this.vaultPublicKey, signature }]);
    const settled = await this.chain.settlePayout(c.id, prehash);
    return this.log.append("payout", { claim_id: c.id, exit_account: c.exit_account, amount: open.toString(), dry: false, status: settled.result, prehash, sign_tx: tx, exec_tx: execTx, settle_tx: settled.tx }, this.now()).hash;
  }
}

/** Size of the base → risky price quote: 10 USDC (6 decimals). */
export const PRICE_QUOTE_BASE = 10_000_000n;

/** The exact string the attestation key signs (contract `nav_message`). */
export const navMessage = (contract: string, epoch: number, nav: string, ts: number, head: string) => `silent-partner/nav/v1|${contract}|${epoch}|${nav}|${ts}|${head}`;
