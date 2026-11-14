// D1–D10: the depositor's questions, answered before the button.
import { expect, test } from "@playwright/test";

const VAULT = "sp-contra-8952.testnet";

test("D1: /trust says what can go wrong, who controls what, the full-access key date, and what's public; linked from nav, footer and follow panel", async ({ page }) => {
  await page.goto("/trust/");
  await expect(page.getByTestId("trust-risks")).toContainText("hasn't had a professional audit");
  for (const t of ["emergency mode", "refunded", "they hold", "paper season"]) await expect(page.getByTestId("trust-risks")).toContainText(t);
  await expect(page.getByTestId("trust-roles")).toContainText("The operator (us)");
  await expect(page.getByTestId("trust-upgrade-key")).toContainText("full-access key");
  await expect(page.getByTestId("trust-upgrade-key")).toContainText("November 25, 2026");
  await expect(page.getByTestId("trust-public")).toContainText("NearBlocks");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Risks" })).toHaveAttribute("href", /\/trust\/?$/);
  await expect(page.locator("footer").getByRole("link", { name: "Risks & trust" })).toBeVisible();
  await page.goto(`/vault/?id=${VAULT}`);
  await expect(page.getByTestId("follow-panel").getByRole("link", { name: /Risks & trust/ }).first()).toBeVisible({ timeout: 30_000 });
});

test("D2: What you pay sits before the Follow button, with the real fee and a worked example", async ({ page }) => {
  await page.goto(`/vault/?id=${VAULT}`);
  const panel = page.getByTestId("follow-panel");
  const box = panel.getByTestId("cost-box");
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(box).toContainText("20% of new gains");
  await expect(box).toContainText(/≈0\.\d\d% per trade/);
  await expect(box).toContainText(/fee\s*none/);
  await expect(box.getByTestId("fee-example")).toContainText("$1,000 for a month at +5% → fee $10");
  const text = await panel.innerText();
  expect(text.indexOf("What you pay")).toBeLessThan(text.indexOf("Follow privately"));
});

test("D3: the timeline gives a clock estimate for exiting, from this vault's cadence", async ({ page }) => {
  await page.goto(`/vault/?id=${VAULT}`);
  const tl = page.getByTestId("follow-timeline");
  await expect(tl).toBeVisible({ timeout: 30_000 });
  await expect(tl.getByTestId("timeline-exit")).toContainText("about 30 minutes here, where prices update every 15 minutes");
  await expect(tl).not.toContainText("~");
  await expect(tl).toContainText("emergency exit");
  await expect(tl).not.toContainText("epoch");
});

test("D2/D3: the read-only mainnet vault shows the same cost box and timeline", async ({ page }) => {
  await page.goto("/vault/?id=1f80f62c945eec98005dac38ab9db5f95c44ef1258cf5ca9606fb8c7dd4da36e");
  const ro = page.getByTestId("mainnet-readonly");
  await expect(ro.getByTestId("cost-box")).toContainText("20% of new gains", { timeout: 30_000 });
  // Y4/Y5: no Follow button here, so the timeline says how a real-money vault will work; the
  // exit figure is the same one the FAQ reads; one trade so far is a count; three proof links
  await expect(ro.getByTestId("follow-timeline")).toContainText("How a real-money vault will work");
  await expect(ro).not.toContainText("after you click Follow");
  await expect(ro.getByTestId("timeline-exit")).toContainText("about 6 hours here");
  await expect(page.getByTestId("limits-rate")).toHaveText("1 trade so far");
  const proof = ro.getByTestId("mainnet-proof").getByRole("link");
  await expect(proof).toHaveCount(3);
  for (const tx of ["w5EU6i3v", "6jg61f4q", "E5KEBvXH"]) await expect(ro.getByTestId("mainnet-proof").locator(`a[href*="${tx}"]`)).toBeVisible();
  await page.goto("/faq/");
  await expect(page.locator("body")).toContainText("about 6 hours on the mainnet vault");
});

test("D4: record length, the new-leader chip, limits in numbers and the leader's stake over time", async ({ page }) => {
  await page.goto(`/vault/?id=${VAULT}`);
  await expect(page.getByTestId("record-length")).toHaveText(/^\d+ (days?|hours) · [\d,]+ price updates?$/, { timeout: 30_000 });
  await expect(page.getByTestId("new-leader")).toHaveText("New leader: short history"); // the season started Nov 9
  const lim = page.getByTestId("limits");
  await expect(lim.getByTestId("limits-near")).toContainText("0–100%");
  await expect(lim.getByTestId("limits-near")).toContainText("clamped");
  await expect(lim.getByTestId("limits-rate")).toContainText(/in the last 24 h|trades? a (day|week)|so far|no trades/);
  await expect(lim).toContainText("USDC and wNEAR only");
  await expect(lim.getByTestId("limits-stake")).toContainText(/\d+\.\d% now, from \d+\.\d% on/);
  await expect(lim.getByTestId("limits-stake").getByTestId("sparkline")).toBeVisible();
});

test("D5: one paper-season line on testnet pages; mainnet says real-money vaults open later, waitlist without email", async ({ page }) => {
  for (const url of [`/vault/?id=${VAULT}`, "/leaderboard/", `/copy/?id=${VAULT}`]) {
    await page.goto(url);
    await expect(page.getByTestId("paper-line")).toHaveText(/^Paper season: testnet tokens, real prices\./);
  }
  await page.goto("/vault/?id=1f80f62c945eec98005dac38ab9db5f95c44ef1258cf5ca9606fb8c7dd4da36e");
  const soon = page.getByTestId("real-money-soon");
  await expect(soon).toContainText("Real-money vaults open after the hackathon review", { timeout: 30_000 });
  await expect(soon.getByRole("link", { name: /@amit29199/ })).toHaveAttribute("href", "https://x.com/amit29199");
  await expect(soon).toContainText("don't collect emails");
  await expect(page.getByTestId("paper-line")).toHaveCount(0);
  await expect(page.locator("input[type=email]")).toHaveCount(0);
});

test("D6/D7: /about names the builder and the review; the FAQ has 10 answers, linked from the hero and the follow panel", async ({ page }) => {
  await page.goto("/about/");
  await expect(page.getByTestId("about-who")).toContainText("Amit Yadav");
  await expect(page.getByTestId("about-review")).toContainText("Two independent security reviews");
  await expect(page.getByTestId("about-review")).toContainText("No professional audit yet");
  await page.goto("/faq/");
  await expect(page.getByTestId("faq-item")).toHaveCount(10);
  await expect(page.locator("#testnet")).toContainText("paper season");
  await page.goto("/");
  await expect(page.getByTestId("hero-faq").getByRole("link", { name: "questions" })).toHaveAttribute("href", /\/faq\/?$/);
  await page.goto(`/vault/?id=${VAULT}`);
  await expect(page.getByTestId("follow-faq").getByRole("link", { name: "Questions" })).toBeVisible({ timeout: 30_000 });
});

test("D8: price updates, signal hashes and the season log sit behind Technical record, one click away", async ({ page }) => {
  await page.goto(`/vault/?id=${VAULT}`);
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("nav-table")).toBeHidden();
  await page.getByTestId("tech-record").locator("summary").click();
  await expect(page.getByTestId("nav-table")).toBeVisible();
  await expect(page.getByTestId("ai-hash-check")).toBeHidden();
  await page.getByTestId("ai-tech").locator("summary").click();
  await expect(page.getByTestId("ai-hash-check")).toBeVisible();
});

test("D9/D10: a system status line in the footer and on vault pages, and short terms in the footer", async ({ page }) => {
  await page.goto(`/vault/?id=${VAULT}`);
  const st = page.getByTestId("sys-status");
  await expect(st).toHaveCount(2);
  await expect(st.first()).toHaveAttribute("data-level", /^(ok|warn|bad)$/, { timeout: 30_000 });
  await expect(st.first()).toContainText(/All systems normal|Running late|Problem/);
  await expect(st.first()).toContainText("last mainnet price");
  const terms = page.getByTestId("terms");
  for (const t of ["paper season", "not investment advice", "no guarantees", "MIT license", "own risk"]) await expect(terms).toContainText(t);
});

test("T2: trading cost so far on the vault, trades/day on the leaderboard, measured cost in What you pay", async ({ page }) => {
  await page.goto("/vault/?id=sp-trend-8952.testnet");
  const lim = page.getByTestId("limits");
  await expect(lim.getByTestId("limits-cost")).toContainText(/Trading cost so far\s*\d+\.\d\d% of the vault \(\d[\d,]* trades?\)/);
  await expect(lim.getByTestId("limits-cost")).toContainText(/measured across the season/);
  await expect(page.getByTestId("cost-per-trade").first()).toContainText(/≈0\.\d\d% per trade, shared \(measured\)/);
  // Y1: one trade-frequency figure, the same on the vault page and the leaderboard
  const FIG = /(\d+) trades? (in the last 24 h|since the 4-hour rule went live \(\d\d:\d\d UTC\))/;
  await expect(lim.getByTestId("limits-rate")).toContainText(FIG);
  const [, onVault, phrase] = (await lim.getByTestId("limits-rate").innerText()).match(FIG)!;
  await expect(lim).not.toContainText(/trades? a day/);
  await page.goto("/leaderboard/");
  await expect(page.getByTestId("row-sp-trend-8952.testnet").getByTestId("trades-day")).toContainText(`${onVault} trade`);
  await expect(page.getByTestId("row-sp-trend-8952.testnet").getByTestId("trades-day")).toContainText(phrase);
});

test("T3/T4: benchmarks are labelled BENCHMARK; the drill and the first test vault sit in a collapsed Test vaults section", async ({ page }) => {
  await page.goto("/leaderboard/");
  await expect(page.getByTestId("row-sp-momo-92991.testnet")).toBeVisible();
  // a benchmark is ranked once it has 12 posts, and is in "New this week" before that
  const hold = page.getByTestId("row-hold.sp-sop-92991.testnet").or(page.getByTestId("new-hold.sp-sop-92991.testnet"));
  await expect(hold).toBeVisible();
  const lb = page.getByTestId("leaderboard");
  await expect(lb.getByTestId("row-sp-drill-92991.testnet")).toHaveCount(0);
  await expect(lb.getByTestId("row-sp-vault-60270.testnet")).toHaveCount(0);
  const tests = page.getByTestId("test-vaults");
  await expect(tests).not.toHaveAttribute("open", "");
  await tests.locator("summary").click();
  await expect(tests.getByTestId("test-sp-vault-60270.testnet")).toContainText("First test vault");
  await expect(tests.getByTestId("test-sp-drill-92991.testnet")).toContainText("Emergency drill");
  await expect(page.getByText("Genesis vault")).toHaveCount(0);
  await page.goto("/vault/?id=half.sp-sop-92991.testnet");
  await expect(page.getByTestId("badge").first()).toHaveText("BENCHMARK");
});

test("T6: the multi-asset Majors vault shows what it may hold and its rule, positions still sealed", async ({ page }) => {
  await page.goto("/vault/?id=majors.sp-sop-92991.testnet");
  const lim = page.getByTestId("limits");
  await expect(lim).toContainText("USDC, wNEAR, BTC, ETH and SOL only");
  await expect(lim.getByTestId("limits-near")).toContainText("BTC, ETH, SOL and NEAR");
  await expect(lim.getByTestId("limits-near")).toContainText("No leverage, no shorting");
  await expect(page.getByText(/\d+(\.\d+)? BTC\b/)).toHaveCount(0);
});

test("Y7/Y8: a vault with only the leader's money says 'no followers yet'; /leaders/ opens the leaderboard; the 404 is themed", async ({ page }) => {
  await page.goto("/leaderboard/");
  const rows = page.locator("[data-testid=stake]");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  for (const r of await rows.all()) {
    const pct = parseFloat(await r.locator(".pos").innerText());
    await expect(r.getByTestId("no-followers")).toHaveCount(pct >= 99.95 ? 1 : 0);
  }
  await page.goto("/leaders/");
  await expect(page).toHaveURL(/\/leaderboard\/$/);
  await page.goto("/404.html");
  await expect(page.getByTestId("not-found")).toContainText("This page doesn't exist");
  await expect(page.locator(".site-head")).toBeVisible();
  await expect(page.getByTestId("not-found").getByRole("link", { name: "Home" })).toBeVisible();
});

test("Y10: the landing says how it differs from signal-selling apps, without naming anyone", async ({ page }) => {
  await page.goto("/");
  const line = page.getByTestId("compare-signals");
  await expect(line).toContainText("Signal-selling apps: you see the trade, then copy it later, at your own price.");
  await expect(line).toContainText("you're inside the trade, one fill, one price");
  for (const name of ["NOVA", "Privue", "Clavis"]) await expect(page.locator("body")).not.toContainText(name);
});
