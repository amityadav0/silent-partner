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

## Next

Deploy and init the vault. The wasm is checked: sha256 `7d4e87ae…47c7`, the same as §3. The args are in [mainnet-init.live.json](mainnet-init.live.json).

Leftover funds go back to `amityadav.near` after the demo window ends (Nov 25). That includes deleting the vault account with `amityadav.near` as the beneficiary, which returns its storage NEAR.
