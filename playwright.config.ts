import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 5_000 },
  outputDir: "output/playwright/results",
  reporter: "line",
  testDir: "tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @dayu/web exec vite --host 127.0.0.1 --port 4173",
    reuseExistingServer: true,
    timeout: 30_000,
    url: "http://127.0.0.1:4173/en",
  },
});
