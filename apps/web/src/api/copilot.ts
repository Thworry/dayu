import type { ReportSnapshot } from "@dayu/evidence-schema";
import { reportSnapshotSchema } from "@dayu/evidence-schema/report";

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

export interface EnhancementResponse {
  baseReport: ReportSnapshot;
  enhancedReport: ReportSnapshot | null;
  errorCode?: CopilotErrorCode;
  metadata?: EnhancedMetadata;
}

export interface AuthSessionResponse {
  authenticated: true;
  csrfToken: string;
  githubUserId: number;
}

export interface CopilotApi {
  enhance(jobId: string, input: { consent: true; csrfToken: string; idempotencyKey: string }, signal?: AbortSignal): Promise<EnhancementResponse>;
  getSession(signal?: AbortSignal): Promise<AuthSessionResponse | null>;
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
  const item = record(value);
  if (item === null || typeof item.model !== "string" || typeof item.promptVersion !== "string" || typeof item.rubricVersion !== "string" || !Array.isArray(item.findings)) return undefined;
  const findings = item.findings.flatMap((candidate): CopilotFindingCopy[] => {
    const finding = record(candidate);
    if (
      finding === null || typeof finding.en !== "string" || typeof finding.zh !== "string"
      || typeof finding.rubricId !== "string" || typeof finding.verdict !== "string"
      || !Array.isArray(finding.evidenceIds) || !finding.evidenceIds.every((id) => typeof id === "string")
      || !Array.isArray(finding.counterEvidenceIds) || !finding.counterEvidenceIds.every((id) => typeof id === "string")
    ) return [];
    return [{
      counterEvidenceIds: finding.counterEvidenceIds, en: finding.en,
      evidenceIds: finding.evidenceIds, rubricId: finding.rubricId,
      verdict: finding.verdict, zh: finding.zh,
    }];
  });
  return { findings, model: item.model, promptVersion: item.promptVersion, rubricVersion: item.rubricVersion };
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
  return {
    baseReport: base.data,
    enhancedReport: enhanced === null ? null : enhanced.data,
    ...(code === undefined ? {} : { errorCode: code }),
    ...(metadata === undefined ? {} : { metadata }),
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
      if (response.status === 401 || response.status === 503) return null;
      const body = record(await json(response));
      if (!response.ok || body?.authenticated !== true || typeof body.csrfToken !== "string" || typeof body.githubUserId !== "number") return null;
      return { authenticated: true, csrfToken: body.csrfToken, githubUserId: body.githubUserId };
    },
  };
}
