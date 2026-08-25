import { defineConfig } from "@playwright/test";

const requestedPort = Number(process.env.DAYU_E2E_PORT ?? "43173");
const requestedApiPort = Number(process.env.DAYU_E2E_API_PORT ?? "43174");
if (!Number.isInteger(requestedPort) || requestedPort < 1_024 || requestedPort > 65_535) {
  throw new Error("DAYU_E2E_PORT must be an integer between 1024 and 65535");
}
if (!Number.isInteger(requestedApiPort) || requestedApiPort < 1_024 || requestedApiPort > 65_535 || requestedApiPort === requestedPort) {
  throw new Error("DAYU_E2E_API_PORT must be a distinct integer between 1024 and 65535");
}
const origin = `http://127.0.0.1:${String(requestedPort)}`;
const apiOrigin = `http://127.0.0.1:${String(requestedApiPort)}`;

export default defineConfig({
  expect: { timeout: 5_000 },
  outputDir: "output/playwright/results",
  reporter: "line",
  testDir: "tests/e2e",
  ...(process.env.CI === undefined ? {} : { workers: 1 }),
  use: {
    baseURL: origin,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `NODE_ENV=test DAYU_E2E_API_PORT=${String(requestedApiPort)} DAYU_E2E_WEB_ORIGIN=${origin} pnpm exec vite-node tests/e2e/harness/server.ts`,
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${apiOrigin}/__dayu_api/ready`,
    },
    {
      command: `pnpm --filter @dayu/web build && NODE_ENV=production DAYU_WEB_PORT=${String(requestedPort)} DAYU_API_ORIGIN=${apiOrigin} pnpm --filter @dayu/web start`,
      reuseExistingServer: false,
      timeout: 60_000,
      url: `${origin}/__dayu/ready`,
    },
  ],
});
