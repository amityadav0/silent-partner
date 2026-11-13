# Mainnet

The runbook is [NEEDS-AMIT.md](NEEDS-AMIT.md) §3. Every transaction is recorded here.

## Accounts (implicit, created 2026-11-12)

Every role is an implicit account. Keys exist only in `~/.near-credentials/mainnet/` on the operator machine. Amit funded the hub from his wallet. Everything else was funded from the hub.

| Role | Account |
|---|---|
| Hub / round trip | `79bc21888f74e434e05fc751bb255eb1bc730103b97af96c52e53cf6e47d5ce0` |
| Vault | `1f80f62c945eec98005dac38ab9db5f95c44ef1258cf5ca9606fb8c7dd4da36e` |
| Operator | `c24664ec4591796ae1672b277dec9f211fb7e5bf63277598f07038b971f66bff` |
| Leader (owner) | `e5e48dcfe4ee062fc78dda34bd50885a1de812af069f939c8c544f9c2df625fd` |
| Follower | `66889f44cb0276a0c07dabecb6bbd99b53e488f49e62c4854f6476972eeca26d` |

## Transactions

| Step | Tx | Result |
|---|---|---|
| Amit → hub, 7 NEAR | (from Amit's wallet) | hub balance 7 NEAR |
| USDC `storage_deposit` for the hub | `2YzHoNzCpkEh3XeSAtZiWnSfKePsTbSkkSRZMnWEoKNh` | ok |
| Hub → vault, 5 NEAR | (near-api-js; the hash was lost when the output was truncated) | vault balance 5 NEAR |
| Hub → operator, 1 NEAR | `GxUFJnmMR9VUDfuMuQB3J6nKW454otx83aXwYnzh23BJ` | ok |
| Hub → leader, 0.15 NEAR | `9zwVrkVZZzwHeg82MHNUBYTyqiqB41bpGbvgytHbyrdD` | ok |
| Hub → follower, 0.15 NEAR | `yMRznLvXGEgMtaNryqTrU4hyJ1utRBBN3fcbTHhMW6x` | ok |
| USDC `storage_deposit` for the vault | `CZMFddRmWRbnYvHWeWTCyJ3Rf9yvCReSxAsQ1Yb87xuh` | ok |
| USDC `storage_deposit` for the leader | `5JCe2G8jjCJiyhnLrn5gYdmJ1gjnzywcYSyFUzddWgV9` | ok |
| USDC `storage_deposit` for the follower | `CtUt692fo5yVpn5oUbbnDwGSWhb4CP58QM1SuXoDnrCu` | ok |
| Amit → hub, 8 USDC | (from Amit's wallet) | hub USDC 8,000,000 |
| Hub → intents.near, 1 USDC (`ft_transfer_call`, empty msg) | `3q8xEzEPpRzRLd5Ye6TEgUc7kZk3W2NWaD7cUdva9V7p` | public intents USDC 1,000,000 |

## §1 round trip: done (2026-11-12 13:39–13:40 UTC)

Public → confidential → public, 1 USDC, through 1Click with our partner JWT. Fees 0. Full scrubbed log: [probes/p1-roundtrip-live.json](probes/p1-roundtrip-live.json).

| Leg | Intent hash | NEAR txs | Time |
|---|---|---|---|
| Shield | `VdxMVspsVvfx8i8sU9GNSpx6y5T2mNz4JwGWGUK4anA` | `HquRCMBdGgyYHtFR7BkawfwgyUEErWEu3XNz7F62TRyy` | ~10 s to SUCCESS |
| Unshield | `7cYMSJvopvzMa6QQCDaEonGnNeDVXaQNe3AJX3qXwt4U` | `GTpZK21yCC2RdC1qL8ex62m4THcCgzjoKa1PQtGzc7ec`, `BaYuN3JkPpR4dLMDWJxRh6mccQYiBYoC6kX6o87TmVw5` | ~10 s to SUCCESS |

Balances: before, the confidential balance was empty. After the shield it showed 1,000,000 with `source: "private"`. After the unshield the confidential balance was empty again and the public `intents.near` balance was back at 1,000,000.

## §3 vault run (2026-11-12)

| Step | Tx / hash | Result |
|---|---|---|
| Deploy + `new` (args: [mainnet-init.live.json](mainnet-init.live.json)) | `BVvZZYcnFspLT2t7nnCCLuqyh7dqqo3RSprJnw9UxhKH` | code_hash `9S9R3aaEs3cPs9nyjvhZKnsK7Ry3GcHTi1f1KVBtZy34`, the same as §3 (reproducible build of `624f3ba`) |
| `activate` (operator) | `3sNC3qXPJPoUfpdiwvhyeXFi1riA2oWSr1j5XVPYRVbb` | `vault_account` `2df9e05a…ab07` = hex of `v1.signer` `derived_public_key` ✓ |
| `set_signal_key` (leader) | `3YWcA9sHo42MSL5AwEXn4UF9BMX9kNcc2dwXUWnjEv3y` | signal pk `ed25519:7spWXqhYDeuNoQy5abFAqghXgjtt7qhfaUza3HcUnhdg` |
| Hub → leader 2 USDC, → follower 5 USDC | `761gDX3qKjAMutGN75zKcEuR9nULGLiSeb64eJC9H6Jk`, `HRAQxXbP44MkrNubCSnLn7YHvrjPsz6kDaWdz7j1MQHP` | ok |
| Hub → leader and follower, +0.1 NEAR each (a 150 Tgas `ft_transfer_call` needs more than 0.15 NEAR of balance) | `9bfWcxFAjAR2B4M2sGcpRzE8axt51ZALgczwjfrSu6yJ`, `78KQu3ccGagGnUCFwvVqMeTiVrjdraVpJkp93CEdD4Bz` | ok |
| Leader deposits 2 USDC | `FBR7NNGV3iWBUMrqtd5odXm4iPqkv8MDw6gYrR2u4Pn8` | 2,000,000 shares |
| Follower deposits 5 USDC | `w5EU6i3veqn13buD8ZRZNuTk5uxKa8wZxwjyHCpux3w` | 7,000,000 shares in total, leader 28.6%; the 7 USDC is forwarded to intents.near for the MPC account |
| Shield, first try | panicked in `sign_intent`: `payload deadline out of window` | No funds moved. Mainnet 1Click payloads carry ~3-day deadlines and the vault signs ≤1 h, so the operator now tightens them (D-P5-10) |
| **Shield 7 USDC**, the first MPC-signed intent on mainnet | sign `2v7aU92EcYUsgqDz6p12JfkwYAkRpB4wend8hpFqVZBT`, intent `H7kbaEipjaPFqmJRudB8Aee9SuE74J1TaK3vZ1hLwZ9S` | SUCCESS; confidential USDC 7,000,000 |
| **Epoch 1** | `DDAMZHLwEWAywF8MCtq5p64kwdEx9YLrSixF8YW75Tm3` | NAV 7,000,000, price 1.0, with verified 1Click price quotes |
| **Leader trade**: 25% USDC → wNEAR (confidential 1Click) | sign `6jg61f4qsPUPXK6cPzKaunZDdFP5Pjr7CWYf1uXpfEfz`, intent `G4ghXr2W6nHu2czXUTYYU6CcgaFzhWnfDBgqi1kQtCUi`, signal `1e93d2c8…052b` | 1.75 USDC → 0.51685 wNEAR (min 0.51419); `signals` = 1 on-chain |
| D-H-2 plain-nonce check (read-only `simulate_intents`) | [probes/plain-nonce-mainnet.json](probes/plain-nonce-mainnet.json) | plain nonce **accepted** (versioned too), so payouts can settle via `is_nonce_used` |
| Follower `request_withdraw`, 2,000,000 shares | `566BLzGi6AHGmsiYmGZ68CzxoEQumUH2EKoQoRqgY4EK` | pending: 1 |
| Epoch 2 (15:34 UTC) | `DTitp9HKHnLrLFiJH3Db4nCcYdqgS3dZxZHXmRgU9TeN` | NAV 6,982,430, price 0.99749. The withdrawal is priced here and starts maturing: a request burns at the post *after* the one that priced it, so nobody exits at a price they already knew |
| **Epoch 3 (16:35 UTC): burn + payout** | post `BeagVHK5g8FQAQzDhwq8fXYx71fYQ637xrmUw14hGk58`; unshield sign `CC1TtU2oGXRKQFp4DEWitnY7sH1UfJHEA1HjQ7TFmhyv` (intent `HtQJnoiErfc4QpXHs46Fj1MzwjRMeytYhjNXCehqqxsG`); payout sign `31wDgXPoSirp6NWPxRvr7wht2PqgW18uh6iuWMpjRXp3`, exec `E5KEBvXH7B83CzcaQQQ8Pmb9AVbn8HkFJKSyLcaaPx83`, settle `DBkm23XQpPU34HjSjt8DoPGFNiKfQAFypfkK9HhAzn6Q` | **Follower paid 1,994,980 USDC units** (2,000,000 shares × 0.99749) to their `intents.near` balance through an MPC-signed `PublicPayout` with a plain nonce, and the claim settled as `paid`. Afterwards: price 1.00427 (NEAR up), 4,075 fee shares to the leader on the new high, 5,004,075 shares left, leader 40% |

## Next

Leftover funds go back to `amityadav.near` after the demo window ends (Nov 25). That includes deleting the vault account with `amityadav.near` as the beneficiary, which returns its storage NEAR.

## Keeper (D-P5-12, 2026-11-13)

| Step | Tx | Result |
|---|---|---|
| Epoch 4, by hand | `CRprZtR6Lw7wC6bUFKj342dyRU1HYedM9qipihytehrN` | NAV 5,017,539 at 02:48:30 UTC |
| `add_key` on the operator: function-call key `ed25519:AqDGG1ec9uyt95GPwCoQwRwA3mSC5358ApVekBXLkVQs`, receiver = vault, methods = [`post_nav`], allowance 0.5 NEAR | `ETSsDQfrZi3o1T69oVeTVh4XeEhgi96rgxqRRioGKhBk` | ok. A first key with a 0.75 NEAR allowance (`Hraxwyi2…`) was deleted (`CdkYVZcx…`) |

- **Secrets** (set with `gh secret set` from local files, never printed or committed): `KEEPER_POST_NAV_KEY`, `MAINNET_ATTESTATION_KEY`, `KEEPER_FILL_LOG`.
- **Schedule.** The job `.github/workflows/keeper.yml` runs every 3 h. It posts when the last post is ≥2.5 h old and never within the contract's 1 h minimum.
- **If the secrets leak.** Prices can move only inside the 1Click-quote band, and the vault's positions are exposed. No funds can move: the key can't shield, trade, pay or transfer.
