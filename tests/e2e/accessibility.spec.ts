import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { baseReport, mockDayu, openBaseReport, partialReport } from "./fixtures/mock-dayu.js";

async function expectNoSeriousAxeViolations(page: Page, state: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const blocking = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking, `${state}: ${blocking.map((item) => `${item.id}: ${item.help}`).join("; ")}`).toEqual([]);
}

test("home, progress, base report, consent, enhanced, partial, and error pass serious/critical axe gates", async ({ browser }) => {
  const states: { name: string; setup(page: Page): Promise<void> }[] = [
    { name: "home", setup: async (page) => { await mockDayu(page); await page.goto("/en"); } },
    { name: "progress", setup: async (page) => {
      await mockDayu(page);
      await page.goto("/en/r/owner/reality-check");
      await expect(page.getByLabel("Scan progress")).toBeVisible();
    } },
    { name: "base report", setup: async (page) => { await openBaseReport(page); await expect(page.getByText("Rules-only Signal")).toBeVisible(); } },
    { name: "consent", setup: async (page) => {
      await openBaseReport(page, { session: { githubUserId: 101 } });
      await expect(page.getByRole("heading", { name: "Run a second waterline check with Copilot" })).toBeVisible();
    } },
    { name: "enhanced", setup: async (page) => {
      await openBaseReport(page, { session: { githubUserId: 101 } });
      await page.getByLabel(/I agree to send this public evidence/iu).check();
      await page.getByRole("button", { name: "Agree and run enhanced analysis" }).click();
      await expect(page.getByText("Enhanced Signal")).toBeVisible();
    } },
    { name: "unavailable dimension", setup: async (page) => {
      await openBaseReport(page, { report: { ...baseReport, dimensionScores: { ...baseReport.dimensionScores, substance: null } } });
      const substanceDimension = page.locator(".dimension-list li").filter({ hasText: "Code Substance" });
      await expect(substanceDimension).toBeVisible();
      await expect(substanceDimension.getByRole("meter")).toHaveCount(0);
      await expect(substanceDimension.getByText("Not enough data")).toBeVisible();
    } },
    { name: "partial", setup: async (page) => {
      await mockDayu(page, { report: partialReport, scanFailure: "github_rate_limited" });
      await page.goto("/en/r/owner/reality-check");
      await expect(page.getByRole("heading", { name: "Evidence collected so far" })).toBeVisible();
    } },
    { name: "error", setup: async (page) => {
      await mockDayu(page, { scanFailure: "private_or_unavailable" });
      await page.goto("/en/r/owner/reality-check");
      await expect(page.getByRole("alert")).toBeVisible();
    } },
  ];
  for (const state of states) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await state.setup(page);
    await expectNoSeriousAxeViolations(page, state.name);
    await context.close();
  }
});

test("skip navigation, headings, focus, keyboard, and live progress are operable", async ({ page }) => {
  await mockDayu(page);
  await page.goto("/en");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  const focusStyle = await skip.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.getByLabel("GitHub repository").focus();
  await page.keyboard.type("owner/reality-check");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Scan progress")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByText("Rules-only Signal")).toBeVisible();

  const headingLevels = await page.locator("h1,h2,h3,h4,h5,h6").evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))));
  expect(headingLevels[0]).toBe(1);
  for (let index = 1; index < headingLevels.length; index += 1) {
    expect((headingLevels[index] ?? 1) - (headingLevels[index - 1] ?? 1)).toBeLessThanOrEqual(1);
  }
});

test("Copilot consent is complete with keyboard only", async ({ page }) => {
  await openBaseReport(page, { session: { githubUserId: 101 } });
  const checkbox = page.getByLabel(/I agree to send this public evidence/iu);
  await checkbox.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  const submit = page.getByRole("button", { name: "Agree and run enhanced analysis" });
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Enhanced Signal")).toBeVisible();
});

test("320px at 200% zoom, dark theme, and reduced motion remain readable", async ({ browser }) => {
  const context = await browser.newContext({
    colorScheme: "dark",
    reducedMotion: "reduce",
    viewport: { height: 900, width: 320 },
  });
  const page = await context.newPage();
  await openBaseReport(page);
  await expect(page.getByText("Rules-only Signal")).toBeVisible();
  await page.evaluate(() => { document.body.style.zoom = "200%"; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const motion = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  expect(motion).toBe(true);
  const reducedDurations = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector(".skip-link") ?? document.body);
    return [style.animationDuration, style.transitionDuration].map((value) => Number.parseFloat(value));
  });
  expect(reducedDurations.every((duration) => duration <= 0.001)).toBe(true);
  await expectNoSeriousAxeViolations(page, "320px dark reduced-motion at 200% zoom");
  await context.close();
});
