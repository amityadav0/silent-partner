// Smoke tests against the static export, reading the testnet vault live.
// The signal test also needs the testnet operator on :8788
// (operator: npx tsx scripts/serve-testnet.ts) and the local testnet keys.
import { expect, test } from "@playwright/test";
import { VAULT, leaderSeedHex, withLeaderKey } from "./helpers";

test("landing page: hero, three steps, links to the leaderboard and docs, live stats", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing")).toContainText("How it works");
  await expect(page.getByRole("link", { name: "See the leaderboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Docs" })).toHaveAttribute("href", /github\.com\/amityadav0\/silent-partner/);
  await expect(page.getByTestId("live-stats")).toContainText(/\d+ NAV posts/);
});

test("leaderboard lists the vault with attested NAVs and no positions", async ({ page }) => {
  await page.goto("/leaderboard/");
  const row = page.getByTestId(`row-${VAULT}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(/\d+\/\d+ ✓/);
  await expect(row).toContainText(/[+−]\d+\.\d{2}%/);
  await expect(page.getByTestId("leaderboard")).not.toContainText(/wNEAR|holdings|position/i);
  await expect(page.getByTestId("honesty")).toContainText("paper · testnet");
  await expect(page.getByTestId("row-sp-momo-92991.testnet").getByTestId("mode")).toHaveText("paper · testnet");
});

test("vault page: chart, every NAV signature verified, deposit and withdraw controls", async ({ page }) => {
  await page.goto(`/vault/?id=${VAULT}`);
  await expect(page.getByTestId("returns-chart")).toBeVisible();
  const attested = page.getByTestId("stat-attested");
  await expect(attested).toContainText(/(\d+)\/\1/);
  await expect(attested).toContainText("verified in your browser");
  await expect(page.getByTestId("nav-table").locator("tbody tr").first()).toBeVisible();
  await expect(page.getByTestId("nav-table")).not.toContainText("✗");
  await expect(page.getByRole("button", { name: "Deposit" })).toBeVisible();
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
  await page.getByLabel("Size percent of NAV").fill("5");
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
  await expect(page.getByTestId("observer")).toContainText("Book NAV");
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

test("leaderboard sorts by any column and draws a sparkline per vault", async ({ page }) => {
  await page.goto("/leaderboard/");
  await expect(page.getByTestId("sparkline").first()).toBeVisible();
  await page.getByTestId("sort-name").click();
  const names = await page.locator("tbody tr td:nth-child(2) a").allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
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
  await expect(page.getByTestId("row-sp-trend-8952.testnet").getByTestId("risk")).toHaveText("high risk");
});

test("follow from any chain: a real 1Click quote from Base into the vault, then a simulated arrival", async ({ page }) => {
  await page.goto("/vault/?id=sp-convict-8952.testnet");
  await page.getByTestId("cc-chain").selectOption("base");
  await page.getByTestId("cc-quote").click();
  await expect(page.getByTestId("cc-result")).toContainText(/USDC on Base → .* USDC into the vault in ~\d+ s/, { timeout: 30_000 });
  await page.getByTestId("cc-simulate").click();
  await expect(page.getByTestId("paper-value")).toBeVisible();
});

test("copy stop-loss control on an upgraded vault, as a follower", async ({ page }) => {
  await page.goto("/vault/?id=sp-convict-8952.testnet&as=sp-follower-60270.testnet");
  await expect(page.getByTestId("stop-loss")).toContainText("Copy stop-loss");
  await expect(page.getByRole("button", { name: "Set stop-loss" })).toBeDisabled(); // read-only view
});
