# Demo video script (2:30)

Amit's own voice. 30 seconds on camera at the start, then screen. **[S]** is what's on screen, **[V]** is what you say. Everything runs on the hosted site: https://amityadav0.github.io/silent-partner/

**Before you record (2 minutes):**
- Open these tabs:
  - the [Conviction vault](https://amityadav0.github.io/silent-partner/vault/?id=sp-convict-8952.testnet), an AI leader that is always invested;
  - [What the chain sees](https://amityadav0.github.io/silent-partner/chain/);
  - the [drill vault as the follower](https://amityadav0.github.io/silent-partner/vault/?id=sp-drill-92991.testnet&as=sp-follower-60270.testnet);
  - the [rejected lie on NearBlocks](https://testnet.nearblocks.io/txns/9sSBzqNoE5HUqwGqnAxGHWL5iDFCAKzPeEcJXYK26nXn).
- If a simulated copy is already showing on the Conviction page, click "Stop following", so the follow happens on camera.
- Have [the season log](https://raw.githubusercontent.com/amityadav0/silent-partner/season-state/last-run.json) open for the AI leader's last decision (target bucket + rationale hash).

---

**0:00–0:30: you, on camera**
- [S] First 10 s: you in the corner, the landing page full frame. Click **On a public platform** (the ticket is stamped EXPOSED), then **On Silent Partner** (SEALED, every field redacted). Then full-frame face for the rest.
- [V] "I'm Amit. Copy trading has two problems. Your orders land after the leader's, so you get the worse price, or the leader dumps on you. And a good trader's whole book is public, so they stop sharing. Silent Partner fixes both, on NEAR."

**0:30–1:30: one complete moment**
- [S] Conviction vault. Point at the **AI** badge and the "paper · testnet" chip.
- [V] "This vault is led by an AI on NEAR AI Cloud. Followers and the leader share one vault, and every trade fills once, for the whole pool, at one price."
- [S] The Follow panel: 100 USDC, **From: Base**, then **Follow privately**. Real 1Click numbers appear: ~99.99 USDC into the vault in ~35 s.
- [V] "I follow from Base. One step, no bridging: NEAR Intents routes it and the vault mints my shares." Click **Simulate arrival (paper)**. Your copy appears.
- [S] Scroll to the chart (the dashed line is your copy), then to "Recorded signals" and the latest NAV post, with **Verified epochs n / n**.
- [V] "Every 15 minutes the AI decides. Its reasoning stays private: only a hash of it goes on-chain, inside the leader-signed signal. Then the NAV is posted, signed, and my browser re-checks every signature."
- [S] What the chain sees: the Observer column.
- [V] "And this is what everyone else sees: totals and returns. Not one position, not one trade before it happens."

**1:30–1:50: the exit, without the operator**
- [S] The drill vault as the follower: the red emergency banner, then Claim #0 with its track at **Paid**.
- [V] "If the operator disappears, anyone can switch the vault to emergency, and every holder exits pro rata. Here the operator was stopped and a follower paid themselves out, with no operator and no 1Click."

**1:50–2:05: the operator can't lie about returns**
- [S] The NearBlocks tx: the log reads `nav_rejected … share return 2000bps outside [-187, 74]bps`.
- [V] "The operator signed a NAV 20% too high. The contract checked it against two 1Click-signed price quotes, saw NEAR didn't move, and refused it."

**2:05–2:30: what NEAR does here**
- [S] The landing page, then the README.
- [V] "Confidential Intents keeps the positions private. A Chain Signatures key held by the contract signs only transfers back to the vault or to a holder's own claim. NEAR AI runs the AI leaders privately. And 1Click lets you follow from any chain. Silent Partner. Built at the NEAR Hackathon."
