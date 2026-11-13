// V7: speed and polish. Landing LCP under 2 s on a throttled phone, no layout shift, an OG
// image on every route.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

async function vitals(page: import("@playwright/test").Page, path: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  // "Fast 3G / mid-range phone": 1.6 Mbps down, 150 ms RTT, 4x CPU slowdown
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    (window as any).__lcp = 0;
    (window as any).__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as any).__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) (window as any).__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(path, { waitUntil: "load" });
  await page.waitForTimeout(4000); // live data arrives; any shift it causes counts
  return page.evaluate(() => ({ lcp: (window as any).__lcp as number, cls: (window as any).__cls as number }));
}

test("V7: landing LCP under 2 s and CLS under 0.1 on a throttled phone", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const v = await vitals(page, "/");
  console.log(`landing LCP ${Math.round(v.lcp)} ms, CLS ${v.cls.toFixed(3)}`);
  expect(v.lcp).toBeLessThan(2000);
  expect(v.cls).toBeLessThan(0.1);
});

test("V7: every route has an OG image and a title", () => {
  const out = join(process.cwd(), "out");
  const pages: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === "index.html") pages.push(p); } };
  walk(out);
  const missing = pages.filter((p) => !/property="og:image"/.test(readFileSync(p, "utf8")) || !/<title>[^<]+<\/title>/.test(readFileSync(p, "utf8")));
  expect(pages.length).toBeGreaterThan(5);
  expect(missing.map((p) => p.slice(out.length))).toEqual([]);
});

for (const [name, path] of [["leaderboard", "/leaderboard/"], ["vault", "/vault/?id=sp-contra-8952.testnet"], ["copy", "/copy/?id=sp-contra-8952.testnet"]] as const) {
  test(`V7: ${name} has no big layout shift while live data loads`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const v = await vitals(page, path);
    console.log(`${name} LCP ${Math.round(v.lcp)} ms, CLS ${v.cls.toFixed(3)}`);
    expect(v.cls).toBeLessThan(0.1);
  });
}

test("V7: while RPC is slow the vault page and leaderboard show skeletons, not blank panels", async ({ page }) => {
  await page.route(/fastnear|drpc|near\.org/, async (r) => { await new Promise((ok) => setTimeout(ok, 2500)); await r.continue(); });
  await page.goto("/vault/?id=sp-contra-8952.testnet");
  await expect(page.getByTestId("skeleton")).toBeVisible();
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 40_000 });
  await page.goto("/leaderboard/");
  await expect(page.getByTestId("skeleton-row").first()).toBeVisible();
});
