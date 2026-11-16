# Keeping the demo online through 2026-11-25

The hosted demo is the Pages site plus the testnet paper season (`.github/workflows/season.yml`, a tick every 15 minutes). This page lists what can make it stop, how it's watched, and what to do.

## What watches it

- **`health.yml`, every 30 minutes** (`.github/health.sh`). It checks:
  - the Pages site loads the landing page;
  - the latest season tick (`season-state/last-run.json`) is at most 45 minutes old. If it's older, the check reruns `season.yml` and waits up to 20 minutes;
  - `sp-momo-92991.testnet`'s last NAV, read straight from testnet RPC, is at most 60 minutes old;
  - NEAR AI answered for at least one AI leader at the last tick;
  - the tick's low-balance warnings (below).

  Anything still wrong opens one issue labelled `uptime`, or comments on the open one, and the run fails, so GitHub emails the repo owner. When everything recovers, the issue is closed automatically.
- **`season.ts` itself** warns when any account it spends from has less than 10 days of budget left. The warning is printed in the run log and written into `last-run.json` (`warnings`), which `health.yml` turns into the issue.

Try the check locally without side effects: `GH_REPO=amityadav0/silent-partner DRY=1 bash .github/health.sh`.

**Mainnet vault keeper (D-P5-12).** The GitHub job `keeper.yml` runs every 3 h and posts the mainnet vault's NAV when the last post is ≥2.5 h old. Its key can call only `post_nav`, with a 0.5 NEAR allowance on the operator account, which holds ~0.99 NEAR. A red keeper run means a post didn't land. Rerun it from the Actions tab, or post by hand with `cd operator && echo yes | npx tsx --env-file=../.env.mainnet scripts/op.ts epoch`. Act within 24 h of the last post, or anyone can put the vault into emergency mode. `op.ts` refreshes the keeper's fill log after every mainnet step by running `operator/scripts/keeper-sync.sh`. If the keeper's log is behind the chain, it fails the run instead of posting. The season loop dispatches the keeper every tick and the health check hourly, because cron on this repo is unreliable. Health opens the "uptime" issue if the last mainnet post is over 6 h old.

## Top-up thresholds (testnet NEAR)

Spend rates are the ones `season.ts` budgets with. "Warn below" is 10 days of spend. Balances were read on 2026-11-10 at 01:55 UTC, right after this round of top-ups.

| Account | Role | Spends NEAR/day | Warn below | Free now | Lasts to about |
|---|---|---|---|---|---|
| `sp-sop-92991.testnet` | season operator: NAV posts, signals, fills | 0.35 | 3.5 | 9.52 | Dec 7 |
| `feed.sp-lai-92991.testnet` | price-feed writer (mock oracle) | 0.03 | 0.3 | 0.98 | Dec 12 |
| `sp-momo-92991.testnet` | vault: Momentum bot | 0.29 | 2.9 | 6.03 | Nov 30 |
| `sp-meanrev-92991.testnet` | vault: Mean-reversion bot | 0.29 | 2.9 | 6.01 | Nov 30 |
| `sp-ai-92991.testnet` | vault: Allocator (AI) | 0.29 | 2.9 | 5.97 | Nov 30 |
| `sp-manual-92991.testnet` | vault: Steady Hand (manual) | 0.29 | 2.9 | 6.04 | Nov 30 |
| `sp-trend-8952.testnet` | vault: Trend Rider (AI) | 0.29 | 2.9 | 6.08 | Nov 30 |
| `sp-contra-8952.testnet` | vault: Contrarian (AI) | 0.29 | 2.9 | 5.52 | Nov 29 |
| `sp-voltgt-8952.testnet` | vault: Vol Target (AI) | 0.29 | 2.9 | 5.59 | Nov 29 |
| `sp-convict-8952.testnet` | vault: Conviction (AI) | 0.29 | 2.9 | 5.59 | Nov 29 |

Top-ups made on 2026-11-10, from spare test accounts that don't spend during the season. Before them, Conviction would have run out around Nov 22 and Contrarian around Nov 23.

| From | To | NEAR | Tx |
|---|---|---|---|
| `sp-fund-61557.testnet` | `sp-convict-8952.testnet` | 2 | [`CSb5Y8St…`](https://testnet.nearblocks.io/txns/CSb5Y8StJf1VQvtk7DMYrRiaoeEoBVkzAN2Y4xAPoc9R) |
| `sp-fund-61557.testnet` | `sp-contra-8952.testnet` | 1.5 | [`3U9sr4X5…`](https://testnet.nearblocks.io/txns/3U9sr4X55rJic5WmHmUgRd1danbAzT6BSiwvv6xMXGND) |
| `sp-lmeanrev-92991.testnet` | `sp-voltgt-8952.testnet` | 1.5 | [`HaVnAVGm…`](https://testnet.nearblocks.io/txns/HaVnAVGme3PqUtsMXQTChDMadLZM2nxdNERJaS8QT5EC) |
| `sp-lmeanrev-92991.testnet` | `sp-trend-8952.testnet` | 1.5 | [`9cH5CMmv…`](https://testnet.nearblocks.io/txns/9cH5CMmv8hVqTZfhCUhtnQYZ7Yz1dazNmsPZ2Mc9ViN1) |

Top-ups made on 2026-11-16, after `last-run.json` warned that seven vaults had 6.7–9.9 days left. Each house vault now has 3.27–3.71 NEAR free, which lasts 11.3–12.8 days at 0.29/day, until Nov 27 (AI) to Nov 29 (Mean Reversion). Faucet account creation wasn't used.

| From | To | NEAR | Tx |
|---|---|---|---|
| `sp-fund-61557` | `sp-convict-8952` | 0.95 | [`BSe8URb4…`](https://testnet.nearblocks.io/txns/BSe8URb4PBSwzfcVb7dubykq7htesVBtdDRjc13n5ocA) |
| `sp-lconvict-8952` | `sp-convict-8952` | 0.45 | [`5t2qSmGy…`](https://testnet.nearblocks.io/txns/5t2qSmGyydeMjKahLjZQd5mJdGr2tExCoo8L2bVCjWyY) |
| `sp-follower-60270` | `sp-contra-8952` | 1.4 | [`2EUyu9oF…`](https://testnet.nearblocks.io/txns/2EUyu9oFbRHMiS6abrzrR65hJZzrCeq8yrFKNjKgz8zF) |
| `sp-op-60270` | `sp-voltgt-8952` | 0.95 | [`8U1fr8kU…`](https://testnet.nearblocks.io/txns/8U1fr8kUKcUmzF7ebpaygZQD47xNH35xF74AooaKEUzY) |
| `sp-lvoltgt-8952` | `sp-voltgt-8952` | 0.45 | [`5saNfVQg…`](https://testnet.nearblocks.io/txns/5saNfVQgDebh699r2M9H6xv3xfA5fA8jvDjqeQer9qEr) |
| `sp-probe-1794059432` | `sp-ai-92991` | 0.45 | [`9VnBgs1C…`](https://testnet.nearblocks.io/txns/9VnBgs1CuCuGVxtP3gokPa7Vqz1hjCJrN14ottdzyYP4) |
| `sp-lai-92991` | `sp-ai-92991` | 0.45 | [`H2tgaB1f…`](https://testnet.nearblocks.io/txns/H2tgaB1fsaSPA8DfTu8C5bWE4Rpix1CZ7NYgqobHwtcv) |
| `sp-ltrend-8952` | `sp-trend-8952` | 0.45 | [`Ej9ZKQfB…`](https://testnet.nearblocks.io/txns/Ej9ZKQfBroq3EYdGG6teRcuScWJDhbRrP8AZnYVox9aw) |
| `sp-lcontra-8952` | `sp-trend-8952` | 0.45 | [`3GsHVNrh…`](https://testnet.nearblocks.io/txns/3GsHVNrhJDi4EvzgLgyiaZy2SBWtBaDw1tE2QpXWmKeg) |
| `sp-lmeanrev-92991` | `sp-meanrev-92991` | 0.45 | [`Bjsv8yE9…`](https://testnet.nearblocks.io/txns/Bjsv8yE9VPnvnsDgKS6SVPh55shDvtniGAiY4mKgymGr) |
| `sp-lmanual-92991` | `sp-meanrev-92991` | 0.45 | [`FyzLaub5…`](https://testnet.nearblocks.io/txns/FyzLaub5VXevwDaLPmeFaNVSUfSCF1BqFq5rvTEwBb1M) |
| `sp-lmomo-92991` | `sp-momo-92991` | 0.45 | [`En36aW8X…`](https://testnet.nearblocks.io/txns/En36aW8XjFznBMK99Gnipc9BgatAprGV9tqZQY4DXJrc) |

The silent-partner spares are now nearly empty. Each one keeps about 0.5 NEAR above storage.

Second round, the same day (INBOX C1: at least 12 days per vault). The spares were spent, so a new faucet account, `sp-gas-1116.testnet` (10 testnet NEAR), funded every season vault to about 13 days (until about Nov 29) and the operator to about 17 NEAR. After this, `health.yml` passed and uptime issue #4 closed.

| To | NEAR | Tx |
|---|---|---|
| `sp-ai-92991` | 0.6 | [`8ABQrSjt…`](https://testnet.nearblocks.io/txns/8ABQrSjtTE7BKbdbYVnTekLec1mbbL91r3NzTso3ELvo) |
| `sp-trend-8952` | 0.4 | [`DzjsFYG4…`](https://testnet.nearblocks.io/txns/DzjsFYG4h5U2QQupkhExSTmmrDvpVqi1o3aR3JRNS6cb) |
| `sp-contra-8952` | 0.45 | [`AMxsTKKE…`](https://testnet.nearblocks.io/txns/AMxsTKKEymYP7nVFoM6HaZsV3Qennu8pdMTRQ2U43ARG) |
| `sp-voltgt-8952` | 0.35 | [`13XFsvN3…`](https://testnet.nearblocks.io/txns/13XFsvN3SDmofRBBTL5cUyEThgpvLkABbNsuvz3opDMB) |
| `sp-convict-8952` | 0.5 | [`DRks5yyX…`](https://testnet.nearblocks.io/txns/DRks5yyXw7tfHGjxhfC6QzXzSbUPv8FZnhSepTDvVN77) |
| `sp-momo-92991` | 0.55 | [`92kkPHcX…`](https://testnet.nearblocks.io/txns/92kkPHcXiLyRBEpd3BZeoZNV7gKwrHRorcWDSzgDpuoz) |
| `sp-meanrev-92991` | 0.15 | [`GYz3ifUM…`](https://testnet.nearblocks.io/txns/GYz3ifUMJ5NYoU3kSq8N4qFMku4cPQvd9vn7UfspsTSG) |
| `sp-manual-92991` | 0.7 | [`QGubK9YD…`](https://testnet.nearblocks.io/txns/QGubK9YDHqKkGzHer4nWdwrcrTnvtn5cEAyQaCrRhej) |
| `sp-sop-92991` (operator) | 5.5 | [`2rfiPP1o…`](https://testnet.nearblocks.io/txns/2rfiPP1ox27nVLMi8RaYk4DZMw2cUzZfQe5XdkjbtQNe) |

The operator gets extra because its real spend is about 0.9 NEAR/day (posting plus the auto top-ups of community, Hold, Half and Majors vaults), not the 0.35/day the warning assumes.

**Community vaults refill themselves.** Calm Owl (`c0.sp-sop-92991.testnet`) and any vault launched from the site have no access key, and Calm Owl ran dry on 2026-11-11 (refilled with 3 NEAR from `sp-lai-92991.testnet` on 2026-11-12, tx [`6moUePvW…`](https://testnet.nearblocks.io/txns/6moUePvW6ri3pcauH3eKugJttum1g4bBXoUesaRomBk8)). Each season tick now sends 1 NEAR from the operator to any community vault, or any vault in `vaults.json` `auto_topup` (Calm Owl is listed), that has less than 3 days of spend left. It never takes the operator below 3 NEAR, and the transfers are listed in `last-run.json` as `topups` (D-J-6). Such a vault only shows up as a low-balance warning if a top-up fails. Then top up the operator.

**How to top up.** Use a spare account that has a key in `~/.near-credentials/testnet/`. As of 2026-11-16 every silent-partner spare is down to about 0.5 NEAR free. `sp-gas-1116.testnet` (faucet, ~0.7 left) is the newest; the next top-up needs a new faucet account (below). Then run:

```sh
near tokens <spare>.testnet send-near <account>.testnet '2 NEAR' network-config testnet sign-with-keychain send
```

If the spares run dry, create a fresh testnet account from the faucet (`near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair save-to-keychain network-config testnet create`, 10 NEAR) and send from it. Everything here is testnet; no real funds are involved.

## Other things that can stop it

| What | Effect | What to do |
|---|---|---|
| NEAR AI outage, key or credits (NEAR AI paused inference on 2026-11-10 after a security incident) | The five AI leaders hold and stop trading; ticks, NAVs and bots continue. `last-run.json` shows `ai_status: "unavailable"` and the vault page says "NEAR AI unavailable: holding". | A provider-side pause needs nothing from us; the leaders resume on the first tick after NEAR AI answers and the `uptime` issue closes itself. For a key or credit problem: check the owner's NEAR AI account, rotate the key, then `gh secret set NEARAI_API_KEY`. A one-off failure is retried once inside the tick. |
| GitHub cron skips | Scheduled runs are best-effort. The season loop re-dispatches itself every ~5h30m, so it doesn't depend on cron. | `health.yml` reruns `season.yml` when the tick is stale. |
| Public RPC rate limits (FastNEAR 429) | Reads fall back to other endpoints (`web/lib/vault.ts` `rpc`). | Nothing, unless all endpoints fail for long. |
| Testnet keys | Don't expire. | None. |
| GitHub Actions minutes | Public repository: free. | None. |
| Market data (CoinGecko, testnet season only) | If it fails, every leader holds for that tick and `last-run.json` shows `marketData: false`; the next tick tries again. | None, unless it persists. |

### Top-ups on 2026-11-14 (15:40–16:10 UTC)

The health check flagged the operator (2.55 NEAR, 7.3 days at 0.35/day) and Majors (0.46). The operator also pays the daily auto top-up of Hold NEAR, Half & Half and Majors, so its real spend is about 1.25 NEAR/day. Moved spare testnet NEAR to `sp-sop-92991.testnet` (now 15.05, ~12 days): 0.58 from `quotes2.sp-lmomo`, 0.66 from `quotes.sp-lmeanrev`, 2.26 from the retired `sp-vault-60270` (each kept 0.5 above storage), 3 from the testnet verifier `sp-intents-61557` (keeps 3 above storage), and 1 from each of the 8 house vaults (each keeps ~3.5 free, ~12 days at 0.29/day). Then 2 NEAR from the operator to `majors.sp-sop-92991.testnet`. Txs: `DSMSvLQj…`, `2FmZvNbX…`, `8GwPQBa8…`, `HAEG8pma…`, `8JVjFsAY…`, `DydADgTL…`, `Dpt4VCab…`, `ABZjGbE6…`, `HV6e867U…`, `GRmgVsU4…`, `G3XeomEe…`, `9THZSikW…`, `BgMNcPeM…`.
