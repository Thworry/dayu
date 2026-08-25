import type { Page, Route } from "@playwright/test";

import { maliciousRepositoryReport } from "./malicious-repository.js";

export const JOB_ID = "f4082d03-6bea-4d90-a901-e15c3f899a3e";

export const baseReport = maliciousRepositoryReport;

export const partialReport = {
  ...baseReport,
  dataStatus: "partial",
  evidence: [{ ...baseReport.evidence[0], limitations: ["github_data_being_generated"], status: "partial" }],
  evidenceIndex: {
    [baseReport.evidence[0].id]: { ...baseReport.evidence[0], limitations: ["github_data_being_generated"], status: "partial" },
  },
  missingSignals: ["contributors", "statistics"],
} as const;

export const enhancedReport = {
  ...baseReport,
  baseScore: 18,
  copilot: {
    findings: [{
      counterEvidenceIds: [],
      en: "[SUPPORTED] The bounded public evidence supports this finding.",
      evidenceIds: [baseReport.evidence[0].id],
      rubricId: "claims.install",
      verdict: "supported",
      zh: "[支持] 有限的公开证据支持这项判断。",
    }],
    model: "gpt-5-mini",
    promptVersion: "copilot-prompt-v1",
    rubricVersion: "copilot-rubric-v1",
  },
  enrichedScore: 16,
  promptVersion: "copilot-prompt-v1",
  score: 16,
  scoreKind: "enhanced",
} as const;

type NullableDimensionReport = (Omit<typeof baseReport, "dimensionScores"> | Omit<typeof partialReport, "dimensionScores">) & {
  dimensionScores: { [Key in keyof typeof partialReport.dimensionScores]: number | null };
};

type Enhancement =
  | { kind: "success" }
  | { code: string; kind: "error"; status?: number }
  | { kind: "malformed" }
  | { delayMs: number; kind: "timeout" };

export interface MockDayuOptions {
  enhancement?: Enhancement;
  report?: NullableDimensionReport | typeof baseReport | typeof partialReport;
  scanFailure?: "github_rate_limited" | "internal_failure" | "private_or_unavailable";
  session?: null | { csrfToken?: string; githubUserId: number };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ contentType: "application/json", json: body, status });
}

export async function mockDayu(page: Page, options: MockDayuOptions = {}): Promise<void> {
  const report = options.report ?? baseReport;
  let statusReads = 0;
  await page.route(/^https?:\/\/[^/]+\/api\//u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/scans" && request.method() === "POST") {
      await json(route, { jobId: JOB_ID, stage: "validated" }, 202);
      return;
    }
    if (url.pathname === `/api/scans/${JOB_ID}` && request.method() === "GET") {
      statusReads += 1;
      const failed = options.scanFailure !== undefined;
      await json(route, {
        createdAt: report.createdAt,
        ...(failed ? { errorCode: options.scanFailure } : {}),
        expiresAt: report.expiresAt,
        id: JOB_ID,
        reportAvailable: failed || statusReads > 1,
        repository: report.repository.fullName,
        stage: failed ? "failed" : statusReads > 1 ? "rendered" : "collected",
      });
      return;
    }
    if (url.pathname === `/api/scans/${JOB_ID}/report` && request.method() === "GET") {
      await json(route, report);
      return;
    }
    if (url.pathname === "/api/auth/session") {
      if (options.session === null || options.session === undefined) {
        await json(route, { error: { code: "invalid_session" } }, 401);
      } else {
        await json(route, {
          authenticated: true,
          csrfToken: options.session.csrfToken ?? "b".repeat(43),
          githubUserId: options.session.githubUserId,
        });
      }
      return;
    }
    if (url.pathname === `/api/scans/${JOB_ID}/copilot` && request.method() === "POST") {
      const enhancement = options.enhancement ?? { kind: "success" };
      if (enhancement.kind === "success") {
        await json(route, {
          baseReport: report,
          enhancedReport,
          metadata: enhancedReport.copilot,
        });
      } else if (enhancement.kind === "malformed") {
        await json(route, { enhancedReport: "<script>not-json</script>" });
      } else if (enhancement.kind === "timeout") {
        await new Promise((resolve) => setTimeout(resolve, enhancement.delayMs));
        await json(route, { error: { code: "copilot_timeout" } }, 504);
      } else {
        await json(route, { error: { code: enhancement.code } }, enhancement.status ?? 429);
      }
      return;
    }
    if (url.pathname === "/api/auth/github/start") {
      await json(route, { error: { code: "invalid_oauth_state" } }, 400);
      return;
    }
    await json(route, { error: { code: "unexpected_mock_request" } }, 500);
  });
}

export async function openBaseReport(page: Page, options: MockDayuOptions = {}): Promise<void> {
  await mockDayu(page, options);
  await page.goto("/en/r/owner/reality-check");
}
