import { defineConfig } from "@playwright/test";

// Runs against the static export (npm run build first).
// Two projects: desktop (everything) and mobile (U8: the V1 → share → return flow on a 390 px phone).
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
export default defineConfig({
  testDir: "e2e",
  testIgnore: ["helpers.ts"],
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: { baseURL: "http://localhost:3000", viewport: { width: 1440, height: 900 }, colorScheme: "light", storageState: "e2e/welcomed.json" },
  projects: [
    { name: "desktop", testIgnore: ["helpers.ts", "mobile.spec.ts"] },
    { name: "mobile", testMatch: ["mobile.spec.ts"], use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: MOBILE_UA } },
  ],
  webServer: [{ command: "python3 -m http.server 3000 -d out", url: "http://localhost:3000/", reuseExistingServer: true, timeout: 30_000, stderr: "ignore" }],
});
