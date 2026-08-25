import { writeFile } from "node:fs/promises";

import { analyzeWithCopilot } from "@dayu/copilot-adapter";
import type { Evidence } from "@dayu/evidence-schema";
import { z } from "zod";

import { accountClassManifestDigest, accountClassRegistrySchema, liveCopilotArtifactSchema } from "./live-copilot.js";
import { sha256Digest } from "./recompute.js";

const accounts = ["free", "pro", "organization_managed"] as const;
const tokenNames = ["DAYU_COPILOT_FREE_TOKEN", "DAYU_COPILOT_PRO_TOKEN", "DAYU_COPILOT_ORG_TOKEN"] as const;

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

function evidenceFixture(): Evidence[] {
  return [{
    fact: { metric: "repository.metadata", value: { defaultBranch: "main", stars: 1 } },
    id: "ev_1234567890abcdef12345678",
    kind: "metadata",
    limitations: [],
    observedAt: "2026-08-25T00:00:00.000Z",
    repository: { fullName: "dayu/release-probe", id: 1 },
    schemaVersion: "1",
    source: { endpoint: "/repos/dayu/release-probe", kind: "api", queryHash: "release-probe-v1" },
    status: "complete",
    summary: "Bounded synthetic release probe; no repository content.",
    value: { defaultBranch: "main", stars: 1 },
  }];
}

async function verifyEmptyScopesAndIdentity(token: string): Promise<{ id: number; login: string }> {
  if (!token.startsWith("gho_")) throw new Error("copilot_probe_requires_empty_scope_oauth_token");
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "DAYU-protected-release-gate",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("github_identity_probe_failed");
  if (!response.headers.has("x-oauth-scopes")) throw new Error("github_scope_attestation_missing");
  const scopes = (response.headers.get("x-oauth-scopes") ?? "").split(",").map((scope) => scope.trim()).filter(Boolean);
  if (scopes.length !== 0) throw new Error("copilot_probe_token_must_have_empty_oauth_scope");
  const identity = z.object({ id: z.number().int().positive(), login: z.string().min(1).max(255) }).loose().parse(await response.json());
  return { id: identity.id, login: identity.login };
}

async function main(): Promise<void> {
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("protected_github_actions_required");
  const commitSha = requiredEnvironment("GITHUB_SHA");
  const workflowRunId = requiredEnvironment("GITHUB_RUN_ID");
  const identitySalt = requiredEnvironment("DAYU_COPILOT_IDENTITY_SALT");
  if (identitySalt.length < 32) throw new Error("copilot_identity_salt_too_short");
  const registry = accountClassRegistrySchema.parse(JSON.parse(requiredEnvironment("DAYU_COPILOT_ACCOUNT_CLASS_MANIFEST")) as unknown);
  const classifiedIds = new Map(registry.accounts.map((item) => [item.account, item.userId]));
  const evidence = evidenceFixture();
  const runs = [];
  for (const [index, account] of accounts.entries()) {
    const tokenName = tokenNames[index];
    if (tokenName === undefined) throw new Error("copilot_token_mapping_invalid");
    const token = requiredEnvironment(tokenName);
    const identity = await verifyEmptyScopesAndIdentity(token);
    if (classifiedIds.get(account) !== identity.id) throw new Error("copilot_account_class_registry_mismatch");
    const subjectDigest = sha256Digest({ identitySalt, login: identity.login.toLowerCase(), userId: identity.id });
    const analysis = await analyzeWithCopilot({ evidence, githubToken: token });
    runs.push({
      account,
      analysisDigest: sha256Digest(analysis),
      evidenceDigest: sha256Digest(evidence),
      repositoryPermissions: "none" as const,
      requestedScopes: [] as [],
      subjectDigest,
    });
  }
  if (new Set(runs.map((run) => run.subjectDigest)).size !== 3) throw new Error("copilot_matrix_requires_three_distinct_accounts");
  const provisionalAttestation = { auditSource: registry.auditSource, commitSha, manifestDigest: `sha256:${"0".repeat(64)}`, runs: runs.map(({ account, subjectDigest }) => ({ account, subjectDigest })), workflowRunId } as const;
  const accountClassAttestation = { ...provisionalAttestation, manifestDigest: accountClassManifestDigest({ accountClassAttestation: provisionalAttestation }) };
  const unsigned = { accountClassAttestation, commitSha, generatedAt: new Date().toISOString(), runs, schemaVersion: "1" as const, workflowRunId };
  const artifact = liveCopilotArtifactSchema.parse({ ...unsigned, artifactDigest: sha256Digest(unsigned) });
  await writeFile(argument("--output"), `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

await main();
