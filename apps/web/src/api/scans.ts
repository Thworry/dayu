import type { ReportSnapshot } from "@dayu/evidence-schema";
import { reportSnapshotSchema } from "@dayu/evidence-schema/report";
import type { Locale } from "@dayu/report-i18n";

export type ScanStage = "validated" | "collected" | "scored" | "enriched" | "rendered" | "failed";

export type PublicErrorCode =
  | "github_rate_limited"
  | "insufficient_evidence"
  | "internal_failure"
  | "invalid_repository"
  | "private_or_unavailable"
  | "request_rate_limited"
  | "scan_not_found"
  | "scan_not_ready";

export interface CreateScanInput {
  repository: string;
  locale: Locale;
}

export interface CreateScanResponse {
  jobId: string;
  stage: ScanStage;
}

export interface PublicScanJob {
  id: string;
  repository: string;
  stage: ScanStage;
  createdAt: string;
  expiresAt: string;
  reportAvailable: boolean;
  errorCode?: PublicErrorCode;
}

export interface ScanApi {
  createScan(input: CreateScanInput, signal?: AbortSignal): Promise<CreateScanResponse>;
  getScan(jobId: string, signal?: AbortSignal): Promise<PublicScanJob>;
  getReport(jobId: string, signal?: AbortSignal): Promise<ReportSnapshot>;
}

export interface ScanFailure {
  code: PublicErrorCode;
  status: number;
  resetAt?: string;
  partial?: ReportSnapshot;
}

class ScanApiError extends Error implements ScanFailure {
  readonly code: PublicErrorCode;
  readonly status: number;
  readonly resetAt?: string;
  readonly partial?: ReportSnapshot;

  constructor(code: PublicErrorCode, status: number, options: { partial?: ReportSnapshot; resetAt?: string } = {}) {
    super(code);
    this.name = "ScanApiError";
    this.code = code;
    this.status = status;
    if (options.partial !== undefined) this.partial = options.partial;
    if (options.resetAt !== undefined) this.resetAt = options.resetAt;
  }
}

export interface PollOptions {
  clock?: () => number;
  signal?: AbortSignal;
  onStage: (stage: ScanStage) => void;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const publicCodes = new Set<PublicErrorCode>([
  "github_rate_limited",
  "insufficient_evidence",
  "internal_failure",
  "invalid_repository",
  "private_or_unavailable",
  "request_rate_limited",
  "scan_not_found",
  "scan_not_ready",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function isReportSnapshot(value: unknown): value is ReportSnapshot {
  return reportSnapshotSchema.safeParse(value).success;
}

function errorCode(body: unknown): PublicErrorCode {
  if (!isRecord(body) || !isRecord(body.error) || typeof body.error.code !== "string") return "internal_failure";
  return publicCodes.has(body.error.code as PublicErrorCode)
    ? body.error.code as PublicErrorCode
    : "internal_failure";
}

function resetAtFrom(response: Response, body: unknown): string | undefined {
  if (isRecord(body) && typeof body.resetAt === "string") return body.resetAt;
  const header = response.headers.get("x-ratelimit-reset") ?? response.headers.get("ratelimit-reset");
  if (header === null) return undefined;
  const numeric = Number(header);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  const milliseconds = numeric > 1_000_000_000 ? numeric * 1000 : Date.now() + numeric * 1000;
  return new Date(milliseconds).toISOString();
}

async function bodyOrNull(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

async function requestJson(url: string, init?: RequestInit): Promise<{ body: unknown; response: Response }> {
  const response = await fetch(url, init);
  const body = await bodyOrNull(response);
  if (!response.ok) {
    const resetAt = resetAtFrom(response, body);
    throw new ScanApiError(errorCode(body), response.status, resetAt === undefined ? {} : { resetAt });
  }
  return { body, response };
}

function parseStage(value: unknown): ScanStage | null {
  return value === "validated" || value === "collected" || value === "scored" || value === "enriched" || value === "rendered" || value === "failed"
    ? value
    : null;
}

function parseCreate(body: unknown): CreateScanResponse {
  if (!isRecord(body) || typeof body.jobId !== "string") throw failure("internal_failure", 502);
  const stage = parseStage(body.stage);
  if (stage === null) throw failure("internal_failure", 502);
  return { jobId: body.jobId, stage };
}

function parseJob(body: unknown): PublicScanJob {
  if (
    !isRecord(body)
    || typeof body.id !== "string"
    || typeof body.repository !== "string"
    || typeof body.createdAt !== "string"
    || typeof body.expiresAt !== "string"
    || typeof body.reportAvailable !== "boolean"
  ) throw failure("internal_failure", 502);
  const stage = parseStage(body.stage);
  if (stage === null) throw failure("internal_failure", 502);
  const parsedError = typeof body.errorCode === "string" && publicCodes.has(body.errorCode as PublicErrorCode)
    ? body.errorCode as PublicErrorCode
    : undefined;
  return {
    createdAt: body.createdAt,
    expiresAt: body.expiresAt,
    id: body.id,
    reportAvailable: body.reportAvailable,
    repository: body.repository,
    stage,
    ...(parsedError === undefined ? {} : { errorCode: parsedError }),
  };
}

function failure(code: PublicErrorCode, status: number, partial?: ReportSnapshot): ScanApiError {
  return new ScanApiError(code, status, partial === undefined ? {} : { partial });
}

export function waitForPollDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    let settled = false;
    function cleanup(): void {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
    function settle(callback: () => void): void {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    }
    function onAbort(): void {
      settle(() => { reject(new DOMException("Aborted", "AbortError")); });
    }
    const timeout = globalThis.setTimeout(() => { settle(resolve); }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new DOMException("Aborted", "AbortError");
}

export function isScanFailure(value: unknown): value is ScanFailure {
  return isRecord(value) && typeof value.code === "string" && publicCodes.has(value.code as PublicErrorCode);
}

export async function pollScan(api: ScanApi, jobId: string, options: PollOptions): Promise<ReportSnapshot> {
  let delay = 250;
  let knownExpiresAt: number | undefined;
  const clock = options.clock ?? Date.now;
  const wait = options.wait ?? waitForPollDelay;
  while (options.signal?.aborted !== true) {
    throwIfAborted(options.signal);
    if (knownExpiresAt !== undefined && knownExpiresAt <= clock()) throw failure("scan_not_found", 404);
    const job = await api.getScan(jobId, options.signal);
    throwIfAborted(options.signal);
    const expiresAt = Date.parse(job.expiresAt);
    if (!Number.isFinite(expiresAt)) throw failure("internal_failure", 502);
    if (expiresAt <= clock()) throw failure("scan_not_found", 404);
    knownExpiresAt = expiresAt;
    options.onStage(job.stage);
    if (job.stage === "rendered") {
      const report = await api.getReport(jobId, options.signal);
      throwIfAborted(options.signal);
      return report;
    }
    if (job.stage === "failed") {
      let partial: ReportSnapshot | undefined;
      if (job.reportAvailable) {
        try {
          partial = await api.getReport(jobId, options.signal);
          throwIfAborted(options.signal);
        } catch {
          throwIfAborted(options.signal);
          partial = undefined;
        }
      }
      throwIfAborted(options.signal);
      throw failure(job.errorCode ?? "internal_failure", 502, partial);
    }
    await wait(delay, options.signal);
    delay = Math.min(delay * 2, 2000);
  }
  throw new DOMException("Aborted", "AbortError");
}

export function createScanApi(): ScanApi {
  return {
    async createScan(input, signal) {
      const { body } = await requestJson("/api/scans", {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST",
        ...(signal === undefined ? {} : { signal }),
      });
      return parseCreate(body);
    },
    async getScan(jobId, signal) {
      const { body } = await requestJson(`/api/scans/${encodeURIComponent(jobId)}`, signal === undefined ? {} : { signal });
      return parseJob(body);
    },
    async getReport(jobId, signal) {
      const { body } = await requestJson(`/api/scans/${encodeURIComponent(jobId)}/report`, signal === undefined ? {} : { signal });
      const parsed = reportSnapshotSchema.safeParse(body);
      if (!parsed.success) throw failure("internal_failure", 502);
      return parsed.data;
    },
  };
}
