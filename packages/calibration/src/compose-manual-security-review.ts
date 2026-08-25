import { writeFile } from "node:fs/promises";

import { manualSecurityReviewManifestDigest, manualSecurityReviewManifestSchema, protectedManualReviewSourceDigest, protectedManualReviewSourceSchema, unsignedProtectedManualReviewSource } from "./security-review.js";

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

async function main(): Promise<void> {
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("protected_github_actions_required");
  const commitSha = requiredEnvironment("GITHUB_SHA");
  const workflowRunId = requiredEnvironment("GITHUB_RUN_ID");
  const source = protectedManualReviewSourceSchema.parse(JSON.parse(requiredEnvironment("DAYU_MANUAL_SECURITY_REVIEW_SOURCE")) as unknown);
  if (source.sourceDigest !== protectedManualReviewSourceDigest(unsignedProtectedManualReviewSource(source))) throw new Error("manual_security_review_source_digest_mismatch");
  const now = new Date();
  if (source.reviewedCommitSha !== commitSha) throw new Error("manual_security_review_commit_mismatch");
  if (Date.parse(source.generatedAt) > now.getTime()
    || Date.parse(source.expiresAt) <= now.getTime()
    || Date.parse(source.expiresAt) - Date.parse(source.generatedAt) > 7 * 24 * 60 * 60 * 1_000) throw new Error("manual_security_review_expired_or_not_yet_valid");
  const unsignedManifest = {
    commitSha,
    expiresAt: source.expiresAt,
    findings: source.findings,
    generatedAt: now.toISOString(),
    immutable: true as const,
    review: source.review,
    schemaVersion: "1" as const,
    sourceDigest: source.sourceDigest,
    sourceGeneratedAt: source.generatedAt,
    workflowRunId,
  };
  const manifest = manualSecurityReviewManifestSchema.parse({ ...unsignedManifest, manifestDigest: manualSecurityReviewManifestDigest(unsignedManifest) });
  await writeFile(argument("--output"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

await main();
