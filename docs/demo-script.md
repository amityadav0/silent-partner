# Demo video script (3:00)

**Format.** Screen recording with a voiceover. **[S]** marks what's on screen; **[V]** is the voiceover.

**Before you record:**
- Start the testnet operator: `cd operator && npx tsx --env-file-if-exists=../.env scripts/serve-testnet.ts`.
- Serve the site: `cd web && npm run build && npm run serve`.
- If the mainnet run is done, have docs/mainnet.md open in a tab.

---

**0:00 to 0:20: the problem**
- [S] Leaderboard (`/`).
- [V] "Copy trading has a dirty secret. When a leader trades, their followers' orders arrive after, so the leader can dump on them. And the leader's whole book is public. Silent Partner fixes both, on NEAR."

**0:20 to 0:50: the idea**
- [S] The leaderboard row, then the "One fill, one price" card.
- [V] "A leader and their followers share one vault. Its funds sit in a NEAR Confidential Intents account. When the leader signals a trade, it's executed once, for the whole pool, through a single 1Click confidential quote. Everyone gets the same price. The public sees attested NAV and returns, and nobody sees positions."

**0:50 to 1:25: send a signal**
- [S] `/leader/`. The signal key shows "ready". Set 5% of NAV, USDC → wNEAR, market, then click "Sign and send". The result reads "Executed for the whole vault". Reload: a new row appears under Recorded signals.
- [V] "The leader signs a signal in the browser with a key their NEAR account registered on the vault. The operator checks it, sizes it against NAV, gets one confidential quote, and records the signal hash on-chain, where the contract checks the leader's signature again. The trade itself stays private."

**1:25 to 2:05: why the operator can't steal**
- [S] docs/testnet.md, the "Real NEAR Intents verifier" section, then the "Thief payout refused" line.
- [V] "Here's the important part. The vault's intents account belongs to an MPC key derived for the contract, through Chain Signatures on the EdDSA domain. No one holds it, us included. The contract only asks MPC to sign a transfer that a 1Click-signed quote binds back into the vault, or out to a holder's own withdrawal. Here the real NEAR Intents verifier executes a vault transfer signed by MPC, and here the contract refuses a payout aimed at the operator's own account."

**2:05 to 2:35: attested returns**
- [S] `/vault/?id=…`. Show the chart and the Attested 4/4 tile. Scroll to NAV posts and the fill-log heads. Then open `/s/?id=…`.
- [V] "Every epoch the operator posts NAV, signed, pinned to the head of a hash-chained fill log. Your browser re-verifies every signature. Deposits mint at NAV. Withdrawals burn at the next NAV. The leader keeps at least 10% of the vault and earns a fee only above the high-water mark. If NAV stops for 24 hours, anyone can trigger emergency exits."

**2:35 to 3:00: proof and next**
- [S] docs/mainnet.md with its transaction links, or docs/testnet.md if mainnet isn't done. Then the README.
- [V] "It's live on testnet with real MPC signatures, and on mainnet with real money: a deposit, a trade, a NAV post and a withdrawal. Next: NAV computed in a TEE, so you don't have to trust the operator for pricing either. Silent Partner, by Scope. Built at the NEAR Hackathon."
