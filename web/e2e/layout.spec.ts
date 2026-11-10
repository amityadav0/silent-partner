// Every page fits 375px and 1440px in both themes, with no sideways page scroll.
import { expect, test } from "@playwright/test";

const PAGES: [string, string][] = [
  ["/", "landing"],
  ["/leaderboard/", "row-sp-momo-92991.testnet"],
  ["/vault/?id=sp-convict-8952.testnet", "returns-chart"],
  ["/s/?id=sp-momo-92991.testnet", "share-proof"],
  ["/chain/", "observer"],
  ["/leader/?id=sp-convict-8952.testnet", "desk"],
  ["/create/", "create"],
  ["/create/ai/", "create-ai"],
  ["/track/", "track"],
];

for (const width of [375, 1440]) {
  for (const [url, ready] of PAGES) {
    test(`${url} fits ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await expect(page.getByTestId(ready)).toBeVisible();
      for (const theme of ["light", "dark"]) {
        await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over).toBeLessThanOrEqual(0);
      }
    });
  }
}
