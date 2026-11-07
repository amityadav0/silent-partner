# Testnet deployment (P2)

Ran 2026-11-07T14:06:53.937Z with `operator/scripts/testnet-e2e.ts`. Every link goes to testnet.nearblocks.io.

## Accounts

| Role | Account |
|---|---|
| Vault contract | [`sp-vault-60270.testnet`](https://testnet.nearblocks.io/address/sp-vault-60270.testnet) |
| Operator | `sp-op-60270.testnet` |
| Leader | `sp-leader-60270.testnet` |
| Follower | `sp-follower-60270.testnet` |

## Settings

| Setting | Value |
|---|---|
| Base token | `usdc.fakes.testnet` (`nep141:usdc.fakes.testnet`) |
| MPC | `v1.signer-prod.testnet`, domain 1 (EdDSA), path `silent-partner/vault` |
| Vault confidential account | `7164eb86180b4bfefcc6cc906aff0673c80f49b9d3837f0916b93dee7bb12a8f`, set by `activate` from MPC and equal to `derived_public_key` (ed25519:8deKo19PKHiPaEAfB3VmSMv5BUtDDX2m9K33pJYCGHve) |
| 1Click quote key | a testnet test key, fixed at init. 1Click has no testnet, so a mainnet vault is initialised with 1Click's real key instead |
| intents contract | none on testnet; deposits stay in the contract |

## What happened

1. **Deposits.** The leader deposited 10 USDC and the follower 50 USDC. A further 45 USDC from the follower was **refunded**, because the leader would have held 9.5%, under the 10% minimum.
2. **NAV epoch 1.** NAV 66 USDC: a 10% gain over 60 deposited. The performance fee minted 1111111 shares to the leader (20% of the 6 USDC gain), and the HWM moved up.
3. **Signal.** The leader registered a signal key. The operator recorded signal 0, and the contract verified the leader's signature on-chain.
4. **Withdrawal.** The follower requested 10,000,000 shares. The NAV epoch 2 post burned them at the post-fee price and opened claim 0 for 10800000 units.
5. **MPC signatures.** `sign_intent` produced real signatures from the vault key:
   - **Login** (empty intent, intents.near): `ed25519:4HDBf6iKrexBmUE4CDGLCJCyGUjsJUZuKWZwYS7UN7Qdwj1jhwy8kMiH9aL4nv4uKx37uJ1LkbYXRsCW9b9hef9S`.
   - **Payout of claim 0** (unshield to the follower, intents.far): `ed25519:3BSe9g3iXHTpR6AAt3dTYWVkqcLk8ShRUyfSUjkouYTmryStVdnr2MFL7eHCgHpaCMm6tT8mjkzU6GifYMqHVnX6`.
   - The contract's `on_signed` checked each signature against the vault key before returning it.
6. **Thief payout refused.** The operator asked to sign a payout whose quote paid the operator's own account. It was refused with `payout must go to the claim's exit account`: True.

## Transactions

| Step | Tx |
|---|---|
| op → vault.activate | [`GZmpSP6UJq…`](https://testnet.nearblocks.io/txns/GZmpSP6UJqdEm5PuBLsq7omat5w6Wzf8F2qPwnqpSaw3) |
| op → usdc.fakes.testnet.storage_deposit | [`ENYjA8koF1…`](https://testnet.nearblocks.io/txns/ENYjA8koF1nUJBcJwrMcw6BF2yNYXSQjdQKs8g64sDyH) |
| op → usdc.fakes.testnet.storage_deposit | [`AkWxejRJ5Y…`](https://testnet.nearblocks.io/txns/AkWxejRJ5YVxcPxVkJQ7uSqrHxmHKPhLVAPpwJxhz3SA) |
| op → usdc.fakes.testnet.storage_deposit | [`bQmZ7KDbnv…`](https://testnet.nearblocks.io/txns/bQmZ7KDbnv6X5qwEaQkEpbWPvorLEALTxX8NfDH8WCU) |
| leader → usdc.fakes.testnet.mint | [`4dMUkfLxsx…`](https://testnet.nearblocks.io/txns/4dMUkfLxsxefPbZjm2AEnESexDZwJ3R7vYkoY4JSEUWB) |
| follower → usdc.fakes.testnet.mint | [`8nJ9woUbvF…`](https://testnet.nearblocks.io/txns/8nJ9woUbvFopPgCGuTkzNHxJiToq6AyCxrxAU52CKRPx) |
| leader → usdc.fakes.testnet.ft_transfer_call | [`CrndEKSPZG…`](https://testnet.nearblocks.io/txns/CrndEKSPZGJmkodcmy87EtpbgwzbWub25m2pyaALxZF) |
| follower → usdc.fakes.testnet.ft_transfer_call | [`5yjJ4WD8zk…`](https://testnet.nearblocks.io/txns/5yjJ4WD8zkVcZUhmzDkxnB9Zxe1Lq8sJ4tSuWCM5PKYq) |
| follower → usdc.fakes.testnet.ft_transfer_call | [`CFTFUywfwg…`](https://testnet.nearblocks.io/txns/CFTFUywfwgfsqiVW598AipACvqMxZo3pXAcH7bCAgjbK) |
| op → vault.post_nav | [`Den1BJBMat…`](https://testnet.nearblocks.io/txns/Den1BJBMatJretu2c858iGvpfVtU9DJRNuVSePw4eCcE) |
| leader → vault.set_signal_key | [`8ikBdiukzE…`](https://testnet.nearblocks.io/txns/8ikBdiukzEFLqMQC34nAxLNhfTu9DfV8hYTNjNrVZKF1) |
| op → vault.record_signal | [`7XBiwDjPNd…`](https://testnet.nearblocks.io/txns/7XBiwDjPNdxnR3qCwTQKKoJVBxyKgAwXu6AbZjmZAPRL) |
| follower → vault.request_withdraw | [`4kJbM72bQK…`](https://testnet.nearblocks.io/txns/4kJbM72bQKYmJCmt5GpnxfxmqjYu9MZx62tFqHDa4uSW) |
| op → vault.post_nav | [`2u6Bak5QHq…`](https://testnet.nearblocks.io/txns/2u6Bak5QHq249dLCXKscrwYrYDZMZmmGu2bWT8ZjtPbW) |
| op → vault.sign_intent | [`D65NiKNkCd…`](https://testnet.nearblocks.io/txns/D65NiKNkCdsCx4XUE9TvgGzkbsgpfoTE3MnH7pG79fdf) |
| op → vault.sign_intent | [`2pyPcY99Tg…`](https://testnet.nearblocks.io/txns/2pyPcY99TgbjwaH7gGBDWyxMYiNDGhoh1gr9VDZAPQfp) |

## Final state

```json
{
  "vault_account": "7164eb86180b4bfefcc6cc906aff0673c80f49b9d3837f0916b93dee7bb12a8f",
  "total_shares": "51111111",
  "book_nav": "55200000",
  "price": "1080000002347826092",
  "hwm": "1080000001963636367",
  "epoch": 2,
  "last_nav_ms": 1794060390717,
  "stale": false,
  "emergency": false,
  "leader_shares": "11111111",
  "pending_withdrawals": 0,
  "signals": 1
}
```
