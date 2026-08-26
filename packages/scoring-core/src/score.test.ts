import { createEvidenceId, reportSnapshotSchema, type DataStatus, type Evidence, type JsonValue } from "@dayu/evidence-schema";
import type { RepositoryClassification } from "@dayu/repository-taxonomy";
import { describe, expect, it } from "vitest";

import { enhancedConfidence, ruleConfidence } from "./confidence.js";
import { cohortPercentileRisk, scoreEnhanced, scoreRules, weightedAvailableScore } from "./score.js";
import type { AiFinding, NormalizerSnapshot, ScoreRulesInput } from "./types.js";

const SHA = "abcdef1234567890";
const OBSERVED = "2026-08-25T00:00:00.000Z";

function evidence(metric: string, value: JsonValue, options: { status?: DataStatus; path?: string; limitations?: string[] } = {}): Evidence {
  const path = options.path ?? `/repos/owner/repo/${metric}`;
  const kind = metric === "repository.file_content" || metric === "repository.tree" ? "file" : "metadata";
  return {
    fact: { metric, value },
    id: createEvidenceId({ commitSha: SHA, kind, path, repoId: 1 }),
    kind,
    limitations: options.limitations ?? [],
    observedAt: OBSERVED,
    repository: { fullName: "owner/repo", id: 1 },
    schemaVersion: "1",
    source: kind === "file"
      ? { commitSha: SHA, kind: "file", path }
      : { endpoint: path, kind: "api", queryHash: "query" },
    status: options.status ?? "complete",
    summary: metric,
    value,
  };
}

const classification: RepositoryClassification = {
  confidence: 0.9,
  coverage: { ratio: 1, scopes: { content: "complete", languages: "complete", metadata: "complete", tree: "complete" } },
  evidenceIds: [],
  modifiers: [],
  scoreMode: "normal",
  type: "software",
};

const normalizer: NormalizerSnapshot = {
  bands: {
    "popularity.contributors": { p80Deficit: 0.1, p99Deficit: 1 },
    "popularity.forks": { p80Deficit: 0.1, p99Deficit: 1 },
    "popularity.human_activity": { p80Deficit: 0.1, p99Deficit: 1 },
    "popularity.subscribers": { p80Deficit: 0.1, p99Deficit: 1 },
  },
  confidence: 0.9,
  version: "cohort-1",
};

function fullEvidence(overrides: { metadataStatus?: DataStatus; treeStatus?: DataStatus; newRepo?: boolean; externalTracker?: boolean; botOnlyPulls?: boolean } = {}): Evidence[] {
  const createdAt = overrides.newRepo ? "2026-08-10T00:00:00Z" : "2020-01-01T00:00:00Z";
  const readme = overrides.externalTracker
    ? "# Product\nProduction ready. Install with npm. Issues are tracked at linear.app/acme/team."
    : "# Product\nProduction ready. Install with npm.";
  return [
    evidence("repository.metadata", {
      archived: false,
      createdAt,
      defaultBranch: "main",
      fork: false,
      forks: 0,
      isTemplate: false,
      openIssues: 0,
      pushedAt: "2020-02-01T00:00:00Z",
      stars: 10_000,
      subscribers: 0,
      updatedAt: "2020-02-01T00:00:00Z",
    }, { ...(overrides.metadataStatus === undefined ? {} : { status: overrides.metadataStatus }) }),
    evidence("repository.default_commit", { sha: SHA }),
    evidence("repository.tree", {
      apiTruncated: overrides.treeStatus === "partial",
      completeForNegativeEvidence: overrides.treeStatus !== "partial",
      files: [{ path: "README.md", size: 100, type: "blob" }],
      observedEntries: 1,
    }, { limitations: overrides.treeStatus === "partial" ? ["github_tree_truncated"] : [], path: "/tree", ...(overrides.treeStatus === undefined ? {} : { status: overrides.treeStatus }) }),
    evidence("repository.file_content", { bytes: readme.length, path: "README.md", text: readme }, { path: "README.md" }),
    evidence("repository.community_profile", { healthPercentage: 5 }),
    evidence("repository.issues", { count: 0, items: [] }),
    evidence("repository.pull_requests", {
      count: overrides.botOnlyPulls ? 1 : 0,
      items: overrides.botOnlyPulls ? [{ authorType: "Bot", comments: 8, id: 1, state: "closed" }] : [],
    }),
    evidence("repository.releases", { count: 0, items: [] }),
    evidence("repository.contributors", { count: 0, items: [] }),
  ];
}

function input(overrides: Partial<ScoreRulesInput> = {}): ScoreRulesInput {
  return {
    analyzedAt: OBSERVED,
    classification,
    collectorVersion: "collector-1",
    evidence: fullEvidence(),
    expiresAt: "2026-08-25T00:30:00.000Z",
    normalizer,
    rulesVersion: "rules-1",
    ...overrides,
  };
}

function contradictedAi(report: ReturnType<typeof scoreRules>): AiFinding[] {
  const evidenceId = report.evidence[0]?.id;
  if (evidenceId === undefined) throw new Error("fixture evidence missing");
  return (["substance", "maintenance", "community", "claims"] as const).map((dimension) => ({
    counterEvidenceIds: [evidenceId],
    dimension,
    en: "The claim is contradicted by the cited public evidence.",
    evidenceIds: [evidenceId],
    rubricId: `ai.${dimension}`,
    verdict: "contradicted",
    zh: "公开证据与该声明不一致。",
  }));
}

describe("score composition", () => {
  it("uses the exact 70/30 enhanced contribution matrix", () => {
    const baseline = scoreRules(input());
    const rulesReport = {
      ...baseline,
      availableWeight: 0.7,
      baseScore: 100,
      dimensionAvailableWeights: { claims: 0.05, community: 0.1, maintenance: 0.15, popularity: 0.25, substance: 0.15 },
      dimensionScores: { claims: 100, community: 100, maintenance: 100, popularity: 100, substance: 100 },
      score: 100,
      scoreKind: "rules_only" as const,
    };
    expect(scoreEnhanced({ aiConfidence: { applicableCoverage: 1, evidenceScopeCompleteness: 1, sampleAdequacy: 1 }, aiFindings: contradictedAi(rulesReport), rulesReport }).score).toBe(100);
  });

  it("normalizes the available 70 percent into the rules-only signal", () => {
    expect(weightedAvailableScore([
      { dimension: "popularity", risk: 100, weight: 0.25 },
      { dimension: "substance", risk: 100, weight: 0.15 },
      { dimension: "maintenance", risk: 100, weight: 0.15 },
      { dimension: "community", risk: 100, weight: 0.1 },
      { dimension: "claims", risk: 100, weight: 0.05 },
    ])).toBe(100);
  });

  it("withholds a precise score below 60 percent available weight", () => {
    const report = scoreRules(input({ evidence: fullEvidence().filter((item) => item.fact.metric === "repository.metadata" || item.fact.metric === "repository.default_commit") }));
    expect(report.scoreKind).toBe("insufficient_evidence");
    expect(report.score).toBeNull();
    expect(report.baseScore).toBeNull();
  });

  it("calculates the published confidence formulas exactly", () => {
    expect(ruleConfidence({ cohort: 0.9, data: 0.8, taxonomy: 0.7 })).toBe(81);
    expect(enhancedConfidence(80, 70)).toBe(77);
  });

  it("normalizes cohort deficits only after the 80th percentile", () => {
    expect(cohortPercentileRisk(0.1, { p80Deficit: 0.1, p99Deficit: 1 })).toBe(0);
    expect(cohortPercentileRisk(0.55, { p80Deficit: 0.1, p99Deficit: 1 })).toBe(50);
    expect(cohortPercentileRisk(1, { p80Deficit: 0.1, p99Deficit: 1 })).toBe(100);
  });

  it("produces a report accepted by the shared schema", () => {
    expect(reportSnapshotSchema.safeParse(scoreRules(input())).success).toBe(true);
  });

  it("keeps every overall score null when deterministic coverage is 59 percent", () => {
    const sparse = fullEvidence().filter((item) => ["repository.metadata", "repository.default_commit", "repository.tree", "repository.file_content"].includes(item.fact.metric));
    const baseline = scoreRules(input({ evidence: sparse }));
    const rulesReport = {
      ...baseline,
      availableWeight: 0.59,
      baseScore: null,
      dimensionAvailableWeights: { claims: 0.04, community: 0.08, maintenance: 0.13, popularity: 0.21, substance: 0.13 },
      score: null,
      scoreKind: "insufficient_evidence" as const,
    };
    expect(rulesReport.baseScore).toBeNull();
    const report = scoreEnhanced({
      aiConfidence: { applicableCoverage: 1, evidenceScopeCompleteness: 1, sampleAdequacy: 1 },
      aiFindings: contradictedAi(rulesReport),
      rulesReport,
    });
    expect(report.availableWeight).toBe(0.59);
    expect(report.scoreKind).toBe("insufficient_evidence");
    expect(report).toMatchObject({ baseScore: null, enrichedScore: undefined, score: null });
    expect(report.findings.some((finding) => finding.producer === "copilot")).toBe(true);
    expect(reportSnapshotSchema.safeParse(report).success).toBe(true);
  });
});

export { classification, fullEvidence, input, normalizer };
