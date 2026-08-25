import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import { composeReleaseEvidence } from "./compose.js";
import { liveCopilotArtifactSchema } from "./live-copilot.js";
import { sha256Digest } from "./recompute.js";
import { parseGoldenCaseSet, parseNormalizerSnapshot } from "./schema.js";
import { manualSecurityReviewManifestSchema, securityFindingsManifestDigest, securityReviewArtifactSchema, securityReviewManifestDigest } from "./security-review.js";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.trim() === "") throw new Error(`missing_${name.slice(2).replaceAll("-", "_")}`);
  return value;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing_protected_${name.toLowerCase()}`);
  return value;
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function main(): Promise<void> {
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("protected_github_actions_required");
  const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const secretScanOutput = execFileSync("pnpm", ["ci:secrets"], { cwd: repositoryRoot, encoding: "utf8" });
  const licenseOutput = execFileSync("pnpm", ["ci:licenses"], { cwd: repositoryRoot, encoding: "utf8" });
  const auditRun = spawnSync("pnpm", ["audit", "--prod", "--json"], { cwd: repositoryRoot, encoding: "utf8" });
  if (auditRun.error !== undefined) throw auditRun.error;
  const auditDocument = JSON.parse(auditRun.stdout || "{}") as { metadata?: { vulnerabilities?: Partial<Record<"critical" | "high" | "low" | "moderate", number>> } };
  if (auditDocument.metadata?.vulnerabilities === undefined) throw new Error("dependency_audit_summary_missing");
  const vulnerabilities = auditDocument.metadata.vulnerabilities;
  const auditFindings = (["low", "moderate", "high", "critical"] as const).flatMap((severity) => {
    const count = vulnerabilities[severity] ?? 0;
    return count > 0 ? [{ count, id: `pnpm-audit-${severity}`, severity, source: "pnpm_audit" as const, status: "unresolved" as const }] : [];
  });
  const normalizer = parseNormalizerSnapshot(await json(`${repositoryRoot}/packages/calibration/data/normalizer-v1.json`));
  const golden = parseGoldenCaseSet(await json(`${repositoryRoot}/packages/calibration/data/golden-cases-v1.json`));
  const copilotArtifact = liveCopilotArtifactSchema.parse(await json(argument("--copilot-results")));
  const commitSha = requiredEnvironment("GITHUB_SHA");
  const workflowRunId = requiredEnvironment("GITHUB_RUN_ID");
  const manualSecurityReview = manualSecurityReviewManifestSchema.parse(await json(argument("--manual-security-review")));
  const findings = [...auditFindings, ...manualSecurityReview.findings.map((finding) => ({ ...finding, source: "manual_review" as const }))];
  const securityBase = {
    commitSha,
    findings,
    generatedAt: new Date().toISOString(),
    reviewAttestations: [
      { control: "dependency_audit" as const, evidenceDigest: sha256Digest({ command: ["audit", "--prod", "--json"], output: auditRun.stdout }), outcome: "pass" as const },
      { control: "license_policy" as const, evidenceDigest: sha256Digest({ command: ["ci:licenses"], output: licenseOutput }), outcome: "pass" as const },
      { control: "manual_security_review" as const, evidenceDigest: manualSecurityReview.manifestDigest, outcome: "pass" as const },
      { control: "secret_scan" as const, evidenceDigest: sha256Digest({ command: ["ci:secrets"], output: secretScanOutput }), outcome: "pass" as const },
    ],
    manualReviewManifestDigest: manualSecurityReview.manifestDigest,
    schemaVersion: "1" as const,
    workflowRunId,
  };
  const securityWithManifests = {
    ...securityBase,
    findingsManifestDigest: securityFindingsManifestDigest(securityBase),
    reviewManifestDigest: securityReviewManifestDigest(securityBase),
  };
  const securityArtifact = securityReviewArtifactSchema.parse({ ...securityWithManifests, artifactDigest: sha256Digest(securityWithManifests) });
  const evidence = composeReleaseEvidence({ copilotArtifact, golden, manualSecurityReview, normalizer, runtime: { commitSha, workflowRunId }, securityArtifact });
  await writeFile(argument("--output"), `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

await main();
