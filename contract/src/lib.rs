//! Silent Partner vault.
//!
//! One vault per contract. Followers and a leader hold shares in one pool whose
//! assets sit in a confidential NEAR Intents account (intents.far) controlled
//! by an MPC key derived for this contract (Chain Signatures, EdDSA domain).
//!
//! * Deposits (base asset, ft_transfer_call) mint shares at the last NAV.
//! * Withdrawal requests lock shares; the next NAV post burns them at that NAV
//!   and opens a claim, paid out by an MPC-signed unshield to the holder.
//! * The operator posts NAV per epoch, signed by its attestation key.
//! * Performance fee: `fee_bps` of gains above a high-water mark, as leader shares.
//! * The leader must hold at least `min_leader_bps` of all shares.
//! * Leader signals are recorded by hash, with the leader's signature, after execution.
//! * No NAV for 24h → anyone can trigger emergency mode: deposits stop, holders
//!   exit at the last NAV, and anyone may submit the exit/unwind quotes.
//!
//! The vault key signs only payloads this contract has parsed and bound to a
//! 1Click-signed quote (see `sign_intent`), so the operator can choose trades
//! but cannot send funds anywhere except back to the vault or to a holder's claim.

pub mod intent;
pub mod math;
pub mod quote;

use intent::{Nep413Payload, Parsed};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap, LookupSet, Vector};
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue};
use quote::{QuoteFacts, SignedQuote};

/// NAV older than this freezes deposits and opens emergency mode.
#[cfg(not(feature = "drill"))]
pub const NAV_STALE_MS: u64 = 24 * 60 * 60 * 1000;
/// Test-only build (`--features drill`) for the testnet emergency drill: 5 minutes.
/// `new` refuses to initialise a drill build on any account outside `.testnet`.
#[cfg(feature = "drill")]
pub const NAV_STALE_MS: u64 = 5 * 60 * 1000;
pub const MAX_INTENT_AHEAD_MS: u64 = 60 * 60 * 1000;
pub const MAX_PENDING_WITHDRAWALS: u32 = 100;
/// A claim the operator hasn't paid within this long lets anyone trigger emergency.
pub const CLAIM_GRACE_MS: u64 = NAV_STALE_MS;
/// Payout payloads must stay valid at least this long (no instantly-dead reservations).
pub const MIN_PAYOUT_AHEAD_MS: u64 = 5 * 60 * 1000;
/// Login payloads (1Click sessions) are short-lived.
pub const MAX_LOGIN_AHEAD_MS: u64 = 5 * 60 * 1000;
/// Defuse's versioned-nonce prefix. Versioned nonces can be cleaned up after
/// expiry, which would make `is_nonce_used` forget an executed payout, so payout
/// payloads must use plain (legacy) nonces, which the verifier keeps forever.
pub const VERSIONED_NONCE_PREFIX: [u8; 4] = [0x56, 0x28, 0xf6, 0xc6];
pub const MPC_DOMAIN_EDDSA: u64 = 1;
const GAS_MPC_SIGN: Gas = Gas::from_tgas(100);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_VIEW: Gas = Gas::from_tgas(10);
const GAS_FT_FORWARD: Gas = Gas::from_tgas(60);

/// `imt:<treasury>:<public id>`: the confidential token id 1Click spends on intents.far.
pub const IMT_TREASURY: &str = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
pub fn imt(public_id: &str) -> String {
    format!("imt:{IMT_TREASURY}:{public_id}")
}

#[ext_contract(ext_mpc)]
pub trait Mpc {
    fn sign(&mut self, request: near_sdk::serde_json::Value);
    fn derived_public_key(&self, path: String, predecessor: AccountId, domain_id: u64) -> String;
}

#[ext_contract(ext_verifier)]
pub trait Verifier {
    fn is_nonce_used(&self, account_id: String, nonce: String) -> bool;
}

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128>;
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner: AccountId,
    pub operator: AccountId,
    pub leader: AccountId,
    /// NEP-141 contract of the base asset (USDC on mainnet).
    pub base_token: AccountId,
    /// Intents asset id of the base asset, e.g. `nep141:<usdc contract>`.
    pub base_asset_id: String,
    /// Where deposits are forwarded (intents.near). None on testnet: funds stay here.
    pub intents_contract: Option<AccountId>,
    pub mpc_contract: AccountId,
    pub mpc_path: String,
    /// 1Click quote-signing key, `ed25519:…`. Immutable after init.
    pub oneclick_key: String,
    /// Operator's NAV attestation key, `ed25519:…`.
    pub attestation_key: String,
    pub perf_fee_bps: u16,
    pub min_leader_bps: u16,
    pub max_slippage_bps: u16,
    pub min_deposit: U128,
    /// Public asset ids the vault may trade between (must include the base).
    pub allowed_assets: Vec<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct NavPost {
    pub epoch: u64,
    /// NAV the operator attested (before fee and withdrawals).
    pub nav: U128,
    pub timestamp_ms: u64,
    pub block_ms: u64,
    /// Price per share × 1e18 after the fee (what withdrawals burned at).
    pub price: U128,
    pub total_shares: U128,
    pub fee_shares: U128,
    pub withdrawn: U128,
    /// Head of the operator's hash-chained fill log at this NAV.
    pub fills_head: String,
    pub signature: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct WithdrawRequest {
    pub id: u64,
    pub account: AccountId,
    pub shares: U128,
    /// intents.near account that receives the payout.
    pub exit_account: AccountId,
    pub requested_ms: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Claim {
    pub id: u64,
    pub account: AccountId,
    pub exit_account: AccountId,
    pub amount: U128,
    /// Sent in signed intents whose deadline has passed or that the operator confirmed.
    pub paid: U128,
    /// In signed intents still inside their deadline.
    pub in_flight: Vec<InFlight>,
    pub epoch: u64,
    pub emergency: bool,
    pub opened_ms: u64,
}

/// A signed (or signing) payout of part of a claim, from the vault's public
/// intents balance. Settled by anyone against the verifier's nonce record.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct InFlight {
    pub prehash: String,
    /// base64 NEP-413 nonce of the payload.
    pub nonce: String,
    pub amount: U128,
    pub deadline_ms: u64,
    pub signed: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Signal {
    pub index: u64,
    /// sha256 (hex) of the leader's canonical signal JSON.
    pub hash: String,
    pub leader_sig: String,
    /// sha256 (hex) of the fill record in the operator's log.
    pub fill_hash: String,
    pub executed_ms: u64,
    pub recorded_ms: u64,
    pub epoch: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub enum SignKind {
    /// Empty intent for a 1Click user session (operator only).
    Login,
    /// Public intents.near → vault's confidential account.
    Shield,
    /// Confidential swap that pays back into the vault.
    Trade,
    /// Confidential → the vault's own public intents balance (same asset).
    Unshield,
    /// Transfer of the base asset from the vault's public intents balance to a
    /// claim's exit account (no quote: nothing is swapped). The only way funds
    /// leave the vault; settled on-chain against the verifier's nonce record.
    PublicPayout { claim_id: u64 },
}

/// What a holder has put in and taken out, in base units, for P&L.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Basis {
    pub deposited: U128,
    /// Sum of claims opened for this holder (what their burned shares were worth).
    pub claimed: U128,
}

#[near(serializers = [json])]
pub struct PositionView {
    pub shares: U128,
    pub locked: U128,
    pub deposited: U128,
    pub claimed: U128,
}

#[near(serializers = [json])]
pub struct VaultView {
    pub vault_account: Option<String>,
    pub total_shares: U128,
    pub book_nav: U128,
    pub price: U128,
    pub hwm: U128,
    pub epoch: u64,
    pub last_nav_ms: u64,
    pub stale: bool,
    pub emergency: bool,
    pub leader_shares: U128,
    pub pending_withdrawals: u32,
    pub signals: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    cfg: Config,
    /// Hex of the vault's MPC-derived ed25519 public key = its implicit account id.
    vault_account: Option<String>,
    shares: LookupMap<AccountId, u128>,
    locked: LookupMap<AccountId, u128>,
    total_shares: u128,
    /// NAV at the last post, plus deposits since, minus payouts since.
    book_nav: u128,
    hwm: u128,
    last_nav_ms: u64,
    epoch: u64,
    emergency: bool,
    navs: Vector<NavPost>,
    pending: IterableMap<u64, WithdrawRequest>,
    next_request: u64,
    claims: Vector<Claim>,
    signals: Vector<Signal>,
    signal_key: Option<String>,
    basis: LookupMap<AccountId, Basis>,
    /// 1Click deposit addresses already paid by a signed transfer: one quote, one transfer.
    used_deposits: LookupSet<String>,
    signal_hashes: LookupSet<String>,
}

#[near]
impl Vault {
    #[init]
    pub fn new(cfg: Config) -> Self {
        require!(cfg.min_leader_bps as u128 <= math::BPS && cfg.perf_fee_bps as u128 <= 5000, "bad bps");
        require!(cfg.max_slippage_bps <= 500, "max slippage above 5%");
        require!(cfg.allowed_assets.contains(&cfg.base_asset_id), "allowed_assets must include the base asset");
        require!(quote::decode_ed25519::<32>(&cfg.oneclick_key).is_some(), "bad oneclick_key");
        require!(quote::decode_ed25519::<32>(&cfg.attestation_key).is_some(), "bad attestation_key");
        #[cfg(feature = "drill")]
        require!(env::current_account_id().as_str().ends_with(".testnet"), "drill builds are testnet only");
        Self {
            cfg,
            vault_account: None,
            shares: LookupMap::new(b"s"),
            locked: LookupMap::new(b"l"),
            total_shares: 0,
            book_nav: 0,
            hwm: math::PRICE_SCALE,
            last_nav_ms: 0,
            epoch: 0,
            emergency: false,
            navs: Vector::new(b"n"),
            pending: IterableMap::new(b"p"),
            next_request: 0,
            claims: Vector::new(b"c"),
            signals: Vector::new(b"g"),
            signal_key: None,
            basis: LookupMap::new(b"b"),
            used_deposits: LookupSet::new(b"u"),
            signal_hashes: LookupSet::new(b"h"),
        }
    }

    // ---------- activation: learn our own MPC key from the MPC contract ----------

    /// Anyone may call once. The vault account comes from the MPC contract, not
    /// from any party, so no one can point deposits at an account they control.
    pub fn activate(&mut self) -> Promise {
        require!(self.vault_account.is_none(), "already active");
        ext_mpc::ext(self.cfg.mpc_contract.clone())
            .with_static_gas(Gas::from_tgas(10))
            .derived_public_key(self.cfg.mpc_path.clone(), env::current_account_id(), MPC_DOMAIN_EDDSA)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_activate())
    }

    #[private]
    pub fn on_activate(&mut self, #[callback_result] r: Result<String, PromiseError>) {
        let pk = r
            .ok()
            .and_then(|s| quote::decode_ed25519::<32>(&s))
            .unwrap_or_else(|| env::panic_str("MPC derived_public_key failed"));
        if self.vault_account.is_none() {
            self.vault_account = Some(hex(&pk));
            self.last_nav_ms = now_ms();
            env::log_str(&format!("silent-partner.activated vault_account={}", hex(&pk)));
        }
    }

    // ---------- deposits ----------

    /// NEP-141 receiver. `msg` must be empty. Returns the refund (unused) amount.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.cfg.base_token, "only the base token");
        match self.try_deposit(&sender_id, amount.0, &msg) {
            Ok(minted) => {
                env::log_str(&format!("silent-partner.deposit account={sender_id} amount={} shares={minted}", amount.0));
                if let (Some(intents), Some(vault)) = (self.cfg.intents_contract.clone(), self.vault_account.clone()) {
                    // Credit the vault's public intents account; the operator shields it.
                    let _ = ext_ft::ext(self.cfg.base_token.clone())
                        .with_attached_deposit(NearToken::from_yoctonear(1))
                        .with_static_gas(GAS_FT_FORWARD)
                        .ft_transfer_call(intents, amount, None, vault);
                }
                PromiseOrValue::Value(U128(0))
            }
            Err(why) => {
                env::log_str(&format!("silent-partner.deposit_refused account={sender_id} reason={why}"));
                PromiseOrValue::Value(amount)
            }
        }
    }

    /// Operator: retry forwarding base tokens held here to the vault's intents account.
    pub fn forward_to_intents(&mut self, amount: U128) -> Promise {
        self.only_operator();
        let intents = self.cfg.intents_contract.clone().unwrap_or_else(|| env::panic_str("no intents contract"));
        let vault = self.vault_account.clone().unwrap_or_else(|| env::panic_str("not active"));
        ext_ft::ext(self.cfg.base_token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_FORWARD)
            .ft_transfer_call(intents, amount, None, vault)
    }

    // ---------- withdrawals ----------

    /// Lock `shares` for burning at the next NAV. Payout goes to `exit_account` on intents.near.
    pub fn request_withdraw(&mut self, shares: U128, exit_account: AccountId) -> u64 {
        require!(!self.emergency, "emergency: use emergency_exit");
        let who = env::predecessor_account_id();
        let s = shares.0;
        require!(s > 0, "zero shares");
        require!(self.free_shares(&who) >= s, "not enough free shares");
        require!(self.pending.len() < MAX_PENDING_WITHDRAWALS, "withdrawal queue full");
        require!(!self.pending.values().any(|r| r.account == who), "one pending withdrawal per account");
        // No dust requests (they cost storage and queue slots), unless it's everything you have.
        require!(
            s == self.free_shares(&who) || math::payout_for_shares(s, self.book_nav, self.total_shares) >= self.cfg.min_deposit.0,
            "withdrawal below the minimum (withdraw all, or at least min_deposit)"
        );
        if who == self.cfg.leader {
            // Conservative: other holders' pending withdrawals don't count as gone
            // (they can cancel), only the leader's own locked shares do.
            let leader_left = self.balance(&who) - self.locked_of(&who) - s;
            let total_left = self.total_shares - self.locked_of(&who) - s;
            require!(
                math::leader_ok(leader_left, total_left, self.cfg.min_leader_bps as u128) || total_left == leader_left,
                "leader stake would fall below minimum"
            );
        }
        self.locked.insert(who.clone(), self.locked_of(&who) + s);
        let id = self.next_request;
        self.next_request += 1;
        self.pending.insert(
            id,
            WithdrawRequest {
                id,
                account: who.clone(),
                shares,
                exit_account,
                requested_ms: now_ms(),
            },
        );
        env::log_str(&format!("silent-partner.withdraw_requested id={id} account={who} shares={s}"));
        id
    }

    pub fn cancel_withdraw(&mut self, id: u64) {
        let r = self.pending.get(&id).cloned().unwrap_or_else(|| env::panic_str("no such request"));
        require!(r.account == env::predecessor_account_id(), "not yours");
        self.pending.remove(&id);
        self.locked.insert(r.account.clone(), self.locked_of(&r.account) - r.shares.0);
    }

    // ---------- NAV ----------

    /// The exact bytes the attestation key signs.
    pub fn nav_message(&self, epoch: u64, nav: U128, timestamp_ms: u64, fills_head: String) -> String {
        format!(
            "silent-partner/nav/v1|{}|{epoch}|{}|{timestamp_ms}|{fills_head}",
            env::current_account_id(),
            nav.0
        )
    }

    /// Operator: post NAV for the next epoch. Charges the performance fee, then
    /// burns every pending withdrawal at the post-fee price and opens claims.
    pub fn post_nav(&mut self, epoch: u64, nav: U128, timestamp_ms: u64, fills_head: String, signature: String) -> NavPost {
        self.only_operator();
        require!(self.vault_account.is_some(), "not active");
        require!(!self.emergency, "emergency");
        require!(epoch == self.epoch + 1, "epoch must be last + 1");
        require!(timestamp_ms > self.last_nav_ms && timestamp_ms <= now_ms() + 60_000, "bad timestamp");
        require!(
            fills_head.len() == 64 && fills_head.bytes().all(|c| c.is_ascii_hexdigit()),
            "fills_head must be 32-byte hex"
        );
        let key = quote::decode_ed25519::<32>(&self.cfg.attestation_key).unwrap();
        let sig = quote::decode_ed25519::<64>(&signature).unwrap_or_else(|| env::panic_str("bad signature encoding"));
        let msg = self.nav_message(epoch, nav, timestamp_ms, fills_head.clone());
        require!(env::ed25519_verify(&sig, msg.as_bytes(), &key), "NAV signature does not verify");

        let (fee_shares, hwm) = math::performance_fee(nav.0, self.total_shares, self.hwm, self.cfg.perf_fee_bps as u128);
        if fee_shares > 0 {
            let leader = self.cfg.leader.clone();
            self.shares.insert(leader.clone(), self.balance(&leader) + fee_shares);
            self.total_shares += fee_shares;
        }
        self.hwm = hwm;
        let price = math::price(nav.0, self.total_shares);
        let (mut nav_left, mut withdrawn) = (nav.0, 0u128);
        let reqs: Vec<WithdrawRequest> = self.pending.values().cloned().collect();
        self.pending.clear();
        for r in reqs {
            let pay = math::payout_for_shares(r.shares.0, nav_left, self.total_shares);
            self.burn(&r.account, r.shares.0);
            nav_left -= pay;
            withdrawn += pay;
            self.open_claim(r.account, r.exit_account, pay, epoch, false);
        }
        self.book_nav = nav_left;
        self.epoch = epoch;
        self.last_nav_ms = timestamp_ms;
        let post = NavPost {
            epoch,
            nav,
            timestamp_ms,
            block_ms: now_ms(),
            price: U128(price),
            total_shares: U128(self.total_shares),
            fee_shares: U128(fee_shares),
            withdrawn: U128(withdrawn),
            fills_head,
            signature,
        };
        self.navs.push(post.clone());
        env::log_str(&format!(
            "silent-partner.nav epoch={epoch} nav={} price={price} fee_shares={fee_shares} withdrawn={withdrawn}",
            nav.0
        ));
        post
    }

    // ---------- signals ----------

    /// Leader: the ed25519 key that signs signals (`ed25519:…`).
    pub fn set_signal_key(&mut self, public_key: String) {
        require!(env::predecessor_account_id() == self.cfg.leader, "only the leader");
        require!(quote::decode_ed25519::<32>(&public_key).is_some(), "bad key");
        self.signal_key = Some(public_key);
    }

    /// Operator: record an executed signal. `leader_sig` must be the leader's
    /// signal key signing the 32 raw bytes of `hash`.
    pub fn record_signal(&mut self, hash: String, leader_sig: String, fill_hash: String, executed_ms: u64) -> u64 {
        self.only_operator();
        let h = unhex32(&hash).unwrap_or_else(|| env::panic_str("hash must be 32-byte hex"));
        require!(unhex32(&fill_hash).is_some(), "fill_hash must be 32-byte hex");
        let key = self
            .signal_key
            .as_deref()
            .and_then(quote::decode_ed25519::<32>)
            .unwrap_or_else(|| env::panic_str("leader has no signal key"));
        let sig = quote::decode_ed25519::<64>(&leader_sig).unwrap_or_else(|| env::panic_str("bad signature encoding"));
        require!(env::ed25519_verify(&sig, h, &key), "leader signature does not verify");
        require!(executed_ms <= now_ms() + 60_000, "executed in the future");
        require!(self.signal_hashes.insert(hash.clone()), "signal already recorded");
        let index = self.signals.len() as u64;
        self.signals.push(Signal {
            index,
            hash,
            leader_sig,
            fill_hash,
            executed_ms,
            recorded_ms: now_ms(),
            epoch: self.epoch,
        });
        index
    }

    // ---------- emergency ----------

    /// Anyone, once NAV is stale, or once `overdue_claim` has been left unpaid
    /// for `CLAIM_GRACE_MS` (an operator that posts NAV but censors payouts). Sticky.
    pub fn trigger_emergency(&mut self, overdue_claim: Option<u64>) {
        require!(self.vault_account.is_some(), "not active");
        let overdue = overdue_claim
            .and_then(|id| self.claims.get(id as u32))
            .is_some_and(|c| open_of(c) > 0 && now_ms() > c.opened_ms + CLAIM_GRACE_MS);
        require!(self.is_stale() || overdue, "NAV is fresh and no claim is overdue");
        if self.emergency {
            return;
        }
        self.emergency = true;
        // Pending withdrawals become exits at the last NAV.
        let reqs: Vec<WithdrawRequest> = self.pending.values().cloned().collect();
        self.pending.clear();
        for r in reqs {
            let pay = math::payout_for_shares(r.shares.0, self.book_nav, self.total_shares);
            self.burn(&r.account, r.shares.0);
            self.book_nav -= pay;
            self.open_claim(r.account, r.exit_account, pay, self.epoch, true);
        }
        env::log_str("silent-partner.emergency");
    }

    /// Holder, in emergency: burn all shares at the last NAV and open a claim.
    pub fn emergency_exit(&mut self, exit_account: AccountId) -> u64 {
        require!(self.emergency, "not in emergency");
        let who = env::predecessor_account_id();
        let s = self.balance(&who);
        require!(s > 0, "no shares");
        let pay = math::payout_for_shares(s, self.book_nav, self.total_shares);
        self.burn(&who, s);
        self.book_nav -= pay;
        self.open_claim(who, exit_account, pay, self.epoch, true)
    }

    // ---------- signing through MPC ----------

    /// Ask MPC to sign `payload` with the vault key, after binding it.
    ///
    /// * `Login`: empty intents for the public verifier, deadline ≤ 5 min. Operator only.
    /// * `Shield`: 1Click quote INTENTS → CONFIDENTIAL_INTENTS of one asset, into the vault.
    /// * `Trade`: CONFIDENTIAL_INTENTS on all legs between allowed assets, paying and
    ///   refunding the vault, slippage ≤ max. In emergency: to the base asset only.
    /// * `Unshield`: CONFIDENTIAL_INTENTS → INTENTS of one asset back to the vault's
    ///   own public balance.
    /// * `PublicPayout{claim}`: no quote; one transfer of the base asset from the
    ///   vault's public balance to the claim's exit account, ≤ what is open, with a
    ///   plain nonce and a deadline 5–60 min ahead.
    ///
    /// Operator only, except in emergency: anyone may Shield, Trade (unwind) and
    /// Unshield (all of which pay the vault itself), and a claimant may pay out
    /// their own claim. Quote-bound transfers must pay exactly the quote's
    /// `amountIn` of the right token to its deposit address, once per quote.
    pub fn sign_intent(&mut self, kind: SignKind, payload: Nep413Payload, quote: Option<SignedQuote>) -> Promise {
        let vault = self.vault_account.clone().unwrap_or_else(|| env::panic_str("not active"));
        let caller = env::predecessor_account_id();
        let is_op = caller == self.cfg.operator;
        let p = intent::parse(&payload).unwrap_or_else(|e| env::panic_str(&format!("payload refused: {e:?}")));
        require!(p.signer_id == vault, "payload signer is not the vault");
        let now = now_ms();
        require!(
            p.deadline_ms > now && p.deadline_ms <= now + MAX_INTENT_AHEAD_MS,
            "payload deadline out of window"
        );
        let prehash_hex = hex(&p.prehash);
        let mut claim_reserve: Option<(u64, U128, U64)> = None;
        // The public verifier the vault's intents.near-side payloads are for.
        let public_verifier = self.public_verifier();
        match (&kind, &p.kind) {
            (SignKind::Login, Parsed::Login) => {
                require!(is_op, "only the operator");
                require!(p.recipient == public_verifier, "login is for the public intents contract");
                require!(p.deadline_ms <= now + MAX_LOGIN_AHEAD_MS, "login deadline too far ahead");
                require!(quote.is_none(), "login takes no quote");
            }
            (SignKind::Login, _) | (_, Parsed::Login) => env::panic_str("kind and payload disagree"),
            (SignKind::PublicPayout { claim_id }, Parsed::Transfer { receiver_id, token, amount }) => {
                require!(quote.is_none(), "public payout takes no quote");
                require!(p.recipient == public_verifier, "public payout is for the public intents contract");
                require!(token == &self.cfg.base_asset_id, "payouts are in the base asset");
                let c = self.claims.get(*claim_id as u32).unwrap_or_else(|| env::panic_str("no such claim"));
                require!(
                    is_op || (self.emergency && caller == c.account),
                    "only the operator, or the claimant in emergency"
                );
                require!(receiver_id == c.exit_account.as_str(), "payout must go to the claim's exit account");
                require!(*amount > 0 && *amount <= open_of(c), "payout exceeds the claim");
                require!(p.deadline_ms >= now + MIN_PAYOUT_AHEAD_MS, "payout deadline too soon");
                require!(!p.nonce.starts_with(&VERSIONED_NONCE_PREFIX), "payouts need a plain nonce");
                require!(!c.in_flight.iter().any(|f| f.prehash == prehash_hex), "payload already in flight");
                claim_reserve = Some((*claim_id, U128(*amount), U64(p.deadline_ms)));
            }
            (_, Parsed::Transfer { receiver_id, token, amount }) => {
                require!(is_op || self.emergency, "only the operator");
                let q = quote.as_ref().unwrap_or_else(|| env::panic_str("quote required"));
                let key = quote::decode_ed25519::<32>(&self.cfg.oneclick_key).unwrap();
                let f = quote::verify(q, &key).unwrap_or_else(|e| env::panic_str(&format!("quote refused: {e:?}")));
                require!(&f.deposit_address == receiver_id, "transfer must pay the quote's deposit address");
                require!(*amount == f.amount_in, "transfer amount must equal the quote's amountIn");
                require!(p.deadline_ms <= f.deadline_ms, "payload outlives the quote");
                require!(f.slippage_bps <= self.cfg.max_slippage_bps as u64, "slippage above max");
                let (want_token, want_recipient) = match f.deposit_type.as_str() {
                    "INTENTS" => (f.origin_asset.clone(), public_verifier.as_str()),
                    "CONFIDENTIAL_INTENTS" => (imt(&f.origin_asset), "intents.far"),
                    _ => env::panic_str("unsupported depositType"),
                };
                require!(token == &want_token, "transfer token does not match the quote's origin asset");
                require!(p.recipient == want_recipient, "payload recipient does not match depositType");
                match kind {
                    SignKind::Shield => self.check_shield(&f, &vault),
                    SignKind::Trade => self.check_trade(&f, &vault),
                    SignKind::Unshield => self.check_unshield(&f, &vault),
                    SignKind::Login | SignKind::PublicPayout { .. } => unreachable!(),
                }
                require!(!self.used_deposits.contains(&f.deposit_address), "quote already used");
                self.used_deposits.insert(f.deposit_address.clone());
            }
        }
        if let Some((id, amt, dl)) = &claim_reserve {
            let mut c = self.claims.get(*id as u32).cloned().unwrap();
            c.in_flight.push(InFlight {
                prehash: prehash_hex.clone(),
                nonce: payload.nonce.clone(),
                amount: *amt,
                deadline_ms: dl.0,
                signed: false,
            });
            self.claims.replace(*id as u32, c);
        }
        let request = near_sdk::serde_json::json!({
            "path": self.cfg.mpc_path, "payload_v2": { "Eddsa": prehash_hex }, "domain_id": MPC_DOMAIN_EDDSA
        });
        let log_signature = kind != SignKind::Login;
        ext_mpc::ext(self.cfg.mpc_contract.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_MPC_SIGN)
            .sign(request)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_signed(prehash_hex, claim_reserve, log_signature),
            )
    }

    /// Returns `ed25519:<base58 signature>` and checks it against the vault key.
    /// A failed sign releases the claim reservation it made. Payout signatures
    /// are logged so anyone (the claimant, in emergency) can submit them; login
    /// signatures are not.
    #[private]
    pub fn on_signed(
        &mut self,
        prehash_hex: String,
        claim: Option<(u64, U128, U64)>,
        log_signature: bool,
        #[callback_result] r: Result<near_sdk::serde_json::Value, PromiseError>,
    ) -> Option<String> {
        let sig = r.ok().and_then(|v| {
            let bytes: Vec<u8> = v
                .get("signature")?
                .as_array()?
                .iter()
                .map(|b| b.as_u64().map(|x| x as u8))
                .collect::<Option<_>>()?;
            <[u8; 64]>::try_from(bytes).ok()
        });
        let ok = match (&sig, self.vault_account.as_deref().and_then(unhex32), unhex32(&prehash_hex)) {
            (Some(s), Some(pk), Some(h)) => env::ed25519_verify(s, h, &pk),
            _ => false,
        };
        if let Some((id, _, _)) = claim {
            let mut c = self.claims.get(id as u32).cloned().unwrap();
            if let Some(i) = c.in_flight.iter().position(|f| f.prehash == prehash_hex && !f.signed) {
                if ok {
                    c.in_flight[i].signed = true;
                } else {
                    c.in_flight.remove(i);
                }
            }
            self.claims.replace(id as u32, c);
        }
        if !ok {
            env::log_str(&format!("silent-partner.sign_failed prehash={prehash_hex}"));
            return None;
        }
        let out = format!("ed25519:{}", near_sdk::bs58::encode(sig.unwrap()).into_string());
        if log_signature {
            env::log_str(&format!("silent-partner.signed prehash={prehash_hex} signature={out}"));
        }
        Some(out)
    }

    /// Anyone: settle an in-flight payout against the public verifier's record.
    /// If the payload's nonce is used, the payout executed: it's paid. If not and
    /// its deadline has passed, it can never execute: it's released. Otherwise
    /// nothing changes. Nobody has to be trusted about what happened.
    pub fn settle_payout(&mut self, claim_id: u64, prehash: String) -> Promise {
        let c = self.claims.get(claim_id as u32).unwrap_or_else(|| env::panic_str("no such claim"));
        let f = c
            .in_flight
            .iter()
            .find(|f| f.prehash == prehash)
            .unwrap_or_else(|| env::panic_str("no such payout"));
        let vault = self.vault_account.clone().unwrap();
        ext_verifier::ext(self.public_verifier().parse().unwrap())
            .with_static_gas(GAS_VIEW)
            .is_nonce_used(vault, f.nonce.clone())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_settle(claim_id, prehash))
    }

    #[private]
    pub fn on_settle(&mut self, claim_id: u64, prehash: String, #[callback_result] used: Result<bool, PromiseError>) -> String {
        let Ok(used) = used else {
            return "verifier unavailable".into();
        };
        let mut c = self.claims.get(claim_id as u32).cloned().unwrap();
        let Some(i) = c.in_flight.iter().position(|f| f.prehash == prehash) else {
            return "already settled".into();
        };
        let out = if used {
            c.paid = U128(c.paid.0 + c.in_flight[i].amount.0);
            c.in_flight.remove(i);
            "paid"
        } else if now_ms() > c.in_flight[i].deadline_ms {
            c.in_flight.remove(i);
            "released"
        } else {
            "pending"
        };
        self.claims.replace(claim_id as u32, c);
        env::log_str(&format!("silent-partner.settle claim={claim_id} prehash={prehash} result={out}"));
        out.into()
    }

    // ---------- views ----------

    pub fn get_config(&self) -> Config {
        self.cfg.clone()
    }

    pub fn get_vault(&self) -> VaultView {
        VaultView {
            vault_account: self.vault_account.clone(),
            total_shares: U128(self.total_shares),
            book_nav: U128(self.book_nav),
            price: U128(math::price(self.book_nav, self.total_shares)),
            hwm: U128(self.hwm),
            epoch: self.epoch,
            last_nav_ms: self.last_nav_ms,
            stale: self.is_stale(),
            emergency: self.emergency,
            leader_shares: U128(self.balance(&self.cfg.leader)),
            pending_withdrawals: self.pending.len(),
            signals: self.signals.len() as u64,
        }
    }

    pub fn get_shares(&self, account_id: AccountId) -> (U128, U128) {
        (U128(self.balance(&account_id)), U128(self.locked_of(&account_id)))
    }

    pub fn get_navs(&self, from: u64, limit: u64) -> Vec<NavPost> {
        (from..from.saturating_add(limit).min(self.navs.len() as u64))
            .filter_map(|i| self.navs.get(i as u32).cloned())
            .collect()
    }

    pub fn get_signals(&self, from: u64, limit: u64) -> Vec<Signal> {
        (from..from.saturating_add(limit).min(self.signals.len() as u64))
            .filter_map(|i| self.signals.get(i as u32).cloned())
            .collect()
    }

    pub fn get_pending(&self) -> Vec<WithdrawRequest> {
        self.pending.values().cloned().collect()
    }

    pub fn get_claims(&self, from: u64, limit: u64) -> Vec<Claim> {
        (from..from.saturating_add(limit).min(self.claims.len() as u64))
            .filter_map(|i| self.claims.get(i as u32).cloned())
            .collect()
    }

    pub fn get_signal_key(&self) -> Option<String> {
        self.signal_key.clone()
    }

    /// Shares plus cost basis: P&L = shares × price + claimed − deposited.
    pub fn get_position(&self, account_id: AccountId) -> PositionView {
        let b = self.basis.get(&account_id).cloned().unwrap_or_default();
        PositionView {
            shares: U128(self.balance(&account_id)),
            locked: U128(self.locked_of(&account_id)),
            deposited: b.deposited,
            claimed: b.claimed,
        }
    }
}

// ---------- internals ----------

impl Vault {
    fn only_operator(&self) {
        require!(env::predecessor_account_id() == self.cfg.operator, "only the operator");
    }

    fn public_verifier(&self) -> String {
        self.cfg
            .intents_contract
            .as_ref()
            .map(|a| a.to_string())
            .unwrap_or_else(|| "intents.near".into())
    }

    fn is_stale(&self) -> bool {
        self.vault_account.is_some() && now_ms() > self.last_nav_ms + NAV_STALE_MS
    }

    fn balance(&self, a: &AccountId) -> u128 {
        self.shares.get(a).copied().unwrap_or(0)
    }

    fn locked_of(&self, a: &AccountId) -> u128 {
        self.locked.get(a).copied().unwrap_or(0)
    }

    fn free_shares(&self, a: &AccountId) -> u128 {
        self.balance(a) - self.locked_of(a)
    }

    fn try_deposit(&mut self, who: &AccountId, amount: u128, msg: &str) -> Result<u128, &'static str> {
        if !msg.is_empty() {
            return Err("msg must be empty");
        }
        if self.vault_account.is_none() {
            return Err("not active");
        }
        if self.emergency || self.is_stale() {
            return Err("deposits frozen: NAV stale or emergency");
        }
        if amount < self.cfg.min_deposit.0 {
            return Err("below minimum deposit");
        }
        let leader = &self.cfg.leader;
        if self.total_shares == 0 && who != leader {
            return Err("the leader seeds the vault first");
        }
        let minted = math::shares_for_deposit(amount, self.book_nav, self.total_shares).ok_or("vault has no value")?;
        if minted == 0 {
            return Err("deposit too small to mint a share");
        }
        // The leader's locked shares burn at the next NAV, so only their free shares count.
        let leader_locked = self.locked_of(leader);
        if who != leader
            && !math::leader_ok(
                self.balance(leader) - leader_locked,
                self.total_shares + minted - leader_locked,
                self.cfg.min_leader_bps as u128,
            )
        {
            return Err("leader stake would fall below minimum");
        }
        self.shares.insert(who.clone(), self.balance(who) + minted);
        self.total_shares += minted;
        self.book_nav += amount;
        let mut b = self.basis.get(who).cloned().unwrap_or_default();
        b.deposited = U128(b.deposited.0 + amount);
        self.basis.insert(who.clone(), b);
        Ok(minted)
    }

    fn burn(&mut self, a: &AccountId, s: u128) {
        let bal = self.balance(a);
        let lk = self.locked_of(a);
        self.shares.insert(a.clone(), bal - s);
        self.locked.insert(a.clone(), lk.saturating_sub(s));
        self.total_shares -= s;
    }

    fn open_claim(&mut self, account: AccountId, exit_account: AccountId, amount: u128, epoch: u64, emergency: bool) -> u64 {
        let id = self.claims.len() as u64;
        let mut b = self.basis.get(&account).cloned().unwrap_or_default();
        b.claimed = U128(b.claimed.0 + amount);
        self.basis.insert(account.clone(), b);
        self.claims.push(Claim {
            id,
            account: account.clone(),
            exit_account,
            amount: U128(amount),
            paid: U128(0),
            in_flight: vec![],
            epoch,
            emergency,
            opened_ms: now_ms(),
        });
        env::log_str(&format!("silent-partner.claim id={id} account={account} amount={amount} emergency={emergency}"));
        id
    }

    fn check_shield(&self, f: &QuoteFacts, vault: &str) {
        require!(
            f.deposit_type == "INTENTS" && f.recipient_type == "CONFIDENTIAL_INTENTS" && f.refund_type == "INTENTS",
            "not a shield quote"
        );
        require!(f.origin_asset == f.destination_asset, "shield must keep the asset");
        require!(self.cfg.allowed_assets.contains(&f.origin_asset), "asset not allowed");
        require!(f.recipient == vault && f.refund_to == vault, "shield must pay and refund the vault");
    }

    fn check_trade(&self, f: &QuoteFacts, vault: &str) {
        require!(
            f.deposit_type == "CONFIDENTIAL_INTENTS" && f.recipient_type == "CONFIDENTIAL_INTENTS" && f.refund_type == "CONFIDENTIAL_INTENTS",
            "not a confidential trade quote"
        );
        require!(f.origin_asset != f.destination_asset, "trade must change asset");
        require!(
            self.cfg.allowed_assets.contains(&f.origin_asset) && self.cfg.allowed_assets.contains(&f.destination_asset),
            "asset not allowed"
        );
        require!(f.recipient == vault && f.refund_to == vault, "trade must pay and refund the vault");
        require!(f.min_amount_out > 0, "zero minAmountOut");
        if self.emergency {
            require!(f.destination_asset == self.cfg.base_asset_id, "emergency trades unwind to the base asset only");
        }
    }

    fn check_unshield(&self, f: &QuoteFacts, vault: &str) {
        require!(
            f.deposit_type == "CONFIDENTIAL_INTENTS" && f.recipient_type == "INTENTS" && f.refund_type == "CONFIDENTIAL_INTENTS",
            "not an unshield quote"
        );
        require!(f.origin_asset == f.destination_asset, "unshield must keep the asset");
        require!(self.cfg.allowed_assets.contains(&f.origin_asset), "asset not allowed");
        require!(f.recipient == vault && f.refund_to == vault, "unshield must pay and refund the vault");
    }
}

/// What a claim still has open: amount − paid − in flight.
fn open_of(c: &Claim) -> u128 {
    c.amount.0 - c.paid.0 - c.in_flight.iter().map(|x| x.amount.0).sum::<u128>()
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex32(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 {
        return None;
    }
    let v: Option<Vec<u8>> = (0..64).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect();
    v?.try_into().ok()
}

#[cfg(test)]
mod prop_tests;
#[cfg(test)]
mod tests;
