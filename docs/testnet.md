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

## Operator run (P3)

Ran 2026-11-07T14:14:02.972Z with `operator/scripts/testnet-operator-run.ts`. This is the operator service code in dry 1Click mode: real 1Click dry quotes for pricing, with testnet assets mapped to the mainnet USDC and wNEAR ids. The NAV and signal transactions are real testnet transactions.

| Step | Result | Tx |
|---|---|---|
| Epoch 3: paper-shield the 60 USDC of public deposits, then post NAV | NAV 49.200000 USDC = 60 held − 10.8 owed to claim 0. Log head `0c4a0e75fb86…` | [`Eq36o7CJXB…`](https://testnet.nearblocks.io/txns/Eq36o7CJXBRARczoLLZj96fHLivU2ZTSXDPktqAfLBGp) |
| Leader signal: 30% of NAV, USDC → wNEAR, market | Executed as one dry confidential quote for the whole vault. Fill `9d56704f6c77…` went into the log, and the signal hash `96a79a507dc6…` was recorded on-chain with the leader's signature | (record_signal in the operator's account history) |
| Epoch 4: post NAV | NAV 49.130654 USDC. The wNEAR is valued by a 1Click quote back into USDC (gross 59.930653, liabilities 10.800000) | [`DURSMNhcyA…`](https://testnet.nearblocks.io/txns/DURSMNhcyARhhVdVfYn3bd7g5Bm5vjfKkYWoYJXbPCMJ) |

**Claim 0 is still open, on purpose.** The P2 script had MPC sign its payout but never submitted the signature, so the payout is in flight. The operator releases only in-flight payouts it submitted itself and that 1Click reports as failed after their deadline. An unknown one is left for review, because anyone who saw the signature log could have submitted it.

## Real NEAR Intents verifier on testnet

Ran 2026-11-07T14:27:24.940Z with `operator/scripts/testnet-intents.ts`.

**Setup.**
- The verifier is `defuse-0.2.10.wasm` from near/intents `releases/`, deployed to [`sp-intents-61557.testnet`](https://testnet.nearblocks.io/address/sp-intents-61557.testnet).
- A second vault, [`sp-vault2-61557.testnet`](https://testnet.nearblocks.io/address/sp-vault2-61557.testnet), has `intents_contract` = that account. Its MPC account is `66d43ceffe902cf4075de0ca529c6e3c725b1fd6d530c9ba1d8849743c10f468`.

**1. Deposit forwarding works.** A 10 USDC `ft_transfer_call` into the vault minted shares, and the contract forwarded the USDC to the verifier.
- The vault's balance on the verifier went from 0 to 10000000.
- 0 was left in the contract.

**2. The verifier executes an MPC-signed vault transfer.**
- The vault signed a Shield-shaped transfer through `sign_intent`: it was bound to a test-key quote, its NEP-413 recipient was the verifier's account id, and the vault's MPC key signed it on testnet MPC.
- The real defuse contract's `execute_intents` executed it. 1000000 units moved to the stand-in deposit address `96500bc76a1a…` (balance 1000000), leaving the vault at 9000000.

| Step | Tx |
|---|---|
| fund intents account (9 NEAR) | [`5yXLcdQaiR…`](https://testnet.nearblocks.io/txns/5yXLcdQaiRyGtUgrDtmRMj1aTH8Xj4QUhKT6KuPcRPZr) |
| deploy defuse 0.2.10 | [`4ognLEkdwj…`](https://testnet.nearblocks.io/txns/4ognLEkdwjujM6PsxG76yWsbMev1bEgLae3zoEvkqxUt) |
| new (intents → intents) | [`4LpssYTK4J…`](https://testnet.nearblocks.io/txns/4LpssYTK4JL6GzzxwfUgw35hn38qhmggRAEZKzE9AYNS) |
| deploy vault2 | [`2zSn5S9wfs…`](https://testnet.nearblocks.io/txns/2zSn5S9wfshwfNaU7J9n4zf6Yi4YhquZQiXWtLgw7MdE) |
| new (vault2 → vault2) | [`9zHh55SAKb…`](https://testnet.nearblocks.io/txns/9zHh55SAKbU1RKPDJksPRLpAXrW3fn9kBcdAyS8tfgJd) |
| activate (op → vault2) | [`9LcBk49J8e…`](https://testnet.nearblocks.io/txns/9LcBk49J8eN4sD36Kpd4gnmsDSGmX3dKyfBnGNB1gJ4z) |
| storage_deposit (op → usdc.fakes.testnet) | [`BAmKGrVR1w…`](https://testnet.nearblocks.io/txns/BAmKGrVR1wDgvNQPMkaPzoBuzbXbE6TZZuYfeTWPsQRp) |
| storage_deposit (op → usdc.fakes.testnet) | [`69Mws9Gynj…`](https://testnet.nearblocks.io/txns/69Mws9Gynj4stZfhH8tztVYsKb2X6xV7UuEYHo71JBCc) |
| mint (leader → usdc.fakes.testnet) | [`3MeVaps9Bx…`](https://testnet.nearblocks.io/txns/3MeVaps9BxVqkm7NCKYG4eKrWKWJft4XJx2TUMDw4KV8) |
| ft_transfer_call (leader → usdc.fakes.testnet) | [`F7RXX11He4…`](https://testnet.nearblocks.io/txns/F7RXX11He4jbTNE6PF25bULoCSk3wTAJuDDmpP877pQG) |
| sign_intent (op → vault2) | [`H21tEP1tXM…`](https://testnet.nearblocks.io/txns/H21tEP1tXMCdXzXrX3eD8k8t6vwYfJdRyUuKA5Qo3JaQ) |
| execute_intents (op → intents) | [`7w9wYSju2Y…`](https://testnet.nearblocks.io/txns/7w9wYSju2YRsDGjAzqMAAHRwXRVMM3Z5hDwmnMVZBuNy) |

## Paper season (item 1, 2026-11-09)

Four demo vaults plus a drill vault, deployed by `operator/scripts/season-setup.ts`. All of them point at the real defuse verifier on testnet (`sp-intents-61557.testnet`), so deposits are forwarded to each vault's MPC-derived account there. The operator `sp-sop-92991.testnet` runs from GitHub Actions every 15 minutes (`.github/workflows/season.yml`): bots decide from public market data, signals are paper-filled at real 1Click dry-quote prices (public legs, no partner key), and a signed NAV is posted per vault.

| Vault | Leader | Strategy |
|---|---|---|
| [`sp-momo-92991.testnet`](https://testnet.nearblocks.io/address/sp-momo-92991.testnet) | `sp-lmomo-92991.testnet` | Momentum bot: Rule-based: long NEAR when the 1h EMA is above the 6h EMA, flat when below. |
| [`sp-meanrev-92991.testnet`](https://testnet.nearblocks.io/address/sp-meanrev-92991.testnet) | `sp-lmeanrev-92991.testnet` | Mean-reversion bot: Rule-based: buys NEAR 1.5σ below its 6h mean, sells 1.5σ above. |
| [`sp-ai-92991.testnet`](https://testnet.nearblocks.io/address/sp-ai-92991.testnet) | `sp-lai-92991.testnet` | AI leader: An LLM on NEAR AI Cloud decides each epoch from public market data; it commits to its rationale by hash only. |
| [`sp-manual-92991.testnet`](https://testnet.nearblocks.io/address/sp-manual-92991.testnet) | `sp-lmanual-92991.testnet` | Manual leader: A human leader signing signals by hand. |
| [`sp-drill-92991.testnet`](https://testnet.nearblocks.io/address/sp-drill-92991.testnet) | `sp-leader-60270.testnet` | Emergency drill: Test build with a 5-minute NAV timeout, for the emergency-exit drill. |

Followers: `sp-follower-60270.testnet`, `sp-fund-61557.testnet`. Fill logs and bot notebooks are sealed (AES-256-GCM) in the `season-state` branch; `last-run.json` there shows the last tick, redacted to what the chain shows.

<details><summary>Setup transactions (30)</summary>

| Step | Tx |
|---|---|
| sp-lmomo-92991.testnet → usdc.fakes.testnet.ft_transfer_call | [`6awKBsbWBz…`](https://testnet.nearblocks.io/txns/6awKBsbWBzQFTrcZJVJu8Xezdff1HXWb4H8mQFHSSPef) |
| sp-follower-60270.testnet → usdc.fakes.testnet.ft_transfer_call | [`68s5HSqXnW…`](https://testnet.nearblocks.io/txns/68s5HSqXnWWYEqoRApMbEaun7Z5RT8ZTv3PLYdgeFF91) |
| sp-fund-61557.testnet → usdc.fakes.testnet.ft_transfer_call | [`HSsG549WBD…`](https://testnet.nearblocks.io/txns/HSsG549WBD3p8CTvCPhQvUarrwNcAPX6M4uv9Tt6QAwb) |
| deploy sp-meanrev-92991.testnet (release build) | [`BJHjQZCGRC…`](https://testnet.nearblocks.io/txns/BJHjQZCGRC3ovLxnVs3Em5oRreHaZeAexRQsHqiQyhxx) |
| sp-meanrev-92991.testnet → sp-meanrev-92991.testnet.new | [`68uKR8fZu5…`](https://testnet.nearblocks.io/txns/68uKR8fZu5JtdjEyh2xd1B8D75hiQVqBR2497tBgMTyf) |
| sp-sop-92991.testnet → sp-meanrev-92991.testnet.activate | [`416SJ94fBt…`](https://testnet.nearblocks.io/txns/416SJ94fBtWaJAhvsTjhpwYtYZz4hnLUU7epnfawubD4) |
| sp-lmeanrev-92991.testnet → sp-meanrev-92991.testnet.set_signal_key | [`AfW7b6Uevb…`](https://testnet.nearblocks.io/txns/AfW7b6Uevb6p91QaeHReMUdMjdW7E2mLdZ5jAaBLhXiy) |
| sp-lmeanrev-92991.testnet → usdc.fakes.testnet.ft_transfer_call | [`5dwA8VrV6C…`](https://testnet.nearblocks.io/txns/5dwA8VrV6CC3fz2uSbLphFALLPGoWd2BNiK2RFvgsKFo) |
| sp-follower-60270.testnet → usdc.fakes.testnet.ft_transfer_call | [`ARZpMSS4ez…`](https://testnet.nearblocks.io/txns/ARZpMSS4ezEJaYwk3DRdH2LWEC1CVvrJ64n7LAXVVDud) |
| sp-fund-61557.testnet → usdc.fakes.testnet.ft_transfer_call | [`9pCY3aXYDW…`](https://testnet.nearblocks.io/txns/9pCY3aXYDWZLoiebmYqjBd8CpsRGUet4XEyrfqUnFoyK) |
| deploy sp-ai-92991.testnet (release build) | [`46YZbtXQMb…`](https://testnet.nearblocks.io/txns/46YZbtXQMbumD6DymRpF2Ns4rfkAmYXGTUMaAn58YpPV) |
| sp-ai-92991.testnet → sp-ai-92991.testnet.new | [`3cDhZeXyVq…`](https://testnet.nearblocks.io/txns/3cDhZeXyVqKpHiyAtxU1Nh3r9fqdSyW3Bk2es4ggaPL2) |
| sp-sop-92991.testnet → sp-ai-92991.testnet.activate | [`DS8AMKDQez…`](https://testnet.nearblocks.io/txns/DS8AMKDQezuCvLEFuEnQy1jkijy1qkjXgCyfeL1x5sfi) |
| sp-lai-92991.testnet → sp-ai-92991.testnet.set_signal_key | [`HykuVkHM1w…`](https://testnet.nearblocks.io/txns/HykuVkHM1wnbiRHVdC2o2fzqjvMKRoSL756TY5snsk4f) |
| sp-lai-92991.testnet → usdc.fakes.testnet.ft_transfer_call | [`4zkuH4qji4…`](https://testnet.nearblocks.io/txns/4zkuH4qji4ViX1FqwRrP7CwkJSR7Eq1Dm2YRiX7LzNY8) |
| sp-follower-60270.testnet → usdc.fakes.testnet.ft_transfer_call | [`2kzpgvwAoJ…`](https://testnet.nearblocks.io/txns/2kzpgvwAoJu2bJN8JuXudtYXj4QC5biSSaoGdQzEcKwo) |
| sp-fund-61557.testnet → usdc.fakes.testnet.ft_transfer_call | [`EyiPGvkQAk…`](https://testnet.nearblocks.io/txns/EyiPGvkQAkCL2TY32C7KqMNmoxkArHwD87HdXNWXiUir) |
| deploy sp-manual-92991.testnet (release build) | [`7pr69bHGF6…`](https://testnet.nearblocks.io/txns/7pr69bHGF63CDLMytu5qXKwR8ghmnKTUL2czXA1mUuPg) |
| sp-manual-92991.testnet → sp-manual-92991.testnet.new | [`EyRYKmtPcR…`](https://testnet.nearblocks.io/txns/EyRYKmtPcRPHWi3nkyQjBC6wT5Q2zgZXhSH1KVEdA5pV) |
| sp-sop-92991.testnet → sp-manual-92991.testnet.activate | [`BkJGfKQ5E3…`](https://testnet.nearblocks.io/txns/BkJGfKQ5E3bV5W98oAWJU8rsrd8nLYQEKsnhg72Ce9XR) |
| sp-lmanual-92991.testnet → sp-manual-92991.testnet.set_signal_key | [`EuTLd1b4tq…`](https://testnet.nearblocks.io/txns/EuTLd1b4tqjiGgvF89Ni5PigopqACYMuh8xAwV7uoSNq) |
| sp-lmanual-92991.testnet → usdc.fakes.testnet.ft_transfer_call | [`2MwUsjQ8b3…`](https://testnet.nearblocks.io/txns/2MwUsjQ8b3gA2kjq79o1WKaJ55ZWLDgFk5rR9M4G95Fu) |
| sp-follower-60270.testnet → usdc.fakes.testnet.ft_transfer_call | [`fv6DrmCL1b…`](https://testnet.nearblocks.io/txns/fv6DrmCL1bX2oM29AS59ezJN4qj7esHG4ko28KkoGM4) |
| sp-fund-61557.testnet → usdc.fakes.testnet.ft_transfer_call | [`Eh3UKv562K…`](https://testnet.nearblocks.io/txns/Eh3UKv562KLDmbfartVG4mwSX9BUTSosg9M6N1YDmB5e) |
| deploy sp-drill-92991.testnet (drill build) | [`GVwLkH9fKe…`](https://testnet.nearblocks.io/txns/GVwLkH9fKeVXcfpEpGnRy9JQvab7iKj6FKzgKZQxW1Y4) |
| sp-drill-92991.testnet → sp-drill-92991.testnet.new | [`AbTRnnyaZB…`](https://testnet.nearblocks.io/txns/AbTRnnyaZBQhTSNTKx3i2qj4aEw3BdNDpPskYTBq29G9) |
| sp-sop-92991.testnet → sp-drill-92991.testnet.activate | [`HG7MLsoAzZ…`](https://testnet.nearblocks.io/txns/HG7MLsoAzZsuWE8fNRk4cqCoU4qBnQqpte3AY56rUamn) |
| sp-leader-60270.testnet → sp-drill-92991.testnet.set_signal_key | [`6KjzpmtXha…`](https://testnet.nearblocks.io/txns/6KjzpmtXha68Wg8cT2NTUv27nkiT86nenmcoq3BLTGbn) |
| sp-leader-60270.testnet → usdc.fakes.testnet.ft_transfer_call | [`FKbyXxLgLB…`](https://testnet.nearblocks.io/txns/FKbyXxLgLBzzMkC4nmMaanJEfJjX4zhXj5xuo784Ezyx) |
| sp-follower-60270.testnet → usdc.fakes.testnet.ft_transfer_call | [`65gxuA6EFh…`](https://testnet.nearblocks.io/txns/65gxuA6EFhbAzcqHmsdy3MfnhEjqHKnwvnseRAL7Lq6P) |

</details>

## Emergency exit drill (item 3, 2026-11-09)

Vault [`sp-drill-92991.testnet`](https://testnet.nearblocks.io/address/sp-drill-92991.testnet), built with `--features drill` (NAV goes stale after 5 minutes instead of 24h; the build refuses non-`.testnet` accounts). Script: `operator/scripts/drill.ts`. The follower got their money out with no operator and no 1Click.

1. **Operator alive.** It posted NAV epoch 1: 100 USDC, 100 shares (leader 20, follower `sp-follower-60270.testnet` 80).
2. **Operator stopped.** Nothing posted. The NAV went stale after 308 s.
3. **Emergency.** `sp-fund-61557.testnet` (any account) called `trigger_emergency`. Its 5 USDC deposit afterwards was refunded in the same transaction: True.
4. **Exit, pro rata.** The follower called `emergency_exit`: 80000000 of 100000000 shares × book NAV 100000000 → claim **80000000** USDC units (pro rata exact: True).
5. **Payout signed by the vault key.** The follower called `sign_intent(PublicPayout{claim})`. The contract checked that the payload is one transfer of the base asset, from the vault's public intents balance, to the claim's exit account, for no more than the claim. Then MPC (`v1.signer-prod.testnet`) signed it: `ed25519:4MnV4JmQaXa7VPKe28xUG7Pz9UHcqvP5…`.
6. **Executed and withdrawn.** The follower submitted it to the real defuse verifier (`execute_intents`). The vault's public balance went 100000000 → 20000000, and the follower's intents balance was credited 80000000. `ft_withdraw` then moved it to their wallet: 50000000 → 130000000 (**+80000000**).
7. **Recorded.** The follower confirmed with `settle_payout(executed = true)`, which is allowed for the claimant in emergency. Claim: amount 80000000, paid 80000000, in flight 0.

The leader's 20 shares are still in the vault (book NAV 20000000, emergency True), so the UI shows the **Exit at last NAV** button: [vault page as the leader](https://amityadav0.github.io/silent-partner/vault/?id=sp-drill-92991.testnet&as=sp-leader-60270.testnet).

| Step | Account | Tx | Contract log |
|---|---|---|---|
| operator posts NAV epoch 1 (100.000000 USDC) | `sp-sop-92991.testnet` | [`BHLB2tGJZK…`](https://testnet.nearblocks.io/txns/BHLB2tGJZKCJmWPUsvNZP1f5oxjBfQ48MviKhLYpe5oT) |  |
| anyone: trigger_emergency | `sp-fund-61557.testnet` | [`ASYiiR6RVk…`](https://testnet.nearblocks.io/txns/ASYiiR6RVkKpD6pehBGpQM4q4Lty2yjbaj1BMkicb7MQ) | silent-partner.emergency |
| anyone: mint 5 test USDC | `sp-fund-61557.testnet` | [`5fGJ2Paz8x…`](https://testnet.nearblocks.io/txns/5fGJ2Paz8x9cwRSspvHBc6hCtU3Xgoj4PW8xP3eeTd4x) |  |
| anyone: deposit 5 USDC (refunded) | `sp-fund-61557.testnet` | [`BAEq3PZLSN…`](https://testnet.nearblocks.io/txns/BAEq3PZLSNyrnk6SzsJnVjkowDV9LiomWX6iDGM2YW94) | silent-partner.deposit_refused account=sp-fund-61557.testnet reason=deposits frozen: NAV stale or emergency |
| follower: emergency_exit | `sp-follower-60270.testnet` | [`3qMe9dxa5Q…`](https://testnet.nearblocks.io/txns/3qMe9dxa5QA8LNGkYkc5iWCr8qbKTRR7iCviBJsGz3FN) | silent-partner.claim id=0 account=sp-follower-60270.testnet amount=80000000 emergency=true |
| follower: sign_intent(PublicPayout) | `sp-follower-60270.testnet` | [`4Stows1SiF…`](https://testnet.nearblocks.io/txns/4Stows1SiFQ5XgTf2f3QKuNFpBXayicX5hgUiXZgTaG4) | silent-partner.signed prehash=ad6c582aecce5a782a6e3dcaaf9924cbf1ca7cfe042e7a91d09bbe5f019f567b signature=ed25519:4MnV4Jm |
| follower: execute_intents on the verifier | `sp-follower-60270.testnet` | [`DhphuPPKd2…`](https://testnet.nearblocks.io/txns/DhphuPPKd2CSu45dKwJdRrngzWj7ffD2iVfYKH4bCqDZ) |  |
| follower: ft_withdraw to wallet | `sp-follower-60270.testnet` | [`J6Gvruurzp…`](https://testnet.nearblocks.io/txns/J6GvruurzpVxVsmuCYDrZkbCC5t16oLN7ogbdk2atiV9) |  |
| follower: settle_payout(executed) | `sp-follower-60270.testnet` | [`EUZvm6KBEG…`](https://testnet.nearblocks.io/txns/EUZvm6KBEG6UtTUYx8cquBKQEWZazTYp8By23NaqZNWJ) |  |

## Settlement check (review finding 1, 2026-11-09)

Vault [`settle.sp-lmanual-92991.testnet`](https://testnet.nearblocks.io/address/settle.sp-lmanual-92991.testnet), running the fixed contract (D-H-2, commit `9aed265`) against the real defuse verifier `sp-intents-61557.testnet`. Script: `operator/scripts/settle-check.ts`.

- **Executed payout → paid.** Claim 0 (8000000 USDC units) was paid by the operator's live path: a `PublicPayout` signed by the vault's MPC key, then `execute_intents` on the verifier, then `settle_payout`. Settlement asked the verifier `is_nonce_used` and got true, so the claim is marked paid (8000000 of 8000000, nothing in flight). The follower's intents balance was credited 8000000. The review's attack (release an executed payout, then pay again) now ends here: an executed payout can't be released.
- **Payout that never executed → pending, then released.** A payout for claim 1 was signed and never submitted. `settle_payout` before its deadline returned `pending`, and after its deadline `released`. The claim had 4000000 open again, and the operator then paid it properly (`paid`, paid 4000000 of 4000000).
- **Who settled.** Every `settle_payout` above was sent by the follower, not the operator: settlement is permissionless.

| Step | Tx | Result |
|---|---|---|
| storage on fake USDC | [`BNVdB5fetd…`](https://testnet.nearblocks.io/txns/BNVdB5fetdayJeHVYhJKySTw7WALUbfWWhm5FAagc5Mi) | {'total': '1250000000000000000000', 'available': '0'} |
| lmanual: mint | [`3jbXSEjDuh…`](https://testnet.nearblocks.io/txns/3jbXSEjDuhbZsFNrM19Cj4655UQD6mVuRXPTsxwPyQuQ) |  |
| lmanual: deposit 10 USDC | [`FPADtx8i7K…`](https://testnet.nearblocks.io/txns/FPADtx8i7KtgLsbQocyiXrMjrn5X3fsbCZtikP6h8J5d) | 10000000 |
| follower: mint | [`7QDFXWfXvk…`](https://testnet.nearblocks.io/txns/7QDFXWfXvkmy5E21itRaWgrkryrEXtH4R4pa9Hn9V1Ae) |  |
| follower: deposit 20 USDC | [`5AUqFLL5Wj…`](https://testnet.nearblocks.io/txns/5AUqFLL5WjuCAnFu9ry5xKi5fFRDQKbnnGpmdTndUso2) | 20000000 |
| follower: request_withdraw 8 USDC | [`DtG8DY1dSf…`](https://testnet.nearblocks.io/txns/DtG8DY1dSfepFH6uUSipYkiiMjW5owBthpxnr5sXXM1) | 0 |
| post NAV epoch 1 (30 USDC) | [`9Unxuh1tLX…`](https://testnet.nearblocks.io/txns/9Unxuh1tLXeBP3vPSV1LTSo6eGABoN39Sw1VmWSPkTgi) |  |
| operator: sign_intent(PublicPayout claim 0) | [`8EvWYyCBRc…`](https://testnet.nearblocks.io/txns/8EvWYyCBRcYYvt9NPPMRViYM7G4LWppmYmTmEvobsrND) |  |
| operator: execute_intents on the verifier | [`2PG4qSKGBN…`](https://testnet.nearblocks.io/txns/2PG4qSKGBNf5QFtvLx1rRzCeEWsQrkvqpuRH9aGKwA11) |  |
| anyone: settle_payout → verifier says nonce used | [`8i7a8EbW7i…`](https://testnet.nearblocks.io/txns/8i7a8EbW7i7vJfxu7U15zeFhJcZZqGdHYq859N6Y2Bw5) | paid |
| follower: request_withdraw 4 USDC | [`6YEidm3efK…`](https://testnet.nearblocks.io/txns/6YEidm3efKVgmJeadsr6ijLVQHKzNWj8SsynjPUtxayR) | 1 |
| post NAV epoch 2 (22 USDC) | [`91JQhLGtiA…`](https://testnet.nearblocks.io/txns/91JQhLGtiA9XgzXUDGzYUXCEMDQyQ4dBzE2QoLeWhbTq) |  |
| operator: sign_intent(PublicPayout claim 1), not executed | [`CZrQPLSjg4…`](https://testnet.nearblocks.io/txns/CZrQPLSjg4156y4RLL7vns6pVnjMf7XgmntH4o7rsEH7) | signature |
| anyone: settle_payout before the deadline | [`Dj8N6iJRAt…`](https://testnet.nearblocks.io/txns/Dj8N6iJRAtEhbEfEUScCHzvZAsp5CgzfPfmgWes4L5hv) | pending |
| anyone: settle_payout after the deadline | [`4wMufA7TuH…`](https://testnet.nearblocks.io/txns/4wMufA7TuHFt1cggmbDZd7SbHPxkDmBqjLyURdZXAvV6) | released |
| operator: pays claim 1 properly (sign, execute, settle) | [`9kDfZ1Rv2f…`](https://testnet.nearblocks.io/txns/9kDfZ1Rv2fjazwkiZAHBM1iJBf3kt2RLxaZZ5bfYthyK) | paid |

## Season scheduler and NAV bound (follow-ups, 2026-11-09)

**Scheduler (D-S-8).** After the change, the season loop's ticks landed on `season-state` 15 minutes apart: `season tick 05:11:47`, `05:26:54`, then, after the switch to the bounded contract, `05:31:49` and `05:46:47` UTC. A manual signal sealed under the season key went through the inbox: the dispatch input was ciphertext, the inbox job queued it at 05:23:45, and the 05:26:54 tick executed it for `sp-manual-92991.testnet` (signal `7b41d122…`, recorded on-chain).

**Oracle and migration (D-H-3).** A Pyth-compatible mock oracle `oracle.sp-lai-92991.testnet` was deployed, written only by `feed.sp-lai-92991.testnet` with CoinGecko's NEAR/USD. The four season vaults were upgraded in place, deploy plus `migrate_v1` in one transaction each, keeping epochs, shares and NAV history.

| Step | Tx |
|---|---|
| create oracle.sp-lai-92991.testnet | [`HsQx8n6rkD…`](https://testnet.nearblocks.io/txns/HsQx8n6rkDc8WrNy8MUdZ1nJLsc1chzehfh97tkvj2Ew) |
| create feed.sp-lai-92991.testnet | [`EM6vfh4Z5g…`](https://testnet.nearblocks.io/txns/EM6vfh4Z5gF6ckax178WwD8eaiaA8g82owWMtziX6Heg) |
| deploy oracle-mock | [`N4e8aN31vL…`](https://testnet.nearblocks.io/txns/N4e8aN31vLMv6yCNWELojkuTro51yMbnGgjRTZ9vBiG) |
| init oracle-mock | [`7zhH8sXZT2…`](https://testnet.nearblocks.io/txns/7zhH8sXZT2UhgRa3JLBfS9CUvXDBeaKqA7XCQ5iPCKjD) |
| writer: set NEAR/USD 3.57 | [`GfsNemvsxF…`](https://testnet.nearblocks.io/txns/GfsNemvsxFsvwEWMyzHzhts88VNLtxUqDSoGV9mKJ174) |
| upgrade + migrate_v1 sp-momo-92991.testnet | [`BD8293KNvz…`](https://testnet.nearblocks.io/txns/BD8293KNvzZy8b5D3A3t7SUHid4PFhtVy9b23TZeFLyU) |
| upgrade + migrate_v1 sp-meanrev-92991.testnet | [`B4LTrLgC9T…`](https://testnet.nearblocks.io/txns/B4LTrLgC9TPvJWbD5fF8syW1TGcVrT9F7xDUWYcuk9xh) |
| upgrade + migrate_v1 sp-ai-92991.testnet | [`AjGPPE5szo…`](https://testnet.nearblocks.io/txns/AjGPPE5szocsHiqtM646DGYKEkiGgBJLoiMQzA6fARK2) |
| upgrade + migrate_v1 sp-manual-92991.testnet | [`3onyLVFePL…`](https://testnet.nearblocks.io/txns/3onyLVFePLLQnnA3h1C9yReH1ta4TorbGgya6eEABsxU) |

**The bound, on-chain.**
- **Honest posts pass.** Epoch 6 (05:31:49) recorded the first oracle price. Epoch 7 (05:46:47) was the first checked post, and all four vaults were accepted inside their bands.
- **A lie is refused.** `operator/scripts/bound-check.ts` had the operator's own attestation key sign a NAV of 973550046 for `sp-meanrev-92991.testnet`, 20% above its book NAV of 811291705, with NEAR at 3.56 USD (moved -19 bps since the last post). The contract read the oracle and rejected it: `share return 2000bps outside [-180, 161]bps (asset -19bps)` ([`GGNWxo6V7h…`](https://testnet.nearblocks.io/txns/GGNWxo6V7hk2H743McPXe4UWZLANF1RZv7iPBjZfjMZr)). The band was [-180, 161] bps, and the vault's epoch and book NAV were unchanged: True.
