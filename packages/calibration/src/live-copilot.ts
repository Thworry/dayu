import { z } from "zod";

import { sha256Digest } from "./recompute.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);

export const liveCopilotArtifactSchema = z.object({
  accountClassAttestation: z.object({
    auditSource: z.literal("github_protected_environment_registry"),
    commitSha: commit,
    manifestDigest: digest,
    runs: z.array(z.object({
      account: z.enum(["free", "pro", "organization_managed"]),
      subjectDigest: digest,
    }).strict()).length(3),
    workflowRunId: z.string().regex(/^[1-9]\d{0,19}$/),
  }).strict(),
  artifactDigest: digest,
  commitSha: commit,
  generatedAt: z.iso.datetime(),
  runs: z.array(z.object({
    account: z.enum(["free", "pro", "organization_managed"]),
    analysisDigest: digest,
    evidenceDigest: digest,
    repositoryPermissions: z.literal("none"),
    requestedScopes: z.array(z.never()).length(0),
    subjectDigest: digest,
  }).strict()).length(3),
  schemaVersion: z.literal("1"),
  workflowRunId: z.string().regex(/^[1-9]\d{0,19}$/),
}).strict().superRefine((artifact, context) => {
  if (new Set(artifact.runs.map((run) => run.account)).size !== 3) context.addIssue({ code: "custom", message: "all three account classes are required" });
  if (new Set(artifact.runs.map((run) => run.subjectDigest)).size !== 3) context.addIssue({ code: "custom", message: "three distinct GitHub accounts are required" });
  if (artifact.accountClassAttestation.commitSha !== artifact.commitSha || artifact.accountClassAttestation.workflowRunId !== artifact.workflowRunId) context.addIssue({ code: "custom", message: "account-class attestation must bind to the artifact run" });
  const classified = new Map(artifact.accountClassAttestation.runs.map((run) => [run.account, run.subjectDigest]));
  if (artifact.runs.some((run) => classified.get(run.account) !== run.subjectDigest)) context.addIssue({ code: "custom", message: "account-class attestation does not match live runs" });
});

export type LiveCopilotArtifact = z.infer<typeof liveCopilotArtifactSchema>;

export const accountClassRegistrySchema = z.object({
  accounts: z.array(z.object({
    account: z.enum(["free", "pro", "organization_managed"]),
    userId: z.number().int().positive(),
  }).strict()).length(3),
  auditSource: z.literal("github_protected_environment_registry"),
  immutable: z.literal(true),
  schemaVersion: z.literal("1"),
}).strict().superRefine((registry, context) => {
  if (new Set(registry.accounts.map((item) => item.account)).size !== 3) context.addIssue({ code: "custom", message: "registry must classify Free, Pro, and organization-managed accounts" });
  if (new Set(registry.accounts.map((item) => item.userId)).size !== 3) context.addIssue({ code: "custom", message: "registry must contain three distinct GitHub user IDs" });
});

export function accountClassManifestDigest(artifact: Pick<LiveCopilotArtifact, "accountClassAttestation">): string {
  const attestation = artifact.accountClassAttestation;
  return sha256Digest({
    auditSource: attestation.auditSource,
    commitSha: attestation.commitSha,
    runs: attestation.runs,
    workflowRunId: attestation.workflowRunId,
  });
}

export function unsignedLiveCopilotArtifact(artifact: LiveCopilotArtifact): Omit<LiveCopilotArtifact, "artifactDigest"> {
  return {
    accountClassAttestation: artifact.accountClassAttestation,
    commitSha: artifact.commitSha,
    generatedAt: artifact.generatedAt,
    runs: artifact.runs,
    schemaVersion: artifact.schemaVersion,
    workflowRunId: artifact.workflowRunId,
  };
}

export function liveCopilotArtifactMatchesManifests(artifact: LiveCopilotArtifact): boolean {
  return artifact.accountClassAttestation.manifestDigest === accountClassManifestDigest(artifact)
    && artifact.artifactDigest === sha256Digest(unsignedLiveCopilotArtifact(artifact));
}
