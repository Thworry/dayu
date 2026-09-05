import type { ReportSnapshot } from "@dayu/evidence-schema";
import { reportSnapshotSchema } from "@dayu/evidence-schema/report";
import { z } from "zod";

export type CopilotErrorCode =
  | "copilot_account_daily_limit"
  | "copilot_busy"
  | "copilot_cancelled"
  | "copilot_consent_required"
  | "copilot_failed"
  | "copilot_invalid_output"
  | "copilot_ip_daily_limit"
  | "copilot_not_entitled"
  | "copilot_policy_disabled"
  | "copilot_quota_exhausted"
  | "copilot_revoked"
  | "copilot_timeout"
  | "invalid_csrf"
  | "invalid_origin"
  | "invalid_session"
  | "scan_not_found"
  | "scan_not_owned"
  | "scan_not_ready";

export interface CopilotFindingCopy {
  counterEvidenceIds: string[];
  en: string;
  evidenceIds: string[];
  rubricId: string;
  verdict: string;
  zh: string;
}

export interface EnhancedMetadata {
  findings: CopilotFindingCopy[];
  model: string;
  promptVersion: string;
  rubricVersion: string;
}

const reviewBindingSchema = z.object({
  repository: reportSnapshotSchema.shape.repository,
  sourceCommit: reportSnapshotSchema.shape.sourceCommit,
  rulesVersion: reportSnapshotSchema.shape.rulesVersion,
  collectorVersion: reportSnapshotSchema.shape.collectorVersion,
  createdAt: reportSnapshotSchema.shape.createdAt,
});
const noChangeReviewSchema = reviewBindingSchema.extend({
  schemaVersion: reportSnapshotSchema.shape.reportVersion,
  reason: reportSnapshotSchema.shape.rulesVersion.refine((value) => value === "no_scorable_judgments"),
  metadata: reportSnapshotSchema.shape.copilot.unwrap(),
}).strict();

/** A completed qualitative review, kept separate from the unchanged rules report. */
export interface NoChangeReview {
  schemaVersion: "1";
  reason: "no_scorable_judgments";
  repository: ReportSnapshot["repository"];
  sourceCommit: string;
  rulesVersion: string;
  collectorVersion: string;
  createdAt: string;
  metadata: EnhancedMetadata;
}

export function sameReportBinding(left: ReportSnapshot, right: ReportSnapshot): boolean {
  return left.repository.id === right.repository.id && left.repository.fullName === right.repository.fullName
    && left.repository.defaultBranch === right.repository.defaultBranch && left.sourceCommit === right.sourceCommit
    && left.rulesVersion === right.rulesVersion && left.collectorVersion === right.collectorVersion && left.createdAt === right.createdAt;
}

export function parseNoChangeReview(value: unknown, report: ReportSnapshot): NoChangeReview | undefined {
  if (report.scoreKind === "enhanced" || report.copilot !== undefined) return undefined;
  const parsed = noChangeReviewSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const review = parsed.data;
  if (review.repository.id !== report.repository.id || review.repository.fullName !== report.repository.fullName
    || review.repository.defaultBranch !== report.repository.defaultBranch || review.sourceCommit !== report.sourceCommit
    || review.rulesVersion !== report.rulesVersion || review.collectorVersion !== report.collectorVersion || review.createdAt !== report.createdAt) return undefined;
  const ids = new Set(report.evidence.map((evidence) => evidence.id));
  if (new Set(review.metadata.findings.map((finding) => finding.rubricId)).size !== review.metadata.findings.length
    || review.metadata.findings.some((finding) => [...finding.evidenceIds, ...finding.counterEvidenceIds].some((id) => !ids.has(id)))) return undefined;
  return { ...review, reason: "no_scorable_judgments" };
}

export function createNoChangeReview(report: ReportSnapshot, metadata: EnhancedMetadata): NoChangeReview | undefined {
  return parseNoChangeReview({ ...reviewBindingSchema.parse(report), schemaVersion: "1", reason: "no_scorable_judgments", metadata }, report);
}

export interface EnhancementResponse {
  baseReport: ReportSnapshot;
  enhancedReport: ReportSnapshot | null;
  errorCode?: CopilotErrorCode;
  metadata?: EnhancedMetadata;
  noChangeReason?: "no_scorable_judgments";
}

export interface AuthSessionResponse {
  authenticated: true;
  csrfToken: string;
  githubUserId: number;
}

export type AuthSessionState =
  | { kind: "authenticated"; session: AuthSessionResponse }
  | { kind: "signed_out" }
  | { kind: "unavailable" };

export interface CopilotApi {
  enhance(jobId: string, input: { consent: true; csrfToken: string; idempotencyKey: string }, signal?: AbortSignal): Promise<EnhancementResponse>;
  getSession(signal?: AbortSignal): Promise<AuthSessionState>;
}

export class CopilotApiError extends Error {
  readonly code: CopilotErrorCode;
  readonly status: number;

  constructor(code: CopilotErrorCode, status: number) {
    super(code);
    this.name = "CopilotApiError";
    this.code = code;
    this.status = status;
  }
}

const errorCodes = new Set<CopilotErrorCode>([
  "copilot_account_daily_limit", "copilot_busy", "copilot_cancelled", "copilot_consent_required", "copilot_failed",
  "copilot_invalid_output", "copilot_ip_daily_limit", "copilot_not_entitled", "copilot_policy_disabled",
  "copilot_quota_exhausted", "copilot_revoked", "copilot_timeout", "invalid_csrf", "invalid_origin",
  "invalid_session", "scan_not_found", "scan_not_owned", "scan_not_ready",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function errorCode(value: unknown): CopilotErrorCode {
  const code = record(record(value)?.error)?.code;
  return typeof code === "string" && errorCodes.has(code as CopilotErrorCode) ? code as CopilotErrorCode : "copilot_failed";
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function parseMetadata(value: unknown): EnhancedMetadata | undefined {
  const parsed = reportSnapshotSchema.shape.copilot.unwrap().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseEnhancement(value: unknown): EnhancementResponse {
  const body = record(value);
  if (body === null) throw new CopilotApiError("copilot_failed", 502);
  const base = reportSnapshotSchema.safeParse(body.baseReport);
  const enhanced = body.enhancedReport === null ? null : reportSnapshotSchema.safeParse(body.enhancedReport);
  if (!base.success || (enhanced !== null && !enhanced.success)) throw new CopilotApiError("copilot_failed", 502);
  const code = typeof body.errorCode === "string" && errorCodes.has(body.errorCode as CopilotErrorCode)
    ? body.errorCode as CopilotErrorCode : undefined;
  const metadata = parseMetadata(body.metadata);
  if (body.noChangeReason === "no_scorable_judgments"
    && (enhanced !== null || code !== undefined || metadata === undefined || createNoChangeReview(base.data, metadata) === undefined)) {
    throw new CopilotApiError("copilot_invalid_output", 502);
  }
  return {
    baseReport: base.data,
    enhancedReport: enhanced === null ? null : enhanced.data,
    ...(code === undefined ? {} : { errorCode: code }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(body.noChangeReason === "no_scorable_judgments" ? { noChangeReason: "no_scorable_judgments" as const } : {}),
  };
}

export function createCopilotApi(): CopilotApi {
  return {
    async enhance(jobId, input, signal) {
      const response = await fetch(`/api/scans/${encodeURIComponent(jobId)}/copilot`, {
        body: JSON.stringify({ consent: input.consent, idempotencyKey: input.idempotencyKey }),
        headers: { "content-type": "application/json", "x-dayu-csrf": input.csrfToken },
        method: "POST",
        ...(signal === undefined ? {} : { signal }),
      });
      const body = await json(response);
      if (!response.ok) throw new CopilotApiError(errorCode(body), response.status);
      return parseEnhancement(body);
    },
    async getSession(signal) {
      const response = await fetch("/api/auth/session", {
        headers: { accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status === 401) return { kind: "signed_out" };
      if (response.status === 503) return { kind: "unavailable" };
      const body = record(await json(response));
      if (!response.ok || body?.authenticated !== true || typeof body.csrfToken !== "string" || typeof body.githubUserId !== "number") {
        return { kind: "unavailable" };
      }
      return {
        kind: "authenticated",
        session: { authenticated: true, csrfToken: body.csrfToken, githubUserId: body.githubUserId },
      };
    },
  };
}
