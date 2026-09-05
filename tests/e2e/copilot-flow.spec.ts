import { expect, test, type Page } from "@playwright/test";

import { openBaseReport } from "./fixtures/mock-dayu.js";
import { bootstrapSession, scanToReport } from "./fixtures/real-dayu.js";
import { openReportDetail } from "./fixtures/report-details.js";

async function consent(page: Page): Promise<void> {
  await page.getByLabel(/I agree to send this public evidence/iu).check();
  await page.getByRole("button", { name: "Agree and run enhanced analysis" }).click();
}

test("Copilot consent succeeds while the rules report remains visible", async ({ page }) => {
  await bootstrapSession(page, "user-a");
  await scanToReport(page, "owner/reality-check");
  await expect(page.getByText("Rules-only Signal")).toBeVisible();
  await consent(page);
  await expect(page.getByRole("heading", { name: "What changed after enhancement" })).toBeVisible();
  await expect(page.getByText("gpt-5-mini")).toBeVisible();
  await expect(page.getByText("Copilot-enhanced Signal")).toBeVisible();
});

test("a completed no-change review survives language switching without a second Copilot request", async ({ page }) => {
  let enhancements = 0;
  page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/copilot")) enhancements += 1; });
  await bootstrapSession(page, "user-a");
  await scanToReport(page, "owner/no-change");
  await consent(page);
  await expect(page.getByRole("heading", { name: "Review complete · score unchanged" })).toBeVisible();
  await openReportDetail(page, "analysis");
  await page.locator("#report-analysis > summary").click();
  await expect(page.locator("#report-analysis")).toHaveJSProperty("open", false);
  await page.locator(".locale-switch").click();
  await expect(page.getByRole("heading", { name: "复核完成 · 分数未变" })).toBeVisible();
  await expect(page.getByText("[无法验证] 公开证据不足以核实这项说法。")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  expect(enhancements).toBe(1);
});

for (const scenario of [
  { code: "copilot_revoked", kind: "error" as const, label: "revoked token", status: 401 },
  { code: "copilot_quota_exhausted", kind: "error" as const, label: "quota exhaustion", status: 429 },
  { code: "copilot_policy_disabled", kind: "error" as const, label: "organization policy", status: 403 },
  { kind: "malformed" as const, label: "malformed provider JSON" },
  { delayMs: 50, kind: "timeout" as const, label: "transient timeout" },
]) {
  test(`${scenario.label} preserves the complete rules report`, async ({ page }) => {
    await openBaseReport(page, { enhancement: scenario, session: { githubUserId: 101 } });
    await consent(page);
    await expect(page.getByRole("alert")).toContainText("The rules report is preserved");
    await expect(page.getByText("Rules-only Signal")).toBeVisible();
    await openReportDetail(page, "evidence");
    await expect(page.getByRole("heading", { name: "Verifiable evidence" })).toBeVisible();
  });
}

test("OAuth cancellation returns to the still-public base report", async ({ page }) => {
  await openBaseReport(page, { session: null });
  await expect(page.getByRole("button", { name: "Connect GitHub to continue" })).toBeVisible();
  await page.goto("/en/r/owner/reality-check?oauth=cancelled");
  await expect(page.getByText("Rules-only Signal")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect GitHub to continue" })).toBeVisible();
});

test("authenticated user B cannot enhance user A's claimed job or receive enhanced output", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await bootstrapSession(pageA, "user-a");
  const created = await scanToReport(pageA, "owner/reality-check");
  await consent(pageA);
  await expect(pageA.getByText("Copilot-enhanced Signal")).toBeVisible();
  const sessionB = await bootstrapSession(pageB, "user-b");
  const denied = await pageB.evaluate(async ({ csrfToken, jobId }) => {
    const response = await fetch(`/api/scans/${jobId}/copilot`, {
      body: JSON.stringify({ consent: true, idempotencyKey: "other-user-attempt-01" }),
      headers: { "content-type": "application/json", "x-dayu-csrf": csrfToken },
      method: "POST",
    });
    return { body: await response.json() as unknown, status: response.status };
  }, { csrfToken: sessionB.csrfToken, jobId: created.jobId });
  expect(denied).toEqual({ body: { error: { code: "scan_not_owned" } }, status: 403 });
  const publicBase = await pageB.evaluate(async (jobId) => {
    const [status, report] = await Promise.all([fetch(`/api/scans/${jobId}`), fetch(`/api/scans/${jobId}/report`)]);
    return { report: await report.json() as Record<string, unknown>, status: status.status };
  }, created.jobId);
  expect(publicBase.status).toBe(200); // Task 10 intentionally keeps the rules report public.
  expect(publicBase.report.scoreKind).toBe("rules_only");
  expect(publicBase.report).not.toHaveProperty("copilot");
  const [cookiesA, cookiesB] = await Promise.all([contextA.cookies(), contextB.cookies()]);
  expect(cookiesA[0]?.value).not.toBe(cookiesB[0]?.value);
  await contextA.close();
  await contextB.close();
});
