import { z } from "zod";
import { evidenceSchema } from "@dayu/evidence-schema";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const commitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const collectorVersionSchema = z.string().regex(/^collector-v\d+(?:\.\d+){0,2}$/);
const taxonomyVersionSchema = z.string().regex(/^taxonomy-v\d+(?:\.\d+){0,2}$/);
const rulesVersionSchema = z.string().regex(/^rules-v\d+(?:\.\d+){0,2}$/);
const normalizerVersionSchema = z.string().regex(/^normalizer-v\d+(?:\.\d+){0,2}(?:-sample)?$/);
const pipelineVersionSchema = z.string().regex(/^scoring-pipeline-v\d+(?:\.\d+){0,2}$/);
const goldenVersionSchema = z.string().regex(/^golden-v\d+(?:\.\d+){0,2}(?:-sample)?$/);
const repositoryTypeSchema = z.enum(["software", "docs_content", "data_model", "template", "creative_demo", "generic"]);
const bindingsSchema = z.object({
  normalizerVersion: normalizerVersionSchema,
  pipelineVersion: pipelineVersionSchema,
  rulesVersion: rulesVersionSchema,
  taxonomyVersion: taxonomyVersionSchema,
}).strict();
const percentilesSchema = z.object({
  p50: z.number().nonnegative(),
  p80: z.number().nonnegative(),
  p95: z.number().nonnegative(),
  p99: z.number().nonnegative(),
}).strict().refine((value) => value.p50 <= value.p80 && value.p80 <= value.p95 && value.p95 <= value.p99, "percentiles must be monotonic");
const scoringNormalizerSchema = z.object({
  bands: z.record(z.string().min(1), z.object({
    p80Deficit: z.number().nonnegative(),
    p99Deficit: z.number().positive(),
  }).strict().refine((band) => band.p99Deficit > band.p80Deficit, "p99 deficit must exceed p80 deficit")),
  confidence: z.number().min(0).max(1),
  version: normalizerVersionSchema,
}).strict();

export const normalizerSnapshotSchema = z.object({
  cohorts: z.array(z.object({
    keys: z.object({
      ageBand: z.enum(["0-179d", "180-729d", "730d+"]),
      ecosystem: z.string().regex(/^[a-z0-9][a-z0-9+._-]{0,31}$/),
      starBand: z.enum(["0-99", "100-999", "1k-9,999", "10k+"]),
      type: repositoryTypeSchema,
    }).strict(),
    metrics: z.record(z.string().regex(/^[a-z][A-Za-z0-9]{2,63}$/), percentilesSchema),
    repositoryCount: z.number().int().nonnegative(),
  }).strict()),
  dataClassification: z.enum(["synthetic_sample", "public_aggregate"]),
  generatedAt: z.iso.datetime(),
  immutable: z.literal(true),
  provenance: z.object({
    collectorVersion: collectorVersionSchema,
    manifestDigest: digestSchema,
    source: z.enum(["synthetic_fixture", "public_github_aggregate"]),
    taxonomyVersion: taxonomyVersionSchema,
  }).strict(),
  repositoryCount: z.number().int().nonnegative(),
  schemaVersion: z.literal("1"),
  scoringNormalizer: scoringNormalizerSchema,
  version: normalizerVersionSchema,
}).strict().superRefine((snapshot, context) => {
  const total = snapshot.cohorts.reduce((sum, cohort) => sum + cohort.repositoryCount, 0);
  if (total !== snapshot.repositoryCount) context.addIssue({ code: "custom", message: "repositoryCount must equal cohort totals" });
  const keys = snapshot.cohorts.map((cohort) => JSON.stringify(cohort.keys));
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", message: "cohort keys must be unique" });
  const sourceMatches = snapshot.dataClassification === "public_aggregate"
    ? snapshot.provenance.source === "public_github_aggregate"
    : snapshot.provenance.source === "synthetic_fixture";
  if (!sourceMatches) context.addIssue({ code: "custom", message: "normalizer provenance must match classification" });
  if (snapshot.scoringNormalizer.version !== snapshot.version) context.addIssue({ code: "custom", message: "scoring normalizer version must match snapshot" });
});

const reviewSchema = z.object({
  blinded: z.boolean(),
  provenance: z.object({
    manifestDigest: digestSchema,
    protocolVersion: z.string().regex(/^blind-review-v\d+(?:\.\d+){0,2}$/),
    source: z.enum(["synthetic_fixture", "independent_blind_review"]),
  }).strict(),
  reviewerCount: z.number().int().nonnegative(),
}).strict();
const scoringInputSchema = z.object({
  analyzedAt: z.iso.datetime(),
  collectorVersion: collectorVersionSchema,
  evidence: z.array(evidenceSchema).min(1).max(256),
  expiresAt: z.iso.datetime(),
  locale: z.enum(["zh", "en"]),
  ownerFollowers: z.number().int().nonnegative().optional(),
}).strict();

export const goldenCaseSetSchema = z.object({
  bindings: bindingsSchema,
  cases: z.array(z.object({
    challengeTags: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/)).min(1).max(12),
    currentScore: z.number().min(0).max(100),
    expected: z.enum(["ordinary", "risk"]),
    id: z.string().regex(/^case_[a-z0-9_-]+$/),
    previousScore: z.number().min(0).max(100).nullable(),
    repositoryType: repositoryTypeSchema,
    review: reviewSchema,
    scoringInput: scoringInputSchema,
    scoringInputDigest: digestSchema,
    scoringOutputDigest: digestSchema,
  }).strict()).refine((cases) => new Set(cases.map((item) => item.id)).size === cases.length, "case IDs must be unique"),
  dataClassification: z.enum(["synthetic_sample", "blind_reviewed_public"]),
  generatedAt: z.iso.datetime(),
  immutable: z.literal(true),
  manifestDigest: digestSchema,
  normalizerManifestDigest: digestSchema,
  reviewedLabelManifestDigest: digestSchema,
  schemaVersion: z.literal("1"),
  version: goldenVersionSchema,
}).strict().superRefine((dataset, context) => {
  for (const [index, item] of dataset.cases.entries()) {
    const reviewMatches = dataset.dataClassification === "blind_reviewed_public"
      ? item.review.provenance.source === "independent_blind_review"
      : item.review.provenance.source === "synthetic_fixture";
    if (!reviewMatches) context.addIssue({ code: "custom", message: "review provenance must match classification", path: ["cases", index, "review"] });
  }
});

const unverifiedEvidenceSchema = z.object({
  reason: z.enum(["not_run", "fixtures_only", "protected_environment_unavailable"]),
  status: z.literal("not_verified"),
}).strict();
const verifiedPipelineSchema = bindingsSchema.extend({
  commitSha: commitShaSchema,
  manifestDigest: digestSchema,
  reviewedLabelManifestDigest: digestSchema,
  status: z.literal("verified"),
  verificationSource: z.literal("github_actions_protected_environment"),
  workflowRunId: z.string().regex(/^[1-9]\d{0,19}$/),
}).strict();
const copilotRunSchema = z.object({
  account: z.enum(["free", "pro", "organization_managed"]),
  commitSha: commitShaSchema,
  evidenceDigest: digestSchema,
  subjectDigest: digestSchema,
  outcome: z.literal("pass"),
  repositoryPermissions: z.literal("none"),
  requestedScopes: z.array(z.never()).length(0),
}).strict();
const verifiedCopilotSchema = z.object({
  accountClassManifestDigest: digestSchema,
  attestationDigest: digestSchema,
  runs: z.array(copilotRunSchema).length(3),
  status: z.literal("verified"),
  verificationSource: z.literal("github_actions_protected_environment"),
  workflowRunId: z.string().regex(/^[1-9]\d{0,19}$/),
}).strict().superRefine((value, context) => {
  if (new Set(value.runs.map((run) => run.account)).size !== 3) context.addIssue({ code: "custom", message: "Free, Pro, and organization-managed runs are all required" });
  if (new Set(value.runs.map((run) => run.commitSha)).size !== 1) context.addIssue({ code: "custom", message: "Copilot runs must bind to one commit" });
  if (new Set(value.runs.map((run) => run.subjectDigest)).size !== 3) context.addIssue({ code: "custom", message: "Copilot runs must use three distinct accounts" });
});
const verifiedSecuritySchema = z.object({
  artifactGeneratedAt: z.iso.datetime(),
  artifactSchemaVersion: z.literal("1"),
  commitSha: commitShaSchema,
  findings: z.array(z.object({
    count: z.number().int().positive(),
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,95}$/),
    severity: z.enum(["low", "moderate", "high", "critical"]),
    source: z.enum(["pnpm_audit", "manual_review"]),
    status: z.enum(["resolved", "unresolved"]),
  }).strict()),
  findingsManifestDigest: digestSchema,
  manualReviewManifestDigest: digestSchema,
  reviewManifestDigest: digestSchema,
  reportDigest: digestSchema,
  reviewAttestations: z.array(z.object({
    control: z.enum(["dependency_audit", "license_policy", "manual_security_review", "secret_scan"]),
    evidenceDigest: digestSchema,
    outcome: z.literal("pass"),
  }).strict()).length(4),
  status: z.literal("verified"),
  verificationSource: z.literal("github_actions_protected_environment"),
  workflowRunId: z.string().regex(/^[1-9]\d{0,19}$/),
  unresolvedHighOrCritical: z.literal(0),
}).strict().superRefine((value, context) => {
  if (new Set(value.reviewAttestations.map((review) => review.control)).size !== 4) context.addIssue({ code: "custom", message: "dependency audit, license policy, manual review, and secret scan attestations are all required" });
});

export const releaseEvidenceSchema = z.object({
  copilotMatrix: z.union([unverifiedEvidenceSchema, verifiedCopilotSchema]),
  generatedAt: z.iso.datetime(),
  immutable: z.literal(true),
  schemaVersion: z.literal("1"),
  scoringPipeline: z.union([unverifiedEvidenceSchema, verifiedPipelineSchema]),
  securityReview: z.union([unverifiedEvidenceSchema, verifiedSecuritySchema]),
}).strict().superRefine((evidence, context) => {
  if (evidence.scoringPipeline.status !== "verified" || evidence.copilotMatrix.status !== "verified" || evidence.securityReview.status !== "verified") return;
  const commits = new Set([
    evidence.scoringPipeline.commitSha,
    evidence.securityReview.commitSha,
    ...evidence.copilotMatrix.runs.map((run) => run.commitSha),
  ]);
  const workflowRuns = new Set([evidence.scoringPipeline.workflowRunId, evidence.securityReview.workflowRunId, evidence.copilotMatrix.workflowRunId]);
  if (commits.size !== 1) context.addIssue({ code: "custom", message: "release evidence must bind to one commit" });
  if (workflowRuns.size !== 1) context.addIssue({ code: "custom", message: "release evidence must bind to one protected workflow run" });
});

export const protectedReleaseRuntimeSchema = z.object({
  commitSha: commitShaSchema,
  source: z.literal("github_actions_protected_environment"),
  workflowRunId: z.string().regex(/^[1-9]\d{0,19}$/),
}).strict();

export type NormalizerSnapshot = z.infer<typeof normalizerSnapshotSchema>;
export type GoldenCaseSet = z.infer<typeof goldenCaseSetSchema>;
export type GoldenCase = GoldenCaseSet["cases"][number];
export type ReleaseEvidence = z.infer<typeof releaseEvidenceSchema>;
export type ProtectedReleaseRuntime = z.infer<typeof protectedReleaseRuntimeSchema>;

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function parseNormalizerSnapshot(input: unknown): Readonly<NormalizerSnapshot> {
  return deepFreeze(normalizerSnapshotSchema.parse(input));
}

export function parseGoldenCaseSet(input: unknown): Readonly<GoldenCaseSet> {
  return deepFreeze(goldenCaseSetSchema.parse(input));
}

export function parseReleaseEvidence(input: unknown): Readonly<ReleaseEvidence> {
  return deepFreeze(releaseEvidenceSchema.parse(input));
}

export function parseProtectedReleaseRuntime(input: unknown): Readonly<ProtectedReleaseRuntime> {
  return deepFreeze(protectedReleaseRuntimeSchema.parse(input));
}
