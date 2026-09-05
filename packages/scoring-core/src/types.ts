import type { Evidence, Finding, ReportSnapshot } from "@dayu/evidence-schema";
import type { RepositoryClassification } from "@dayu/repository-taxonomy";

export type Dimension = "popularity" | "substance" | "maintenance" | "community" | "claims";

export type ScoringCaveat =
  | "active_weeks_unavailable"
  | "binary_lfs"
  | "bounded_activity_sample"
  | "external_tracker"
  | "generated_heavy"
  | "low_star_wording_guard"
  | "monorepo"
  | "new_repo_history_guard";

export interface PercentileBand {
  p80Deficit: number;
  p99Deficit: number;
}

export interface NormalizerSnapshot {
  version: string;
  confidence: number;
  bands: Readonly<Record<string, PercentileBand>>;
}

export interface RuleFinding {
  findingId: string;
  ruleId: string;
  ruleVersion: string;
  dimension: Dimension;
  risk: number;
  evidenceIds: string[];
  positiveEvidenceIds: string[];
  copyKey: string;
  limitations: ScoringCaveat[];
}

export interface DimensionRuleResult {
  dimension: Dimension;
  risk: number | null;
  coverage: number;
  quality: number;
  findings: RuleFinding[];
  positiveSignals: RuleFinding[];
  missingSignals: string[];
}

export interface RuleContext {
  analyzedAt: string;
  classification: RepositoryClassification;
  evidence: readonly Evidence[];
  normalizer: NormalizerSnapshot;
  rulesVersion: string;
}

export interface ScoreRulesInput {
  analyzedAt: string;
  classification: RepositoryClassification;
  collectorVersion: string;
  evidence: readonly Evidence[];
  expiresAt: string;
  normalizer: NormalizerSnapshot;
  rulesVersion: string;
  locale?: "zh" | "en";
  ownerFollowers?: number;
}

export interface RulesReport extends ReportSnapshot {
  scoreKind: "rules_only" | "insufficient_evidence" | "facts_only";
  availableWeight: number;
  dimensionAvailableWeights: Record<Dimension, number>;
  normalizerVersion: string;
}

export type AiVerdict = "supported" | "mixed" | "contradicted" | "unverifiable" | "not_applicable";

export interface AiFinding {
  rubricId: string;
  dimension: Exclude<Dimension, "popularity">;
  verdict: AiVerdict;
  risk?: 0 | 50 | 100 | null;
  evidenceIds: string[];
  counterEvidenceIds: string[];
  zh: string;
  en: string;
}

export interface AiConfidenceInput {
  applicableCoverage: number;
  evidenceScopeCompleteness: number;
  sampleAdequacy: number;
}

export interface EnhancedScoreInput {
  rulesReport: RulesReport;
  aiFindings: readonly AiFinding[];
  aiConfidence: AiConfidenceInput;
  promptVersion?: string;
}

export interface EnhancedReport extends ReportSnapshot {
  scoreKind: "rules_only" | "enhanced" | "insufficient_evidence" | "facts_only";
  availableWeight: number;
  dimensionAvailableWeights: Record<Dimension, number>;
  normalizerVersion: string;
}

export interface ScorePart {
  dimension: Dimension;
  risk: number;
  weight: number;
}

export const DIMENSIONS: readonly Dimension[] = ["popularity", "substance", "maintenance", "community", "claims"];

export const RULE_WEIGHTS: Readonly<Record<Dimension, number>> = {
  claims: 0.05,
  community: 0.1,
  maintenance: 0.15,
  popularity: 0.25,
  substance: 0.15,
};

export const AI_WEIGHTS: Readonly<Record<Exclude<Dimension, "popularity">, number>> = {
  claims: 0.1,
  community: 0.05,
  maintenance: 0.05,
  substance: 0.1,
};

export function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function clampRisk(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

export function evidenceQuality(item: Evidence): number {
  if (item.status === "complete") return item.limitations.length === 0 ? 1 : 0.9;
  if (item.status !== "partial") return 0;
  if (item.limitations.includes("github_tree_truncated")) return 0.4;
  if (item.limitations.includes("bounded_first_page") || item.limitations.includes("page_budget_incomplete")) return 0.75;
  return 0.75;
}

export function evidenceFor(context: RuleContext, metric: string): Evidence | undefined {
  return context.evidence.find((item) => item.fact.metric === metric);
}

export function valueRecord(item: Evidence | undefined): Record<string, unknown> | null {
  const value = item?.value;
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

export function valueItems(item: Evidence | undefined): Record<string, unknown>[] {
  const items = valueRecord(item)?.items;
  return Array.isArray(items)
    ? items.filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value))
    : [];
}

export function countValue(item: Evidence | undefined): number | null {
  const count = valueRecord(item)?.count;
  return typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : null;
}

export function finding(input: Omit<RuleFinding, "findingId" | "ruleVersion">, version: string): RuleFinding | null {
  const evidenceIds = [...new Set(input.evidenceIds)];
  if (evidenceIds.length === 0) return null;
  return {
    ...input,
    evidenceIds,
    findingId: `fd_${input.ruleId.replace(/[^a-z0-9_.-]/gi, "_")}`,
    positiveEvidenceIds: [...new Set(input.positiveEvidenceIds)],
    ruleVersion: version,
  };
}

export function toSharedFinding(item: RuleFinding): Finding {
  const severity = item.risk >= 80 ? "high" : item.risk >= 60 ? "moderate" : item.risk > 0 ? "low" : "info";
  return {
    caveat: item.limitations.join(","),
    copyKey: item.copyKey,
    counterEvidenceIds: item.positiveEvidenceIds,
    dimension: item.dimension,
    evidenceIds: item.evidenceIds,
    explanationKey: `${item.copyKey}.explanation`,
    findingId: item.findingId,
    id: item.findingId,
    producer: "rule",
    risk: Math.round(clampRisk(item.risk)),
    ruleId: item.ruleId,
    scoreImpact: Math.round(clampRisk(item.risk)),
    severity,
    titleKey: `${item.copyKey}.title`,
  };
}
