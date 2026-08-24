import { describe, expect, it } from "vitest";
import type { Evidence, JsonValue } from "@dayu/evidence-schema";

import { scoreEnhanced, scoreRules } from "./score.js";
import { scoreMaintenance } from "./rules/maintenance.js";
import { scoreCommunity } from "./rules/community.js";
import { scorePopularity } from "./rules/popularity.js";
import { classification, fullEvidence, input } from "./score.test.js";

function replaceMetric(metric: string, value: JsonValue, status: "complete" | "restricted" = "complete"): Evidence[] {
  return fullEvidence().map((item) => item.fact.metric === metric ? { ...item, fact: { ...item.fact, value }, status, value } : item);
}

function metadataWith(evidence: Evidence[], values: Record<string, JsonValue>): Evidence[] {
  return evidence.map((item) => {
    if (item.fact.metric !== "repository.metadata") return item;
    const current = typeof item.value === "object" && item.value !== null && !Array.isArray(item.value) ? item.value : {};
    const value = { ...current, ...values };
    return { ...item, fact: { ...item.fact, value }, value };
  });
}

describe("scoring invariants", () => {
  it("never changes deterministic output when locale changes", () => {
    expect(scoreRules(input({ locale: "zh" }))).toEqual(scoreRules(input({ locale: "en" })));
  });

  it("keeps owner followers out of every score input", () => {
    expect(scoreRules(input({ ownerFollowers: 1 }))).toEqual(scoreRules(input({ ownerFollowers: 1_000_000 })));
  });

  it("does not convert restricted or missing watcher detail into risk", () => {
    const complete = scoreRules(input());
    const restricted = scoreRules(input({ evidence: fullEvidence({ metadataStatus: "partial" }) }));
    expect(restricted.dimensionScores.popularity).toBe(complete.dimensionScores.popularity);
    expect(restricted.confidence).toBeLessThan(complete.confidence);
    expect(restricted.findings.some((finding) => finding.ruleId === "restricted_watchers_risk")).toBe(false);
  });

  it("does not infer missing files from a truncated tree", () => {
    const complete = scoreRules(input());
    const truncated = scoreRules(input({ evidence: fullEvidence({ treeStatus: "partial" }) }));
    expect(truncated.dimensionScores.substance).toBeNull();
    expect(truncated.dimensionScores.claims).toBeNull();
    expect(truncated.confidence).toBeLessThan(complete.confidence);
  });

  it("does not penalize a new repository for maintenance or community history", () => {
    const newClassification = { ...classification, modifiers: ["new_repo"] } satisfies typeof classification;
    const report = scoreRules(input({ classification: newClassification, evidence: fullEvidence({ newRepo: true }) }));
    expect(report.dimensionScores.maintenance).toBe(0);
    expect(report.dimensionScores.community).toBe(0);
  });

  it("does not score external issue tracking as absent community activity", () => {
    const external = { ...classification, modifiers: ["external_tracker"] } satisfies typeof classification;
    const report = scoreRules(input({ classification: external, evidence: fullEvidence({ externalTracker: true }) }));
    expect(report.dimensionScores.community).toBeNull();
    expect(report.missingSignals).toContain("community.external_tracker");
  });

  it("excludes bot-only pull requests from human activity", () => {
    const botOnly = scoreRules(input({ evidence: fullEvidence({ botOnlyPulls: true }) }));
    const empty = scoreRules(input());
    expect(botOnly.dimensionScores.community).toBe(empty.dimensionScores.community);
    expect(botOnly.dimensionScores.popularity).toBe(empty.dimensionScores.popularity);
  });

  it("returns facts only for forks, mirrors, and archived repositories", () => {
    const report = scoreRules(input({ classification: { ...classification, modifiers: ["archived"], scoreMode: "facts_only" } }));
    expect(report.scoreKind).toBe("facts_only");
    expect(report.score).toBeNull();
    expect(report.findings).toEqual([]);
  });

  it("caps 60 and 80 verdicts unless independent dimension and confidence gates pass", () => {
    const rulesReport = scoreRules(input());
    const oneDimension = rulesReport.dimensionScores;
    const gatedRules = { ...rulesReport, confidence: 90, dimensionScores: { ...oneDimension, community: 0, maintenance: 0, substance: 0 } };
    const evidenceId = rulesReport.evidence[0]?.id;
    if (evidenceId === undefined) throw new Error("fixture evidence missing");
    const report = scoreEnhanced({
      aiConfidence: { applicableCoverage: 1, evidenceScopeCompleteness: 1, sampleAdequacy: 1 },
      aiFindings: [{ counterEvidenceIds: [evidenceId], dimension: "claims", en: "Mismatch.", evidenceIds: [evidenceId], rubricId: "ai.claims", verdict: "contradicted", zh: "不一致。" }],
      rulesReport: { ...gatedRules, score: 100, baseScore: 100 },
    });
    expect(report.score).toBeLessThan(60);
  });

  it("discards AI findings with unknown Evidence IDs", () => {
    const rulesReport = scoreRules(input());
    const report = scoreEnhanced({
      aiConfidence: { applicableCoverage: 1, evidenceScopeCompleteness: 1, sampleAdequacy: 1 },
      aiFindings: [{ counterEvidenceIds: [], dimension: "claims", en: "Mismatch.", evidenceIds: ["ev_aaaaaaaaaaaaaaaaaaaaaaaa"], rubricId: "ai.claims", verdict: "contradicted", zh: "不一致。" }],
      rulesReport,
    });
    expect(report.findings.every((finding) => finding.producer === "rule")).toBe(true);
  });

  it("marks claims unavailable when no install or release claim applies", () => {
    const evidence = fullEvidence().map((item) => item.fact.metric === "repository.file_content"
      ? { ...item, fact: { ...item.fact, value: { bytes: 16, path: "README.md", text: "# Product\nHello." } }, value: { bytes: 16, path: "README.md", text: "# Product\nHello." } }
      : item);
    expect(scoreRules(input({ evidence })).dimensionScores.claims).toBeNull();
  });

  it("excludes issue response from maintenance when issues are disabled", () => {
    const evidence = metadataWith(fullEvidence(), { hasIssues: false });
    const report = scoreRules(input({ evidence }));
    expect(report.missingSignals).toContain("maintenance.issues_disabled");
  });

  it("does not create community risk when issues are disabled and pull data is unavailable", () => {
    const pullsUnavailable = replaceMetric("repository.pull_requests", { available: false }, "restricted");
    const evidence = metadataWith(pullsUnavailable, { hasIssues: false });
    const report = scoreRules(input({ evidence }));
    expect(report.dimensionScores.community).toBeNull();
    expect(report.missingSignals).toContain("community.issues_disabled");
  });

  it("Laplace-smooths human dialogue ratios", () => {
    const issues = replaceMetric("repository.issues", { count: 1, items: [{ comments: 0, id: 1, state: "open" }] });
    const report = scoreRules(input({ evidence: issues }));
    expect(report.dimensionScores.community).toBe(58);
  });

  it.each([
    {
      files: ["README.md", ".gitattributes", "weights/model.safetensors"],
      modifier: "binary_lfs" as const,
      type: "data_model" as const,
    },
    {
      files: ["README.md", "package.json", "generated/client.ts", "vendor/runtime.js"],
      modifier: "generated_heavy" as const,
      type: "software" as const,
    },
    {
      files: ["README.md", "pnpm-workspace.yaml", "packages/a/package.json", "packages/a/tests/a.test.ts"],
      modifier: "monorepo" as const,
      type: "software" as const,
    },
  ])("uses $modifier-specific substance applicability", ({ files, modifier, type }) => {
    const tree = replaceMetric("repository.tree", { apiTruncated: false, completeForNegativeEvidence: true, files: files.map((path) => ({ path, size: 10, type: "blob" })), observedEntries: files.length });
    const report = scoreRules(input({ classification: { ...classification, modifiers: [modifier], type }, evidence: tree }));
    expect(report.dimensionScores.substance).not.toBeNull();
    expect(report.dimensionScores.substance).toBeLessThan(60);
  });

  it("normalizes maintenance quality by the covered signal weight", () => {
    const context = { analyzedAt: "2026-08-25T00:00:00.000Z", classification, evidence: fullEvidence(), normalizer: input().normalizer, rulesVersion: "rules-1" };
    expect(scoreMaintenance(context).quality).toBe(1);
  });

  it("applies popularity coverage exactly once for partial signals", () => {
    const partial = fullEvidence().map((item) => ["repository.contributors", "repository.issues", "repository.pull_requests"].includes(item.fact.metric)
      ? { ...item, limitations: ["page_budget_incomplete"], status: "partial" as const }
      : item);
    const report = scoreRules(input({ evidence: partial }));
    const result = scorePopularity({ analyzedAt: input().analyzedAt, classification, evidence: partial, normalizer: input().normalizer, rulesVersion: "rules-1" });
    expect(result.coverage).toBeCloseTo(0.4);
    expect(result.risk).toBe(100);
    expect((result.risk ?? 0) * result.coverage).toBeCloseTo(40);
    expect(report.dimensionAvailableWeights.popularity).toBeCloseTo(0.1);
  });

  it("keeps proportional maintenance and community coverage around the 60 percent gate", () => {
    const complete = scoreRules(input());
    expect(complete.availableWeight).toBeCloseTo(0.7);
    expect(complete.dimensionAvailableWeights.maintenance).toBeCloseTo(0.15);
    expect(complete.dimensionAvailableWeights.community).toBeCloseTo(0.1);
    const oneCommunityEndpoint = fullEvidence().map((item) => item.fact.metric === "repository.pull_requests"
      ? { ...item, status: "restricted" as const, value: { available: false }, fact: { ...item.fact, value: { available: false } } }
      : item);
    const one = scoreRules(input({ evidence: oneCommunityEndpoint }));
    expect(one.dimensionAvailableWeights.maintenance).toBeCloseTo(0.11);
    expect(one.dimensionAvailableWeights.community).toBeCloseTo(0.05);
    const atGateEvidence = fullEvidence().map((item) => item.fact.metric === "repository.contributors"
      ? { ...item, status: "restricted" as const, value: { available: false }, fact: { ...item.fact, value: { available: false } } }
      : item);
    const atGate = scoreRules(input({ evidence: atGateEvidence }));
    expect(atGate.availableWeight).toBeCloseTo(0.6375);
    expect(atGate.score).not.toBeNull();
    const belowGateEvidence = atGateEvidence.map((item) => ["repository.releases", "repository.issues"].includes(item.fact.metric)
      ? { ...item, status: "restricted" as const, value: { available: false }, fact: { ...item.fact, value: { available: false } } }
      : item);
    const below = scoreRules(input({ evidence: belowGateEvidence }));
    expect(below.availableWeight).toBeCloseTo(0.43);
    expect(below.score).toBeNull();
  });

  it("normalizes maintenance and community risk by covered internal weight", () => {
    const partialMaintenance = fullEvidence().map((item) => ["repository.issues", "repository.pull_requests", "repository.releases"].includes(item.fact.metric)
      ? { ...item, status: "partial" as const }
      : item);
    const maintenance = scoreMaintenance({ analyzedAt: input().analyzedAt, classification, evidence: partialMaintenance, normalizer: input().normalizer, rulesVersion: "rules-1" });
    expect(maintenance.coverage).toBeCloseTo(4 / 15);
    expect(maintenance.risk).toBe(100);
    expect((maintenance.risk ?? 0) * maintenance.coverage).toBeCloseTo(100 * 4 / 15);

    const partialCommunity = fullEvidence().map((item) => item.fact.metric === "repository.pull_requests"
      ? { ...item, status: "partial" as const }
      : item);
    const community = scoreCommunity({ analyzedAt: input().analyzedAt, classification, evidence: partialCommunity, normalizer: input().normalizer, rulesVersion: "rules-1" });
    expect(community.coverage).toBeCloseTo(0.5);
    expect(community.risk).toBe(50);
    expect((community.risk ?? 0) * community.coverage).toBeCloseTo(25);
  });

  it("deduplicates identical AI rubric findings independent of order", () => {
    const rulesReport = scoreRules(input());
    const evidenceId = rulesReport.evidence[0]?.id;
    if (evidenceId === undefined) throw new Error("fixture evidence missing");
    const first = { counterEvidenceIds: [evidenceId], dimension: "claims" as const, en: "Mismatch.", evidenceIds: [evidenceId], rubricId: "claims.delivery", verdict: "contradicted" as const, zh: "不一致。" };
    const second = { ...first, dimension: "substance" as const, rubricId: "substance.artifact" };
    const options = { aiConfidence: { applicableCoverage: 1, evidenceScopeCompleteness: 1, sampleAdequacy: 1 }, rulesReport };
    const single = scoreEnhanced({ ...options, aiFindings: [first, second] });
    const duplicated = scoreEnhanced({ ...options, aiFindings: [second, first, first] });
    expect(duplicated.score).toBe(single.score);
    expect(duplicated.dimensionScores).toEqual(single.dimensionScores);
    expect(duplicated.findings).toEqual(single.findings);
    expect(new Set(duplicated.findings.map((finding) => finding.id)).size).toBe(duplicated.findings.length);
  });

  it("rejects conflicting duplicate rubric IDs and keeps generated finding IDs unique", () => {
    const rulesReport = scoreRules(input());
    const evidenceId = rulesReport.evidence[0]?.id;
    if (evidenceId === undefined) throw new Error("fixture evidence missing");
    const common = { counterEvidenceIds: [evidenceId], dimension: "claims" as const, en: "Judgment.", evidenceIds: [evidenceId], zh: "判断。" };
    const report = scoreEnhanced({
      aiConfidence: { applicableCoverage: 1, evidenceScopeCompleteness: 1, sampleAdequacy: 1 },
      aiFindings: [
        { ...common, rubricId: "claims/a", verdict: "contradicted" },
        { ...common, rubricId: "claims_a", verdict: "mixed" },
        { ...common, rubricId: "conflict", verdict: "mixed" },
        { ...common, rubricId: "conflict", verdict: "contradicted" },
      ],
      rulesReport,
    });
    const ai = report.findings.filter((finding) => finding.producer === "copilot");
    expect(ai.map((finding) => finding.copilotJudgmentId)).not.toContain("conflict");
    expect(new Set(ai.map((finding) => finding.id)).size).toBe(ai.length);
  });
});
