import { defineConfig } from "@playwright/test";

// Runs against the static export (npm run build first).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: { baseURL: "http://localhost:3000", viewport: { width: 1100, height: 900 } },
  webServer: [{ command: "python3 -m http.server 3000 -d out", url: "http://localhost:3000/", reuseExistingServer: true, timeout: 30_000, stderr: "ignore" }],
});
