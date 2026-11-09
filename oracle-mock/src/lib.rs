//! Testnet stand-in for Pyth on NEAR (`pyth-oracle.near`). Pyth's testnet
//! contract can only be updated with data from Pyth's Hermes service, which now
//! requires an API key, so the paper season reads this instead. Same view as
//! Pyth: `get_price_no_older_than(price_id, age) -> Option<Price>`. Prices are
//! set by one writer (the season's price-feed account, fed from public market
//! data), so this is a trusted feed: fine for paper vaults, not for real funds.

use near_sdk::json_types::{I64, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Price {
    pub price: I64,
    pub conf: U64,
    pub expo: i32,
    pub publish_time: i64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Oracle {
    writer: AccountId,
    prices: LookupMap<String, Price>,
}

#[near]
impl Oracle {
    #[init]
    pub fn new(writer: AccountId) -> Self {
        Self {
            writer,
            prices: LookupMap::new(b"p"),
        }
    }

    /// Writer only. `publish_time` (unix seconds) must be now-ish and newer than the stored one.
    pub fn set_price(&mut self, price_id: String, price: Price) {
        require!(
            env::predecessor_account_id() == self.writer,
            "only the writer"
        );
        require!(price.price.0 > 0, "price must be positive");
        let now = (env::block_timestamp_ms() / 1000) as i64;
        require!(
            price.publish_time <= now + 5 && price.publish_time >= now - 120,
            "publish_time not current"
        );
        if let Some(old) = self.prices.get(&price_id) {
            require!(
                price.publish_time > old.publish_time,
                "publish_time must increase"
            );
        }
        self.prices.insert(price_id, price);
    }

    /// Same as Pyth: None unless the price is at most `age` seconds old.
    pub fn get_price_no_older_than(&self, price_id: String, age: u64) -> Option<Price> {
        let now = (env::block_timestamp_ms() / 1000) as i64;
        self.prices
            .get(&price_id)
            .filter(|p| now - p.publish_time <= age as i64)
            .cloned()
    }

    pub fn get_price_unsafe(&self, price_identifier: String) -> Option<Price> {
        self.prices.get(&price_identifier).cloned()
    }

    pub fn get_writer(&self) -> AccountId {
        self.writer.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(pred: &str, s: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(pred.parse().unwrap())
            .block_timestamp(s * 1_000_000_000)
            .build());
    }
    fn p(price: i64, t: i64) -> Price {
        Price {
            price: I64(price),
            conf: U64(1000),
            expo: -8,
            publish_time: t,
        }
    }

    #[test]
    fn freshness_writer_and_monotonic_time() {
        ctx("w.testnet", 1_000);
        let mut o = Oracle::new("w.testnet".parse().unwrap());
        o.set_price("id".into(), p(400, 1_000));
        assert_eq!(
            o.get_price_no_older_than("id".into(), 60),
            Some(p(400, 1_000))
        );
        ctx("w.testnet", 1_100);
        assert_eq!(o.get_price_no_older_than("id".into(), 60), None);
        assert_eq!(o.get_price_unsafe("id".into()), Some(p(400, 1_000)));
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ctx("x.testnet", 1_100);
            let mut o2 = Oracle::new("w.testnet".parse().unwrap());
            o2.set_price("id".into(), p(400, 1_100));
        }))
        .is_err());
    }
}
