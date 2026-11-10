import { defineConfig } from "@playwright/test";

// Runs against the static export (npm run build first).
export default defineConfig({
  testDir: "e2e",
  testIgnore: ["helpers.ts"],
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: { baseURL: "http://localhost:3000", viewport: { width: 1440, height: 900 }, colorScheme: "light", storageState: "e2e/welcomed.json" },
  webServer: [{ command: "python3 -m http.server 3000 -d out", url: "http://localhost:3000/", reuseExistingServer: true, timeout: 30_000, stderr: "ignore" }],
});
