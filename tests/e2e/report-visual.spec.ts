import { expect, test, type Browser, type Page } from "@playwright/test";

const report = {
  baseScore: 18,
  collectorVersion: "collector-v1",
  confidence: 82,
  createdAt: "2026-08-25T00:00:00.000Z",
  dataStatus: "partial",
  dimensionScores: { claims: 12, community: 16, maintenance: 20, popularity: 22, substance: 14 },
  evidence: [{
    fact: { metric: "repository.metadata", value: { description: "A stable, mocked repository used only for local visual checks." } },
    id: "ev_aaaaaaaaaaaaaaaaaaaaaaaa",
    kind: "metadata",
    limitations: ["bounded_public_sample"],
    observedAt: "2026-08-25T00:00:00.000Z",
    repository: { fullName: "facebook/react", id: 1024 },
    schemaVersion: "1",
    source: { endpoint: "/repos/facebook/react", kind: "api", queryHash: "public-v1" },
    status: "complete",
    summary: "Public repository metadata",
    value: { description: "A stable, mocked repository used only for local visual checks." },
  }],
  evidenceIndex: {},
  expiresAt: "2099-08-25T00:30:00.000Z",
  findings: [],
  locale: "en",
  missingSignals: ["releases"],
  positiveSignals: [],
  reportVersion: "1",
  researchPreview: {
    calibrationStatus: "uncalibrated",
    normalizerKind: "synthetic_reference",
    normalizerVersion: "normalizer-v1",
    releaseStage: "pre_beta",
  },
  repository: { defaultBranch: "main", fullName: "facebook/react", id: 1024 },
  repositoryType: "software",
  rulesVersion: "rules-v1",
  score: 18,
  scoreKind: "rules_only",
  sourceCommit: "abcdef1234567",
} as const;

const visualReport = { ...report, evidenceIndex: { [report.evidence[0].id]: report.evidence[0] } };

async function mockScan(page: Page): Promise<void> {
  await page.route("**/api/scans", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { jobId: "f4082d03-6bea-4d90-a901-e15c3f899a3e", stage: "validated" }, status: 202 });
  });
  await page.route("**/api/scans/f4082d03-6bea-4d90-a901-e15c3f899a3e", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { id: "f4082d03-6bea-4d90-a901-e15c3f899a3e", repository: "facebook/react", stage: "rendered", reportAvailable: true, createdAt: report.createdAt, expiresAt: report.expiresAt } });
  });
  await page.route("**/api/scans/f4082d03-6bea-4d90-a901-e15c3f899a3e/report", async (route) => {
    await route.fulfill({ contentType: "application/json", json: visualReport });
  });
}

async function inspectReport(browser: Browser, scenario: { colorScheme: "dark" | "light"; reducedMotion: "no-preference" | "reduce"; width: number }, outputPath: string): Promise<void> {
  const context = await browser.newContext({ colorScheme: scenario.colorScheme, reducedMotion: scenario.reducedMotion, viewport: { height: 900, width: scenario.width } });
  const page = await context.newPage();
  await mockScan(page);
  await page.goto("/en/r/facebook/react");
  await expect(page.getByText("Rules-only Signal")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verifiable evidence" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ev_aaaaaaaaaaaaaaaaaaaaaaaa" })).toHaveAttribute("href", "https://api.github.com/repos/facebook/react");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const action = page.getByRole("button", { name: "Download share card" });
  const actionBox = await action.boundingBox();
  expect(actionBox?.height).toBeGreaterThanOrEqual(44);
  const actionColors = await action.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
  expect(actionColors.background).not.toBe(actionColors.color);
  if (scenario.width === 1440) {
    const maximumScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    await page.evaluate((top) => { window.scrollTo({ behavior: "instant", top }); }, Math.min(900, maximumScroll));
    const stickyTop = await page.locator(".score-summary").evaluate((element) => element.getBoundingClientRect().top);
    expect(stickyTop).toBeGreaterThanOrEqual(20);
    expect(stickyTop).toBeLessThanOrEqual(36);
  }
  await page.screenshot({ fullPage: true, path: outputPath });
  await context.close();
}

for (const scenario of [
  { colorScheme: "light", reducedMotion: "reduce", width: 320 },
  { colorScheme: "dark", reducedMotion: "no-preference", width: 768 },
  { colorScheme: "light", reducedMotion: "no-preference", width: 1440 },
] as const) {
  test(`renders the evidence report at ${String(scenario.width)}px in ${scenario.colorScheme}`, async ({ browser }, testInfo) => {
    await inspectReport(browser, scenario, testInfo.outputPath(`report-${String(scenario.width)}-${scenario.colorScheme}.png`));
  });
}
