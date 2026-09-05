import { readFileSync } from "node:fs";

import { createEvidenceId, type Evidence, type JsonValue } from "@dayu/evidence-schema";
import { REFERENCE_SCORING_NORMALIZER, SCORING_RULES_VERSION } from "@dayu/scoring-core";
import { TAXONOMY_VERSION } from "@dayu/repository-taxonomy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { composeReleaseEvidence } from "./compose.js";
import { buildCohorts, type CalibrationRepository } from "./cohorts.js";
import { evaluateGoldenCases, evaluateReleaseGate, wilson95 } from "./evaluate.js";
import { recomputedManifestDigest, recomputeScoringInput, reviewLabelDigest, reviewedLabelManifestDigest, SCORING_PIPELINE_VERSION, sha256Digest } from "./recompute.js";
import { parseGoldenCaseSet, parseNormalizerSnapshot } from "./schema.js";
import { manualSecurityReviewManifestDigest, manualSecurityReviewManifestSchema, protectedManualReviewSourceDigest, securityFindingsManifestDigest, securityReviewArtifactSchema, securityReviewManifestDigest } from "./security-review.js";

const OBSERVED = "2026-08-25T00:00:00.000Z";
const RELEASE_NOW = new Date("2026-08-25T08:00:00.000Z");
const COMMIT = "abcdef1234567890";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const RELEASE_COMMIT = "d".repeat(40);
const TYPES = ["software", "docs_content", "data_model", "template", "creative_demo", "generic"] as const;

beforeEach(() => {
  vi.useFakeTimers({ now: RELEASE_NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

function evidence(repoId: number, fullName: string, metric: string, value: JsonValue, path = metric): Evidence {
  const kind = metric === "repository.tree" || metric === "repository.file_content" ? "file" : metric === "repository.default_commit" ? "commit" : "metadata";
  return {
    fact: { metric, value },
    id: createEvidenceId({ commitSha: COMMIT, kind, path, repoId }),
    kind,
    limitations: [],
    observedAt: OBSERVED,
    repository: { fullName, id: repoId },
    schemaVersion: "1",
    source: kind === "file" ? { commitSha: COMMIT, kind: "file", path } : { endpoint: `/repos/${fullName}/${path}`, kind: "api", queryHash: "golden-v1" },
    status: "complete",
    summary: metric,
    value,
  };
}

function filesFor(type: typeof TYPES[number]): string[] {
  switch (type) {
    case "software": return ["package.json", "src/index.ts", "tests/index.test.ts", "README.md", "LICENSE"];
    case "docs_content": return ["mkdocs.yml", "docs/index.md", "docs/guide.md", "README.md", "LICENSE"];
    case "data_model": return ["model-index.yml", "model_card.md", "data/sample.parquet", "README.md", "LICENSE"];
    case "template": return ["template/package.json", "template/src/index.ts", "README.md", "LICENSE"];
    case "creative_demo": return ["sketch.pde", "index.html", "assets/scene.png", "README.md", "LICENSE"];
    case "generic": return ["README", "LICENSE"];
  }
}

function scoringInput(index: number, type: typeof TYPES[number]) {
  const repoId = index + 1;
  const fullName = `golden/repo-${String(repoId)}`;
  const paths = filesFor(type);
  const metadata = {
    archived: false,
    createdAt: "2020-01-01T00:00:00Z",
    defaultBranch: "main",
    fork: false,
    forks: 8,
    isTemplate: type === "template",
    mirror: false,
    openIssues: 2,
    pushedAt: "2026-08-20T00:00:00Z",
    stars: 50,
    subscribers: 4,
    updatedAt: "2026-08-20T00:00:00Z",
  };
  const evidenceItems = [
    evidence(repoId, fullName, "repository.metadata", metadata),
    evidence(repoId, fullName, "repository.default_commit", { sha: COMMIT }),
    evidence(repoId, fullName, "repository.tree", { apiTruncated: false, completeForNegativeEvidence: true, files: paths.map((path) => ({ path, size: 100, type: "blob" })), observedEntries: paths.length }, "tree"),
    evidence(repoId, fullName, "repository.file_content", { bytes: 44, path: "README.md", text: "# Project\nInstall, test, and contribute safely." }, "README.md"),
    evidence(repoId, fullName, "repository.community_profile", { healthPercentage: 100 }),
    evidence(repoId, fullName, "repository.issues", { count: 2, items: [{ authorType: "User", comments: 2, id: 1, state: "open" }] }),
    evidence(repoId, fullName, "repository.pull_requests", { count: 2, items: [{ authorType: "User", comments: 2, id: 2, state: "closed" }] }),
    evidence(repoId, fullName, "repository.releases", { count: 1, items: [{ publishedAt: "2026-08-01T00:00:00Z", tagName: "v1.0.0" }] }),
    evidence(repoId, fullName, "repository.contributors", { count: 5, items: [] }),
  ];
  return { analyzedAt: OBSERVED, collectorVersion: "collector-v1", evidence: evidenceItems, expiresAt: "2026-08-25T00:30:00.000Z", locale: "en" as const };
}

function publicNormalizer() {
  const cohorts = TYPES.flatMap((type, typeIndex) => ["0-99", "100-999", "1k-9,999", "10k+"].map((starBand, starIndex) => ({
    keys: {
      ageBand: (["0-179d", "180-729d", "730d+"] as const)[(typeIndex + starIndex) % 3],
      ecosystem: ["typescript", "python", "rust"][(typeIndex + starIndex) % 3],
      starBand,
      type,
    },
    metrics: { contributors: { p50: 1, p80: 2, p95: 3, p99: 4 } },
    repositoryCount: typeIndex === 5 && starIndex === 3 ? 400 : 200,
  })));
  return parseNormalizerSnapshot({
    cohorts,
    dataClassification: "public_aggregate",
    generatedAt: OBSERVED,
    immutable: true,
    provenance: { collectorVersion: "collector-v1", manifestDigest: DIGEST_A, source: "public_github_aggregate", taxonomyVersion: TAXONOMY_VERSION },
    repositoryCount: 5_000,
    schemaVersion: "1",
    scoringNormalizer: REFERENCE_SCORING_NORMALIZER,
    version: REFERENCE_SCORING_NORMALIZER.version,
  });
}

function productionGolden(normalizer: ReturnType<typeof publicNormalizer>, allFactsOnly = false) {
  const rawCases = Array.from({ length: 150 }, (_, index) => {
    const expected = index < 96 ? "ordinary" as const : "risk" as const;
    const input = scoringInput(index, allFactsOnly ? "generic" : TYPES[index % TYPES.length] ?? "generic");
    const recomputed = recomputeScoringInput(input, normalizer.scoringNormalizer);
    if (recomputed === null) throw new Error("fixture must produce a score");
    return {
      challengeTags: ["current-rules-replay"],
      currentScore: recomputed.currentScore,
      scoreKind: recomputed.report.scoreKind,
      expected,
      id: `case_${String(index)}`,
      previousScore: null,
      repositoryType: recomputed.repositoryType,
      review: { blinded: true, provenance: { manifestDigest: DIGEST_A, protocolVersion: "blind-review-v1", source: "independent_blind_review" }, reviewerCount: 1 },
      scoringInput: input,
      scoringInputDigest: recomputed.inputDigest,
      scoringOutputDigest: recomputed.outputDigest,
    };
  });
  const base = {
    bindings: { normalizerVersion: normalizer.version, pipelineVersion: SCORING_PIPELINE_VERSION, rulesVersion: SCORING_RULES_VERSION, taxonomyVersion: TAXONOMY_VERSION },
    cases: rawCases,
    dataClassification: "blind_reviewed_public" as const,
    generatedAt: OBSERVED,
    immutable: true as const,
    manifestDigest: DIGEST_A,
    normalizerManifestDigest: normalizer.provenance.manifestDigest,
    reviewedLabelManifestDigest: DIGEST_A,
    schemaVersion: "1" as const,
    version: "golden-v1",
  };
  const provisional = parseGoldenCaseSet(base);
  const reviewedCases = provisional.cases.map((item) => ({ ...item, review: { ...item.review, provenance: { ...item.review.provenance, manifestDigest: reviewLabelDigest(item) } } }));
  const reviewed = parseGoldenCaseSet({ ...base, cases: reviewedCases });
  const manifestDigest = recomputedManifestDigest(reviewed, normalizer.scoringNormalizer);
  if (manifestDigest === null) throw new Error("manifest recomputation failed");
  return parseGoldenCaseSet({ ...base, cases: reviewedCases, manifestDigest, reviewedLabelManifestDigest: reviewedLabelManifestDigest(reviewed) });
}

function passingManualSecurityReview(runtime: { commitSha: string; workflowRunId: string }, findings: { count: number; id: string; severity: "critical" | "high" | "low" | "moderate"; status: "resolved" | "unresolved" }[] = [], expiresAt = "2026-08-26T00:00:00.000Z") {
  const sourceBase = {
    expiresAt,
    findings,
    generatedAt: OBSERVED,
    immutable: true as const,
    review: { reviewerCount: 2, scopeDigest: sha256Digest({ scope: "release-security-review" }) },
    reviewedCommitSha: runtime.commitSha,
    schemaVersion: "1" as const,
  };
  const sourceDigest = protectedManualReviewSourceDigest(sourceBase);
  const manifestBase = { commitSha: runtime.commitSha, expiresAt: sourceBase.expiresAt, findings, generatedAt: OBSERVED, immutable: true as const, review: sourceBase.review, schemaVersion: "1" as const, sourceDigest, sourceGeneratedAt: sourceBase.generatedAt, workflowRunId: runtime.workflowRunId };
  return manualSecurityReviewManifestSchema.parse({ ...manifestBase, manifestDigest: manualSecurityReviewManifestDigest(manifestBase) });
}

function passingSecurityArtifact(runtime: { commitSha: string; workflowRunId: string }, manualSecurityReview: ReturnType<typeof passingManualSecurityReview>) {
  const base = {
    commitSha: runtime.commitSha,
    findings: manualSecurityReview.findings.map((finding) => ({ ...finding, source: "manual_review" as const })),
    generatedAt: OBSERVED,
    manualReviewManifestDigest: manualSecurityReview.manifestDigest,
    reviewAttestations: (["dependency_audit", "license_policy", "manual_security_review", "secret_scan"] as const).map((control) => ({ control, evidenceDigest: control === "manual_security_review" ? manualSecurityReview.manifestDigest : sha256Digest({ control, outcome: "pass" }), outcome: "pass" as const })),
    schemaVersion: "1" as const,
    workflowRunId: runtime.workflowRunId,
  };
  const withManifests = { ...base, findingsManifestDigest: securityFindingsManifestDigest(base), reviewManifestDigest: securityReviewManifestDigest(base) };
  return securityReviewArtifactSchema.parse({ ...withManifests, artifactDigest: sha256Digest(withManifests) });
}

function releaseArtifacts(golden: ReturnType<typeof productionGolden>, normalizer: ReturnType<typeof publicNormalizer>) {
  const runtime = { commitSha: RELEASE_COMMIT, workflowRunId: "12345" };
  const runs = (["free", "pro", "organization_managed"] as const).map((account) => ({ account, analysisDigest: sha256Digest({ account }), evidenceDigest: sha256Digest({ probe: true }), repositoryPermissions: "none" as const, requestedScopes: [] as [], subjectDigest: sha256Digest({ account, userId: `${account}-subject` }) }));
  const attestationBase = { auditSource: "github_protected_environment_registry" as const, commitSha: runtime.commitSha, runs: runs.map(({ account, subjectDigest }) => ({ account, subjectDigest })), workflowRunId: runtime.workflowRunId };
  const accountClassAttestation = { ...attestationBase, manifestDigest: sha256Digest(attestationBase) };
  const unsigned = {
    accountClassAttestation,
    commitSha: runtime.commitSha,
    generatedAt: OBSERVED,
    runs,
    schemaVersion: "1" as const,
    workflowRunId: runtime.workflowRunId,
  };
  const copilotArtifact = { ...unsigned, artifactDigest: sha256Digest(unsigned) };
  const manualSecurityReview = passingManualSecurityReview(runtime);
  const securityArtifact = passingSecurityArtifact(runtime, manualSecurityReview);
  const releaseEvidence = composeReleaseEvidence({ copilotArtifact, golden, manualSecurityReview, normalizer, runtime, securityArtifact });
  return { copilotArtifact, manualSecurityReview, releaseEvidence, runtime: { ...runtime, source: "github_actions_protected_environment" }, securityArtifact };
}

describe("calibration cohorts", () => {
  it("stratifies by type, age, star scale, and ecosystem", () => {
    const calibrationFixture: CalibrationRepository[] = [
      { createdAt: "2025-01-01T00:00:00.000Z", ecosystem: "TypeScript", metrics: { contributors: 4 }, repositoryType: "software", stars: 550 },
      { createdAt: "2023-01-01T00:00:00.000Z", ecosystem: "Python", metrics: { contributors: 8 }, repositoryType: "software", stars: 5_500 },
      { createdAt: "2026-07-01T00:00:00.000Z", ecosystem: "Markdown", metrics: { contributors: 2 }, repositoryType: "docs_content", stars: 42 },
    ];
    expect(buildCohorts(calibrationFixture, new Date(OBSERVED))).toHaveLength(3);
  });
});

describe("genuine release scoring", () => {
  it("requires explicit abstention provenance for null golden scores", () => {
    const golden = productionGolden(publicNormalizer());
    const unscored = golden.cases.find((item) => item.currentScore === null);
    if (unscored === undefined) throw new Error("facts-only fixture required");
    expect(unscored.scoreKind).toBe("facts_only");
    expect(() => parseGoldenCaseSet({ ...golden, cases: [{ ...unscored, scoreKind: undefined }] })).toThrow();
    expect(() => parseGoldenCaseSet({ ...golden, cases: [{ ...unscored, currentScore: 0 }] })).toThrow();
  });

  it("reports audited abstentions separately without converting them to successful predictions", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer, true);
    const diagnostic = evaluateGoldenCases(golden);
    expect(diagnostic).toMatchObject({ abstainedCaseCount: 150, scoredCaseCount: 0, perTypeScoreDistributions: {}, perTypeAbstentions: { generic: 150 } });
    expect(diagnostic.thresholds["60"]).toMatchObject({ trueNegativeCount: 0, falseNegativeCount: 0, falsePositiveCount: 0, truePositiveCount: 0, falsePositiveRate: null, falseNegativeRate: null });
    expect(diagnostic.challengeOutcomes["current-rules-replay"]).toMatchObject({ accuracy: null, abstainedCount: 150, correctCount: 0 });
    const { releaseEvidence, runtime } = releaseArtifacts(golden, normalizer);
    const gate = evaluateReleaseGate(normalizer, golden, releaseEvidence, runtime);
    expect(gate.requirements.qualifyingBlindReviewedCases.actual).toBe(150);
    expect(gate.requirements.ordinaryCases.actual).toBe(0);
    expect(gate.requirements.riskCases.actual).toBe(0);
    expect(gate.claims).toEqual({ falsePositiveAt60Supported: false, falsePositiveAt80Supported: false });
    expect(gate.status).toBe("pre_beta_not_ready");
  });

  it.each(["numeric_score", "abstention_kind", "review_label"] as const)("rejects tampered %s on a replayed facts-only case", (change) => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { releaseEvidence, runtime } = releaseArtifacts(golden, normalizer);
    const cases = golden.cases.map((item) => item.id !== "case_5" ? item
      : change === "numeric_score" ? { ...item, currentScore: 0, scoreKind: "rules_only" as const }
      : change === "abstention_kind" ? { ...item, scoreKind: "insufficient_evidence" as const }
      : { ...item, expected: "risk" as const });
    const tampered = parseGoldenCaseSet({ ...golden, cases });
    expect(reviewedLabelManifestDigest(tampered)).not.toBe(golden.reviewedLabelManifestDigest);
    const gate = evaluateReleaseGate(normalizer, tampered, releaseEvidence, runtime);
    expect(gate.status).toBe("pre_beta_not_ready");
    expect(gate.reasons).toContain("production_scoring_pipeline_not_verified_or_unbound");
  });

  it("reaches beta_ready only through current scoreRules replay and current-run evidence", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { releaseEvidence, runtime } = releaseArtifacts(golden, normalizer);
    const gate = evaluateReleaseGate(normalizer, golden, releaseEvidence, runtime);
    expect(gate.reasons).toEqual([]);
    expect(gate.status).toBe("beta_ready");
    expect(gate.evaluation.caseCount).toBe(150);
    expect(gate.evaluation.scoredCaseCount).toBe(125);
    expect(gate.evaluation.abstainedCaseCount).toBe(25);
    expect(gate.requirements.ordinaryCases.actual).toBe(80);
    expect(gate.requirements.riskCases.actual).toBe(45);
    expect(gate.claims.falsePositiveAt60Supported).toBe(true);
  });

  it.each(["score", "input", "output", "version"] as const)("fails closed for tampered %s", (kind) => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { releaseEvidence, runtime } = releaseArtifacts(golden, normalizer);
    const first = golden.cases[0];
    if (first === undefined) throw new Error("fixture missing");
    const cases = golden.cases.map((item, index) => index !== 0 ? item : kind === "score"
      ? { ...item, currentScore: item.currentScore === 100 ? 99 : (item.currentScore ?? 0) + 1 }
      : kind === "input" ? { ...item, scoringInput: { ...item.scoringInput, collectorVersion: "collector-v2" } }
      : kind === "output" ? { ...item, scoringOutputDigest: DIGEST_A }
      : item);
    const bindings = kind === "version" ? { ...golden.bindings, rulesVersion: "rules-v999" } : golden.bindings;
    const tampered = parseGoldenCaseSet({ ...golden, bindings, cases });
    expect(evaluateReleaseGate(normalizer, tampered, releaseEvidence, runtime).status).toBe("pre_beta_not_ready");
  });

  it.each(["expected", "labels", "review", "provenance", "provenance_manifest"] as const)("fails closed for tampered reviewed %s", (kind) => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { releaseEvidence, runtime } = releaseArtifacts(golden, normalizer);
    const cases = golden.cases.map((item, index) => index !== 0 ? item
      : kind === "expected" ? { ...item, expected: item.expected === "ordinary" ? "risk" as const : "ordinary" as const }
      : kind === "labels" ? { ...item, challengeTags: ["tampered-label"] }
      : kind === "review" ? { ...item, review: { ...item.review, reviewerCount: item.review.reviewerCount + 1 } }
      : kind === "provenance" ? { ...item, review: { ...item.review, provenance: { ...item.review.provenance, protocolVersion: "blind-review-v2" } } }
      : { ...item, review: { ...item.review, provenance: { ...item.review.provenance, manifestDigest: DIGEST_A } } });
    const tampered = parseGoldenCaseSet({ ...golden, cases });
    const gate = evaluateReleaseGate(normalizer, tampered, releaseEvidence, runtime);
    expect(gate.status).toBe("pre_beta_not_ready");
    expect(gate.reasons).toContain("production_scoring_pipeline_not_verified_or_unbound");
  });

  it("rejects a padded review population with one ordinary case", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { releaseEvidence, runtime } = releaseArtifacts(golden, normalizer);
    const padded = parseGoldenCaseSet({ ...golden, cases: golden.cases.map((item, index) => ({ ...item, expected: index === 0 ? "ordinary" : "risk" })) });
    const gate = evaluateReleaseGate(normalizer, padded, releaseEvidence, runtime);
    expect(gate.status).toBe("pre_beta_not_ready");
    expect(gate.reasons).toContain("qualifying_ordinary_case_count_below_80");
  });

  it("rejects a stale workflow artifact and fake release assertion", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { releaseEvidence, runtime } = releaseArtifacts(golden, normalizer);
    expect(evaluateReleaseGate(normalizer, golden, releaseEvidence, { ...runtime, workflowRunId: "99999" }).status).toBe("pre_beta_not_ready");
    expect(evaluateReleaseGate(normalizer, golden, true, runtime).status).toBe("pre_beta_not_ready");
  });

  it("rejects a forged live Copilot artifact digest", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { copilotArtifact, manualSecurityReview, securityArtifact } = releaseArtifacts(golden, normalizer);
    expect(() => composeReleaseEvidence({
      copilotArtifact: { ...copilotArtifact, artifactDigest: DIGEST_A },
      golden,
      manualSecurityReview,
      normalizer,
      runtime: { commitSha: RELEASE_COMMIT, workflowRunId: "12345" },
      securityArtifact,
    })).toThrow("copilot_artifact_or_account_class_manifest_mismatch");
  });

  it("rejects the same GitHub account reused for multiple Copilot classes", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { copilotArtifact, manualSecurityReview, securityArtifact } = releaseArtifacts(golden, normalizer);
    const duplicate = copilotArtifact.runs.map((run, index) => index === 1 ? { ...run, subjectDigest: copilotArtifact.runs[0]?.subjectDigest ?? DIGEST_A } : run);
    expect(() => composeReleaseEvidence({ copilotArtifact: { ...copilotArtifact, runs: duplicate }, golden, manualSecurityReview, normalizer, runtime: { commitSha: RELEASE_COMMIT, workflowRunId: "12345" }, securityArtifact })).toThrow();
  });

  it("rejects a tampered Copilot account-class assignment", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { copilotArtifact, manualSecurityReview, securityArtifact } = releaseArtifacts(golden, normalizer);
    const swapped = copilotArtifact.runs.map((run) => ({ ...run, account: run.account === "free" ? "pro" as const : run.account === "pro" ? "free" as const : run.account }));
    const withoutDigest = { accountClassAttestation: copilotArtifact.accountClassAttestation, commitSha: copilotArtifact.commitSha, generatedAt: copilotArtifact.generatedAt, runs: swapped, schemaVersion: copilotArtifact.schemaVersion, workflowRunId: copilotArtifact.workflowRunId };
    expect(() => composeReleaseEvidence({ copilotArtifact: { ...withoutDigest, artifactDigest: sha256Digest(withoutDigest) }, golden, manualSecurityReview, normalizer, runtime: { commitSha: RELEASE_COMMIT, workflowRunId: "12345" }, securityArtifact })).toThrow();
  });

  it("rejects tampered security findings and review provenance", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { copilotArtifact, manualSecurityReview, securityArtifact } = releaseArtifacts(golden, normalizer);
    const tamperedFinding = { ...securityArtifact, findings: [{ count: 1, id: "dependency-high", severity: "high" as const, source: "pnpm_audit" as const, status: "unresolved" as const }] };
    expect(() => composeReleaseEvidence({ copilotArtifact, golden, manualSecurityReview, normalizer, runtime: { commitSha: RELEASE_COMMIT, workflowRunId: "12345" }, securityArtifact: tamperedFinding })).toThrow("security_review_manifest_mismatch");
    const tamperedReview = { ...securityArtifact, reviewAttestations: securityArtifact.reviewAttestations.map((review, index) => index === 0 ? { ...review, evidenceDigest: DIGEST_A } : review) };
    expect(() => composeReleaseEvidence({ copilotArtifact, golden, manualSecurityReview, normalizer, runtime: { commitSha: RELEASE_COMMIT, workflowRunId: "12345" }, securityArtifact: tamperedReview })).toThrow("security_review_manifest_mismatch");
  });

  it("rejects a validly manifested unresolved high-severity finding", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { copilotArtifact } = releaseArtifacts(golden, normalizer);
    const runtime = { commitSha: RELEASE_COMMIT, workflowRunId: "12345" };
    const manualSecurityReview = passingManualSecurityReview(runtime, [{ count: 1, id: "manual-high", severity: "high", status: "unresolved" }]);
    const securityArtifact = passingSecurityArtifact(runtime, manualSecurityReview);
    expect(() => composeReleaseEvidence({ copilotArtifact, golden, manualSecurityReview, normalizer, runtime, securityArtifact })).toThrow("unresolved_high_or_critical_security_findings");
  });

  it("rejects a missing protected manual security review", () => {
    expect(() => manualSecurityReviewManifestSchema.parse(undefined)).toThrow();
  });

  it.each(["expired", "expiry_boundary", "tampered", "source_tampered", "wrong_commit"] as const)("fails closed for %s protected manual security review", (kind) => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { copilotArtifact, manualSecurityReview, securityArtifact } = releaseArtifacts(golden, normalizer);
    const runtime = { commitSha: RELEASE_COMMIT, workflowRunId: "12345" };
    const changed = kind === "expired"
      ? passingManualSecurityReview(runtime, [], "2026-08-25T00:00:01.000Z")
      : kind === "expiry_boundary" ? passingManualSecurityReview(runtime, [], RELEASE_NOW.toISOString())
      : kind === "tampered" ? { ...manualSecurityReview, manifestDigest: DIGEST_A }
      : kind === "source_tampered" ? (() => {
        const unsigned = { commitSha: manualSecurityReview.commitSha, expiresAt: manualSecurityReview.expiresAt, findings: manualSecurityReview.findings, generatedAt: manualSecurityReview.generatedAt, immutable: manualSecurityReview.immutable, review: manualSecurityReview.review, schemaVersion: manualSecurityReview.schemaVersion, sourceDigest: DIGEST_A, sourceGeneratedAt: manualSecurityReview.sourceGeneratedAt, workflowRunId: manualSecurityReview.workflowRunId };
        return manualSecurityReviewManifestSchema.parse({ ...unsigned, manifestDigest: manualSecurityReviewManifestDigest(unsigned) });
      })()
      : passingManualSecurityReview({ ...runtime, commitSha: "e".repeat(40) });
    expect(() => composeReleaseEvidence({ copilotArtifact, golden, manualSecurityReview: changed, normalizer, runtime, securityArtifact })).toThrow();
  });

  it("accepts a manifested resolved manual high finding without hiding it", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { copilotArtifact } = releaseArtifacts(golden, normalizer);
    const runtime = { commitSha: RELEASE_COMMIT, workflowRunId: "12345" };
    const manualSecurityReview = passingManualSecurityReview(runtime, [{ count: 1, id: "manual-high-resolved", severity: "high", status: "resolved" }]);
    const securityArtifact = passingSecurityArtifact(runtime, manualSecurityReview);
    const releaseEvidence = composeReleaseEvidence({ copilotArtifact, golden, manualSecurityReview, normalizer, runtime, securityArtifact });
    expect(releaseEvidence.securityReview.status).toBe("verified");
    if (releaseEvidence.securityReview.status !== "verified") throw new Error("verified review required");
    expect(releaseEvidence.securityReview.findings).toContainEqual(expect.objectContaining({ id: "manual-high-resolved", status: "resolved" }));
  });

  it("rejects a manual finding omitted from the merged security artifact", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { copilotArtifact } = releaseArtifacts(golden, normalizer);
    const runtime = { commitSha: RELEASE_COMMIT, workflowRunId: "12345" };
    const manualSecurityReview = passingManualSecurityReview(runtime, [{ count: 1, id: "manual-moderate", severity: "moderate", status: "unresolved" }]);
    const emptyManualReview = passingManualSecurityReview(runtime);
    const securityArtifact = passingSecurityArtifact(runtime, emptyManualReview);
    expect(() => composeReleaseEvidence({ copilotArtifact, golden, manualSecurityReview, normalizer, runtime, securityArtifact })).toThrow("manual_security_review_not_merged");
  });

  it("revalidates Copilot classes and security manifests inside the evaluator", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { releaseEvidence, runtime } = releaseArtifacts(golden, normalizer);
    if (releaseEvidence.copilotMatrix.status !== "verified" || releaseEvidence.securityReview.status !== "verified") throw new Error("verified fixture required");
    const swappedRuns = releaseEvidence.copilotMatrix.runs.map((run) => ({ ...run, account: run.account === "free" ? "pro" as const : run.account === "pro" ? "free" as const : run.account }));
    expect(evaluateReleaseGate(normalizer, golden, { ...releaseEvidence, copilotMatrix: { ...releaseEvidence.copilotMatrix, runs: swappedRuns } }, runtime).status).toBe("pre_beta_not_ready");
    const changedFindings = [{ count: 1, id: "manual-high", severity: "high" as const, source: "manual_review" as const, status: "unresolved" as const }];
    expect(evaluateReleaseGate(normalizer, golden, { ...releaseEvidence, securityReview: { ...releaseEvidence.securityReview, findings: changedFindings } }, runtime).status).toBe("pre_beta_not_ready");
    const changedReviews = releaseEvidence.securityReview.reviewAttestations.map((review, index) => index === 0 ? { ...review, evidenceDigest: DIGEST_A } : review);
    expect(evaluateReleaseGate(normalizer, golden, { ...releaseEvidence, securityReview: { ...releaseEvidence.securityReview, reviewAttestations: changedReviews } }, runtime).status).toBe("pre_beta_not_ready");
  });

  it("rejects three duplicate security controls even when every digest is recomputed", () => {
    const normalizer = publicNormalizer();
    const golden = productionGolden(normalizer);
    const { releaseEvidence, runtime } = releaseArtifacts(golden, normalizer);
    if (releaseEvidence.securityReview.status !== "verified") throw new Error("verified fixture required");
    const duplicateReviews = releaseEvidence.securityReview.reviewAttestations.map((review) => ({ ...review, control: "dependency_audit" as const }));
    const securityBase = {
      commitSha: releaseEvidence.securityReview.commitSha,
      findings: releaseEvidence.securityReview.findings,
      generatedAt: releaseEvidence.securityReview.artifactGeneratedAt,
      manualReviewManifestDigest: releaseEvidence.securityReview.manualReviewManifestDigest,
      reviewAttestations: duplicateReviews,
      schemaVersion: releaseEvidence.securityReview.artifactSchemaVersion,
      workflowRunId: releaseEvidence.securityReview.workflowRunId,
    };
    const securityWithManifests = {
      ...securityBase,
      findingsManifestDigest: securityFindingsManifestDigest(securityBase),
      reviewManifestDigest: securityReviewManifestDigest(securityBase),
    };
    const forgedSecurityReview = {
      ...releaseEvidence.securityReview,
      reportDigest: sha256Digest(securityWithManifests),
      reviewAttestations: duplicateReviews,
      reviewManifestDigest: securityWithManifests.reviewManifestDigest,
    };
    const gate = evaluateReleaseGate(normalizer, golden, { ...releaseEvidence, securityReview: forgedSecurityReview }, runtime);
    expect(gate.status).toBe("pre_beta_not_ready");
    expect(gate.reasons).toContain("high_severity_security_review_not_verified");
  });

  it("rejects one 5,000-row cohort despite a declared public aggregate", () => {
    const normalizer = publicNormalizer();
    const oneCohort = parseNormalizerSnapshot({ ...normalizer, cohorts: [{ ...normalizer.cohorts[0], repositoryCount: 5_000 }], repositoryCount: 5_000 });
    const golden = productionGolden(normalizer);
    const { releaseEvidence, runtime } = releaseArtifacts(golden, normalizer);
    const gate = evaluateReleaseGate(oneCohort, golden, releaseEvidence, runtime);
    expect(gate.reasons).toContain("normalizer_stratified_coverage_incomplete");
  });

  it("binds the API reference normalizer to the versioned calibration payload", () => {
    const checked = parseNormalizerSnapshot(JSON.parse(readFileSync(new URL("../data/normalizer-v1.json", import.meta.url), "utf8")) as unknown);
    expect(sha256Digest(checked.scoringNormalizer)).toBe(sha256Digest(REFERENCE_SCORING_NORMALIZER));
  });

  it("uses Wilson intervals that remain non-zero with zero false positives", () => {
    expect(wilson95(0, 1)).toEqual({ high: 0.793451, low: 0, method: "wilson_95" });
  });
});
