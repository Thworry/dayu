import { expect, test } from "@playwright/test";

import { maliciousText } from "./fixtures/malicious-repository.js";
import { scanFromHome, scanToReport } from "./fixtures/real-dayu.js";
import { openReportDetail } from "./fixtures/report-details.js";

test("anonymous rules-only scan completes without GitHub login", async ({ page }) => {
  await scanToReport(page, "owner/reality-check");
  await expect(page.getByText("Rules-only Signal")).toBeVisible();
  await expect(page.getByRole("heading", { name: "owner/reality-check" })).toBeVisible();
  await expect(page.getByText("Sign in", { exact: true })).toHaveCount(0);
});

test("repository-controlled HTML, SVG, and event handlers render only as text", async ({ page }) => {
  await scanToReport(page, "owner/reality-check");
  await expect(page.getByText(maliciousText).first()).toBeVisible();
  await expect(page.locator("script", { hasText: "window.__dayuPwned=true" })).toHaveCount(0);
  await expect(page.locator("[onerror], [onload]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __dayuPwned?: boolean }).__dayuPwned)).not.toBe(true);
});

for (const scenario of [
  { label: "GitHub 403", repository: "owner/private" },
  { label: "GitHub 429", repository: "owner/rate-limited" },
] as const) {
  test(`${scenario.label} becomes a stable error without a pseudo-report`, async ({ page }) => {
    await scanFromHome(page, scenario.repository);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("Rules-only Signal")).toHaveCount(0);
  });
}

test("tree truncation has its own partial-evidence caveat", async ({ page }) => {
  await scanToReport(page, "owner/tree-truncated");
  await openReportDetail(page, "analysis");
  await expect(page.locator(".status-line")).toHaveText("Partial");
  await openReportDetail(page, "evidence");
  await expect(page.getByText("GitHub returned an incomplete file tree", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("GitHub was still preparing the data", { exact: true })).toHaveCount(0);
});

test("statistics 202 has a distinct data-generation caveat", async ({ page }) => {
  await scanToReport(page, "owner/stats-pending");
  await openReportDetail(page, "analysis");
  await expect(page.locator(".status-line")).toHaveText("Partial");
  await openReportDetail(page, "evidence");
  await expect(page.getByText("GitHub was still preparing the data", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("GitHub returned an incomplete file tree", { exact: true })).toHaveCount(0);
});
