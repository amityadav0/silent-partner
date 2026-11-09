# season-state

State of the testnet paper season, written by `.github/workflows/season.yml`.

- `state/*.enc`: each vault's hash-chained fill log and its leader's notebook, sealed with AES-256-GCM under a repo secret. The fill-log head of every NAV post is on-chain, so the sealed log can be disclosed and checked later, but its contents (positions, trades, the AI leader's rationales) are private.
- `last-run.json`: what the last tick did, limited to what the chain shows anyway (epoch, NAV, tx, signal hash).

Testnet, paper fills at real 1Click dry-quote prices. No real funds.
