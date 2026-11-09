// Screenshots of every page with live testnet data → docs/screens/.
import { expect, test } from "@playwright/test";
import { VAULT, leaderSeedHex, withLeaderKey } from "./helpers";

const OUT = "../docs/screens";

test("screens", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByTestId("live-stats")).toBeVisible();
  await page.screenshot({ path: `${OUT}/landing.png`, fullPage: true });

  await page.goto("/leaderboard/");
  await expect(page.getByTestId(`row-${VAULT}`)).toBeVisible();
  await page.screenshot({ path: `${OUT}/leaderboard.png`, fullPage: true });

  await page.goto(`/vault/?id=${VAULT}`);
  await expect(page.getByTestId("returns-chart")).toBeVisible();
  await expect(page.getByTestId("nav-table").locator("tbody tr").first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/vault.png`, fullPage: true });

  const seed = leaderSeedHex();
  if (seed) await withLeaderKey(page, seed);
  await page.goto(`/leader/?id=${VAULT}`);
  await expect(page.getByTestId("signal-form")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/leader.png`, fullPage: true });

  await page.goto(`/s/?id=${VAULT}`);
  await expect(page.getByTestId("share-proof")).toContainText("✓");
  await page.screenshot({ path: `${OUT}/share.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/vault/?id=${VAULT}`);
  await expect(page.getByTestId("returns-chart")).toBeVisible();
  await page.screenshot({ path: `${OUT}/vault-mobile.png`, fullPage: true });
});
