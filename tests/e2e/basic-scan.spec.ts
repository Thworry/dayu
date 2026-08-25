import { expect, test } from "@playwright/test";

import { maliciousText } from "./fixtures/malicious-repository.js";
import { scanFromHome, scanToReport } from "./fixtures/real-dayu.js";

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
  await expect(page.getByText("Partial", { exact: true })).toBeVisible();
  await expect(page.getByText("github_tree_truncated", { exact: true })).toBeVisible();
  await expect(page.getByText("github_data_being_generated", { exact: true })).toHaveCount(0);
});

test("statistics 202 has a distinct data-generation caveat", async ({ page }) => {
  await scanToReport(page, "owner/stats-pending");
  await expect(page.getByText("Partial", { exact: true })).toBeVisible();
  await expect(page.getByText("github_data_being_generated", { exact: true })).toBeVisible();
  await expect(page.getByText("github_tree_truncated", { exact: true })).toHaveCount(0);
});
