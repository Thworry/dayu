import { describe, expect, it } from "vitest";

import { findingSchema, reportSnapshotSchema } from "./report.js";

const evidence = {
  id: "ev_aaaaaaaaaaaaaaaaaaaaaaaa",
  schemaVersion: "1",
  kind: "file",
  repository: { id: 1024, fullName: "owner/repo" },
  source: { kind: "file", commitSha: "abcdef1234567", path: "README.md" },
  observedAt: "2026-08-24T00:00:00Z",
  status: "complete",
  summary: "README at the pinned default branch",
  value: "# Example",
  fact: { metric: "file_exists", value: true },
  limitations: [],
} as const;

const finding = {
  id: "fd_readme",
  findingId: "fd_readme",
  producer: "rule",
  dimension: "substance",
  severity: "info",
  risk: 0,
  scoreImpact: 0,
  evidenceIds: [evidence.id],
  counterEvidenceIds: [],
  titleKey: "finding.readme.title",
  explanationKey: "finding.readme.explanation",
  copyKey: "finding.readme",
  ruleId: "substance.readme",
  caveat: "",
} as const;

const validReport = {
  reportVersion: "1",
  repository: { id: 1024, fullName: "owner/repo", defaultBranch: "main" },
  sourceCommit: "abcdef1234567",
  repositoryType: "software",
  dataStatus: "complete",
  missingSignals: [],
  scoreKind: "rules_only",
  score: 12,
  baseScore: 12,
  confidence: 88,
  dimensionScores: { popularity: 10, substance: 5, maintenance: 20, community: 15, claims: 10 },
  findings: [finding],
  positiveSignals: [finding],
  evidence: [evidence],
  evidenceIndex: { [evidence.id]: evidence },
  collectorVersion: "1.0.0",
  rulesVersion: "1.0.0",
  locale: "en",
  createdAt: "2026-08-24T00:00:00Z",
  expiresAt: "2026-08-24T00:30:00Z",
} as const;

describe("Report contracts", () => {
  it("keeps the approved report context and evidence index", () => {
    const parsed = reportSnapshotSchema.parse(validReport);

    expect(parsed.dataStatus).toBe("complete");
    expect(parsed.evidenceIndex[evidence.id]?.source).toMatchObject({ commitSha: "abcdef1234567" });
  });

  it("requires the producer-specific judgment id", () => {
    const parsed = findingSchema.safeParse({ ...finding, producer: "copilot", ruleId: undefined });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ["copilotJudgmentId"] })]),
      );
    }
  });

  it("rejects findings that cite unknown evidence", () => {
    const parsed = reportSnapshotSchema.safeParse({
      ...validReport,
      findings: [{ ...finding, evidenceIds: ["ev_bbbbbbbbbbbbbbbbbbbbbbbb"] }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: "Finding references unknown evidence" })]),
      );
    }
  });

  it("rejects an evidence index key that disagrees with its value", () => {
    const parsed = reportSnapshotSchema.safeParse({
      ...validReport,
      evidenceIndex: { ev_bbbbbbbbbbbbbbbbbbbbbbbb: evidence },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: "Evidence index key must match an evidence id" })]),
      );
    }
  });

  it("rejects an evidence index value that disagrees with the evidence array", () => {
    const parsed = reportSnapshotSchema.safeParse({
      ...validReport,
      evidenceIndex: { [evidence.id]: { ...evidence, summary: "Changed summary" } },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: "Evidence index value must match evidence array" })]),
      );
    }
  });

  it("accepts equivalent evidence values with different object key order", () => {
    const arrayEvidence = {
      ...evidence,
      value: { alpha: 1, beta: 2 },
      fact: { metric: "file_exists", value: { expected: true, observed: true } },
    };
    const indexEvidence = {
      ...evidence,
      value: { beta: 2, alpha: 1 },
      fact: { metric: "file_exists", value: { observed: true, expected: true } },
    };
    const parsed = reportSnapshotSchema.safeParse({
      ...validReport,
      evidence: [arrayEvidence],
      evidenceIndex: { [evidence.id]: indexEvidence },
    });
    expect(parsed.success).toBe(true);
  });

  it.each(["insufficient_evidence", "facts_only"] as const)("rejects a precise score for %s", (scoreKind) => {
    expect(reportSnapshotSchema.safeParse({ ...validReport, scoreKind }).success).toBe(false);
  });

  it("rejects a hidden base score for an unscored report", () => {
    const parsed = reportSnapshotSchema.safeParse({
      ...validReport,
      scoreKind: "insufficient_evidence",
      score: null,
      baseScore: 12,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects enhanced fields on a rules-only report", () => {
    const parsed = reportSnapshotSchema.safeParse({
      ...validReport,
      enrichedScore: 14,
      promptVersion: "1.0.0",
    });
    expect(parsed.success).toBe(false);
  });

  it("requires complete enhanced score context", () => {
    const parsed = reportSnapshotSchema.safeParse({ ...validReport, scoreKind: "enhanced", enrichedScore: undefined });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: "Enhanced reports require base, enriched, and prompt versions" })]),
      );
    }
  });

  it("stores bounded bilingual Copilot metadata for language switching without a rerun", () => {
    const copilot = {
      findings: [{ counterEvidenceIds: [], en: "[SUPPORTED] Bounded finding.", evidenceIds: [evidence.id], rubricId: "claims.install", verdict: "supported", zh: "[支持] 有限判断。" }],
      model: "gpt-5-mini",
      promptVersion: "copilot-prompt-v1",
      rubricVersion: "copilot-rubric-v1",
    } as const;
    const parsed = reportSnapshotSchema.safeParse({
      ...validReport,
      copilot,
      enrichedScore: 14,
      promptVersion: "copilot-prompt-v1",
      score: 14,
      scoreKind: "enhanced",
    });
    expect(parsed.success).toBe(true);

    expect(reportSnapshotSchema.safeParse({
      ...validReport,
      copilot: { ...copilot, findings: [{ ...copilot.findings[0], evidenceIds: ["ev_bbbbbbbbbbbbbbbbbbbbbbbb"] }] },
      enrichedScore: 14,
      promptVersion: "copilot-prompt-v1",
      score: 14,
      scoreKind: "enhanced",
    }).success).toBe(false);
  });
});
