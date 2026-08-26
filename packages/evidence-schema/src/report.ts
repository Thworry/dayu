import { z } from "zod";

import { dataStatusSchema, evidenceSchema } from "./evidence.js";

const evidenceIdSchema = z.string().regex(/^ev_[a-f0-9]{24}$/);

function isStructurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => isStructurallyEqual(value, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && isStructurallyEqual(leftRecord[key], rightRecord[key]))
  );
}

export const dimensionSchema = z.enum([
  "popularity",
  "substance",
  "maintenance",
  "community",
  "claims",
]);

export const findingSchema = z
  .object({
    id: z.string().min(1),
    findingId: z.string().min(1),
    producer: z.enum(["rule", "copilot"]),
    dimension: dimensionSchema,
    severity: z.enum(["info", "low", "moderate", "high"]),
    risk: z.number().min(0).max(100),
    scoreImpact: z.number().min(-100).max(100),
    evidenceIds: z.array(evidenceIdSchema).min(1),
    counterEvidenceIds: z.array(evidenceIdSchema).default([]),
    titleKey: z.string().min(1),
    explanationKey: z.string().min(1),
    copyKey: z.string().min(1),
    ruleId: z.string().min(1).optional(),
    copilotJudgmentId: z.string().min(1).optional(),
    caveat: z.string(),
  })
  .superRefine((finding, context) => {
    if (finding.id !== finding.findingId) {
      context.addIssue({ code: "custom", message: "id and findingId must match", path: ["findingId"] });
    }
    if (finding.producer === "rule" && !finding.ruleId) {
      context.addIssue({ code: "custom", message: "rule findings require ruleId", path: ["ruleId"] });
    }
    if (finding.producer === "copilot" && !finding.copilotJudgmentId) {
      context.addIssue({
        code: "custom",
        message: "Copilot findings require copilotJudgmentId",
        path: ["copilotJudgmentId"],
      });
    }
  });

const copilotMetadataSchema = z.object({
  findings: z.array(z.object({
    counterEvidenceIds: z.array(evidenceIdSchema).max(6),
    en: z.string().min(1).max(300),
    evidenceIds: z.array(evidenceIdSchema).max(6),
    rubricId: z.string().min(1).max(80),
    verdict: z.enum(["supported", "mixed", "contradicted", "unverifiable", "not_applicable"]),
    zh: z.string().min(1).max(240),
  }).strict()).max(12),
  model: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(80),
  rubricVersion: z.string().min(1).max(80),
}).strict();

const researchPreviewSchema = z.object({
  calibrationStatus: z.literal("uncalibrated"),
  normalizerKind: z.literal("synthetic_reference"),
  normalizerVersion: z.string().min(1),
  releaseStage: z.literal("pre_beta"),
}).strict();

export const reportSnapshotSchema = z
  .object({
    reportVersion: z.literal("1"),
    researchPreview: researchPreviewSchema,
    repository: z.object({
      id: z.number().int().positive(),
      fullName: z.string(),
      defaultBranch: z.string(),
    }),
    sourceCommit: z.string().min(7),
    repositoryType: z.string(),
    dataStatus: dataStatusSchema,
    missingSignals: z.array(z.string()),
    scoreKind: z.enum([
      "rules_only",
      "enhanced",
      "insufficient_evidence",
      "facts_only",
    ]),
    score: z.number().int().min(0).max(100).nullable(),
    baseScore: z.number().int().min(0).max(100).nullable(),
    enrichedScore: z.number().int().min(0).max(100).nullable().optional(),
    confidence: z.number().int().min(0).max(100),
    dimensionScores: z.record(
      dimensionSchema,
      z.number().min(0).max(100).nullable(),
    ),
    findings: z.array(findingSchema),
    positiveSignals: z.array(findingSchema),
    evidence: z.array(evidenceSchema),
    evidenceIndex: z.record(evidenceIdSchema, evidenceSchema),
    collectorVersion: z.string(),
    rulesVersion: z.string(),
    promptVersion: z.string().optional(),
    copilot: copilotMetadataSchema.optional(),
    locale: z.enum(["zh", "en"]),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .superRefine((report, context) => {
    const evidenceIds = new Set(report.evidence.map((item) => item.id));
    const evidenceById = new Map(report.evidence.map((item) => [item.id, item]));
    if (evidenceIds.size !== report.evidence.length) {
      context.addIssue({ code: "custom", message: "Evidence IDs must be unique", path: ["evidence"] });
    }

    const indexEntries = Object.entries(report.evidenceIndex);
    if (indexEntries.length !== evidenceIds.size) {
      context.addIssue({ code: "custom", message: "Evidence index must match evidence array", path: ["evidenceIndex"] });
    }

    for (const [key, item] of indexEntries) {
      if (key !== item.id || !evidenceIds.has(key)) {
        context.addIssue({ code: "custom", message: "Evidence index key must match an evidence id", path: ["evidenceIndex", key] });
      } else if (!isStructurallyEqual(item, evidenceById.get(key))) {
        context.addIssue({ code: "custom", message: "Evidence index value must match evidence array", path: ["evidenceIndex", key] });
      }
    }

    for (const [index, item] of report.evidence.entries()) {
      if (!report.evidenceIndex[item.id]) {
        context.addIssue({ code: "custom", message: "Evidence is missing from index", path: ["evidence", index, "id"] });
      }
      if (item.repository.id !== report.repository.id || item.repository.fullName !== report.repository.fullName) {
        context.addIssue({ code: "custom", message: "Evidence repository must match report repository", path: ["evidence", index, "repository"] });
      }
      if (item.source.kind === "file" && item.source.commitSha !== report.sourceCommit) {
        context.addIssue({ code: "custom", message: "File evidence must use report source commit", path: ["evidence", index, "source", "commitSha"] });
      }
    }

    for (const [group, findings] of [
      ["findings", report.findings],
      ["positiveSignals", report.positiveSignals],
    ] as const) {
      for (const [index, finding] of findings.entries()) {
        for (const evidenceId of [...finding.evidenceIds, ...finding.counterEvidenceIds]) {
          if (!evidenceIds.has(evidenceId)) {
            context.addIssue({ code: "custom", message: "Finding references unknown evidence", path: [group, index, "evidenceIds"] });
          }
        }
      }
    }

    if (report.copilot !== undefined) {
      if (report.scoreKind === "rules_only" || (report.scoreKind === "enhanced" && report.copilot.promptVersion !== report.promptVersion)) {
        context.addIssue({ code: "custom", message: "Copilot metadata requires an analyzed report and matching prompt version", path: ["copilot"] });
      }
      for (const [index, finding] of report.copilot.findings.entries()) {
        for (const evidenceId of [...finding.evidenceIds, ...finding.counterEvidenceIds]) {
          if (!evidenceIds.has(evidenceId)) {
            context.addIssue({ code: "custom", message: "Copilot copy references unknown evidence", path: ["copilot", "findings", index, "evidenceIds"] });
          }
        }
      }
    }

    if (report.scoreKind === "insufficient_evidence" || report.scoreKind === "facts_only") {
      if (report.score !== null || report.baseScore !== null || report.enrichedScore != null || report.promptVersion) {
        context.addIssue({ code: "custom", message: "Unscored reports cannot contain a precise score", path: ["score"] });
      }
    }
    if (
      report.scoreKind === "rules_only" &&
      (report.score === null || report.baseScore !== report.score || report.enrichedScore != null || report.promptVersion)
    ) {
      context.addIssue({ code: "custom", message: "Rules-only reports must contain only the base score", path: ["baseScore"] });
    }
    if (
      report.scoreKind === "enhanced" &&
      (report.score === null || report.baseScore === null || report.enrichedScore !== report.score || !report.promptVersion)
    ) {
      context.addIssue({ code: "custom", message: "Enhanced reports require base, enriched, and prompt versions", path: ["enrichedScore"] });
    }
  });

export type Finding = z.infer<typeof findingSchema>;
export type ReportSnapshot = z.infer<typeof reportSnapshotSchema>;
