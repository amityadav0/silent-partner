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
  await expect(page.getByTestId("follow-panel").getByRole("link", { name: /Risks & trust/ })).toBeVisible({ timeout: 30_000 });
});

test("D2: What you pay sits before the Follow button, with the real fee and a worked example", async ({ page }) => {
  await page.goto(`/vault/?id=${VAULT}`);
  const panel = page.getByTestId("follow-panel");
  const box = panel.getByTestId("cost-box");
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(box).toContainText("20% of new gains");
  await expect(box).toContainText("≈0.20% per trade");
  await expect(box).toContainText(/fee\s*none/);
  await expect(box.getByTestId("fee-example")).toContainText("$1,000 for a month at +5% → fee $10");
  const text = await panel.innerText();
  expect(text.indexOf("What you pay")).toBeLessThan(text.indexOf("Follow privately"));
});

test("D3: the timeline gives a clock estimate for exiting, from this vault's cadence", async ({ page }) => {
  await page.goto(`/vault/?id=${VAULT}`);
  const tl = page.getByTestId("follow-timeline");
  await expect(tl).toBeVisible({ timeout: 30_000 });
  await expect(tl.getByTestId("timeline-exit")).toContainText(/about ~\d+ (min|h)/);
  await expect(tl).toContainText("emergency exit");
  await expect(tl).not.toContainText("epoch");
});

test("D2/D3: the read-only mainnet vault shows the same cost box and timeline", async ({ page }) => {
  await page.goto("/vault/?id=1f80f62c945eec98005dac38ab9db5f95c44ef1258cf5ca9606fb8c7dd4da36e");
  const ro = page.getByTestId("mainnet-readonly");
  await expect(ro.getByTestId("cost-box")).toContainText("20% of new gains", { timeout: 30_000 });
  await expect(ro.getByTestId("timeline-exit")).toContainText(/about ~\d+ (min|h)/);
});
