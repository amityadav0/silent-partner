//! One-off state migration for vaults deployed with the season-1 layout
//! (commit 7459df7: the testnet paper-season vaults). Mainnet vaults are fresh
//! deploys and never need it. `#[private]`: only the vault account itself can
//! call it, which could redeploy the code anyway.

use crate::*;

#[near(serializers = [borsh])]
pub struct ConfigV1 {
    pub owner: AccountId,
    pub operator: AccountId,
    pub leader: AccountId,
    pub base_token: AccountId,
    pub base_asset_id: String,
    pub intents_contract: Option<AccountId>,
    pub mpc_contract: AccountId,
    pub mpc_path: String,
    pub oneclick_key: String,
    pub attestation_key: String,
    pub perf_fee_bps: u16,
    pub min_leader_bps: u16,
    pub max_slippage_bps: u16,
    pub min_deposit: U128,
    pub allowed_assets: Vec<String>,
}

#[near(serializers = [borsh])]
pub struct VaultV1 {
    pub cfg: ConfigV1,
    pub vault_account: Option<String>,
    pub shares: LookupMap<AccountId, u128>,
    pub locked: LookupMap<AccountId, u128>,
    pub total_shares: u128,
    pub book_nav: u128,
    pub hwm: u128,
    pub last_nav_ms: u64,
    pub epoch: u64,
    pub emergency: bool,
    pub navs: Vector<NavPost>,
    pub pending: IterableMap<u64, WithdrawRequest>,
    pub next_request: u64,
    /// Claim's layout changed since; migration requires none (checked).
    pub claims: Vector<Vec<u8>>,
    pub signals: Vector<Signal>,
    pub signal_key: Option<String>,
    pub basis: LookupMap<AccountId, Basis>,
}

#[near]
impl Vault {
    /// Season-1 layout → current, adding the NAV oracle. Refuses vaults with
    /// claims or pending withdrawals (their stored layout changed).
    #[private]
    #[init(ignore_state)]
    pub fn migrate_v1(nav_oracle: Option<NavOracle>) -> Self {
        let old: VaultV1 = env::state_read().unwrap_or_else(|| env::panic_str("no v1 state"));
        require!(old.claims.is_empty(), "v1 vault has claims");
        require!(old.pending.is_empty(), "v1 vault has pending withdrawals");
        let c = old.cfg;
        let cfg = Config {
            owner: c.owner,
            operator: c.operator,
            leader: c.leader,
            base_token: c.base_token,
            base_asset_id: c.base_asset_id,
            intents_contract: c.intents_contract,
            mpc_contract: c.mpc_contract,
            mpc_path: c.mpc_path,
            oneclick_key: c.oneclick_key,
            attestation_key: c.attestation_key,
            perf_fee_bps: c.perf_fee_bps,
            min_leader_bps: c.min_leader_bps,
            max_slippage_bps: c.max_slippage_bps,
            min_deposit: c.min_deposit,
            allowed_assets: c.allowed_assets,
            nav_oracle,
            nav_quotes: None,
        };
        if let Some(o) = &cfg.nav_oracle {
            require!(cfg.allowed_assets.len() == 2 && unhex32(&o.price_id).is_some(), "bad nav_oracle");
        }
        let mut signal_hashes = LookupSet::new(b"h");
        for s in old.signals.iter() {
            signal_hashes.insert(s.hash.clone());
        }
        env::log_str("silent-partner.migrated from=v1");
        Self {
            cfg,
            vault_account: old.vault_account,
            shares: old.shares,
            locked: old.locked,
            total_shares: old.total_shares,
            book_nav: old.book_nav,
            hwm: old.hwm,
            last_nav_ms: old.last_nav_ms,
            epoch: old.epoch,
            emergency: old.emergency,
            navs: old.navs,
            pending: old.pending,
            next_request: old.next_request,
            claims: Vector::new(b"c"),
            signals: old.signals,
            signal_key: old.signal_key,
            basis: old.basis,
            used_deposits: LookupSet::new(b"u"),
            signal_hashes,
            maturing: IterableMap::new(b"m"),
            band_ref: None,
            band_anchor: None,
            trades_since_anchor: 0,
            posting_since_ms: 0,
            stops: IterableMap::new(b"t"),
        }
    }
}

/// Layout of vaults deployed at commit f97e5c0 (the four AI season vaults and
/// the quotes demo): everything current except `stops`.
#[near(serializers = [borsh])]
pub struct VaultV3 {
    pub cfg: Config,
    pub vault_account: Option<String>,
    pub shares: LookupMap<AccountId, u128>,
    pub locked: LookupMap<AccountId, u128>,
    pub total_shares: u128,
    pub book_nav: u128,
    pub hwm: u128,
    pub last_nav_ms: u64,
    pub epoch: u64,
    pub emergency: bool,
    pub navs: Vector<NavPost>,
    pub pending: IterableMap<u64, WithdrawRequest>,
    pub next_request: u64,
    pub claims: Vector<Claim>,
    pub signals: Vector<Signal>,
    pub signal_key: Option<String>,
    pub basis: LookupMap<AccountId, Basis>,
    pub used_deposits: LookupSet<String>,
    pub signal_hashes: LookupSet<String>,
    pub maturing: IterableMap<u64, Maturing>,
    pub band_ref: Option<BandRef>,
    pub band_anchor: Option<BandRef>,
    pub trades_since_anchor: u32,
    pub posting_since_ms: u64,
}

#[near]
impl Vault {
    /// f97e5c0 layout → current: adds copy stop-losses (empty). Nothing else changes.
    #[private]
    #[init(ignore_state)]
    pub fn migrate_v3() -> Self {
        let o: VaultV3 = env::state_read().unwrap_or_else(|| env::panic_str("no v3 state"));
        env::log_str("silent-partner.migrated from=v3");
        Self {
            cfg: o.cfg,
            vault_account: o.vault_account,
            shares: o.shares,
            locked: o.locked,
            total_shares: o.total_shares,
            book_nav: o.book_nav,
            hwm: o.hwm,
            last_nav_ms: o.last_nav_ms,
            epoch: o.epoch,
            emergency: o.emergency,
            navs: o.navs,
            pending: o.pending,
            next_request: o.next_request,
            claims: o.claims,
            signals: o.signals,
            signal_key: o.signal_key,
            basis: o.basis,
            used_deposits: o.used_deposits,
            signal_hashes: o.signal_hashes,
            maturing: o.maturing,
            band_ref: o.band_ref,
            band_anchor: o.band_anchor,
            trades_since_anchor: o.trades_since_anchor,
            posting_since_ms: o.posting_since_ms,
            stops: IterableMap::new(b"t"),
        }
    }
}
