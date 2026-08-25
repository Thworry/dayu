import type { ReportSnapshot } from "@dayu/evidence-schema";

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

export interface ScanJob {
  id: string;
  repository: string;
  stage: ScanStage;
  createdAt: string;
  expiresAt: string;
  report?: ReportSnapshot;
  errorCode?: PublicErrorCode;
  /** Internal ownership binding. This field is never returned by public scan routes. */
  copilotOwnerId?: number;
}

export type CreateScanJobInput = Omit<ScanJob, "expiresAt" | "id"> & { expiresAt?: string };

export interface ScanJobStore {
  close?(): Promise<void>;
  create(input: CreateScanJobInput): Promise<ScanJob>;
  get(id: string): Promise<ScanJob | null>;
  update(id: string, patch: Partial<Omit<ScanJob, "id">>): Promise<void>;
  delete(id: string): Promise<void>;
  claimForCopilot(id: string, githubUserId: number): Promise<ScanJob | "forbidden" | "not_ready" | null>;
}
