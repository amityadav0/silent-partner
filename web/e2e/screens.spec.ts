// Screenshots of every page with live testnet data → docs/screens/.
import { expect, test, type Page } from "@playwright/test";
import { VAULT, leaderSeedHex, withLeaderKey } from "./helpers";

const OUT = "../docs/screens";
const SEASON = "sp-momo-92991.testnet";
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

test("screens", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await expect(page.getByTestId("live-stats")).toBeVisible();
  await shot(page, "landing");

  await page.goto("/leaderboard/");
  await expect(page.getByTestId(`row-${SEASON}`)).toBeVisible();
  await expect(page.getByTestId("sparkline").first()).toBeVisible();
  await shot(page, "leaderboard");

  await page.goto(`/vault/?id=${SEASON}&as=sp-follower-60270.testnet`);
  await expect(page.getByTestId("returns-chart")).toBeVisible();
  await expect(page.getByTestId("pnl")).toBeVisible();
  await shot(page, "vault");

  await page.goto("/chain/");
  await expect(page.getByTestId("disclosure-verdict")).toContainText("Matches the chain");
  await shot(page, "chain");

  await page.goto("/vault/?id=sp-drill-92991.testnet&as=sp-leader-60270.testnet");
  await expect(page.getByTestId("emergency")).toBeVisible();
  await shot(page, "emergency");
  await page.goto("/vault/?id=sp-drill-92991.testnet&as=sp-follower-60270.testnet");
  await expect(page.getByTestId("claim-0")).toBeVisible();
  await shot(page, "emergency-claim-paid");

  await page.goto("/create/");
  await page.getByTestId("f-vault").fill("my-vault.testnet");
  await page.getByTestId("f-leader").fill("me.testnet");
  for (let i = 0; i < 3; i++) await page.getByTestId("next").click();
  await expect(page.getByTestId("create-ok")).toBeVisible();
  await shot(page, "create");

  const seed = leaderSeedHex();
  if (seed) await withLeaderKey(page, seed);
  await page.goto(`/leader/?id=${VAULT}`);
  await expect(page.getByTestId("signal-form")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "leader");

  await page.goto(`/s/?id=${SEASON}`);
  await expect(page.getByTestId("share-proof")).toContainText("✓");
  await shot(page, "share");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/vault/?id=${SEASON}`);
  await expect(page.getByTestId("returns-chart")).toBeVisible();
  await shot(page, "vault-mobile");
  await page.goto("/leaderboard/");
  await expect(page.getByTestId(`row-${SEASON}`)).toBeVisible();
  await shot(page, "leaderboard-mobile");
});
