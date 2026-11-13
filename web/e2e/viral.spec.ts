// V1–V2: someone lands from an X link on a phone, understands it, copies a leader in one tap,
// and shares the copy. No wallet anywhere.
import { expect, test } from "@playwright/test";

const PHONE = { width: 390, height: 844 };

test("V1: on a phone, the no-wallet copy CTA and the ticket toggle are both above the fold", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const cta = page.getByTestId("hero-copy");
  await expect(cta).toHaveText(/Copy Contrarian with \$100: no wallet, 10 seconds/);
  for (const el of [cta, page.getByTestId("ticket-sealed")]) {
    const b = await el.boundingBox();
    expect(b, "visible").not.toBeNull();
    expect(b!.y + b!.height, "inside the first screen").toBeLessThanOrEqual(PHONE.height);
  }
});

test("V1: one tap starts a $100 simulated copy and lands on Your silent copy", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await page.getByTestId("hero-copy").click();
  const card = page.getByTestId("silent-copy");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Your silent copy");
  await expect(card).toContainText("Contrarian");
  await expect(page.getByTestId("copy-value")).toHaveText(/^\$\d+\.\d\d$/);
  await expect(page.getByTestId("copy-change")).toContainText("since you joined");
  await expect(card).toContainText("(sealed)");
  await expect(page).toHaveURL(/\/copy\/\?id=sp-contra-8952\.testnet$/);
  // kept across reloads, not restarted
  const entry = await page.evaluate(() => localStorage.getItem("sp.paper.sp-contra-8952.testnet"));
  expect(JSON.parse(entry!).usd).toBe(100);
  await page.reload();
  await expect(page.getByTestId("copy-value")).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => localStorage.getItem("sp.paper.sp-contra-8952.testnet"))).toBe(entry);
});

test("V2: the share carries only the copy's real change and a link that opens into a copy", async ({ page }) => {
  await page.goto("/copy/?id=sp-contra-8952.testnet&start=1");
  const share = page.getByTestId("copy-share");
  await expect(share).toBeVisible({ timeout: 30_000 });
  const text = (await share.getAttribute("data-text"))!;
  const url = (await share.getAttribute("data-url"))!;
  expect(text).toMatch(/^silently copying Contrarian on @NEARProtocol: [+−]\d+\.\d\d% in \d+ (min|hours?|days)\. i can't see their trades\. neither can bots\.$/);
  const shown = (await page.getByTestId("copy-change").textContent())!.split(" ")[0];
  expect(text).toContain(shown);
  expect(url).toBe("https://amityadav0.github.io/silent-partner/v/sp-contra-8952.testnet/?ref=copy&copy=1");
  await expect(page.getByTestId("copy-x")).toHaveAttribute("href", /x\.com\/intent\/post\?text=silently/);
  // the next person: the pre-rendered vault link carries the vault's card and opens into a copy
  const next = await page.context().newPage();
  await next.goto("/v/sp-contra-8952.testnet/?ref=copy&copy=1");
  await expect(next.getByTestId("silent-copy")).toBeVisible({ timeout: 30_000 });
  const res = await page.request.get("/v/sp-contra-8952.testnet/");
  expect(await res.text()).toMatch(/og:image" content="https:\/\/raw\.githubusercontent\.com\/[^"]+cards\/sp-contra-8952\.testnet\.png/);
});

test("V3: /how explains it in three pictures and plain words, technical names behind a ?", async ({ page }) => {
  await page.goto("/how/");
  await expect(page.getByTestId("how").locator("svg[role=img]")).toHaveCount(3);
  await expect(page.getByTestId("how")).toContainText("One vault, shared with the trader");
  await expect(page.getByTestId("how")).toContainText("An exit that doesn't need us");
  const visible = await page.getByTestId("how").innerText();
  expect(visible).not.toMatch(/\b(NAV|epoch|HWM|MPC)\b/);
  await page.getByTestId("term").first().click();
  await expect(page.getByRole("note").first()).toContainText("NAV post");
  await page.goto("/");
  await page.getByRole("link", { name: "How it works" }).first().click();
  await expect(page).toHaveURL(/\/how\/$/);
});

test("V4: Watch opens the demo muted, with captions, in a lightbox", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("watch").click();
  const v = page.getByTestId("watch-video");
  await expect(v).toBeVisible();
  expect(await v.evaluate((el: HTMLVideoElement) => el.muted)).toBe(true);
  await expect(v.locator("track[kind=captions][default]")).toHaveCount(1);
  const vtt = await page.request.get("/demo/captions.vtt");
  expect(await vtt.text()).toMatch(/^WEBVTT/);
  expect((await page.request.head("/demo/silent-partner-demo.mp4")).status()).toBe(200);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("watch-video")).toHaveCount(0);
});

test("V5: the leader console has a share kit: post, badge and an invite link that credits the leader", async ({ page }) => {
  await page.goto("/leader/?id=sp-contra-8952.testnet");
  const kit = page.getByTestId("share-kit");
  await expect(kit).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("share-kit-text")).toContainText("my trades are sealed. my returns are verified on chain. copy me without seeing me →");
  const url = (await page.getByTestId("share-kit-link").getAttribute("data-url"))!;
  expect(url).toMatch(/^https:\/\/amityadav0\.github\.io\/silent-partner\/v\/sp-contra-8952\.testnet\/\?ref=.+/);
  await expect(page.getByTestId("share-kit-x")).toHaveAttribute("href", /x\.com\/intent\/post\?text=my%20trades%20are%20sealed/);
});
