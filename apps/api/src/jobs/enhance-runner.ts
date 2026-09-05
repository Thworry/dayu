import type { CopilotAnalysis } from "@dayu/copilot-adapter";
import type { ReportSnapshot } from "@dayu/evidence-schema";
import { scoreEnhanced, type AiConfidenceInput, type RulesReport } from "@dayu/scoring-core";

import type { AuthSession, OAuthService } from "../auth/oauth.js";
import type { ScanJobStore } from "./types.js";

export const COPILOT_PROMPT_VERSION = "copilot-prompt-v1";
export const COPILOT_RUBRIC_VERSION = "copilot-rubric-v1";

export type CopilotFailureCode =
  | "copilot_failed"
  | "copilot_invalid_output"
  | "copilot_not_entitled"
  | "copilot_policy_disabled"
  | "copilot_quota_exhausted"
  | "copilot_revoked"
  | "copilot_timeout";

export interface EnhancementAnalyzerInput {
  evidence: ReportSnapshot["evidence"];
  githubToken: string;
  idempotencyKey: string;
  signal: AbortSignal;
}

export interface EnhancementAnalysis extends CopilotAnalysis {
  model: string;
}

export type EnhancementAnalyzer = (input: EnhancementAnalyzerInput) => Promise<EnhancementAnalysis>;

export interface CopilotFindingCopy {
  counterEvidenceIds: string[];
  en: string;
  evidenceIds: string[];
  rubricId: string;
  verdict: "contradicted" | "mixed" | "not_applicable" | "supported" | "unverifiable";
  zh: string;
}

export interface EnhancedMetadata {
  findings: CopilotFindingCopy[];
  model: string;
  promptVersion: string;
  rubricVersion: string;
}

export interface EnhancementResult {
  baseReport: ReportSnapshot;
  enhancedReport: ReportSnapshot | null;
  errorCode?: CopilotFailureCode;
  metadata?: EnhancedMetadata;
  noChangeReason?: "no_scorable_judgments";
}

export interface EnhanceJobInput {
  analyze: EnhancementAnalyzer;
  idempotencyKey: string;
  jobId: string;
  jobStore: ScanJobStore;
  oauth: OAuthService;
  session: AuthSession;
  signal: AbortSignal;
}

export class CopilotEnhancementError extends Error {
  readonly code: CopilotFailureCode;

  constructor(code: CopilotFailureCode) {
    super(code);
    this.name = "CopilotEnhancementError";
    this.code = code;
  }
}

export class CopilotRunCancelledError extends Error {
  constructor() {
    super("copilot_cancelled");
    this.name = "CopilotRunCancelledError";
  }
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CopilotRunCancelledError();
}

function classify(reason: unknown): CopilotFailureCode {
  if (reason instanceof CopilotEnhancementError) return reason.code;
  if (reason instanceof Error) {
    if (reason.message === "copilot_not_entitled" || reason.message === "copilot_policy_disabled" || reason.message === "copilot_quota_exhausted" || reason.message === "copilot_revoked" || reason.message === "copilot_timeout") {
      return reason.message;
    }
    if (/invalid|absolute_claim|unknown_evidence|unsafe_output|complete_scope|counterevidence|duplicate_/u.test(reason.message)) {
      return "copilot_invalid_output";
    }
  }
  return "copilot_failed";
}

function confidence(report: ReportSnapshot, analysis: CopilotAnalysis): AiConfidenceInput {
  const scopedEvidence = report.evidence.filter((item) => item.status !== "not_applicable");
  const complete = scopedEvidence.filter((item) => item.status === "complete").length;
  const adjudicated = analysis.findings.filter((finding) => finding.verdict === "supported" || finding.verdict === "mixed" || finding.verdict === "contradicted");
  const coveredDimensions = new Set(adjudicated.map((finding) => finding.dimension)).size;
  return {
    applicableCoverage: Math.min(1, new Set(adjudicated.map((finding) => finding.rubricId)).size / 6),
    evidenceScopeCompleteness: scopedEvidence.length === 0 ? 0 : complete / scopedEvidence.length,
    sampleAdequacy: Math.min(1, coveredDimensions / 4),
  };
}

async function analyzeOnce(input: EnhanceJobInput, baseReport: ReportSnapshot): Promise<EnhancementAnalysis> {
  throwIfCancelled(input.signal);
  try {
    const analysis = await input.oauth.withAccessToken(input.session.rawSessionId, async (githubToken) => {
      throwIfCancelled(input.signal);
      return await input.analyze({
        evidence: baseReport.evidence,
        githubToken,
        idempotencyKey: input.idempotencyKey,
        signal: input.signal,
      });
    });
    throwIfCancelled(input.signal);
    return analysis;
  } catch (reason) {
    if (input.signal.aborted || reason instanceof CopilotRunCancelledError) throw new CopilotRunCancelledError();
    const code = classify(reason);
    if (code === "copilot_revoked") await input.oauth.logout(input.session.rawSessionId);
    throw new CopilotEnhancementError(code);
  }
}

export async function enhanceJob(input: EnhanceJobInput): Promise<EnhancementResult> {
  const job = await input.jobStore.get(input.jobId);
  if (job?.report === undefined) throw new Error("scan_not_ready");
  const baseReport = job.report;
  try {
    const analysis = await analyzeOnce(input, baseReport);
    const scored = scoreEnhanced({
      aiConfidence: confidence(baseReport, analysis),
      aiFindings: analysis.findings,
      promptVersion: COPILOT_PROMPT_VERSION,
      rulesReport: baseReport as RulesReport,
    });
    const metadata: EnhancedMetadata = {
      findings: analysis.findings.map((finding) => ({
        counterEvidenceIds: finding.counterEvidenceIds,
        en: finding.en,
        evidenceIds: finding.evidenceIds,
        rubricId: finding.rubricId,
        verdict: finding.verdict,
        zh: finding.zh,
      })),
      model: analysis.model,
      promptVersion: COPILOT_PROMPT_VERSION,
      rubricVersion: COPILOT_RUBRIC_VERSION,
    };
    const hasJudgments = [...scored.findings, ...scored.positiveSignals].some((finding) => finding.producer === "copilot");
    if (scored.scoreKind === "rules_only" || scored.scoreKind === "facts_only" || !hasJudgments) {
      throwIfCancelled(input.signal);
      return { baseReport, enhancedReport: null, metadata, noChangeReason: "no_scorable_judgments" };
    }
    const enhancedReport: ReportSnapshot = { ...scored, copilot: metadata };
    throwIfCancelled(input.signal);
    return {
      baseReport,
      enhancedReport,
      metadata,
    };
  } catch (reason) {
    if (input.signal.aborted || reason instanceof CopilotRunCancelledError) throw new CopilotRunCancelledError();
    const errorCode = classify(reason);
    return { baseReport, enhancedReport: null, errorCode };
  }
}
