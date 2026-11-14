// Smoke tests against the static export, reading the testnet vault live.
// The signal test also needs the testnet operator on :8788
// (operator: npx tsx scripts/serve-testnet.ts) and the local testnet keys.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { VAULT, leaderSeedHex, withLeaderKey } from "./helpers";

test("landing page: public-vs-sealed ticket, proof strip, six cards, exit band, comparison, live stats", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Not the crowd.");
  await expect(page.getByTestId("stamp")).toHaveText("SEALED");
  await expect(page.getByTestId("ticket").getByTestId("redacted").first()).toBeVisible();
  await page.getByTestId("ticket-public").click();
  await expect(page.getByTestId("stamp")).toHaveText("EXPOSED");
  await expect(page.getByTestId("ticket")).toContainText("LONG");
  await expect(page.getByTestId("proof-strip")).toContainText("0.00%");
  await expect(page.getByTestId("proof-cards").locator(".card")).toHaveCount(6);
  await expect(page.getByTestId("drill-line")).toContainText("no operator online");
  await expect(page.getByTestId("compare")).toContainText("Same trade, same price");
  await expect(page.getByRole("link", { name: "Meet the leaders" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Docs" })).toHaveAttribute("href", /github\.com\/amityadav0\/silent-partner/);
  await expect(page.getByTestId("live-stats")).toContainText(/\d+ price updates/);
});

test("theme: light by default, the toggle switches and is remembered", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("theme: a first visit is light even when the system prefers dark", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "dark", baseURL: "http://localhost:3000" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await ctx.close();
});

test("leaderboard lists the vault with attested NAVs and no positions", async ({ page }) => {
  await page.goto("/leaderboard/");
  // a season vault: the first testnet vault is now under "Test vaults" (T4)
  const row = page.getByTestId("row-sp-momo-92991.testnet");
  await expect(row).toBeVisible();
  await expect(row).toContainText(/✓ \d+\/\d+/);
  await expect(row).toContainText(/[+−]\d+\.\d{2}%/);
  await expect(page.getByTestId("leaderboard")).not.toContainText(/wNEAR|USDC/);
  await expect(row.getByTestId("redacted")).toBeVisible();
  await expect(page.getByTestId("honesty")).toContainText("paper · testnet");
});

test("vault page: chart, every NAV signature verified, deposit and withdraw controls", async ({ page }) => {
  await page.goto(`/vault/?id=${VAULT}`);
  await expect(page.getByTestId("returns-chart")).toBeVisible();
  const attested = page.getByTestId("stat-attested");
  await expect(attested).toContainText(/(\d+) \/ \1/);
  await expect(attested).toContainText("verified in your browser");
  await page.getByTestId("tech-record").locator("summary").click();
  await expect(page.getByTestId("nav-table").locator("tbody tr").first()).toBeVisible();
  await expect(page.getByTestId("nav-table")).not.toContainText("✗");
  await expect(page.getByTestId("follow-cta")).toHaveText("Follow privately");
  await expect(page.getByTestId("my-position")).toContainText("Connect a wallet");
});

test("share page shows return and browser-verified proof", async ({ page }) => {
  await page.goto(`/s/?id=${VAULT}`);
  await expect(page.getByTestId("share-return")).toContainText("%");
  await expect(page.getByTestId("share-proof")).toContainText("✓");
});

test("wallet modal offers exactly MyNearWallet and Meteor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("MyNearWallet").first()).toBeVisible();
  await expect(page.getByText("Meteor Wallet").first()).toBeVisible();
});

test("leader console signs a signal in the browser; the operator executes and records it", async ({ page, request }) => {
  const seed = leaderSeedHex();
  test.skip(!seed, "no local testnet keys");
  const up = await request.get("http://localhost:8788/v1/health").then((r) => r.ok()).catch(() => false);
  test.skip(!up, "testnet operator not running on :8788");
  test.setTimeout(120_000);
  await withLeaderKey(page, seed!);
  await page.goto(`/leader/?id=${VAULT}`);
  await expect(page.getByTestId("signal-key")).toContainText("ready");
  const before = await page.getByTestId("signals-table").locator("tbody tr").count();
  // sell wNEAR for USDC: earlier runs bought with all of this test vault's USDC, so a buy has "nothing to sell"
  await page.getByLabel("Sell").selectOption({ label: "wNEAR" });
  await page.getByLabel("Buy").selectOption({ label: "USDC" });
  await page.getByLabel("Size percent of the vault").fill("5");
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByRole("status")).toContainText("Executed for the whole vault", { timeout: 90_000 });
  await page.reload();
  await expect.poll(async () => page.getByTestId("signals-table").locator("tbody tr").count(), { timeout: 30_000 }).toBeGreaterThan(before);
});

test("drill vault: emergency state, pro-rata exit button, the follower's paid emergency claim", async ({ page }) => {
  const DRILL = "sp-drill-92991.testnet";
  await page.goto(`/vault/?id=${DRILL}&as=sp-leader-60270.testnet`);
  await expect(page.getByTestId("emergency")).toContainText("Emergency mode");
  await expect(page.getByTestId("status")).toHaveText("emergency");
  await expect(page.getByTestId("emergency-exit")).toBeVisible();
  await expect(page.getByTestId("emergency")).toContainText("claim of about 20");
  await page.goto(`/vault/?id=${DRILL}&as=sp-follower-60270.testnet`);
  await expect(page.getByTestId("my-position")).toContainText("Claim #0 (emergency): 80");
  await expect(page.getByTestId("my-position").locator(".chip-ok")).toHaveText("paid");
});

test("what the chain sees: three views of one vault; the disclosed log matches every on-chain commitment", async ({ page }) => {
  await page.goto("/chain/");
  await expect(page.getByTestId("observer")).toContainText("Vault value");
  await expect(page.getByTestId("follower")).toContainText("P&L");
  await expect(page.getByTestId("leader")).toContainText("Holds wNEAR");
  await expect(page.getByTestId("disclosure-verdict")).toContainText("Matches the chain");
  await expect(page.getByTestId("checks")).toContainText("Signal #0");
});

test("vault page as a follower: P&L from on-chain cost basis", async ({ page }) => {
  await page.goto("/vault/?id=sp-manual-92991.testnet&as=sp-follower-60270.testnet");
  await expect(page.getByTestId("pnl")).toContainText("Deposited");
  await expect(page.getByTestId("pnl")).toContainText("300.00 USDC");
  await expect(page.getByTestId("pnl")).toContainText(/[+−]\d+\.\d{2} USDC \([+−]\d+\.\d{2}%\)/);
});

test("withdrawal track: the drill follower's claim shows Paid", async ({ page }) => {
  await page.goto("/vault/?id=sp-drill-92991.testnet&as=sp-follower-60270.testnet");
  await expect(page.getByTestId("claim-0").getByTestId("track").locator("li.now")).toHaveText("Paid");
});

test("leaderboard: calmest first by default, among the season leaders; other sorts work", async ({ page }) => {
  await page.goto("/leaderboard/");
  await expect(page.getByTestId("row-sp-momo-92991.testnet")).toBeVisible();
  await expect(page.getByTestId("sort-dd")).toHaveAttribute("aria-pressed", "true");
  const SEASON = 8;
  const nums = async (id: string) => (await page.getByTestId(id).allTextContents()).slice(0, SEASON).map((t) => Number(t.match(/[+−-]?\d+(\.\d+)?/)![0].replace("−", "-")));
  const dd = (await nums("dd")).map(Math.abs);
  expect(dd).toEqual([...dd].sort((a, b) => a - b));
  await page.getByTestId("sort-stake").click();
  const stake = await nums("stake");
  expect(stake).toEqual([...stake].sort((a, b) => b - a));
  await page.getByTestId("sort-ret").click();
  const ret = await nums("ret");
  expect(ret).toEqual([...ret].sort((a, b) => b - a));
  await expect(page.getByTestId("lead-card")).toContainText("Lead a vault");
});

test("vault page: risk first, drawdown shaded, who sees what, follow panel order", async ({ page }) => {
  await page.goto("/vault/?id=sp-convict-8952.testnet&as=sp-follower-60270.testnet");
  const stats = page.getByTestId("stats").locator(".tile-l");
  await expect(stats.first()).toHaveText("Worst drawdown");
  await expect(page.getByTestId("dd-window")).toBeAttached();
  const who = page.getByTestId("who-sees");
  await expect(who.getByTestId("redacted")).toHaveCount(2);
  await expect(page.getByTestId("who-follows")).toHaveText("not shown");
  await expect(who).toContainText("balances are visible on chain");
  await page.getByTestId("who-you").click();
  await expect(who.getByTestId("redacted")).toHaveCount(2);
  await expect(page.getByTestId("your-shares")).toBeVisible();
  await expect(page.getByTestId("your-stop")).toBeVisible();
  await expect(page.getByTestId("stop-toggle")).toBeVisible();
  const panel = await page.getByTestId("follow-panel").innerText();
  const at = (t: string) => panel.indexOf(t);
  expect(at("Amount")).toBeGreaterThanOrEqual(0);
  expect(at("Amount")).toBeLessThan(at("Copy stop-loss"));
  expect(at("Copy stop-loss")).toBeLessThan(at("You enter at"));
  expect(at("You enter at")).toBeLessThan(at("Follow privately"));
  expect(at("Follow privately")).toBeLessThan(at("Try it with $1,000 simulated"));
});

test("AI vault: latest on-chain trade and the season-log hash check", async ({ page }) => {
  await page.goto("/vault/?id=sp-contra-8952.testnet#ai");
  await expect(page.getByTestId("ai-latest")).toContainText(/signal #\d+/);
  await expect(page.getByTestId("ai-last-tick")).toContainText(/decided|unavailable/);
  await page.getByTestId("ai-tech").locator("summary").click();
  await expect(page.getByTestId("ai-hash-check")).toContainText(/same hash|no log entry/);
  // decision receipts: each one passes the browser checks, or none exist yet
  await expect(page.getByTestId("ai-receipts")).toBeVisible();
  if (await page.getByTestId("ai-receipt").count()) await expect(page.getByTestId("ai-receipt").first()).toContainText("✓");
});

test("landing: 60-second tour with Open buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tour").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("tour-open").nth(2)).toHaveAttribute("href", /^https:\/\/testnet\.nearblocks\.io\/txns\//);
});

test("lead a vault: strategy sealed in the browser, bounds from the risk band, style line to approve", async ({ page }) => {
  await page.goto("/create/ai/");
  await page.getByTestId("f-name").fill("Calm Owl");
  await page.getByRole("button", { name: "Use the example" }).click();
  await page.getByTestId("f-risk-med").click();
  await expect(page.getByTestId("bounds")).toContainText("0% and 60%");
  await page.getByTestId("f-risk-low").click();
  await expect(page.getByTestId("bounds")).toContainText("0% and 40%");
  await expect(page.getByTestId("f-style")).toHaveValue(/risk$/);
  await expect(page.getByTestId("hash")).toHaveText(/^[0-9a-f]{10}…[0-9a-f]{10}$/);
  await expect(page.getByTestId("launch-btn")).toHaveText("Connect a wallet to launch");
  await page.getByTestId("kind-human").click();
  await expect(page.getByTestId("f-strategy")).toHaveCount(0);
  await expect(page.getByTestId("sealed-note")).toHaveCount(0);
});

test("open season: the community vault is on the leaderboard with its badge, and its page names it", async ({ page }) => {
  await page.goto("/leaderboard/");
  const row = page.getByTestId("row-c0.sp-sop-92991.testnet");
  await expect(row).toContainText("Calm Owl");
  await expect(row.getByTestId("community")).toHaveText("Community");
  await expect(page.getByTestId("calmest-title")).toHaveText(/^(Calmest return this week|Held up best this week)$/);
  await expect(page.getByTestId("calmest-ratio")).toHaveText(/^ · ratio −?\d+\.\d\d$/);
  await expect(page.getByTestId("calmest-ratio")).not.toHaveText(/−0\.00/);
  await page.goto("/vault/?id=c0.sp-sop-92991.testnet");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Calm Owl");
  await expect(page.getByTestId("community")).toBeVisible();
  await expect(page.getByTestId("about")).toContainText("strategy is sealed");
  // partner letters: the public sees that they exist, redacted
  await expect(page.getByTestId("letter-count")).toHaveText(/[1-9]\d* letters?/);
  await expect(page.getByTestId("letter-0").getByTestId("redacted")).toBeVisible();
  await expect(page.getByTestId("letters")).not.toContainText("USDC");
});

test("alerts panel: vault-level only, ntfy topic, browser notifications", async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
  await page.goto("/vault/?id=sp-momo-92991.testnet");
  const a = page.getByTestId("alerts");
  await expect(a).toContainText("nothing about positions");
  await expect(page.getByTestId("ntfy-link")).toHaveAttribute("href", "https://ntfy.sh/silent-partner-sp-momo-92991-testnet");
  await page.getByTestId("alerts-toggle").click();
  await expect(page.getByTestId("alerts-toggle")).toHaveText("Notifying in this browser ✓");
  await expect(page.getByTestId("alert-list")).not.toContainText("Reading");
});

test("my partners: a follower's vaults as one portfolio, and a simulated blend without a wallet", async ({ page }) => {
  await page.goto("/partners/?as=sp-follower-60270.testnet");
  await expect(page.getByTestId("total")).toContainText("USDC", { timeout: 40_000 });
  await expect(page.getByTestId("holding-sp-manual-92991.testnet")).toBeVisible();
  expect(await page.locator("[data-testid^=holding-]").count()).toBeGreaterThan(2);
  await expect(page.getByTestId("mix-dd")).toContainText("−");
  await page.getByTestId("blend-calm").click();
  await expect(page.getByTestId("blend-pick")).toHaveCount(3);
  await page.getByTestId("blend-go").click();
  await expect(page.getByTestId("simulated")).toBeVisible();
  await expect(page.getByTestId("simulated").locator(".row-kv")).toHaveCount(3);
});

test("share loops: a vault link with its own preview, invite credit, badge and bio line", async ({ page }) => {
  await page.goto("/v/sp-momo-92991.testnet/?ref=sp-lmomo-92991.testnet");
  await expect(page).toHaveURL(/\/vault\/\?id=sp-momo-92991\.testnet&ref=sp-lmomo-92991\.testnet/);
  await expect(page.getByTestId("invited-by")).toHaveText("Invited by sp-lmomo-92991.testnet");
  await expect(page.getByTestId("invite")).toHaveAttribute("data-url", "https://amityadav0.github.io/silent-partner/v/sp-momo-92991.testnet/?ref=sp-lmomo-92991.testnet");
  const html = await (await page.request.get("/v/sp-momo-92991.testnet/")).text();
  expect(html).toContain('property="og:image" content="https://raw.githubusercontent.com/amityadav0/silent-partner/season-state/cards/sp-momo-92991.testnet.png"');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  await page.goto("/s/?id=sp-momo-92991.testnet");
  await expect(page.getByTestId("bio")).toHaveValue(/^Leading on Silent Partner ✓ verified on chain · \d+ price updates · \d+% own money in · positions sealed$/);
});

test("first visit: three steps on the landing page only, skippable, remembered", async ({ browser }) => {
  // a real visitor: Playwright's navigator.webdriver would hide the sheet
  const human = async () => {
    const c = await browser.newContext({ baseURL: "http://localhost:3000", storageState: undefined });
    await c.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
    return c;
  };
  const ctx = await human();
  const page = await ctx.newPage();
  // deep links open on what was clicked
  for (const u of ["/leaderboard/", "/vault/?id=sp-momo-92991.testnet", "/create/ai/", "/?ref=sp-lmomo-92991.testnet"]) {
    await page.goto(u);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("welcome"), u).toHaveCount(0);
  }
  await page.goto("/");
  const w = page.getByTestId("welcome");
  await expect(w).toContainText("What's sealed");
  await expect(w.getByTestId("redacted")).toBeVisible();
  await page.getByTestId("welcome-next").click();
  await expect(w).toContainText("What you see");
  await page.getByTestId("welcome-next").click();
  await expect(w).toContainText("Your exit");
  await page.getByTestId("welcome-done").click();
  await expect(page).toHaveURL(/leaderboard/);
  await expect(w).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByTestId("welcome")).toHaveCount(0);
  // a second visitor skips it with Escape; a third with a backdrop click
  for (const how of ["escape", "backdrop"]) {
    const c = await human();
    const p2 = await c.newPage();
    await p2.goto("/");
    await expect(p2.getByTestId("welcome")).toBeVisible();
    if (how === "escape") await p2.keyboard.press("Escape");
    else await p2.mouse.click(5, 5);
    await expect(p2.getByTestId("welcome")).toHaveCount(0);
    await p2.reload();
    await page.waitForTimeout(300);
    await expect(p2.getByTestId("welcome")).toHaveCount(0);
    await c.close();
  }
  // a headless browser never sees it
  const bot = await (await browser.newContext({ baseURL: "http://localhost:3000", storageState: undefined })).newPage();
  await bot.goto("/");
  await bot.waitForTimeout(300);
  await expect(bot.getByTestId("welcome")).toHaveCount(0);
  await ctx.close();
});

test("leader console reads as a private desk", async ({ page }) => {
  await page.goto("/leader/?id=sp-convict-8952.testnet");
  await expect(page.getByTestId("desk-key")).toContainText("Signal key");
  await expect(page.getByTestId("desk-fee")).toContainText(/\d USDC/);
  await expect(page.getByTestId("desk-private")).toContainText("visible only to you and the operator");
});

test("no FOMO patterns on any public page", async ({ page }) => {
  for (const url of ["/leaderboard/", "/vault/?id=sp-convict-8952.testnet"]) {
    await page.goto(url);
    await expect(page.locator("main")).toContainText(/Verified|Leaders/);
    await expect(page.locator("main")).not.toContainText(/just copied|top gainer|you'd have made|ends in/i);
  }
});

test("create-vault wizard: four steps to init args and deploy commands", async ({ page }) => {
  await page.goto("/create/");
  await page.getByTestId("f-vault").fill("my-vault.testnet");
  await page.getByTestId("f-leader").fill("me.testnet");
  for (let i = 0; i < 3; i++) await page.getByTestId("next").click();
  await expect(page.getByTestId("create-ok")).toBeVisible();
  await expect(page.getByTestId("create-json")).toContainText('"perf_fee_bps": 2000');
  await expect(page.getByTestId("create-commands")).toContainText("near contract deploy my-vault.testnet");
  await page.getByRole("button", { name: "1. Roles" }).click();
  await page.getByTestId("f-vault").fill("Bad Vault");
  await page.getByRole("button", { name: "4. Review" }).click();
  await expect(page.getByTestId("create-errors")).toContainText("Vault account");
});

test("paper follow: no wallet, $1,000 copy with P&L and a dashed copy line, kept across reloads", async ({ page }) => {
  await page.goto("/vault/?id=sp-convict-8952.testnet");
  await page.getByTestId("paper-start").click();
  await expect(page.getByTestId("paper-value")).toContainText("$1,000.00");
  await expect(page.getByTestId("paper-pnl")).toContainText("%");
  await expect(page.getByTestId("copy-line")).toBeAttached();
  await page.reload();
  await expect(page.getByTestId("paper-value")).toBeVisible();
  await page.getByRole("button", { name: "Stop following" }).click();
  await expect(page.getByTestId("paper-start")).toBeVisible();
});

test("leaderboard: every house leader has a badge and a style", async ({ page }) => {
  await page.goto("/leaderboard/");
  for (const id of ["sp-trend-8952.testnet", "sp-convict-8952.testnet", "sp-momo-92991.testnet", "sp-manual-92991.testnet"]) {
    await expect(page.getByTestId(`row-${id}`).getByTestId("badge")).toBeVisible();
  }
  await expect(page.getByTestId("row-sp-trend-8952.testnet").getByTestId("badge")).toHaveText("AI");
  await expect(page.getByTestId("row-sp-trend-8952.testnet").getByTestId("risk")).toHaveAttribute("aria-label", "high risk");
});

test("follow from any chain: a real 1Click quote from Base into the vault, then a simulated arrival", async ({ page }) => {
  await page.goto("/vault/?id=sp-convict-8952.testnet");
  await page.getByTestId("cc-chain").selectOption("base");
  await page.getByTestId("follow-cta").click();
  await expect(page.getByTestId("cc-result")).toContainText(/USDC on Base → .* USDC into the vault in ~\d+ s/, { timeout: 30_000 });
  await page.getByTestId("cc-simulate").click();
  await expect(page.getByTestId("paper-value")).toBeVisible();
});

test("copy stop-loss control on an upgraded vault, as a follower", async ({ page }) => {
  await page.goto("/vault/?id=sp-convict-8952.testnet&as=sp-follower-60270.testnet");
  await expect(page.getByTestId("stop-loss")).toContainText("Copy stop-loss");
  await expect(page.getByRole("button", { name: "Set stop-loss" })).toBeDisabled(); // read-only view
});

test("track record card: drawdown, Sharpe-like, epochs, leader share", async ({ page }) => {
  await page.goto("/s/?id=sp-momo-92991.testnet");
  await expect(page.getByTestId("track-record")).toContainText("Leader holds");
  await expect(page.getByTestId("track-record")).toContainText("Price updates");
});

test("bring your track record: a pasted EIP-191 proof verifies in the browser", async ({ page }) => {
  const { secp256k1 } = await import("@noble/curves/secp256k1");
  const { keccak_256 } = await import("@noble/hashes/sha3");
  const { bytesToHex } = await import("@noble/hashes/utils");
  const priv = secp256k1.utils.randomPrivateKey();
  const addr = "0x" + bytesToHex(keccak_256(secp256k1.getPublicKey(priv, false).subarray(1)).subarray(12));
  const issued = "2026-11-09T10:00:00Z";
  const msg = `Silent Partner track record\nvault: sp-convict-8952.testnet\naddress: ${addr}\nissued: ${issued}`;
  const m = new TextEncoder().encode(msg);
  const h = keccak_256(new Uint8Array([...new TextEncoder().encode(`\x19Ethereum Signed Message:\n${m.length}`), ...m]));
  const s = secp256k1.sign(h, priv);
  const sig = "0x" + bytesToHex(s.toCompactRawBytes()) + (27 + s.recovery).toString(16);
  await page.goto("/track/");
  await page.getByTestId("tr-vault").fill("sp-convict-8952.testnet");
  await page.getByText("Or sign elsewhere and paste").click();
  await page.getByTestId("tr-address").fill(addr);
  await page.getByTestId("tr-issued").fill(issued);
  await page.getByTestId("tr-signature").fill(sig);
  await page.getByTestId("tr-verify").click();
  await expect(page.getByTestId("tr-result")).toContainText(`✓ ${addr} signed for sp-convict-8952.testnet`);
});

test("landing: recent verified events show times and checks only", async ({ page }) => {
  await page.goto("/");
  const ev = page.getByTestId("recent-events");
  await expect(ev.getByTestId("recent-event").first()).toBeVisible({ timeout: 30_000 });
  await expect(ev).toContainText("Price post signed");
  await expect(ev).toContainText("✓");
  await expect(ev).not.toContainText(/USDC|\$|followers?\b|\.testnet/i);
});

test("leaderboard: only vaults with 12 verified price posts are ranked", async ({ page }) => {
  await page.goto("/leaderboard/");
  await expect(page.getByTestId("row-sp-momo-92991.testnet")).toBeVisible();
  await expect(page.getByTestId("verifying")).toHaveCount(0, { timeout: 60_000 }); // Z5: first paint, then verified
  for (const cell of await page.locator("[data-testid^=row-sp-]:not([data-testid*=drill]):not([data-testid*=vault-60270]) td[data-label=Verified]").allTextContents()) {
    expect(Number(cell.match(/(\d+)\//)![1])).toBeGreaterThanOrEqual(12);
  }
  const fresh = page.getByTestId("new-leaders");
  if (await fresh.count()) await expect(fresh).toContainText(/ranking after 12 price posts \(\d+\/12\)/);
});

test("AI vault: an error-only latest tick still shows the last decision and its receipts from the log", async ({ page }) => {
  const id = "sp-contra-8952.testnet";
  const fx = JSON.parse(readFileSync(join(process.cwd(), "../operator/test/fixtures/nearai-receipt.json"), "utf8"));
  const { model, ...receipt } = fx.receipt;
  const memo = createHash("sha256").update(`${receipt.text}:${receipt.quote_sha256}`).digest("hex");
  await page.route("**/season-state/last-run.json", (r) => r.fulfill({ json: { ranAt: "2026-11-12T14:40:00Z", results: [{ vault: id, error: "NAV out of band" }] } }));
  await page.route("**/season-state/attestations.json", (r) => r.fulfill({ json: { [receipt.quote_sha256]: { ...fx.attestation, seen: "2026-11-12T14:25:00Z" } } }));
  await page.route("**/season-state/decisions.json", (r) =>
    r.fulfill({ json: { [id]: [{ ranAt: new Date().toISOString(), ai_model: model, ai_status: "ok", ai_target_band: "40–60%", ai_rationale_hash: memo, signal_hash: null, ai_receipt: receipt }] } }),
  );
  await page.goto(`/vault/?id=${id}`);
  const ai = page.getByTestId("ai-decisions");
  await expect(ai.getByTestId("ai-last-tick")).toContainText("Last decision", { timeout: 30_000 });
  await expect(ai.getByTestId("ai-last-tick")).toContainText("decided 40–60% NEAR");
  await expect(ai.getByTestId("ai-latest-tick-note")).toContainText("no decision");
  await expect(ai).toContainText(`${model} · NEAR AI Cloud`);
  await expect(ai.getByTestId("ai-receipt").first()).toContainText("✓");
  await expect(ai.getByTestId("ai-receipt").first()).toContainText("hold,");
});

test("mainnet vault: read live from mainnet, MAINNET chip, read-only, kept off the testnet leaderboard", async ({ page }) => {
  const id = "1f80f62c945eec98005dac38ab9db5f95c44ef1258cf5ca9606fb8c7dd4da36e";
  await page.goto(`/vault/?id=${id}`);
  await expect(page.getByTestId("mode")).toHaveText("MAINNET · real funds", { timeout: 30_000 });
  await expect(page.getByTestId("net-chip")).toHaveText("MAINNET");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Genesis (mainnet)");
  await expect(page.getByTestId("stat-attested")).toContainText("verified in your browser");
  await expect(page.getByTestId("mainnet-readonly")).toBeVisible();
  await expect(page.getByTestId("my-position")).toHaveCount(0);
  await expect(page.getByRole("link", { name: id })).toHaveAttribute("href", `https://nearblocks.io/address/${id}`);
  await page.goto("/");
  await expect(page.getByTestId("mainnet-line")).toContainText(/\d+ price posts, all verified/, { timeout: 30_000 });
  await expect(page.getByTestId("event-mainnet").first()).toBeVisible();
  await page.goto("/leaderboard/");
  await expect(page.locator(`[data-testid="row-${id}"]`)).toHaveCount(0);
  await expect(page.getByTestId("net-chip")).toHaveText("testnet");
});
