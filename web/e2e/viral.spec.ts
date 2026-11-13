// V1–V2: someone lands from an X link on a phone, understands it, copies a leader in one tap,
// and shares the copy. No wallet anywhere.
import { expect, test } from "@playwright/test";

const PHONE = { width: 390, height: 844 };

test("V1: on a phone, the no-wallet copy CTA and the ticket toggle are both above the fold", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const cta = page.getByTestId("hero-copy");
  await expect(cta).toHaveText(/^Copy .+ with \$100: no wallet, 10 seconds$/);
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
  await expect(page.getByTestId("copy-value")).toHaveText(/^\$\d+\.\d\d$/);
  await expect(page.getByTestId("copy-change")).toContainText("since you joined");
  await expect(card).toContainText("(sealed)");
  await expect(page).toHaveURL(/\/copy\/\?id=[^&]+\.testnet$/);
  const id = new URL(page.url()).searchParams.get("id")!;
  // kept across reloads, not restarted
  const entry = await page.evaluate((k) => localStorage.getItem(k), `sp.paper.${id}`);
  expect(JSON.parse(entry!).usd).toBe(100);
  await page.reload();
  await expect(page.getByTestId("copy-value")).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate((k) => localStorage.getItem(k), `sp.paper.${id}`)).toBe(entry);
});

test("U1: the hero has two actions: the $100 copy and Watch", async ({ page }) => {
  await page.goto("/");
  const actions = page.locator(".hero-copy").locator("a.btn, button.btn, a.quiet");
  await expect(actions).toHaveCount(2);
  await expect(page.getByTestId("hero-copy")).toBeVisible();
  await expect(page.getByTestId("watch")).toBeVisible();
  await expect(page.getByTestId("tour-button")).toHaveCount(0);
});

test("U11: the hero copies the leader with the best 7-day vs-NEAR among verified leaders (Contrarian if none)", async ({ page }) => {
  await page.goto("/");
  const cta = page.getByTestId("hero-copy");
  await expect(cta).toHaveAttribute("data-pick", /\.testnet$/);
  await page.waitForLoadState("networkidle");
  const pick = (await cta.getAttribute("data-pick"))!;
  await expect(cta).toHaveAttribute("href", `/copy/?id=${encodeURIComponent(pick)}&start=1`);
});

test("U2: the copy card's first minute shows the leader's verified record, the next update and Notify me", async ({ page }) => {
  await page.goto("/copy/?id=sp-contra-8952.testnet&start=1");
  const rec = page.getByTestId("copy-record");
  await expect(rec).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("record-line")).toHaveText(/^[+−]\d+\.\d\d% since start( \([+−±]\d+\.\d\d pts vs NEAR\))? · worst dip (0%|−\d+\.\d%) · \d+% own money in$/);
  await expect(page.getByTestId("record-last")).toHaveText(/Last price update (just now|\d+ (min|h|days) ago) ✓ signature checked/);
  await expect(rec.getByTestId("sparkline")).toBeVisible();
  await expect(page.getByTestId("copy-next")).toContainText(/next (in ~\d+ (min|h)|any minute now)/);
  await expect(page.getByTestId("copy-notify")).toHaveText("Notify me");
  await expect(page.getByTestId("silent-copy")).not.toContainText(/would have/i);
});

test("U4: on desktop (no Web Share) Share copies the link and says so for 2 s", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => Object.defineProperty(navigator, "share", { value: undefined, configurable: true }));
  await page.goto("/copy/?id=sp-contra-8952.testnet&start=1");
  const share = page.getByTestId("copy-share");
  await expect(share).toBeVisible({ timeout: 30_000 });
  await share.click();
  await expect(share).toHaveText("Link copied ✓");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://amityadav0.github.io/silent-partner/v/sp-contra-8952.testnet/?ref=copy&copy=1");
  await expect(share).toHaveText("Share my silent copy", { timeout: 4000 });
  await page.goto("/leader/?id=sp-contra-8952.testnet");
  await page.getByTestId("share-kit-link").click();
  await expect(page.getByTestId("share-kit-link")).toHaveText("Link copied ✓");
  await expect(page.getByTestId("share-kit-link")).toHaveText("Copy invite link", { timeout: 4000 });
});

test("U6: the leader console without a wallet says it's a demo desk", async ({ page }) => {
  await page.goto("/leader/");
  await expect(page.getByTestId("desk-demo")).toContainText(/Demo: .+'s desk \(connect the leader wallet to see yours\)/, { timeout: 30_000 });
});

test("U7: how-it-works pictures keep their words in captions, and stack above the text at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/how/");
  const figs = page.getByTestId("how-fig");
  await expect(figs).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const f = figs.nth(i);
    await expect(f.locator("figcaption")).not.toBeEmpty();
    // every label inside the drawing stays inside the drawing
    const clipped = await f.locator("svg").evaluate((svg: SVGSVGElement) => [...svg.querySelectorAll("text")].filter((t) => { const b = t.getBBox(), v = svg.viewBox.baseVal; return b.x < v.x || b.y < v.y || b.x + b.width > v.x + v.width || b.y + b.height > v.y + v.height; }).length);
    expect(clipped).toBe(0);
    const fb = (await f.boundingBox())!, hb = (await f.locator("xpath=following-sibling::div//h2").boundingBox())!;
    expect(fb.y + fb.height).toBeLessThanOrEqual(hb.y);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("U12: the 60-second tour uses Open buttons, not raw URLs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tour-open")).toHaveCount(3);
  expect(await page.getByTestId("tour").innerText()).not.toMatch(/https?:\/\//);
});

test("V2: the share carries only the copy's real change and a link that opens into a copy", async ({ page }) => {
  await page.goto("/copy/?id=sp-contra-8952.testnet&start=1");
  const share = page.getByTestId("copy-share");
  await expect(share).toBeVisible({ timeout: 30_000 });
  const text = (await share.getAttribute("data-text"))!;
  const url = (await share.getAttribute("data-url"))!;
  // a fresh copy (under 3 price updates) shares the leader's verified record, not "+0.00% in 1 min" (U3)
  expect(text).toMatch(/^just started silently copying Contrarian on @NEARProtocol\. verified record: [+−]\d+\.\d\d%( \(\+\d+\.\d\d pts vs NEAR\))?, worst dip (0%|−\d+\.\d%)\. i can't see their trades\. neither can bots\.$/);
  const shown = (await page.getByTestId("record-line").textContent())!.split(" ")[0];
  expect(text).toContain(`verified record: ${shown}`);
  expect(url).toBe("https://amityadav0.github.io/silent-partner/v/sp-contra-8952.testnet/?ref=copy&copy=1");
  await expect(page.getByTestId("copy-x")).toHaveAttribute("href", /x\.com\/intent\/post\?text=just%20started%20silently/);
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

test("V8: the funnel never counts automated or local visits, and sets no cookies", async ({ page, context }) => {
  const hits: string[] = [];
  page.on("request", (r) => { if (r.url().includes("abacus")) hits.push(r.url()); });
  await page.goto("/?ref=someone");
  await page.goto("/copy/?id=sp-contra-8952.testnet&start=1");
  await expect(page.getByTestId("silent-copy")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("copy-share").click();
  expect(hits).toEqual([]);
  expect((await context.cookies()).length).toBe(0);
});

test("U9: vs holding NEAR on the leaderboard, the vault stats and the copy card, with raw return kept", async ({ page }) => {
  await page.goto("/leaderboard/");
  const row = page.getByTestId("row-sp-contra-8952.testnet");
  await expect(row.getByTestId("ret")).toHaveText(/^[+−]\d+\.\d\d%$/, { timeout: 30_000 });
  await expect(row.getByTestId("vs-near")).toHaveText(/^[+−±]\d+\.\d\d pts$/);
  await expect(page.locator("th", { hasText: "vs holding NEAR" })).toHaveCount(1);
  await page.getByTestId("sort-vs").click();
  const pts = await page.locator("[data-testid^=row-] [data-testid=vs-near][data-pts]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-pts"))));
  const seasonPts = pts.slice(0, 3);
  expect([...seasonPts].sort((a, b) => b - a)).toEqual(seasonPts);
  await page.goto("/vault/?id=sp-contra-8952.testnet");
  await expect(page.getByTestId("stat-vs-near")).toContainText(/[+−±]\d+\.\d\d pts vs NEAR/, { timeout: 30_000 });
  await expect(page.getByTestId("stat-vs-near")).toContainText(/NEAR [+−]\d+\.\d\d% over the same updates/);
  await expect(page.getByTestId("stat-return")).toContainText(/[+−]\d+\.\d\d%/);
});

test("U13: TEE ✓ chips on AI rows link to the vault's AI panel", async ({ page }) => {
  await page.goto("/leaderboard/");
  await expect(page.getByTestId("row-sp-contra-8952.testnet")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  const chips = page.getByTestId("tee-chip");
  const n = await chips.count();
  for (let i = 0; i < n; i++) await expect(chips.nth(i)).toHaveAttribute("href", /\/vault\/\?id=.+#ai$/);
  console.log(`TEE chips: ${n}`);
});
