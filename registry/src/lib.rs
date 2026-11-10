//! Open season on testnet. Anyone files a vault launch here; the season
//! operator (the owner) deploys the vault and marks it live. An AI launch
//! carries its strategy sealed to the season operator's key, plus the
//! strategy's sha256: the plain text never touches the chain.
//!
//! Community leaders also post their trade signals here, sealed the same way,
//! so a signal is unreadable until the operator executes it at the next tick.

use near_sdk::json_types::U64;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

/// Kept back from each launch deposit to pay for this contract's storage.
pub const STORAGE_RESERVE: NearToken = NearToken::from_millinear(100);
/// A posted signal pays its own storage.
pub const SIGNAL_DEPOSIT: NearToken = NearToken::from_millinear(10);
pub const MAX_PENDING_SIGNALS_PER_VAULT: u32 = 3;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Launch {
    pub id: u32,
    pub leader: AccountId,
    /// "ai" or "human"
    pub kind: String,
    pub name: String,
    /// The public one-line style the leader approved.
    pub style: String,
    /// "low", "med" or "high": the enforced target-weight band.
    pub risk: String,
    /// sha256 (hex) of the plain strategy text; AI launches only.
    pub prompt_hash: Option<String>,
    /// The strategy sealed to the season operator's X25519 key; AI launches only.
    pub sealed_prompt: Option<String>,
    pub created_ms: U64,
    /// "pending", "live" or "rejected"
    pub status: String,
    pub vault: Option<AccountId>,
    pub note: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct SealedSignal {
    pub id: U64,
    pub vault: AccountId,
    pub sealed: String,
    pub posted_ms: U64,
}

#[near(serializers = [json])]
pub struct Info {
    pub owner: AccountId,
    pub funder: AccountId,
    pub launches: u32,
    pub max_total: u32,
    pub max_per_leader: u8,
    pub min_deposit: NearToken,
    pub signals: U64,
    pub signals_acked: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    owner: AccountId,
    funder: AccountId,
    launches: Vector<Launch>,
    per_leader: LookupMap<AccountId, u8>,
    by_vault: LookupMap<AccountId, u32>,
    max_total: u32,
    max_per_leader: u8,
    min_deposit: NearToken,
    signals: Vector<SealedSignal>,
    signals_acked: u64,
}

fn valid_name(s: &str) -> bool {
    (3..=32).contains(&s.chars().count()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '\'') && !s.starts_with(' ') && !s.ends_with(' ')
}
fn valid_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_sealed(s: &str) -> bool {
    (40..=6000).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[near]
impl Registry {
    #[init]
    pub fn new(owner: AccountId, funder: AccountId, max_total: u32, max_per_leader: u8, min_deposit: NearToken) -> Self {
        require!(min_deposit > STORAGE_RESERVE, "min_deposit must exceed the storage reserve");
        Self {
            owner,
            funder,
            launches: Vector::new(b"l"),
            per_leader: LookupMap::new(b"p"),
            by_vault: LookupMap::new(b"v"),
            max_total,
            max_per_leader,
            min_deposit,
            signals: Vector::new(b"s"),
            signals_acked: 0,
        }
    }

    /// File a launch. The deposit (minus a storage reserve) goes to the season
    /// operator, which spends it creating and funding the vault account.
    #[payable]
    pub fn launch(&mut self, kind: String, name: String, style: String, risk: String, prompt_hash: Option<String>, sealed_prompt: Option<String>) -> u32 {
        let leader = env::predecessor_account_id();
        let paid = env::attached_deposit();
        require!(paid >= self.min_deposit, format!("attach at least {}", self.min_deposit.exact_amount_display()));
        require!(kind == "ai" || kind == "human", "kind must be ai or human");
        require!(valid_name(&name), "name: 3-32 letters, digits, spaces, - or '");
        require!(!style.trim().is_empty() && style.chars().count() <= 140, "style: 1-140 characters");
        require!(["low", "med", "high"].contains(&risk.as_str()), "risk must be low, med or high");
        if kind == "ai" {
            require!(prompt_hash.as_deref().is_some_and(valid_hash), "prompt_hash: 64 lowercase hex characters");
            require!(sealed_prompt.as_deref().is_some_and(valid_sealed), "sealed_prompt: 40-6000 base64url characters");
        } else {
            require!(prompt_hash.is_none() && sealed_prompt.is_none(), "a human launch carries no strategy text");
        }
        require!(self.launches.len() < self.max_total, "the open season is full");
        let mine = self.per_leader.get(&leader).copied().unwrap_or(0);
        require!(mine < self.max_per_leader, "launch limit reached for this account");
        self.per_leader.insert(leader.clone(), mine + 1);
        let id = self.launches.len();
        self.launches.push(Launch { id, leader, kind, name, style: style.trim().to_string(), risk, prompt_hash, sealed_prompt, created_ms: U64(env::block_timestamp_ms()), status: "pending".into(), vault: None, note: None });
        Promise::new(self.funder.clone()).transfer(paid.saturating_sub(STORAGE_RESERVE)).detach();
        id
    }

    /// The season operator records the outcome of a launch.
    pub fn set_status(&mut self, id: u32, status: String, vault: Option<AccountId>, note: Option<String>) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        require!(["pending", "live", "rejected"].contains(&status.as_str()), "bad status");
        let l = self.launches.get_mut(id).unwrap_or_else(|| env::panic_str("no such launch"));
        if let Some(v) = &vault {
            self.by_vault.insert(v.clone(), id);
        }
        l.status = status;
        if vault.is_some() {
            l.vault = vault;
        }
        l.note = note;
    }

    /// A community leader posts a trade signal, sealed to the season operator.
    #[payable]
    pub fn post_signal(&mut self, vault: AccountId, sealed: String) -> U64 {
        require!(env::attached_deposit() >= SIGNAL_DEPOSIT, "attach 0.01 NEAR for storage");
        let id = *self.by_vault.get(&vault).unwrap_or_else(|| env::panic_str("not a community vault"));
        let l = self.launches.get(id).unwrap();
        require!(l.status == "live", "the vault isn't live");
        require!(env::predecessor_account_id() == l.leader, "only the vault's leader");
        require!(valid_sealed(&sealed), "sealed: 40-6000 base64url characters");
        let pending = (self.signals_acked..self.signals.len() as u64).filter(|i| self.signals.get(*i as u32).is_some_and(|s| s.vault == vault)).count() as u32;
        require!(pending < MAX_PENDING_SIGNALS_PER_VAULT, "too many signals waiting for this vault");
        let n = self.signals.len() as u64;
        self.signals.push(SealedSignal { id: U64(n), vault, sealed, posted_ms: U64(env::block_timestamp_ms()) });
        U64(n)
    }

    /// The operator has read every signal below `upto`.
    pub fn ack_signals(&mut self, upto: U64) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        require!(upto.0 >= self.signals_acked && upto.0 <= self.signals.len() as u64, "bad cursor");
        self.signals_acked = upto.0;
    }

    pub fn get_info(&self) -> Info {
        Info { owner: self.owner.clone(), funder: self.funder.clone(), launches: self.launches.len(), max_total: self.max_total, max_per_leader: self.max_per_leader, min_deposit: self.min_deposit, signals: U64(self.signals.len() as u64), signals_acked: U64(self.signals_acked) }
    }
    pub fn get_launches(&self, from: u32, limit: u32) -> Vec<Launch> {
        (from..self.launches.len().min(from.saturating_add(limit))).filter_map(|i| self.launches.get(i).cloned()).collect()
    }
    pub fn get_launch(&self, id: u32) -> Option<Launch> {
        self.launches.get(id).cloned()
    }
    pub fn launch_of_vault(&self, vault: AccountId) -> Option<Launch> {
        self.by_vault.get(&vault).and_then(|i| self.launches.get(*i).cloned())
    }
    /// Signals the operator hasn't acknowledged yet.
    pub fn pending_signals(&self) -> Vec<SealedSignal> {
        (self.signals_acked..self.signals.len() as u64).filter_map(|i| self.signals.get(i as u32).cloned()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const HASH: &str = "3235fb679becde5dc6da4142c843fe6ed781c38f44cc1f6774bef62f8e79d4b1";
    fn sealed() -> String {
        "A".repeat(80)
    }
    fn ctx(who: usize, deposit: NearToken) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(who)).attached_deposit(deposit).build());
    }
    fn reg() -> Registry {
        ctx(0, NearToken::from_near(0));
        Registry::new(accounts(0), accounts(0), 3, 2, NearToken::from_near(5))
    }
    fn ai(r: &mut Registry) -> u32 {
        r.launch("ai".into(), "Calm Owl".into(), "Holds NEAR above its 7-day average".into(), "med".into(), Some(HASH.into()), Some(sealed()))
    }

    #[test]
    fn launch_records_and_caps() {
        let mut r = reg();
        ctx(1, NearToken::from_near(5));
        assert_eq!(ai(&mut r), 0);
        assert_eq!(ai(&mut r), 1);
        let l = r.get_launch(0).unwrap();
        assert_eq!((l.status.as_str(), l.leader.clone(), l.prompt_hash.as_deref()), ("pending", accounts(1), Some(HASH)));
        // per-account cap
        let e = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ai(&mut r)));
        assert!(e.is_err());
    }

    #[test]
    #[should_panic(expected = "the open season is full")]
    fn total_cap() {
        let mut r = reg();
        for who in 1..=4 {
            ctx(who, NearToken::from_near(5));
            ai(&mut r);
        }
    }

    #[test]
    #[should_panic(expected = "attach at least")]
    fn deposit_required() {
        let mut r = reg();
        ctx(1, NearToken::from_near(1));
        ai(&mut r);
    }

    #[test]
    fn validation_table() {
        type Case<'a> = (&'a str, &'a str, &'a str, Option<&'a str>, Option<String>, &'a str);
        let cases: Vec<Case> = vec![
            ("robot", "Calm Owl", "med", Some(HASH), Some(sealed()), "kind must be"),
            ("ai", "x", "med", Some(HASH), Some(sealed()), "name:"),
            ("ai", "Calm <Owl>", "med", Some(HASH), Some(sealed()), "name:"),
            ("ai", "Calm Owl", "wild", Some(HASH), Some(sealed()), "risk must be"),
            ("ai", "Calm Owl", "med", Some("ABC"), Some(sealed()), "prompt_hash"),
            ("ai", "Calm Owl", "med", Some(HASH), Some("short".into()), "sealed_prompt"),
            ("ai", "Calm Owl", "med", None, None, "prompt_hash"),
            ("human", "Calm Owl", "med", Some(HASH), None, "carries no strategy"),
        ];
        for (kind, name, risk, h, s, want) in cases {
            let mut r = reg();
            ctx(1, NearToken::from_near(5));
            let e = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| r.launch(kind.into(), name.into(), "style".into(), risk.into(), h.map(String::from), s.clone())));
            let msg = e.err().and_then(|p| p.downcast_ref::<String>().cloned()).unwrap_or_default();
            assert!(msg.contains(want), "{kind} {name} {risk}: got {msg:?}");
        }
        let mut r = reg();
        ctx(1, NearToken::from_near(5));
        assert_eq!(r.launch("human".into(), "Desk Two".into(), "Signs by hand".into(), "low".into(), None, None), 0);
    }

    #[test]
    fn owner_marks_live_and_the_leader_posts_sealed_signals() {
        let mut r = reg();
        ctx(1, NearToken::from_near(5));
        ai(&mut r);
        ctx(2, NearToken::from_near(0));
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| r.set_status(0, "live".into(), Some("c0.sop.testnet".parse().unwrap()), None))).is_err());
        ctx(0, NearToken::from_near(0));
        r.set_status(0, "live".into(), Some("c0.sop.testnet".parse().unwrap()), None);
        assert_eq!(r.launch_of_vault("c0.sop.testnet".parse().unwrap()).unwrap().status, "live");
        // only the leader, with the storage deposit
        ctx(2, SIGNAL_DEPOSIT);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| r.post_signal("c0.sop.testnet".parse().unwrap(), sealed()))).is_err());
        ctx(1, SIGNAL_DEPOSIT);
        for _ in 0..MAX_PENDING_SIGNALS_PER_VAULT {
            r.post_signal("c0.sop.testnet".parse().unwrap(), sealed());
        }
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| r.post_signal("c0.sop.testnet".parse().unwrap(), sealed()))).is_err());
        assert_eq!(r.pending_signals().len(), 3);
        ctx(0, NearToken::from_near(0));
        r.ack_signals(U64(2));
        assert_eq!(r.pending_signals().len(), 1);
        ctx(1, SIGNAL_DEPOSIT);
        r.post_signal("c0.sop.testnet".parse().unwrap(), sealed());
        assert_eq!(r.get_info().signals.0, 4);
    }
}
