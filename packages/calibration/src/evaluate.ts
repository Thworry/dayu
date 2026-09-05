import { TAXONOMY_VERSION, type RepositoryType } from "@dayu/repository-taxonomy";
import { REFERENCE_SCORING_NORMALIZER, SCORING_RULES_VERSION } from "@dayu/scoring-core";

import { recomputeGoldenCase, recomputedManifestDigest, reviewLabelsMatchManifest, SCORING_PIPELINE_VERSION, sha256Digest } from "./recompute.js";
import { protectedReleaseRuntimeSchema, releaseEvidenceSchema, type GoldenCase, type GoldenCaseSet, type NormalizerSnapshot, type ProtectedReleaseRuntime, type ReleaseEvidence } from "./schema.js";
import { securityReviewArtifactMatchesManifests, securityReviewArtifactSchema, unresolvedHighOrCritical } from "./security-review.js";

const REPOSITORY_TYPES: readonly RepositoryType[] = ["software", "docs_content", "data_model", "template", "creative_demo", "generic"];

export interface ConfidenceInterval {
  high: number | null;
  low: number | null;
  method: "wilson_95";
}

export interface ThresholdEvaluation {
  falseNegativeCount: number;
  falseNegativeRate: number | null;
  falsePositiveCount: number;
  falsePositiveRate: number | null;
  falsePositiveRate95Ci: ConfidenceInterval;
  threshold: 60 | 80;
  trueNegativeCount: number;
  truePositiveCount: number;
}

export interface ChallengeOutcome {
  abstainedCount: number;
  accuracy: number | null;
  caseCount: number;
  correctCount: number;
}

export interface CalibrationEvaluation {
  abstainedCaseCount: number;
  caseCount: number;
  challengeOutcomes: Record<string, ChallengeOutcome>;
  changedCases: { currentScore: number | null; id: string; previousScore: number }[];
  perTypeAbstentions: Partial<Record<RepositoryType, number>>;
  perTypeScoreDistributions: Partial<Record<RepositoryType, { count: number; max: number; mean: number; min: number }>>;
  thresholds: Record<"60" | "80", ThresholdEvaluation>;
  scoredCaseCount: number;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(6));
}

/** Two-sided 95% Wilson score interval. Unlike percentile bootstrap, zero successes never yields a dishonest [0, 0]. */
export function wilson95(successes: number, total: number): ConfidenceInterval {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(total) || successes < 0 || total < 0 || successes > total) {
    throw new Error("invalid_binomial_counts");
  }
  if (total === 0) return { high: null, low: null, method: "wilson_95" };
  const z = 1.959963984540054;
  const z2 = z * z;
  const probability = successes / total;
  const denominator = 1 + z2 / total;
  const center = (probability + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((probability * (1 - probability) + z2 / (4 * total)) / total) / denominator;
  return {
    high: Number(Math.min(1, center + margin).toFixed(6)),
    low: Number(Math.max(0, center - margin).toFixed(6)),
    method: "wilson_95",
  };
}

function evaluateThreshold(cases: readonly GoldenCase[], threshold: 60 | 80): ThresholdEvaluation {
  let falseNegativeCount = 0;
  let falsePositiveCount = 0;
  let trueNegativeCount = 0;
  let truePositiveCount = 0;
  for (const item of cases) {
    if (item.currentScore === null) continue;
    const predictedRisk = item.currentScore >= threshold;
    if (item.expected === "risk" && predictedRisk) truePositiveCount += 1;
    else if (item.expected === "risk") falseNegativeCount += 1;
    else if (predictedRisk) falsePositiveCount += 1;
    else trueNegativeCount += 1;
  }
  return {
    falseNegativeCount,
    falseNegativeRate: ratio(falseNegativeCount, falseNegativeCount + truePositiveCount),
    falsePositiveCount,
    falsePositiveRate: ratio(falsePositiveCount, falsePositiveCount + trueNegativeCount),
    falsePositiveRate95Ci: wilson95(falsePositiveCount, falsePositiveCount + trueNegativeCount),
    threshold,
    trueNegativeCount,
    truePositiveCount,
  };
}

function evaluateCases(cases: readonly GoldenCase[]): CalibrationEvaluation {
  const perType = new Map<RepositoryType, number[]>();
  const abstentions = new Map<RepositoryType, number>();
  const challenges = new Map<string, { abstainedCount: number; caseCount: number; correctCount: number }>();
  for (const item of cases) {
    if (item.currentScore === null) abstentions.set(item.repositoryType, (abstentions.get(item.repositoryType) ?? 0) + 1);
    else {
      const scores = perType.get(item.repositoryType) ?? [];
      scores.push(item.currentScore);
      perType.set(item.repositoryType, scores);
    }
    for (const tag of item.challengeTags) {
      const outcome = challenges.get(tag) ?? { abstainedCount: 0, caseCount: 0, correctCount: 0 };
      outcome.caseCount += 1;
      if (item.currentScore === null) outcome.abstainedCount += 1;
      else {
        const predicted = item.currentScore >= 60 ? "risk" : "ordinary";
        if (predicted === item.expected) outcome.correctCount += 1;
      }
      challenges.set(tag, outcome);
    }
  }
  return {
    abstainedCaseCount: cases.filter((item) => item.currentScore === null).length,
    caseCount: cases.length,
    challengeOutcomes: Object.fromEntries([...challenges.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([tag, outcome]) => [tag, {
      ...outcome,
      accuracy: ratio(outcome.correctCount, outcome.caseCount - outcome.abstainedCount),
    }])),
    changedCases: cases.flatMap((item) => item.previousScore === null || item.previousScore === item.currentScore ? [] : [{
      currentScore: item.currentScore,
      id: item.id,
      previousScore: item.previousScore,
    }]),
    perTypeAbstentions: Object.fromEntries(abstentions),
    perTypeScoreDistributions: Object.fromEntries([...perType.entries()].map(([type, values]) => [type, {
      count: values.length,
      max: Math.max(...values),
      mean: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
      min: Math.min(...values),
    }])),
    thresholds: {
      "60": evaluateThreshold(cases, 60),
      "80": evaluateThreshold(cases, 80),
    },
    scoredCaseCount: cases.filter((item) => item.currentScore !== null).length,
  };
}

/** Diagnostic evaluation. Release claims use evaluateReleaseGate, which reselects and evaluates qualifying cases internally. */
export function evaluateGoldenCases(input: GoldenCaseSet): CalibrationEvaluation {
  return evaluateCases(input.cases);
}

export interface ReleaseGate {
  claims: {
    falsePositiveAt60Supported: boolean;
    falsePositiveAt80Supported: boolean;
  };
  evaluation: CalibrationEvaluation;
  reasons: string[];
  requirements: {
    cohortCoverage: { actual: number; minimum: 24 };
    ecosystems: { actual: number; minimum: 3 };
    ordinaryCases: { actual: number; minimum: 80 };
    perTypeBalanced: { actual: number; minimum: 6 };
    publicAggregateRepositories: { actual: number; minimum: 5000 };
    qualifyingBlindReviewedCases: { actual: number; minimum: 120 };
    riskCases: { actual: number; minimum: 40 };
  };
  status: "beta_ready" | "pre_beta_not_ready";
}

function pipelineRuntimeMatches(evidence: ReleaseEvidence | null, runtime: ProtectedReleaseRuntime | null): boolean {
  if (evidence === null || runtime === null || evidence.scoringPipeline.status !== "verified") return false;
  return evidence.scoringPipeline.commitSha === runtime.commitSha
    && evidence.scoringPipeline.workflowRunId === runtime.workflowRunId;
}

function copilotRuntimeMatches(evidence: ReleaseEvidence | null, runtime: ProtectedReleaseRuntime | null): boolean {
  if (evidence === null || runtime === null || evidence.copilotMatrix.status !== "verified") return false;
  const accountManifest = sha256Digest({
    auditSource: "github_protected_environment_registry",
    commitSha: runtime.commitSha,
    runs: evidence.copilotMatrix.runs.map((run) => ({ account: run.account, subjectDigest: run.subjectDigest })),
    workflowRunId: runtime.workflowRunId,
  });
  return evidence.copilotMatrix.workflowRunId === runtime.workflowRunId
    && new Set(evidence.copilotMatrix.runs.map((run) => run.subjectDigest)).size === 3
    && evidence.copilotMatrix.runs.every((run) => run.commitSha === runtime.commitSha)
    && evidence.copilotMatrix.accountClassManifestDigest === accountManifest;
}

function securityRuntimeMatches(evidence: ReleaseEvidence | null, runtime: ProtectedReleaseRuntime | null): boolean {
  if (evidence === null || runtime === null || evidence.securityReview.status !== "verified") return false;
  const security = evidence.securityReview;
  const parsedArtifact = securityReviewArtifactSchema.safeParse({
    artifactDigest: security.reportDigest,
    commitSha: security.commitSha,
    findings: security.findings,
    findingsManifestDigest: security.findingsManifestDigest,
    generatedAt: security.artifactGeneratedAt,
    manualReviewManifestDigest: security.manualReviewManifestDigest,
    reviewAttestations: security.reviewAttestations,
    reviewManifestDigest: security.reviewManifestDigest,
    schemaVersion: security.artifactSchemaVersion,
    workflowRunId: security.workflowRunId,
  });
  if (!parsedArtifact.success) return false;
  const artifact = parsedArtifact.data;
  return security.commitSha === runtime.commitSha
    && security.workflowRunId === runtime.workflowRunId
    && securityReviewArtifactMatchesManifests(artifact)
    && unresolvedHighOrCritical(artifact) === 0;
}

function allGoldenCasesRecompute(golden: GoldenCaseSet, normalizer: NormalizerSnapshot): boolean {
  const inputDigests = new Set<string>();
  for (const item of golden.cases) {
    const recomputed = recomputeGoldenCase(item, normalizer.scoringNormalizer);
    if (recomputed?.currentScore !== item.currentScore
      || recomputed.inputDigest !== item.scoringInputDigest
      || recomputed.outputDigest !== item.scoringOutputDigest
      || recomputed.repositoryType !== item.repositoryType
      || inputDigests.has(recomputed.inputDigest)) return false;
    inputDigests.add(recomputed.inputDigest);
  }
  return recomputedManifestDigest(golden, normalizer.scoringNormalizer) === golden.manifestDigest;
}

function pipelineBindingsMatch(golden: GoldenCaseSet, normalizer: NormalizerSnapshot, evidence: ReleaseEvidence | null, runtime: ProtectedReleaseRuntime | null): boolean {
  const pipeline = evidence?.scoringPipeline;
  return pipelineRuntimeMatches(evidence, runtime)
    && pipeline?.status === "verified"
    && pipeline.manifestDigest === golden.manifestDigest
    && pipeline.reviewedLabelManifestDigest === golden.reviewedLabelManifestDigest
    && golden.normalizerManifestDigest === normalizer.provenance.manifestDigest
    && golden.bindings.rulesVersion === SCORING_RULES_VERSION
    && golden.bindings.taxonomyVersion === TAXONOMY_VERSION
    && golden.bindings.pipelineVersion === SCORING_PIPELINE_VERSION
    && pipeline.normalizerVersion === normalizer.version
    && pipeline.normalizerVersion === golden.bindings.normalizerVersion
    && pipeline.pipelineVersion === golden.bindings.pipelineVersion
    && pipeline.rulesVersion === golden.bindings.rulesVersion
    && pipeline.taxonomyVersion === golden.bindings.taxonomyVersion
    && normalizer.provenance.taxonomyVersion === golden.bindings.taxonomyVersion
    && normalizer.scoringNormalizer.version === normalizer.version
    && sha256Digest(normalizer.scoringNormalizer) === sha256Digest(REFERENCE_SCORING_NORMALIZER)
    && reviewLabelsMatchManifest(golden)
    && allGoldenCasesRecompute(golden, normalizer);
}

function qualifyingCases(golden: GoldenCaseSet, normalizer: NormalizerSnapshot, evidence: ReleaseEvidence | null, runtime: ProtectedReleaseRuntime | null): GoldenCase[] {
  if (golden.dataClassification !== "blind_reviewed_public" || !pipelineBindingsMatch(golden, normalizer, evidence, runtime)) return [];
  const seenInputs = new Set<string>();
  return golden.cases.filter((item) => {
    const recomputed = recomputeGoldenCase(item, normalizer.scoringNormalizer);
    if (recomputed?.currentScore !== item.currentScore
      || recomputed.inputDigest !== item.scoringInputDigest
      || recomputed.outputDigest !== item.scoringOutputDigest
      || recomputed.repositoryType !== item.repositoryType
      || seenInputs.has(recomputed.inputDigest)) return false;
    seenInputs.add(recomputed.inputDigest);
    return item.review.blinded
      && item.review.reviewerCount >= 1
      && item.review.provenance.source === "independent_blind_review";
  });
}

function normalizerCoverage(normalizer: NormalizerSnapshot): { cohorts: number; ecosystems: number; complete: boolean } {
  const types = new Set(normalizer.cohorts.map((cohort) => cohort.keys.type));
  const ages = new Set(normalizer.cohorts.map((cohort) => cohort.keys.ageBand));
  const stars = new Set(normalizer.cohorts.map((cohort) => cohort.keys.starBand));
  const ecosystems = new Set(normalizer.cohorts.map((cohort) => cohort.keys.ecosystem));
  const everyCohortSubstantial = normalizer.cohorts.every((cohort) => cohort.repositoryCount >= 25);
  const largest = Math.max(0, ...normalizer.cohorts.map((cohort) => cohort.repositoryCount));
  const noSingleCohortDominates = normalizer.repositoryCount > 0 && largest / normalizer.repositoryCount <= 0.5;
  return {
    cohorts: normalizer.cohorts.length,
    complete: normalizer.cohorts.length >= 24
      && types.size === REPOSITORY_TYPES.length
      && ages.size === 3
      && stars.size === 4
      && ecosystems.size >= 3
      && everyCohortSubstantial
      && noSingleCohortDominates,
    ecosystems: ecosystems.size,
  };
}

export function evaluateReleaseGate(normalizer: NormalizerSnapshot, golden: GoldenCaseSet, releaseEvidenceInput?: unknown, protectedRuntimeInput?: unknown): ReleaseGate {
  const parsedEvidence = releaseEvidenceSchema.safeParse(releaseEvidenceInput);
  const evidence = parsedEvidence.success ? parsedEvidence.data : null;
  const parsedRuntime = protectedReleaseRuntimeSchema.safeParse(protectedRuntimeInput);
  const runtime = parsedRuntime.success ? parsedRuntime.data : null;
  const cases = qualifyingCases(golden, normalizer, evidence, runtime);
  const evaluation = evaluateCases(cases);
  // Abstentions remain blind-reviewed audit cases, but never count as numeric
  // predictions or satisfy the minimum scoreable ordinary/risk populations.
  const ordinaryCases = cases.filter((item) => item.currentScore !== null && item.expected === "ordinary").length;
  const riskCases = cases.filter((item) => item.currentScore !== null && item.expected === "risk").length;
  const balancedTypes = REPOSITORY_TYPES.filter((type) => {
    const ofType = cases.filter((item) => item.repositoryType === type);
    return ofType.filter((item) => item.expected === "ordinary").length >= 5
      && ofType.filter((item) => item.expected === "risk").length >= 5;
  }).length;
  const populationReady = cases.length >= 120 && ordinaryCases >= 80 && riskCases >= 40 && balancedTypes === REPOSITORY_TYPES.length;
  const at60 = evaluation.thresholds["60"].falsePositiveRate95Ci.high;
  const at80 = evaluation.thresholds["80"].falsePositiveRate95Ci.high;
  const claims = {
    falsePositiveAt60Supported: populationReady && at60 !== null && at60 <= 0.05,
    falsePositiveAt80Supported: populationReady && at80 !== null && at80 <= 0.01,
  };
  const coverage = normalizerCoverage(normalizer);
  const publicNormalizer = normalizer.dataClassification === "public_aggregate"
    && normalizer.provenance.source === "public_github_aggregate";
  const reasons: string[] = [];
  if (!publicNormalizer) reasons.push("normalizer_provenance_not_public_aggregate");
  if (normalizer.repositoryCount < 5_000) reasons.push("public_aggregate_repository_count_below_5000");
  if (!coverage.complete) reasons.push("normalizer_stratified_coverage_incomplete");
  if (!parsedEvidence.success) reasons.push("release_evidence_invalid_or_missing");
  if (!parsedRuntime.success || !pipelineRuntimeMatches(evidence, runtime)) reasons.push("protected_release_runtime_not_verified_or_unbound");
  if (!pipelineBindingsMatch(golden, normalizer, evidence, runtime)) reasons.push("production_scoring_pipeline_not_verified_or_unbound");
  if (cases.length < 120) reasons.push("qualifying_blind_reviewed_case_count_below_120");
  if (ordinaryCases < 80) reasons.push("qualifying_ordinary_case_count_below_80");
  if (riskCases < 40) reasons.push("qualifying_risk_case_count_below_40");
  if (balancedTypes < REPOSITORY_TYPES.length) reasons.push("per_type_case_balance_incomplete");
  if (!claims.falsePositiveAt60Supported && !claims.falsePositiveAt80Supported) reasons.push("false_positive_claim_not_supported_by_wilson_95ci");
  if (!copilotRuntimeMatches(evidence, runtime)) reasons.push("live_copilot_entitlement_matrix_not_verified");
  if (!securityRuntimeMatches(evidence, runtime)) reasons.push("high_severity_security_review_not_verified");
  return {
    claims,
    evaluation,
    reasons,
    requirements: {
      cohortCoverage: { actual: coverage.cohorts, minimum: 24 },
      ecosystems: { actual: coverage.ecosystems, minimum: 3 },
      ordinaryCases: { actual: ordinaryCases, minimum: 80 },
      perTypeBalanced: { actual: balancedTypes, minimum: 6 },
      publicAggregateRepositories: { actual: publicNormalizer ? normalizer.repositoryCount : 0, minimum: 5_000 },
      qualifyingBlindReviewedCases: { actual: cases.length, minimum: 120 },
      riskCases: { actual: riskCases, minimum: 40 },
    },
    status: reasons.length === 0 ? "beta_ready" : "pre_beta_not_ready",
  };
}
