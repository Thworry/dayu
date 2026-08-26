import type { Evidence, Finding } from "@dayu/evidence-schema";

import { aiConfidence, enhancedConfidence, ruleConfidence } from "./confidence.js";
import { scoreClaims } from "./rules/claims.js";
import { scoreCommunity } from "./rules/community.js";
import { scoreMaintenance } from "./rules/maintenance.js";
import { scorePopularity } from "./rules/popularity.js";
import { scoreSubstance } from "./rules/substance.js";
import {
  AI_WEIGHTS,
  DIMENSIONS,
  RULE_WEIGHTS,
  clampRisk,
  clampUnit,
  toSharedFinding,
  valueRecord,
  type AiFinding,
  type Dimension,
  type DimensionRuleResult,
  type EnhancedReport,
  type EnhancedScoreInput,
  type PercentileBand,
  type RuleContext,
  type RulesReport,
  type ScorePart,
  type ScoreRulesInput,
} from "./types.js";

export function cohortPercentileRisk(deficit: number, band: PercentileBand): number {
  if (!Number.isFinite(deficit) || !Number.isFinite(band.p80Deficit) || !Number.isFinite(band.p99Deficit) || band.p99Deficit <= band.p80Deficit) return 0;
  if (deficit <= band.p80Deficit) return 0;
  if (deficit >= band.p99Deficit) return 100;
  const risk = 100 * (deficit - band.p80Deficit) / (band.p99Deficit - band.p80Deficit);
  return Math.round(risk * 1_000_000_000_000) / 1_000_000_000_000;
}

export function weightedAvailableScore(parts: readonly ScorePart[]): number | null {
  const availableWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  if (availableWeight < 0.6) return null;
  return Math.round(parts.reduce((sum, part) => sum + part.risk * part.weight, 0) / availableWeight);
}

function evidenceStatus(evidence: readonly Evidence[]): "complete" | "partial" | "restricted" | "unverifiable" {
  if (evidence.length === 0) return "unverifiable";
  if (evidence.some((item) => item.status === "restricted")) return "restricted";
  if (evidence.some((item) => item.status !== "complete")) return "partial";
  return "complete";
}

function repositoryContext(evidence: readonly Evidence[]): { defaultBranch: string; fullName: string; id: number; sourceCommit: string } {
  const first = evidence[0];
  if (first === undefined) throw new Error("scoring_requires_evidence");
  const metadata = evidence.find((item) => item.fact.metric === "repository.metadata");
  const commit = evidence.find((item) => item.fact.metric === "repository.default_commit");
  const defaultBranch = valueRecord(metadata)?.defaultBranch;
  const commitSha = valueRecord(commit)?.sha;
  const pinnedFile = evidence.find((item) => item.source.kind === "file")?.source;
  const sourceCommit = typeof commitSha === "string" ? commitSha : pinnedFile?.kind === "file" ? pinnedFile.commitSha : null;
  if (sourceCommit === null || sourceCommit.length < 7) throw new Error("scoring_requires_source_commit");
  return {
    defaultBranch: typeof defaultBranch === "string" ? defaultBranch : "main",
    fullName: first.repository.fullName,
    id: first.repository.id,
    sourceCommit,
  };
}

function evidenceIndex(evidence: readonly Evidence[]): Record<string, Evidence> {
  return Object.fromEntries(evidence.map((item) => [item.id, item]));
}

function gateScore(raw: number, dimensions: Readonly<Record<Dimension, number | null>>, confidence: number): number {
  let score = Math.round(clampRisk(raw));
  const riskyDimensions = DIMENSIONS.filter((dimension) => (dimensions[dimension] ?? 0) >= 60).length;
  if (score >= 80 && (riskyDimensions < 3 || confidence < 75)) score = 79;
  if (score >= 60 && (riskyDimensions < 2 || confidence < 60)) score = 59;
  return score;
}

function emptyDimensionScores(): Record<Dimension, number | null> {
  return { claims: null, community: null, maintenance: null, popularity: null, substance: null };
}

function emptyDimensionWeights(): Record<Dimension, number> {
  return { claims: 0, community: 0, maintenance: 0, popularity: 0, substance: 0 };
}

function evaluations(context: RuleContext): DimensionRuleResult[] {
  return [
    scorePopularity(context),
    scoreSubstance(context),
    scoreMaintenance(context),
    scoreCommunity(context),
    scoreClaims(context),
  ];
}

export function scoreRules(input: ScoreRulesInput): RulesReport {
  const evidence = [...input.evidence];
  const repository = repositoryContext(evidence);
  const base = {
    availableWeight: 0,
    collectorVersion: input.collectorVersion,
    confidence: 0,
    createdAt: input.analyzedAt,
    dataStatus: evidenceStatus(evidence),
    dimensionAvailableWeights: emptyDimensionWeights(),
    dimensionScores: emptyDimensionScores(),
    evidence,
    evidenceIndex: evidenceIndex(evidence),
    expiresAt: input.expiresAt,
    findings: [] as Finding[],
    locale: "en" as const,
    missingSignals: [] as string[],
    normalizerVersion: input.normalizer.version,
    positiveSignals: [] as Finding[],
    reportVersion: "1" as const,
    researchPreview: {
      calibrationStatus: "uncalibrated" as const,
      normalizerKind: "synthetic_reference" as const,
      normalizerVersion: input.normalizer.version,
      releaseStage: "pre_beta" as const,
    },
    repository: { defaultBranch: repository.defaultBranch, fullName: repository.fullName, id: repository.id },
    repositoryType: input.classification.type,
    rulesVersion: input.rulesVersion,
    sourceCommit: repository.sourceCommit,
  };
  if (input.classification.scoreMode === "facts_only") {
    return { ...base, baseScore: null, confidence: ruleConfidence({ cohort: input.normalizer.confidence, data: 0, taxonomy: input.classification.confidence }), score: null, scoreKind: "facts_only" };
  }

  const context: RuleContext = {
    analyzedAt: input.analyzedAt,
    classification: input.classification,
    evidence,
    normalizer: input.normalizer,
    rulesVersion: input.rulesVersion,
  };
  const results = evaluations(context);
  const parts: ScorePart[] = [];
  const dimensionScores = emptyDimensionScores();
  const dimensionAvailableWeights = emptyDimensionWeights();
  for (const result of results) {
    dimensionScores[result.dimension] = result.risk === null ? null : Math.round(clampRisk(result.risk));
    if (result.risk !== null) {
      const weight = RULE_WEIGHTS[result.dimension] * clampUnit(result.coverage);
      dimensionAvailableWeights[result.dimension] = weight;
      if (weight > 0) parts.push({ dimension: result.dimension, risk: result.risk, weight });
    }
  }
  const availableWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const data = results.reduce((sum, result) => sum + RULE_WEIGHTS[result.dimension] * clampUnit(result.coverage) * clampUnit(result.quality), 0) / 0.7;
  const confidence = ruleConfidence({ cohort: input.normalizer.confidence, data, taxonomy: input.classification.confidence });
  const rawScore = weightedAvailableScore(parts);
  const score = rawScore === null ? null : gateScore(rawScore, dimensionScores, confidence);
  const sharedFindings = results.flatMap((result) => result.findings).map(toSharedFinding);
  const positiveSignals = results.flatMap((result) => result.positiveSignals).map(toSharedFinding);
  return {
    ...base,
    availableWeight,
    baseScore: score,
    confidence,
    dimensionAvailableWeights,
    dimensionScores,
    findings: sharedFindings,
    missingSignals: [...new Set(results.flatMap((result) => result.missingSignals))],
    positiveSignals,
    score,
    scoreKind: score === null ? "insufficient_evidence" : "rules_only",
  };
}

function verdictRisk(finding: AiFinding): number | null {
  switch (finding.verdict) {
    case "supported": return 0;
    case "mixed": return 50;
    case "contradicted": return 100;
    case "unverifiable":
    case "not_applicable": return null;
  }
}

function validAiFinding(finding: AiFinding, evidenceIds: ReadonlySet<string>): boolean {
  return finding.evidenceIds.length > 0 && [...finding.evidenceIds, ...finding.counterEvidenceIds].every((id) => evidenceIds.has(id));
}

function canonicalAiFinding(finding: AiFinding): string {
  return JSON.stringify({
    counterEvidenceIds: [...finding.counterEvidenceIds].sort(),
    dimension: finding.dimension,
    en: finding.en,
    evidenceIds: [...finding.evidenceIds].sort(),
    verdict: finding.verdict,
    zh: finding.zh,
  });
}

function deduplicateAiFindings(findings: readonly AiFinding[], evidenceIds: ReadonlySet<string>): AiFinding[] {
  const groups = new Map<string, Map<string, AiFinding>>();
  for (const finding of findings) {
    if (!validAiFinding(finding, evidenceIds)) continue;
    const variants = groups.get(finding.rubricId) ?? new Map<string, AiFinding>();
    const normalized = { ...finding, counterEvidenceIds: [...finding.counterEvidenceIds].sort(), evidenceIds: [...finding.evidenceIds].sort() };
    variants.set(canonicalAiFinding(normalized), normalized);
    groups.set(finding.rubricId, variants);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, variants]) => variants.size === 1 ? [...variants.values()] : []);
}

function aiSharedFinding(item: AiFinding, risk: number): Finding {
  const findingId = `fd_copilot_${encodeURIComponent(item.rubricId)}`;
  return {
    caveat: "copilot_evidence_bound_judgment",
    copilotJudgmentId: item.rubricId,
    copyKey: `finding.copilot.${item.rubricId}`,
    counterEvidenceIds: item.counterEvidenceIds,
    dimension: item.dimension,
    evidenceIds: item.evidenceIds,
    explanationKey: `finding.copilot.${item.rubricId}.explanation`,
    findingId,
    id: findingId,
    producer: "copilot",
    risk,
    scoreImpact: risk,
    severity: risk >= 80 ? "high" : risk >= 60 ? "moderate" : risk > 0 ? "low" : "info",
    titleKey: `finding.copilot.${item.rubricId}.title`,
  };
}

export function scoreEnhanced(input: EnhancedScoreInput): EnhancedReport {
  const rules = input.rulesReport;
  if (rules.scoreKind === "facts_only") return { ...rules, scoreKind: "facts_only" };
  const knownEvidence = new Set(rules.evidence.map((item) => item.id));
  const adjudicated = deduplicateAiFindings(input.aiFindings, knownEvidence).flatMap((item) => {
    const risk = verdictRisk(item);
    return risk === null ? [] : [{ item, risk }];
  });
  const parts: ScorePart[] = DIMENSIONS.flatMap((dimension) => {
    const weight = rules.dimensionAvailableWeights[dimension];
    const risk = rules.dimensionScores[dimension];
    return risk === null || weight <= 0 ? [] : [{ dimension, risk, weight }];
  });
  for (const dimension of ["substance", "maintenance", "community", "claims"] as const) {
    const matches = adjudicated.filter((entry) => entry.item.dimension === dimension);
    if (matches.length === 0) continue;
    const risk = matches.reduce((sum, entry) => sum + entry.risk, 0) / matches.length;
    const weight = AI_WEIGHTS[dimension];
    parts.push({ dimension, risk, weight });
  }
  // Copilot may add evidence-bound qualitative judgments, but it cannot turn
  // missing deterministic public data into measured evidence coverage.
  const availableWeight = rules.availableWeight;
  const totalByDimension = emptyDimensionScores();
  for (const dimension of DIMENSIONS) {
    const matching = parts.filter((part) => part.dimension === dimension);
    const weight = matching.reduce((sum, part) => sum + part.weight, 0);
    totalByDimension[dimension] = weight === 0 ? null : Math.round(matching.reduce((sum, part) => sum + part.risk * part.weight, 0) / weight);
  }
  const confidence = enhancedConfidence(rules.confidence, aiConfidence(input.aiConfidence));
  const aiFindings = adjudicated.filter((entry) => entry.risk > 0).map((entry) => aiSharedFinding(entry.item, entry.risk));
  const aiPositive = adjudicated.filter((entry) => entry.risk === 0).map((entry) => aiSharedFinding(entry.item, entry.risk));
  if (rules.availableWeight < 0.6 || rules.baseScore === null || rules.score === null) {
    return {
      ...rules,
      availableWeight,
      baseScore: null,
      confidence,
      dimensionScores: totalByDimension,
      enrichedScore: undefined,
      findings: [...rules.findings, ...aiFindings],
      promptVersion: undefined,
      positiveSignals: [...rules.positiveSignals, ...aiPositive],
      score: null,
      scoreKind: "insufficient_evidence",
    };
  }
  const rawScore = weightedAvailableScore(parts);
  const score = rawScore === null ? null : gateScore(rawScore, totalByDimension, confidence);
  if (score === null) throw new Error("enhanced_score_requires_deterministic_coverage");
  return {
    ...rules,
    availableWeight,
    confidence,
    dimensionScores: totalByDimension,
    baseScore: rules.baseScore,
    enrichedScore: score,
    findings: [...rules.findings, ...aiFindings],
    positiveSignals: [...rules.positiveSignals, ...aiPositive],
    promptVersion: input.promptVersion ?? "copilot-rubric-1",
    score,
    scoreKind: "enhanced",
  };
}
