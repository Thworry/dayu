import { z } from "zod";

import { sha256Digest } from "./recompute.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const findingSchema = z.object({
  count: z.number().int().positive(),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,95}$/),
  severity: z.enum(["low", "moderate", "high", "critical"]),
  source: z.enum(["pnpm_audit", "manual_review"]),
  status: z.enum(["resolved", "unresolved"]),
}).strict();
const manualFindingSchema = findingSchema.omit({ source: true });
const manualFindingsSchema = z.array(manualFindingSchema).max(500).refine((findings) => new Set(findings.map((finding) => finding.id)).size === findings.length, "manual finding IDs must be unique");
const manualReviewSchema = z.object({
  reviewerCount: z.number().int().positive().max(20),
  scopeDigest: digest,
}).strict();

export const protectedManualReviewSourceSchema = z.object({
  expiresAt: z.iso.datetime(),
  findings: manualFindingsSchema,
  generatedAt: z.iso.datetime(),
  immutable: z.literal(true),
  review: manualReviewSchema,
  reviewedCommitSha: commit,
  schemaVersion: z.literal("1"),
  sourceDigest: digest,
}).strict();

export const manualSecurityReviewManifestSchema = z.object({
  commitSha: commit,
  expiresAt: z.iso.datetime(),
  findings: manualFindingsSchema,
  generatedAt: z.iso.datetime(),
  immutable: z.literal(true),
  manifestDigest: digest,
  review: manualReviewSchema,
  schemaVersion: z.literal("1"),
  sourceDigest: digest,
  sourceGeneratedAt: z.iso.datetime(),
  workflowRunId: z.string().regex(/^[1-9]\d{0,19}$/),
}).strict();

export type ProtectedManualReviewSource = z.infer<typeof protectedManualReviewSourceSchema>;
export type ManualSecurityReviewManifest = z.infer<typeof manualSecurityReviewManifestSchema>;

export function unsignedProtectedManualReviewSource(source: ProtectedManualReviewSource): Omit<ProtectedManualReviewSource, "sourceDigest"> {
  return {
    expiresAt: source.expiresAt,
    findings: source.findings,
    generatedAt: source.generatedAt,
    immutable: source.immutable,
    review: source.review,
    reviewedCommitSha: source.reviewedCommitSha,
    schemaVersion: source.schemaVersion,
  };
}

export function protectedManualReviewSourceDigest(source: Omit<ProtectedManualReviewSource, "sourceDigest">): string {
  return sha256Digest(source);
}

export function manualSecurityReviewManifestDigest(manifest: Omit<ManualSecurityReviewManifest, "manifestDigest">): string {
  return sha256Digest(manifest);
}

export function manualSecurityReviewManifestIsCurrent(manifest: ManualSecurityReviewManifest, runtime: { commitSha: string; workflowRunId: string }, now = new Date()): boolean {
  const unsigned = {
    commitSha: manifest.commitSha,
    expiresAt: manifest.expiresAt,
    findings: manifest.findings,
    generatedAt: manifest.generatedAt,
    immutable: manifest.immutable,
    review: manifest.review,
    schemaVersion: manifest.schemaVersion,
    sourceDigest: manifest.sourceDigest,
    sourceGeneratedAt: manifest.sourceGeneratedAt,
    workflowRunId: manifest.workflowRunId,
  };
  return manifest.commitSha === runtime.commitSha
    && manifest.workflowRunId === runtime.workflowRunId
    && Date.parse(manifest.sourceGeneratedAt) <= now.getTime()
    && Date.parse(manifest.generatedAt) >= Date.parse(manifest.sourceGeneratedAt)
    && Date.parse(manifest.generatedAt) <= now.getTime()
    && Date.parse(manifest.expiresAt) > now.getTime()
    && Date.parse(manifest.expiresAt) - Date.parse(manifest.sourceGeneratedAt) <= 7 * 24 * 60 * 60 * 1_000
    && manifest.manifestDigest === manualSecurityReviewManifestDigest(unsigned)
    && manifest.sourceDigest === protectedManualReviewSourceDigest({
      expiresAt: manifest.expiresAt,
      findings: manifest.findings,
      generatedAt: manifest.sourceGeneratedAt,
      immutable: manifest.immutable,
      review: manifest.review,
      reviewedCommitSha: manifest.commitSha,
      schemaVersion: manifest.schemaVersion,
    });
}

export const securityReviewArtifactSchema = z.object({
  artifactDigest: digest,
  commitSha: commit,
  findings: z.array(findingSchema),
  findingsManifestDigest: digest,
  generatedAt: z.iso.datetime(),
  manualReviewManifestDigest: digest,
  reviewAttestations: z.array(z.object({
    control: z.enum(["dependency_audit", "license_policy", "manual_security_review", "secret_scan"]),
    evidenceDigest: digest,
    outcome: z.literal("pass"),
  }).strict()).length(4),
  reviewManifestDigest: digest,
  schemaVersion: z.literal("1"),
  workflowRunId: z.string().regex(/^[1-9]\d{0,19}$/),
}).strict().superRefine((artifact, context) => {
  if (new Set(artifact.reviewAttestations.map((review) => review.control)).size !== 4) context.addIssue({ code: "custom", message: "all security controls are required" });
});

export type SecurityReviewArtifact = z.infer<typeof securityReviewArtifactSchema>;

export function securityFindingsManifestDigest(artifact: Pick<SecurityReviewArtifact, "commitSha" | "findings" | "workflowRunId">): string {
  return sha256Digest({ commitSha: artifact.commitSha, findings: artifact.findings, workflowRunId: artifact.workflowRunId });
}

export function securityReviewManifestDigest(artifact: Pick<SecurityReviewArtifact, "commitSha" | "reviewAttestations" | "workflowRunId">): string {
  return sha256Digest({ commitSha: artifact.commitSha, reviewAttestations: artifact.reviewAttestations, workflowRunId: artifact.workflowRunId });
}

export function unsignedSecurityReviewArtifact(artifact: SecurityReviewArtifact): Omit<SecurityReviewArtifact, "artifactDigest"> {
  return {
    commitSha: artifact.commitSha,
    findings: artifact.findings,
    findingsManifestDigest: artifact.findingsManifestDigest,
    generatedAt: artifact.generatedAt,
    manualReviewManifestDigest: artifact.manualReviewManifestDigest,
    reviewAttestations: artifact.reviewAttestations,
    reviewManifestDigest: artifact.reviewManifestDigest,
    schemaVersion: artifact.schemaVersion,
    workflowRunId: artifact.workflowRunId,
  };
}

export function securityReviewArtifactMatchesManifests(artifact: SecurityReviewArtifact): boolean {
  return artifact.findingsManifestDigest === securityFindingsManifestDigest(artifact)
    && artifact.reviewManifestDigest === securityReviewManifestDigest(artifact)
    && artifact.artifactDigest === sha256Digest(unsignedSecurityReviewArtifact(artifact));
}

export function unresolvedHighOrCritical(artifact: SecurityReviewArtifact): number {
  return artifact.findings.reduce((total, finding) => total + (finding.status === "unresolved" && (finding.severity === "high" || finding.severity === "critical") ? finding.count : 0), 0);
}
