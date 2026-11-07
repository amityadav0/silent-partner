//! Silent Partner vault contract. P0 skeleton; the full vault lands in P2.
use near_sdk::{near, AccountId, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    operator: AccountId,
}

#[near]
impl Vault {
    #[init]
    pub fn new(owner: AccountId, operator: AccountId) -> Self {
        Self { owner, operator }
    }

    pub fn get_operator(&self) -> AccountId {
        self.operator.clone()
    }

    pub fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_sets_operator() {
        let v = Vault::new("owner.testnet".parse().unwrap(), "op.testnet".parse().unwrap());
        assert_eq!(v.get_operator().as_str(), "op.testnet");
        assert_eq!(v.owner.as_str(), "owner.testnet");
    }
}
