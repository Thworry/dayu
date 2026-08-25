import { createEvidenceId, type DataStatus, type Evidence, type JsonValue } from "../../../packages/evidence-schema/src/index.js";
import { GitHubTransportError, type CollectedRepository, type RepositoryRef } from "../../../packages/github-collector/src/index.js";
import type { AiFinding } from "../../../packages/copilot-adapter/src/index.js";

import { createMemoryVault } from "../../../apps/api/src/auth/memory-vault.js";
import { createOAuthService, type GitHubOAuthClient } from "../../../apps/api/src/auth/oauth.js";
import { DEVELOPMENT_SESSION_COOKIE_NAME } from "../../../apps/api/src/auth/session.js";
import { createAes256GcmEncryptionAdapter } from "../../../apps/api/src/auth/token-vault.js";
import type { EnhancementAnalyzer } from "../../../apps/api/src/jobs/enhance-runner.js";
import { memoryJobStore } from "../../../apps/api/src/jobs/store.js";
import { buildServer } from "../../../apps/api/src/server.js";

if (process.env.NODE_ENV !== "test") throw new Error("The E2E API harness can run only with NODE_ENV=test");

const port = Number(process.env.DAYU_E2E_API_PORT ?? "43174");
const webOrigin = process.env.DAYU_E2E_WEB_ORIGIN ?? "http://127.0.0.1:43173";
if (!Number.isInteger(port) || port < 1_024 || port > 65_535) throw new Error("invalid DAYU_E2E_API_PORT");

const SHA = "abcdef1234567890";
const maliciousText = `</strong><img src=x onerror="window.__dayuPwned=true"><script>window.__dayuPwned=true</script><svg onload="window.__dayuPwned=true"></svg>`;

function observation(
  repository: { fullName: string; id: number },
  metric: string,
  value: JsonValue,
  options: { limitations?: string[]; status?: DataStatus } = {},
): Evidence {
  const file = metric === "repository.file_content" || metric === "repository.tree";
  const path = metric === "repository.file_content" ? "README.md" : file ? "tree" : `/repos/${repository.fullName}/${metric}`;
  return {
    fact: { metric, value },
    id: createEvidenceId({ commitSha: SHA, kind: file ? "file" : "metadata", path, repoId: repository.id }),
    kind: file ? "file" : "metadata",
    limitations: options.limitations ?? [],
    observedAt: "2026-08-25T00:00:00.000Z",
    repository,
    schemaVersion: "1",
    source: file ? { commitSha: SHA, kind: "file", path } : { endpoint: `/repos/${repository.fullName}`, kind: "api", queryHash: metric },
    status: options.status ?? "complete",
    summary: metric === "repository.metadata" ? maliciousText : metric,
    value,
  };
}

function collected(ref: RepositoryRef): CollectedRepository {
  const repository = { fullName: `${ref.owner}/${ref.repo}`, id: ref.repo === "second" ? 2 : 1 };
  const treePartial = ref.repo === "tree-truncated";
  const statsPartial = ref.repo === "stats-pending";
  const evidence = [
    observation(repository, "repository.metadata", {
      archived: false, createdAt: "2020-01-01T00:00:00Z", defaultBranch: "main", description: maliciousText,
      fork: false, forks: 100, hasIssues: true, isTemplate: false, openIssues: 4,
      pushedAt: "2026-08-24T00:00:00Z", stars: 500, subscribers: 30, updatedAt: "2026-08-24T00:00:00Z",
    }),
    observation(repository, "repository.default_commit", { sha: SHA }),
    observation(repository, "repository.tree", {
      apiTruncated: treePartial,
      completeForNegativeEvidence: !treePartial,
      files: [{ path: "README.md", size: 200, type: "blob" }, { path: "src/index.ts", size: 500, type: "blob" }],
      observedEntries: 2,
    }, treePartial ? { limitations: ["github_tree_truncated"], status: "partial" } : {}),
    observation(repository, "repository.file_content", { bytes: 52, path: "README.md", text: "# Product\nInstall with pnpm. Releases are published." }),
    observation(repository, "repository.languages", { TypeScript: 1_000 }),
    observation(repository, "repository.community_profile", { healthPercentage: 80 }),
    observation(repository, "repository.issues", { count: 2, items: [{ comments: 2, id: 1, state: "closed" }] }),
    observation(repository, "repository.pull_requests", { count: 2, items: [{ comments: 2, id: 2, state: "closed" }] }),
    observation(repository, "repository.releases", { count: 2, items: [] }),
    observation(repository, "repository.contributors", statsPartial ? { available: false } : { count: 8, items: [] }, statsPartial
      ? { limitations: ["github_data_being_generated"], status: "partial" }
      : {}),
  ];
  return {
    coverage: {
      attempted: evidence.length,
      complete: evidence.filter((item) => item.status === "complete").length,
      restricted: 0,
      truncated: evidence.filter((item) => item.status === "partial").length,
    },
    evidence,
    rateLimit: { remaining: 50, resetAt: null },
    repository: { defaultBranch: "main", defaultSha: SHA, fullName: repository.fullName, id: repository.id, stars: 500, subscribers: 30 },
  };
}

function collector(ref: RepositoryRef): Promise<CollectedRepository> {
  if (ref.repo === "private") return Promise.reject(new Error("private_or_unavailable"));
  if (ref.repo === "rate-limited") return Promise.reject(new GitHubTransportError("fixture rate limit", "rate_limit", 429, new Headers({ "retry-after": "60" })));
  return Promise.resolve(collected(ref));
}

const cipher = createAes256GcmEncryptionAdapter(new Uint8Array(32).fill(7));
const vault = createMemoryVault({ cipher, hmacSecret: new Uint8Array(32).fill(9) });
const githubClient: GitHubOAuthClient = {
  exchangeCode: ({ code }) => Promise.resolve({ accessToken: `dayu-e2e-access-${code}`, expiresInSeconds: 3_600 }),
  getUser: (accessToken) => Promise.resolve({ id: accessToken.endsWith("user-b") ? 202 : 101 }),
  revokeToken: () => Promise.resolve(),
};
const oauth = createOAuthService({
  cipher,
  clientId: "dayu-e2e-client",
  githubClient,
  redirectUri: `${webOrigin}/api/auth/github/callback`,
  transactionHmacSecret: new Uint8Array(32).fill(11),
  vault,
});

const analyze: EnhancementAnalyzer = (input) => {
  const evidence = input.evidence.find((item) => item.status === "complete");
  if (evidence === undefined) throw new Error("copilot_invalid_output");
  const finding: AiFinding = {
    counterEvidenceIds: [], dimension: "claims", en: "[SUPPORTED] Public evidence supports this bounded finding.",
    evidenceIds: [evidence.id], risk: 0, rubricId: "claims.install", verdict: "supported",
    zh: "[支持] 公开证据支持这项有限判断。",
  };
  return Promise.resolve({ findings: [finding], model: "gpt-5-mini" });
};

const app = buildServer({
  auth: { appOrigin: webOrigin, oauth, secureCookie: false },
  collector,
  copilot: { analyze },
  jobStore: memoryJobStore(),
});

app.get("/__dayu_api/ready", () => ({ app: "DAYU API", ready: true }));
app.get("/api/__test/session", async (request, reply) => {
  if (request.ip !== "127.0.0.1" && request.ip !== "::1") return await reply.code(404).send();
  const candidate = request.query as { user?: unknown };
  if (candidate.user !== "user-a" && candidate.user !== "user-b") return await reply.code(400).send({ error: { code: "invalid_test_user" } });
  const started = oauth.begin({ returnTo: "/en/r/owner/reality-check" });
  const session = await oauth.complete({ code: candidate.user, state: started.state, transactionSecret: started.transactionSecret });
  reply.header("Cache-Control", "no-store");
  reply.header("Set-Cookie", `${DEVELOPMENT_SESSION_COOKIE_NAME}=${session.rawSessionId}; Path=/; HttpOnly; SameSite=Lax`);
  return { csrfToken: session.csrfToken, githubUserId: session.githubUserId };
});

await app.listen({ host: "127.0.0.1", port });

async function shutdown(): Promise<void> {
  await app.close();
  process.exit(0);
}
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
