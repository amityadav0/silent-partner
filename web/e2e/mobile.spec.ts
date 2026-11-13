// U8: the whole V1 → share → return flow on a 390 px phone (mobile project: touch, phone UA).
import { expect, test, type Locator, type Page } from "@playwright/test";

async function tapTargets(scope: Locator) {
  const small = await scope.locator("a.btn, button").evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => ({ t: (e.textContent ?? "").trim().slice(0, 30), h: e.getBoundingClientRect().height })).filter((x) => x.h < 44),
  );
  expect(small, "buttons at least 44 px tall").toEqual([]);
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "no horizontal scroll").toBeLessThanOrEqual(390);
}

test("U8: land → one tap → the card fits → share → the next person opens into a copy → come back to the same copy", async ({ page, context }) => {
  await page.goto("/");
  await noSideScroll(page);
  const cta = page.getByTestId("hero-copy");
  const cb = (await cta.boundingBox())!;
  expect(cb.y + cb.height).toBeLessThanOrEqual(844);
  expect(cb.height).toBeGreaterThanOrEqual(44);
  await cta.tap();

  const card = page.getByTestId("silent-copy");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("copy-record")).toBeVisible();
  const box = (await card.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await noSideScroll(page);
  await tapTargets(card);

  // the X intent: an https x.com/intent link, which the X app claims on iOS and Android
  const x = page.getByTestId("copy-x");
  const href = (await x.getAttribute("href"))!;
  expect(href).toMatch(/^https:\/\/x\.com\/intent\/post\?text=.+&url=https%3A%2F%2Famityadav0\.github\.io%2Fsilent-partner%2Fv%2F/);
  await expect(x).toHaveAttribute("target", "_blank");

  // share: on a phone the Web Share sheet opens with the text and the link
  const id = new URL(page.url()).searchParams.get("id")!;
  await page.evaluate(() => { (window as any).__shared = null; (navigator as any).share = async (d: unknown) => { (window as any).__shared = d; }; });
  await page.getByTestId("copy-share").tap();
  const shared = (await page.evaluate(() => (window as any).__shared)) as { text: string; url: string };
  expect(shared.url).toBe(`https://amityadav0.github.io/silent-partner/v/${id}/?ref=copy&copy=1`);
  expect(shared.text).toMatch(/silently copying/);

  // the next person taps the shared link on their phone
  const next = await context.browser()!.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: "e2e/welcomed.json" });
  const p2 = await next.newPage();
  await p2.goto(`/v/${id}/?ref=copy&copy=1`);
  await expect(p2.getByTestId("silent-copy")).toBeVisible({ timeout: 30_000 });
  await noSideScroll(p2);
  await next.close();

  // the first person comes back later: same copy, not restarted
  const entry = await page.evaluate((k) => localStorage.getItem(k), `sp.paper.${id}`);
  await page.goto("/");
  await page.goto(`/copy/?id=${id}`);
  await expect(page.getByTestId("copy-value")).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate((k) => localStorage.getItem(k), `sp.paper.${id}`)).toBe(entry);
});
