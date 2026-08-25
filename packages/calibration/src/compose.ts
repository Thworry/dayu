import { liveCopilotArtifactMatchesManifests, liveCopilotArtifactSchema, type LiveCopilotArtifact } from "./live-copilot.js";
import { recomputeGoldenCase, recomputedManifestDigest, reviewLabelsMatchManifest, sha256Digest } from "./recompute.js";
import { releaseEvidenceSchema, type GoldenCaseSet, type NormalizerSnapshot, type ReleaseEvidence } from "./schema.js";
import { manualSecurityReviewManifestIsCurrent, manualSecurityReviewManifestSchema, securityReviewArtifactMatchesManifests, securityReviewArtifactSchema, unresolvedHighOrCritical, type ManualSecurityReviewManifest, type SecurityReviewArtifact } from "./security-review.js";

export function verifyProductionScoringData(golden: GoldenCaseSet, normalizer: NormalizerSnapshot): string {
  if (normalizer.dataClassification !== "public_aggregate" || golden.dataClassification !== "blind_reviewed_public") throw new Error("production_calibration_data_required");
  const manifest = recomputedManifestDigest(golden, normalizer.scoringNormalizer);
  if (manifest === null || manifest !== golden.manifestDigest) throw new Error("scoring_manifest_recomputation_failed");
  if (!reviewLabelsMatchManifest(golden)) throw new Error("reviewed_label_manifest_recomputation_failed");
  for (const item of golden.cases) {
    const recomputed = recomputeGoldenCase(item, normalizer.scoringNormalizer);
    if (recomputed?.currentScore !== item.currentScore
      || recomputed.inputDigest !== item.scoringInputDigest
      || recomputed.outputDigest !== item.scoringOutputDigest
      || recomputed.repositoryType !== item.repositoryType) throw new Error("golden_case_recomputation_failed");
  }
  return manifest;
}

export function composeReleaseEvidence(input: {
  copilotArtifact: LiveCopilotArtifact;
  golden: GoldenCaseSet;
  manualSecurityReview: ManualSecurityReviewManifest;
  normalizer: NormalizerSnapshot;
  runtime: { commitSha: string; workflowRunId: string };
  securityArtifact: SecurityReviewArtifact;
}): ReleaseEvidence {
  const artifact = liveCopilotArtifactSchema.parse(input.copilotArtifact);
  if (!liveCopilotArtifactMatchesManifests(artifact)) throw new Error("copilot_artifact_or_account_class_manifest_mismatch");
  if (artifact.commitSha !== input.runtime.commitSha || artifact.workflowRunId !== input.runtime.workflowRunId) throw new Error("copilot_artifact_runtime_mismatch");
  const security = securityReviewArtifactSchema.parse(input.securityArtifact);
  const manualReview = manualSecurityReviewManifestSchema.parse(input.manualSecurityReview);
  if (!manualSecurityReviewManifestIsCurrent(manualReview, input.runtime)) throw new Error("manual_security_review_missing_stale_or_tampered");
  const mergedManualFindings = security.findings.filter((finding) => finding.source === "manual_review").map((finding) => ({ count: finding.count, id: finding.id, severity: finding.severity, status: finding.status }));
  const manualAttestation = security.reviewAttestations.find((review) => review.control === "manual_security_review");
  if (security.manualReviewManifestDigest !== manualReview.manifestDigest
    || manualAttestation?.evidenceDigest !== manualReview.manifestDigest
    || sha256Digest(mergedManualFindings) !== sha256Digest(manualReview.findings)) throw new Error("manual_security_review_not_merged");
  if (!securityReviewArtifactMatchesManifests(security)) throw new Error("security_review_manifest_mismatch");
  if (security.commitSha !== input.runtime.commitSha || security.workflowRunId !== input.runtime.workflowRunId) throw new Error("security_review_runtime_mismatch");
  const highOrCritical = unresolvedHighOrCritical(security);
  if (highOrCritical !== 0) throw new Error("unresolved_high_or_critical_security_findings");
  verifyProductionScoringData(input.golden, input.normalizer);
  return releaseEvidenceSchema.parse({
    copilotMatrix: {
      accountClassManifestDigest: artifact.accountClassAttestation.manifestDigest,
      attestationDigest: artifact.artifactDigest,
      runs: artifact.runs.map((run) => ({
        account: run.account,
        commitSha: input.runtime.commitSha,
        evidenceDigest: run.evidenceDigest,
        outcome: "pass",
        repositoryPermissions: run.repositoryPermissions,
        requestedScopes: run.requestedScopes,
        subjectDigest: run.subjectDigest,
      })),
      status: "verified",
      verificationSource: "github_actions_protected_environment",
      workflowRunId: input.runtime.workflowRunId,
    },
    generatedAt: new Date().toISOString(),
    immutable: true,
    schemaVersion: "1",
    scoringPipeline: {
      ...input.golden.bindings,
      commitSha: input.runtime.commitSha,
      manifestDigest: input.golden.manifestDigest,
      reviewedLabelManifestDigest: input.golden.reviewedLabelManifestDigest,
      status: "verified",
      verificationSource: "github_actions_protected_environment",
      workflowRunId: input.runtime.workflowRunId,
    },
    securityReview: {
      artifactGeneratedAt: security.generatedAt,
      artifactSchemaVersion: security.schemaVersion,
      commitSha: input.runtime.commitSha,
      findings: security.findings,
      findingsManifestDigest: security.findingsManifestDigest,
      manualReviewManifestDigest: security.manualReviewManifestDigest,
      reportDigest: security.artifactDigest,
      reviewAttestations: security.reviewAttestations,
      reviewManifestDigest: security.reviewManifestDigest,
      status: "verified",
      verificationSource: "github_actions_protected_environment",
      workflowRunId: input.runtime.workflowRunId,
      unresolvedHighOrCritical: highOrCritical,
    },
  });
}
