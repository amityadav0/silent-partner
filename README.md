# Silent Partner

Private copy-trading vaults on NEAR Confidential Intents. By Scope.

**What.** A leader and their followers share one confidential vault account. The leader sends trade signals; an operator executes each signal once for the whole pool through 1Click confidential quotes and limit orders.

**Why.** On a public copy-trading platform, followers' orders arrive after the leader's, so the leader can front-run them or dump into them. A copy-trading vault fixes that only if nobody can see the positions. Here everyone gets the same fill, and the public sees attested NAV and returns but never positions.

**How.**
- `contract/`: the vault on NEAR. It handles shares, deposits and withdrawals at NAV, the leader's 10% minimum stake, a high-water-mark performance fee, operator-attested NAV per epoch, a registry of leader signal hashes and an emergency exit.
- `operator/`: a TypeScript service. It watches deposits, takes signed leader signals, executes them through 1Click and keeps a hash-chained fill log. It posts NAV every epoch and processes withdrawals.
- `web/`: a Next.js static site with a leaderboard, vault pages, a leader console and share pages. It supports MyNearWallet and Meteor.

**Live proof.** _TBD (P5): mainnet transactions in [docs/mainnet.md](docs/mainnet.md)._

**Run it.**

```sh
cp .env.example .env          # fill in testnet accounts; DRY_RUN=1 stays on
make test                     # contract + operator + web
make build                    # wasm, operator dist, web static export
```

Docs: [architecture](docs/architecture.md) · [threat model](docs/threat-model.md) · [decisions](docs/DECISIONS.md) · [status](docs/STATUS.md)
