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
pub mod migrate;
pub mod quote;

/// Emergency round state (T5), kept under its own storage keys outside the root struct, so the
/// vault's stored layout is unchanged and live vaults upgrade by a plain code deploy.
pub mod rounds {
    use near_sdk::env;
    fn key(id: u64) -> Vec<u8> {
        let mut k = b"xa".to_vec();
        k.extend(id.to_le_bytes());
        k
    }
    fn read(k: &[u8]) -> u128 {
        env::storage_read(k).and_then(|v| v.try_into().ok()).map(u128::from_le_bytes).unwrap_or(0)
    }
    /// Cash a round has set aside for claim `id` (paid out of it so far included).
    pub fn alloc_of(id: u64) -> u128 {
        read(&key(id))
    }
    pub fn set_alloc(id: u64, v: u128) {
        if v == 0 {
            env::storage_remove(&key(id));
        } else {
            env::storage_write(&key(id), &v.to_le_bytes());
        }
    }
    /// Cash set aside for holders who haven't exited yet; each exit takes its part.
    pub fn pool_alloc() -> u128 {
        read(b"xp")
    }
    pub fn set_pool_alloc(v: u128) {
        env::storage_write(b"xp", &v.to_le_bytes());
    }
}

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
/// Stop-losses per vault (each is checked at every NAV post).
pub const MAX_STOPS: u32 = 100;
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
/// The round callback reads every claim once.
const GAS_ROUND: Gas = Gas::from_tgas(100);
/// The NAV callback burns up to 100 withdrawals.
const GAS_NAV_CALLBACK: Gas = Gas::from_tgas(200);
/// The cumulative NAV band's window.
pub const BAND_WINDOW_MS: u64 = 24 * 60 * 60 * 1000;
/// Window upside budget for oracle-priced vaults (testnet season).
pub const DEFAULT_WINDOW_UP_BPS: u16 = 300;
/// The two price-quote legs must be observed within this much of each other.
pub const MAX_LEG_GAP_MS: u64 = 30_000;

struct BandParams {
    tolerance: i128,
    slippage: i128,
    min_interval_ms: u64,
    window_up: i128,
}

/// A post whose callback never ran (out of gas) stops blocking after this long.
const POSTING_TIMEOUT_MS: u64 = 10 * 60 * 1000;
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

#[ext_contract(ext_oracle)]
pub trait PriceOracle {
    fn get_price_no_older_than(&self, price_id: String, age: u64) -> Option<OraclePrice>;
}

#[ext_contract(ext_verifier)]
pub trait Verifier {
    fn is_nonce_used(&self, account_id: String, nonce: String) -> bool;
    fn mt_balance_of(&self, account_id: String, token_id: String) -> U128;
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
    /// Bound each posted NAV by a public price (base + one risky asset only),
    /// read from a Pyth-compatible oracle. Used by the testnet season vaults.
    pub nav_oracle: Option<NavOracle>,
    /// Or by two 1Click-signed quotes passed with each post, verified with
    /// `oneclick_key`: the same signature root as every trade. Mainnet uses this.
    /// At most one of `nav_oracle` / `nav_quotes`; neither: attestation only.
    pub nav_quotes: Option<NavQuotes>,
}

/// NAV price from two signed 1Click quotes per post: base → risky and risky →
/// base, at most `max_age_ms` old. Their bid/ask bracket sets the price; its
/// half-spread widens the band (as the oracle's confidence would).
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct NavQuotes {
    /// 1Click asset ids priced (normally `base_asset_id` and the risky allowed asset).
    pub base_id: String,
    pub risk_id: String,
    pub max_age_ms: u64,
    pub tolerance_bps: u16,
    /// Quotes wider than this (half-spread) are refused: a huge quote size can't buy a wide band.
    pub max_spread_bps: u16,
    /// Minimum time between bounded posts: the per-post allowance can't be stacked by posting often.
    pub min_interval_ms: u64,
    /// 24h envelope: the share return since the window's anchor may exceed the risky asset's
    /// return over the same window by at most this much (active-trading allowance per day).
    pub window_up_bps: u16,
}

/// A price at a NAV post: `mid` in the source's own fixed-point units, and how
/// uncertain it is (oracle confidence, or the quotes' half-spread), in bps.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct PricePoint {
    pub mid: U128,
    pub half_spread_bps: u32,
    pub source: String,
    /// When the price was observed (oldest quote timestamp / oracle publish time), ms.
    pub observed_ms: u64,
}

/// Where the band starts: the price and the post-burn share price at a post.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct BandRef {
    pub point: PricePoint,
    /// Share price × 1e18 after the post's fee and burns (what the holders who stay hold).
    pub share_price: U128,
    pub at_ms: u64,
}

/// The risky asset's path through the current 24h window, split into runs at the
/// weight changes the leader actually made: signals recorded on chain, each verified
/// against the leader's signal key, so the operator can't add one alone (operator-
/// requested trades don't count, or a dust trade per post would open a run each time). Within a run the vault's weight
/// is constant, so its return lies between 0 and the run's asset return; across
/// runs, between the products of the runs' down- and up-moves. Kept under its own
/// storage key, so live vaults need no state migration.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct BandPath {
    /// The window this path belongs to (`band_anchor.at_ms`).
    pub anchor_at_ms: u64,
    /// Products of (1 + max(0, r)) and (1 + min(0, r)) over the closed runs, × 1e18.
    pub up: U128,
    pub down: U128,
    /// The price where the open run started.
    pub run_mid: U128,
    /// Leader signals recorded at the last bounded post.
    pub signals: u64,
}

const BAND_PATH_KEY: &[u8] = b"band_path";
/// (reference post's `at_ms`, bps): how far the last accepted post fell below the
/// asset's per-post envelope. The next post may recover exactly that (D-H-8).
const BAND_DIP_KEY: &[u8] = b"band_dip";

/// A Pyth-compatible price feed for the vault's risky asset in base units
/// (`get_price_no_older_than(price_id, age) -> Option<Price>`), e.g.
/// `pyth-oracle.near` with the NEAR/USD feed.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct NavOracle {
    pub contract: AccountId,
    /// Feed id, 32 bytes hex (no 0x).
    pub price_id: String,
    /// Oldest acceptable price, seconds.
    pub max_age_s: u64,
    /// Added to the band on top of `max_slippage_bps` and the oracle's
    /// confidence: fees and valuation differences (1Click quotes vs. oracle).
    pub tolerance_bps: u16,
}

/// Pyth's price shape: `price × 10^expo`, ± `conf`.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct OraclePrice {
    pub price: near_sdk::json_types::I64,
    pub conf: U64,
    pub expo: i32,
    pub publish_time: i64,
}

/// A withdrawal priced at one NAV post and burned at the next, at the lower price.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Maturing {
    pub request: WithdrawRequest,
    /// Post-fee share price × 1e18 at the post that priced it.
    pub priced_at: U128,
    pub priced_epoch: u64,
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
    /// Withdrawals priced at the last post, burned at the next.
    maturing: IterableMap<u64, Maturing>,
    /// The last bounded post (per-post band) and the 24h window's anchor (cumulative band).
    band_ref: Option<BandRef>,
    band_anchor: Option<BandRef>,
    /// Trade transfers the vault key signed since the window's anchor (each may cost up to max slippage).
    trades_since_anchor: u32,
    /// A post waiting for its oracle callback (block ms), 0 when none.
    posting_since_ms: u64,
    /// Followers' copy stop-losses, checked at every NAV post.
    stops: IterableMap<AccountId, StopLoss>,
}

/// A follower's auto-exit: when a post's share price falls to `trigger_price`,
/// all their free shares are queued for withdrawal, priced at that post.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct StopLoss {
    pub drawdown_bps: u16,
    /// Share price (× 1e18) when set: the stop is measured from here.
    pub ref_price: U128,
    pub trigger_price: U128,
    pub exit_account: AccountId,
    pub set_ms: u64,
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
        require!(cfg.nav_oracle.is_none() || cfg.nav_quotes.is_none(), "one NAV price source at most");
        if let Some(q) = &cfg.nav_quotes {
            require!(cfg.allowed_assets.len() == 2, "the NAV bound needs exactly base + one risky asset");
            require!(q.base_id != q.risk_id, "quote assets must differ");
            require!(q.max_age_ms > 0 && q.max_age_ms <= 5 * 60 * 1000, "max_age_ms must be 1 ms..5 min");
            require!(
                q.tolerance_bps <= 500 && q.max_spread_bps <= 200 && q.window_up_bps <= 2000,
                "tolerance, spread cap or window too wide"
            );
            // On mainnet the quoted pair must be the vault's own assets. (Testnet vaults
            // price the mainnet pair, since 1Click has no testnet.)
            if !env::current_account_id().as_str().ends_with(".testnet") {
                require!(
                    q.base_id == cfg.base_asset_id && cfg.allowed_assets.contains(&q.risk_id),
                    "quote assets must be the vault's"
                );
            }
        }
        if let Some(o) = &cfg.nav_oracle {
            require!(cfg.allowed_assets.len() == 2, "the NAV bound needs exactly base + one risky asset");
            require!(unhex32(&o.price_id).is_some(), "price_id must be 32-byte hex");
            require!(o.max_age_s > 0 && o.max_age_s <= 3600, "max_age_s must be 1..3600");
            require!(o.tolerance_bps <= 1000, "tolerance above 10%");
        }
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
            maturing: IterableMap::new(b"m"),
            band_ref: None,
            band_anchor: None,
            trades_since_anchor: 0,
            posting_since_ms: 0,
            stops: IterableMap::new(b"t"),
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
        // `msg` may name the account the shares are for: deposits that arrive through
        // 1Click from another chain (`customRecipientMsg`) are sent by a relayer.
        let beneficiary = if msg.is_empty() {
            Ok(sender_id.clone())
        } else {
            msg.trim().parse::<AccountId>().map_err(|_| "msg must be empty or the account to credit")
        };
        let result = beneficiary.and_then(|b| self.try_deposit(&b, amount.0).map(|m| (b, m)));
        match result {
            Ok((who, minted)) => {
                env::log_str(&format!(
                    "silent-partner.deposit account={who} sender={sender_id} amount={} shares={minted}",
                    amount.0
                ));
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
        require!(self.pending.len() + self.maturing.len() < MAX_PENDING_WITHDRAWALS, "withdrawal queue full");
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

    // ---------- copy stop-loss ----------

    /// Follower: auto-exit if the share price falls `drawdown_bps` below today's
    /// book price. Checked by the contract at every NAV post; when it fires, all
    /// free shares are queued for withdrawal to `exit_account`, priced at that post.
    pub fn set_stop_loss(&mut self, drawdown_bps: u16, exit_account: AccountId) -> StopLoss {
        let who = env::predecessor_account_id();
        require!(who != self.cfg.leader, "the leader keeps a minimum stake: no stop-loss");
        require!((100..=9000).contains(&drawdown_bps), "drawdown must be 1%..90%");
        require!(self.balance(&who) > 0, "no shares");
        require!(
            self.stops.contains_key(&who) || self.stops.len() < MAX_STOPS,
            "too many stop-losses on this vault"
        );
        let ref_price = math::price(self.book_nav, self.total_shares);
        let stop = StopLoss {
            drawdown_bps,
            ref_price: U128(ref_price),
            trigger_price: U128(ref_price * (math::BPS - drawdown_bps as u128) / math::BPS),
            exit_account,
            set_ms: now_ms(),
        };
        self.stops.insert(who, stop.clone());
        stop
    }

    pub fn cancel_stop_loss(&mut self) {
        self.stops.remove(&env::predecessor_account_id());
    }

    pub fn get_stop_loss(&self, account_id: AccountId) -> Option<StopLoss> {
        self.stops.get(&account_id).cloned()
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
    /// `price_quotes`: for vaults with `nav_quotes`, two 1Click-signed quotes
    /// (base → risky, risky → base); ignored otherwise.
    pub fn post_nav(
        &mut self,
        epoch: u64,
        nav: U128,
        timestamp_ms: u64,
        fills_head: String,
        signature: String,
        price_quotes: Option<Vec<SignedQuote>>,
    ) -> PromiseOrValue<Option<NavPost>> {
        self.only_operator();
        self.check_nav_post(epoch, nav, timestamp_ms, &fills_head, &signature);
        if self.cfg.nav_quotes.is_some() {
            let p = self.price_from_quotes(price_quotes.unwrap_or_default());
            if let Err(why) = self.check_band(nav.0, &p) {
                env::log_str(&format!("silent-partner.nav_rejected epoch={epoch} nav={} reason={why}", nav.0));
                return PromiseOrValue::Value(None);
            }
            let share_pre = math::price(nav.0, self.total_shares);
            let post = self.apply_nav(epoch, nav, timestamp_ms, fills_head, signature);
            self.record_band(p, share_pre);
            return PromiseOrValue::Value(Some(post));
        }
        let Some(o) = self.cfg.nav_oracle.clone() else {
            return PromiseOrValue::Value(Some(self.apply_nav(epoch, nav, timestamp_ms, fills_head, signature)));
        };
        require!(
            self.posting_since_ms == 0 || now_ms() > self.posting_since_ms + POSTING_TIMEOUT_MS,
            "a NAV post is already waiting for its oracle price"
        );
        self.posting_since_ms = now_ms();
        PromiseOrValue::Promise(
            ext_oracle::ext(o.contract)
                .with_static_gas(GAS_VIEW)
                .get_price_no_older_than(o.price_id, o.max_age_s)
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_NAV_CALLBACK)
                        .on_nav_price(epoch, nav, timestamp_ms, fills_head, signature),
                ),
        )
    }

    /// Applies the NAV if the oracle answered with a fresh price and the per-share
    /// return since the last post lies in the band the risky asset's move allows.
    /// A rejection changes nothing (logged as `silent-partner.nav_rejected`).
    #[private]
    pub fn on_nav_price(
        &mut self,
        epoch: u64,
        nav: U128,
        timestamp_ms: u64,
        fills_head: String,
        signature: String,
        #[callback_result] r: Result<Option<OraclePrice>, PromiseError>,
    ) -> Option<NavPost> {
        self.posting_since_ms = 0;
        let reject = |why: String| {
            env::log_str(&format!("silent-partner.nav_rejected epoch={epoch} nav={} reason={why}", nav.0));
            None
        };
        let Ok(Some(p)) = r else {
            return reject("no fresh oracle price".into());
        };
        // The state may have moved while the oracle answered.
        if self.emergency || epoch != self.epoch + 1 || timestamp_ms <= self.last_nav_ms {
            return reject("stale post".into());
        }
        let Some(point) = oracle_point(&p) else {
            return reject("bad oracle price".into());
        };
        if let Err(why) = self.check_band(nav.0, &point) {
            return reject(why);
        }
        let share_pre = math::price(nav.0, self.total_shares);
        let post = self.apply_nav(epoch, nav, timestamp_ms, fills_head, signature);
        self.record_band(point, share_pre);
        Some(post)
    }

    pub fn get_maturing(&self) -> Vec<Maturing> {
        self.maturing.values().cloned().collect()
    }

    /// The per-post band a NAV for the next post must fall in, given a price now:
    /// (low, high) share return in bps against the reference share price (or the
    /// book price before the first bounded post). None for an unbounded vault.
    pub fn nav_band(&self, point: PricePoint) -> Option<(i64, i64)> {
        let b = self.band_params()?;
        let (lo, hi) = match &self.band_ref {
            Some(r) => {
                let ra = math::mid_return_bps(r.point.mid.0, point.mid.0)?;
                let spread = point.half_spread_bps as i128 + r.point.half_spread_bps as i128;
                (ra.min(0) - (b.slippage + b.tolerance + spread), ra.max(0) + b.tolerance + spread)
            }
            None => {
                let t = b.slippage + b.tolerance + point.half_spread_bps as i128;
                (-t, t)
            }
        };
        Some((lo as i64, hi as i64))
    }

    pub fn get_band_state(&self) -> (Option<BandRef>, Option<BandRef>, u32) {
        (self.band_ref.clone(), self.band_anchor.clone(), self.trades_since_anchor)
    }

    /// The 24h window's run-split price path (see `BandPath`).
    pub fn get_band_path(&self) -> Option<BandPath> {
        self.band_anchor.as_ref().map(|a| self.band_path_now(a))
    }

    /// Verify two signed quotes and return the price point they give (panics if refused).
    pub fn price_from_quotes(&self, price_quotes: Vec<SignedQuote>) -> PricePoint {
        let q = self.cfg.nav_quotes.as_ref().unwrap_or_else(|| env::panic_str("vault has no nav_quotes"));
        let key = quote::decode_ed25519::<32>(&self.cfg.oneclick_key).unwrap();
        let [a, b] = &price_quotes[..] else {
            env::panic_str("need exactly two price quotes")
        };
        let fa = quote::price_facts(a, &key).unwrap_or_else(|e| env::panic_str(&format!("price quote refused: {e:?}")));
        let fb = quote::price_facts(b, &key).unwrap_or_else(|e| env::panic_str(&format!("price quote refused: {e:?}")));
        let (buy, sell) = if fa.origin_asset == q.base_id { (fa, fb) } else { (fb, fa) };
        require!(buy.origin_asset == q.base_id && buy.destination_asset == q.risk_id, "need a base → risky quote");
        require!(
            sell.origin_asset == q.risk_id && sell.destination_asset == q.base_id,
            "need a risky → base quote"
        );
        let now = now_ms();
        for t in [buy.timestamp_ms, sell.timestamp_ms] {
            require!(t <= now + 60_000 && now.saturating_sub(t) <= q.max_age_ms, "price quote too old");
        }
        // One observation: both legs within 30 s of each other, the same size both ways
        // (the sell leg sells what the buy leg bought, ±5%).
        require!(
            buy.timestamp_ms.abs_diff(sell.timestamp_ms) <= MAX_LEG_GAP_MS,
            "price quotes not taken together"
        );
        require!(
            sell.amount_in.saturating_mul(100) >= buy.amount_out.saturating_mul(95) && sell.amount_in.saturating_mul(100) <= buy.amount_out.saturating_mul(105),
            "price quote legs differ in size"
        );
        let (mid, hs) = math::bracket(buy.amount_in, buy.amount_out, sell.amount_in, sell.amount_out).unwrap_or_else(|| env::panic_str("bad quote amounts"));
        require!(hs <= q.max_spread_bps as u32, "price quotes too wide");
        PricePoint {
            mid: U128(mid),
            half_spread_bps: hs,
            source: "1click".into(),
            observed_ms: buy.timestamp_ms.min(sell.timestamp_ms),
        }
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
        // Pending and maturing withdrawals become exits at the last NAV
        // (maturing ones at the lower of their priced-at and the last NAV).
        let mut reqs: Vec<(WithdrawRequest, u128)> = self.maturing.values().map(|m| (m.request.clone(), m.priced_at.0)).collect();
        reqs.extend(self.pending.values().map(|r| (r.clone(), u128::MAX)));
        self.maturing.clear();
        self.pending.clear();
        for (r, priced_at) in reqs {
            let pay = math::payout_for_shares(r.shares.0, self.book_nav, self.total_shares).min(if priced_at == u128::MAX {
                u128::MAX
            } else {
                r.shares.0 * priced_at / math::PRICE_SCALE
            });
            self.burn(&r.account, r.shares.0);
            self.book_nav -= pay;
            self.open_claim(r.account, r.exit_account, pay, self.epoch, true);
        }
        env::log_str("silent-partner.emergency");
    }

    /// Holder, in emergency: burn all shares at the last NAV and open a claim. The claim takes
    /// its part of the cash earlier rounds set aside for holders who hadn't exited yet (T5).
    pub fn emergency_exit(&mut self, exit_account: AccountId) -> u64 {
        require!(self.emergency, "not in emergency");
        let who = env::predecessor_account_id();
        let s = self.balance(&who);
        require!(s > 0, "no shares");
        let pay = math::payout_for_shares(s, self.book_nav, self.total_shares);
        let pool = rounds::pool_alloc();
        let part = math::pool_part(pool, s, self.total_shares);
        self.burn(&who, s);
        self.book_nav -= pay;
        let id = self.open_claim(who, exit_account, pay, self.epoch, true);
        rounds::set_pool_alloc(pool - part);
        rounds::set_alloc(id, part.min(pay));
        id
    }

    /// Anyone, in emergency: start a payout round (T5). It reads the vault's public base
    /// balance on the verifier and splits what isn't already set aside pro rata over every open
    /// claim and the holders still in, by what each is owed at the last price. Claimants can then
    /// pay out up to their allocation, so the last one out gets the same fraction as the first,
    /// whatever the unwind recovers. Call again after more is unwound or unshielded.
    pub fn emergency_round(&mut self) -> Promise {
        require!(self.emergency, "not in emergency");
        let vault = self.vault_account.clone().unwrap_or_else(|| env::panic_str("not active"));
        ext_verifier::ext(self.public_verifier().parse().unwrap())
            .with_static_gas(GAS_VIEW)
            .mt_balance_of(vault, self.cfg.base_asset_id.clone())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ROUND).on_round())
    }

    #[private]
    pub fn on_round(&mut self, #[callback_result] balance: Result<U128, PromiseError>) -> U128 {
        let Ok(balance) = balance else {
            env::log_str("silent-partner.round verifier unavailable");
            return U128(0);
        };
        let pool = rounds::pool_alloc();
        // What each claim already has covered: allocated, or paid and in flight (a claim paid
        // before the emergency was never allocated). Covered but unpaid cash is set aside.
        let n = self.claims.len();
        let (mut covered, mut owed) = (Vec::with_capacity(n as usize), Vec::with_capacity(n as usize));
        let mut reserved = pool;
        for i in 0..n {
            let c = &self.claims[i];
            let sent = c.paid.0 + c.in_flight.iter().map(|x| x.amount.0).sum::<u128>();
            let cov = rounds::alloc_of(i as u64).max(sent).min(c.amount.0);
            reserved += cov - c.paid.0.min(cov);
            owed.push(c.amount.0 - cov);
            covered.push(cov);
        }
        let cash = balance.0.saturating_sub(reserved);
        let (adds, pool_add) = math::round_adds(cash, &owed, self.book_nav.saturating_sub(pool));
        let mut given = pool_add;
        for i in 0..n as usize {
            if adds[i] > 0 || covered[i] != rounds::alloc_of(i as u64) {
                rounds::set_alloc(i as u64, covered[i] + adds[i]);
            }
            given += adds[i];
        }
        rounds::set_pool_alloc(pool + pool_add);
        env::log_str(&format!(
            "silent-partner.round balance={} free={cash} allocated={given} pool={}",
            balance.0,
            pool + pool_add
        ));
        U128(given)
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
                // In emergency every payout, the operator's included, waits for a round (T5).
                require!(
                    !self.emergency || *amount <= rounds::alloc_of(*claim_id).saturating_sub(c.amount.0 - open_of(c)),
                    "emergency: above this claim's round allocation; call emergency_round"
                );
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
                    SignKind::Trade => {
                        self.check_trade(&f, &vault);
                        self.trades_since_anchor = self.trades_since_anchor.saturating_add(1);
                    }
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

    /// Emergency rounds (T5): each claim's allocation from `from`, and the cash set aside for
    /// holders still in.
    pub fn get_rounds(&self, from: u64, limit: u64) -> (Vec<U128>, U128) {
        let end = (from + limit.min(200)).min(self.claims.len() as u64);
        ((from..end).map(|i| U128(rounds::alloc_of(i))).collect(), U128(rounds::pool_alloc()))
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
            pending_withdrawals: self.pending.len() + self.maturing.len(),
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

    fn check_nav_post(&self, epoch: u64, nav: U128, timestamp_ms: u64, fills_head: &str, signature: &str) {
        require!(self.vault_account.is_some(), "not active");
        require!(!self.emergency, "emergency");
        require!(epoch == self.epoch + 1, "epoch must be last + 1");
        require!(timestamp_ms > self.last_nav_ms && timestamp_ms <= now_ms() + 60_000, "bad timestamp");
        require!(
            fills_head.len() == 64 && fills_head.bytes().all(|c| c.is_ascii_hexdigit()),
            "fills_head must be 32-byte hex"
        );
        let key = quote::decode_ed25519::<32>(&self.cfg.attestation_key).unwrap();
        let sig = quote::decode_ed25519::<64>(signature).unwrap_or_else(|| env::panic_str("bad signature encoding"));
        let msg = self.nav_message(epoch, nav, timestamp_ms, fills_head.to_string());
        require!(env::ed25519_verify(&sig, msg.as_bytes(), &key), "NAV signature does not verify");
    }

    fn band_params(&self) -> Option<BandParams> {
        let (tolerance, min_interval, window_up) = match (&self.cfg.nav_quotes, &self.cfg.nav_oracle) {
            (Some(q), _) => (q.tolerance_bps, q.min_interval_ms, q.window_up_bps),
            (_, Some(o)) => (o.tolerance_bps, 0, DEFAULT_WINDOW_UP_BPS),
            _ => return None,
        };
        Some(BandParams {
            tolerance: tolerance as i128,
            slippage: self.cfg.max_slippage_bps as i128,
            min_interval_ms: min_interval,
            window_up: window_up as i128,
        })
    }

    /// The NAV bound. Returns are share returns in bps; r is the risky asset's
    /// return over the same span (mid to mid).
    /// * No holders: NAV can't exceed book NAV (no value can appear with nobody to own it).
    /// * No reference yet (first bounded post, or after migration): the share price must be
    ///   within slippage + tolerance + spread of the book price (deposits are base, 1:1).
    /// * Per post, against the last bounded post (at least `min_interval_ms` earlier, with a
    ///   strictly newer price): [min(0, r) − (slippage + tolerance + spreads), max(0, r) +
    ///   tolerance + spreads]. Costs only lower NAV, so slippage is on the low side only.
    /// * Over the 24h window, against its anchor: the same with a fixed upside budget
    ///   `window_up_bps` + spreads, and on the low side that budget plus max slippage per
    ///   trade the vault actually signed. Per-post allowances can't compound past this.
    fn check_band(&self, nav: u128, p: &PricePoint) -> Result<(), String> {
        let Some(b) = self.band_params() else {
            return Ok(());
        };
        if self.total_shares == 0 {
            return if nav <= self.book_nav {
                Ok(())
            } else {
                Err(format!("no holders: NAV {nav} above book NAV {}", self.book_nav))
            };
        }
        let share = math::price(nav, self.total_shares);
        let fmt = |what: &str, rv: i128, lo: i128, hi: i128, ra: i128| format!("{what}: share return {rv}bps outside [{lo}, {hi}]bps (asset {ra}bps)");
        let Some(r) = &self.band_ref else {
            let rv = math::share_return_bps(math::price(self.book_nav, self.total_shares), share);
            let t = b.slippage + b.tolerance + p.half_spread_bps as i128;
            return if rv.abs() <= t {
                Ok(())
            } else {
                Err(fmt("first post vs book price", rv, -t, t, 0))
            };
        };
        if r.point.source != p.source {
            return Err("price source changed".into());
        }
        if now_ms() < r.at_ms + b.min_interval_ms {
            return Err(format!("too soon: one bounded post per {} ms", b.min_interval_ms));
        }
        if p.observed_ms <= r.point.observed_ms {
            return Err("price not newer than the last post's".into());
        }
        // `down_env`/`up_env`: the lowest and highest share return the asset's moves allow
        // (bps); `None` means a constant weight: [min(0, r), max(0, r)].
        let check = |what: &str, from: &BandRef, env: Option<(i128, i128)>, up_budget: i128, down_extra: i128, up_extra: i128| -> Result<(), String> {
            let ra = math::mid_return_bps(from.point.mid.0, p.mid.0).ok_or("bad price")?;
            let (down_env, up_env) = env.map_or((ra.min(0), ra.max(0)), |(d, u)| (d.min(ra.min(0)), u.max(ra.max(0))));
            let rv = math::share_return_bps(from.share_price.0, share);
            let spread = p.half_spread_bps as i128 + from.point.half_spread_bps as i128;
            let (lo, hi) = (down_env - (up_budget + down_extra + spread), up_env + up_budget + spread + up_extra);
            if rv >= lo && rv <= hi {
                Ok(())
            } else {
                Err(fmt(what, rv, lo, hi, ra))
            }
        };
        check("per post", r, None, b.tolerance, b.slippage, self.band_dip_for(r))?;
        if let Some(a) = &self.band_anchor {
            // Across the window the weight may change at each trade the leader made, so
            // the envelope follows the asset's path run by run, not just its endpoint.
            let (_, down_env, up_env) = self.band_path_step(a, r, p).ok_or("bad price")?;
            check(
                "24h window",
                a,
                Some((down_env, up_env)),
                b.window_up,
                b.slippage * self.trades_since_anchor.max(1) as i128,
                0,
            )?;
        }
        Ok(())
    }

    /// After an accepted bounded post: it becomes the reference, and it anchors a new
    /// 24h window when there is none or the current one is over.
    /// `share_pre`: this post's share price before fee and burns, the same basis `check_band` used.
    fn record_band(&mut self, p: PricePoint, share_pre: u128) {
        let step = match (&self.band_anchor, &self.band_ref) {
            (Some(a), Some(last)) => self.band_path_step(a, last, &p).map(|s| s.0),
            _ => None,
        };
        let after_burns = math::price(self.book_nav, self.total_shares);
        let dip = match (&self.band_ref, self.band_params()) {
            (Some(last), Some(b)) => math::mid_return_bps(last.point.mid.0, p.mid.0).map_or(0, |ra| {
                let rv = math::share_return_bps(last.share_price.0, share_pre);
                let cap = b.slippage + b.tolerance + p.half_spread_bps as i128 + last.point.half_spread_bps as i128;
                (ra.min(0) - rv).clamp(0, cap)
            }),
            _ => 0,
        };
        let r = BandRef {
            point: p,
            share_price: U128(after_burns),
            at_ms: now_ms(),
        };
        // Withdrawals burned below this post's price leave value to the holders who
        // stay. That isn't a market move, so the window's anchor moves up with it.
        let posted = self.navs.get(self.navs.len() - 1).map(|n| n.price.0).unwrap_or(after_burns);
        if let Some(a) = self.band_anchor.as_mut() {
            if after_burns > posted && posted > 0 {
                a.share_price = U128(math::mul_div(a.share_price.0, after_burns, posted).unwrap_or(a.share_price.0));
            }
        }
        if self.band_anchor.as_ref().is_none_or(|a| r.at_ms >= a.at_ms + BAND_WINDOW_MS) {
            self.band_anchor = Some(r.clone());
            self.trades_since_anchor = 0;
            self.write_band_path(&self.band_path_now(&r));
        } else if let Some(s) = step {
            self.write_band_path(&s);
        }
        env::storage_write(BAND_DIP_KEY, &near_sdk::borsh::to_vec(&(r.at_ms, dip as i64)).unwrap());
        self.band_ref = Some(r);
    }

    /// Credit for the next per-post check: the last post's dip below the envelope, if
    /// `last` is still the reference it was measured against.
    fn band_dip_for(&self, last: &BandRef) -> i128 {
        env::storage_read(BAND_DIP_KEY)
            .and_then(|b| near_sdk::borsh::from_slice::<(u64, i64)>(&b).ok())
            .filter(|(at, _)| *at == last.at_ms)
            .map_or(0, |(_, d)| d.max(0) as i128)
    }

    /// The stored path for the window anchored at `anchor`, or a fresh one: no closed
    /// runs, the open run starting at the anchor, markers as they are now (a vault
    /// upgraded mid-window keeps the endpoint bound until its next trade).
    fn band_path_now(&self, anchor: &BandRef) -> BandPath {
        env::storage_read(BAND_PATH_KEY)
            .and_then(|b| near_sdk::borsh::from_slice::<BandPath>(&b).ok())
            .filter(|b| b.anchor_at_ms == anchor.at_ms)
            .unwrap_or_else(|| BandPath {
                anchor_at_ms: anchor.at_ms,
                up: U128(math::PRICE_SCALE),
                down: U128(math::PRICE_SCALE),
                run_mid: anchor.point.mid,
                signals: self.signals.len() as u64,
            })
    }

    fn write_band_path(&self, b: &BandPath) {
        env::storage_write(BAND_PATH_KEY, &near_sdk::borsh::to_vec(b).unwrap());
    }

    /// The window path after a post priced at `p` (`last` is the previous bounded post):
    /// the path to store, and the share-return envelope (low, high) in bps vs the anchor.
    /// If the leader signalled since `last`, the open run closes at `last` and the segment
    /// `last → p` is a run of its own (the weight changed somewhere inside it); otherwise
    /// the open run extends to `p`.
    fn band_path_step(&self, anchor: &BandRef, last: &BandRef, p: &PricePoint) -> Option<(BandPath, i128, i128)> {
        let mut b = self.band_path_now(anchor);
        let bps = math::BPS as i128;
        let apply = |m: u128, r: i128| math::mul_div(m, (bps + r).max(0) as u128, math::BPS);
        let traded = b.signals != self.signals.len() as u64;
        let (up, down) = if traded {
            for (from, to) in [(b.run_mid.0, last.point.mid.0), (last.point.mid.0, p.mid.0)] {
                let r = math::mid_return_bps(from, to)?;
                b.up = U128(apply(b.up.0, r.max(0))?);
                b.down = U128(apply(b.down.0, r.min(0))?);
            }
            b.run_mid = p.mid;
            (b.up.0, b.down.0)
        } else {
            let r = math::mid_return_bps(b.run_mid.0, p.mid.0)?;
            (apply(b.up.0, r.max(0))?, apply(b.down.0, r.min(0))?)
        };
        b.signals = self.signals.len() as u64;
        let to_bps = |m: u128| (m as i128 - math::PRICE_SCALE as i128) * bps / math::PRICE_SCALE as i128;
        Some((b, to_bps(down), to_bps(up)))
    }

    /// Fee above the HWM, then: withdrawals priced at the previous post burn at
    /// min(that price, this price); requests pending now are priced at this post.
    fn apply_nav(&mut self, epoch: u64, nav: U128, timestamp_ms: u64, fills_head: String, signature: String) -> NavPost {
        let (fee_shares, hwm) = math::performance_fee(nav.0, self.total_shares, self.hwm, self.cfg.perf_fee_bps as u128);
        if fee_shares > 0 {
            let leader = self.cfg.leader.clone();
            self.shares.insert(leader.clone(), self.balance(&leader) + fee_shares);
            self.total_shares += fee_shares;
        }
        self.hwm = hwm;
        let price = math::price(nav.0, self.total_shares);
        let (mut nav_left, mut withdrawn) = (nav.0, 0u128);
        let matured: Vec<Maturing> = self.maturing.values().cloned().collect();
        self.maturing.clear();
        for m in matured {
            let r = m.request;
            let pay = math::matured_payout(r.shares.0, nav_left, self.total_shares, m.priced_at.0);
            self.burn(&r.account, r.shares.0);
            nav_left -= pay;
            withdrawn += pay;
            self.open_claim(r.account, r.exit_account, pay, epoch, false);
        }
        let reqs: Vec<WithdrawRequest> = self.pending.values().cloned().collect();
        self.pending.clear();
        for r in reqs {
            self.maturing.insert(
                r.id,
                Maturing {
                    request: r,
                    priced_at: U128(price),
                    priced_epoch: epoch,
                },
            );
        }
        self.trigger_stops(price, epoch);
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

    /// Stop-losses whose trigger the post-fee price reached: queue all free shares,
    /// priced at this post (they burn at the next one, at the lower of the two).
    fn trigger_stops(&mut self, price: u128, epoch: u64) {
        let hit: Vec<(AccountId, StopLoss)> = self
            .stops
            .iter()
            .filter(|(_, s)| price <= s.trigger_price.0)
            .map(|(a, s)| (a.clone(), s.clone()))
            .collect();
        for (who, stop) in hit {
            self.stops.remove(&who);
            let free = self.free_shares(&who);
            if free == 0 || self.pending.len() + self.maturing.len() >= MAX_PENDING_WITHDRAWALS {
                env::log_str(&format!("silent-partner.stop_skipped account={who} free={free}"));
                continue;
            }
            self.locked.insert(who.clone(), self.locked_of(&who) + free);
            let id = self.next_request;
            self.next_request += 1;
            let request = WithdrawRequest {
                id,
                account: who.clone(),
                shares: U128(free),
                exit_account: stop.exit_account,
                requested_ms: now_ms(),
            };
            self.maturing.insert(
                id,
                Maturing {
                    request,
                    priced_at: U128(price),
                    priced_epoch: epoch,
                },
            );
            env::log_str(&format!(
                "silent-partner.stop_loss account={who} shares={free} price={price} trigger={}",
                stop.trigger_price.0
            ));
        }
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

    fn try_deposit(&mut self, who: &AccountId, amount: u128) -> Result<u128, &'static str> {
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

/// An oracle price as a price point: mid scaled to 1e30 of its units, confidence as the spread.
fn oracle_point(p: &OraclePrice) -> Option<PricePoint> {
    if p.price.0 <= 0 {
        return None;
    }
    let e = 30 + p.expo;
    if !(0..=36).contains(&e) {
        return None;
    }
    let mid = (p.price.0 as u128).checked_mul(10u128.pow(e as u32))?;
    let hs = u32::try_from(math::conf_bps(p.price.0, p.conf.0)).ok()?;
    Some(PricePoint {
        mid: U128(mid),
        half_spread_bps: hs,
        source: "oracle".into(),
        observed_ms: (p.publish_time.max(0) as u64) * 1000,
    })
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
