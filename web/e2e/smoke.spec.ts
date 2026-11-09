// Smoke tests against the static export, reading the testnet vault live.
// The signal test also needs the testnet operator on :8788
// (operator: npx tsx scripts/serve-testnet.ts) and the local testnet keys.
import { expect, test } from "@playwright/test";
import { VAULT, leaderSeedHex, withLeaderKey } from "./helpers";

test("leaderboard lists the vault with attested NAVs and no positions", async ({ page }) => {
  await page.goto("/");
  const row = page.getByTestId(`row-${VAULT}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(/\d+\/\d+ ✓/);
  await expect(row).toContainText(/[+−]\d+\.\d{2}%/);
  await expect(page.getByTestId("leaderboard")).not.toContainText(/wNEAR|holdings|position/i);
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
