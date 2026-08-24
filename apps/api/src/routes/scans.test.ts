import { createEvidenceId, type DataStatus, type Evidence, type JsonValue, type ReportSnapshot } from "@dayu/evidence-schema";
import {
  collectPublicRepository,
  GitHubTransportError,
  type CollectedRepository,
  type GitHubTransport,
} from "@dayu/github-collector";
import { afterEach, describe, expect, it, vi } from "vitest";

import { memoryJobStore } from "../jobs/store.js";
import { buildServer } from "../server.js";

const SHA = "abcdef1234567890";
const START = new Date("2026-08-25T00:00:00.000Z");

function evidence(metric: string, value: JsonValue, options: { status?: DataStatus; limitations?: string[] } = {}): Evidence {
  const path = metric === "repository.file_content" ? "README.md" : `/repos/owner/repo/${metric}`;
  const file = metric === "repository.file_content" || metric === "repository.tree";
  return {
    fact: { metric, value },
    id: createEvidenceId({ commitSha: SHA, kind: file ? "file" : "metadata", path, repoId: 1 }),
    kind: file ? "file" : "metadata",
    limitations: options.limitations ?? [],
    observedAt: START.toISOString(),
    repository: { fullName: "owner/repo", id: 1 },
    schemaVersion: "1",
    source: file
      ? { commitSha: SHA, kind: "file", path }
      : { endpoint: `/repos/owner/repo/${metric}`, kind: "api", queryHash: "query" },
    status: options.status ?? "complete",
    summary: metric,
    value,
  };
}

function collected(options: { sparse?: boolean; partial?: boolean } = {}): CollectedRepository {
  const data: Evidence[] = [
    evidence("repository.metadata", {
      archived: false,
      createdAt: "2020-01-01T00:00:00Z",
      defaultBranch: "main",
      fork: false,
      forks: 100,
      hasIssues: true,
      isTemplate: false,
      openIssues: 4,
      pushedAt: "2026-08-24T00:00:00Z",
      stars: 500,
      subscribers: 30,
      updatedAt: "2026-08-24T00:00:00Z",
    }),
    evidence("repository.default_commit", { sha: SHA }),
  ];
  if (!options.sparse) {
    data.push(
      evidence("repository.tree", {
        apiTruncated: false,
        completeForNegativeEvidence: true,
        files: [
          { path: "README.md", size: 200, type: "blob" },
          { path: "package.json", size: 200, type: "blob" },
          { path: "src/index.ts", size: 500, type: "blob" },
          { path: "tests/index.test.ts", size: 500, type: "blob" },
        ],
        observedEntries: 4,
      }),
      evidence("repository.file_content", {
        bytes: 73,
        path: "README.md",
        text: "# Product\nProduction ready. Install with npm. Releases are published monthly.",
      }),
      evidence("repository.languages", { TypeScript: 1000 }),
      evidence("repository.community_profile", { healthPercentage: 80 }),
      evidence("repository.issues", { count: 2, items: [{ comments: 2, id: 1, state: "closed" }] }),
      evidence("repository.pull_requests", { count: 2, items: [{ comments: 2, id: 2, state: "closed" }] }),
      evidence("repository.releases", options.partial ? { available: false } : { count: 2, items: [] }, options.partial
        ? { limitations: ["github_data_being_generated"], status: "partial" }
        : {}),
      evidence("repository.contributors", options.partial ? { available: false } : { count: 8, items: [] }, options.partial
        ? { limitations: ["github_endpoint_restricted"], status: "restricted" }
        : {}),
    );
  }
  return {
    coverage: {
      attempted: data.length,
      complete: data.filter((item) => item.status === "complete").length,
      restricted: data.filter((item) => item.status === "restricted").length,
      truncated: data.filter((item) => item.status === "partial").length,
    },
    evidence: data,
    rateLimit: { remaining: 50, resetAt: null },
    repository: {
      defaultBranch: "main",
      defaultSha: SHA,
      fullName: "owner/repo",
      id: 1,
      stars: 500,
      subscribers: 30,
    },
  };
}

function realCollector(overrides: Record<string, unknown> = {}): (ref: { owner: string; repo: string }) => Promise<CollectedRepository> {
  const metadata = {
    archived: false,
    created_at: "2020-01-01T00:00:00Z",
    default_branch: "main",
    fork: false,
    forks_count: 20,
    full_name: "owner/repo",
    has_issues: true,
    id: 1,
    is_template: false,
    open_issues_count: 2,
    private: false,
    pushed_at: "2026-08-24T00:00:00Z",
    stargazers_count: 500,
    subscribers_count: 30,
    updated_at: "2026-08-24T00:00:00Z",
    watchers_count: 500,
  };
  const responses: Record<string, unknown> = {
    "/repos/owner/repo": metadata,
    "/repos/owner/repo/branches/main": { commit: { sha: SHA } },
    [`/repos/owner/repo/git/trees/${SHA}?recursive=1`]: {
      sha: SHA,
      tree: [{ path: "package.json", size: 100, type: "blob" }],
      truncated: true,
    },
    "/repos/owner/repo/languages": { TypeScript: 1000 },
    "/repos/owner/repo/community/profile": { health_percentage: 80 },
    "/repos/owner/repo/issues?state=all&per_page=100&page=1": [{ comments: 1, id: 1, state: "closed" }],
    "/repos/owner/repo/pulls?state=all&per_page=100&page=1": [{ comments: 1, id: 2, state: "closed" }],
    "/repos/owner/repo/releases?per_page=100&page=1": [{ id: 3, tag_name: "v1.0.0" }],
    "/repos/owner/repo/contributors?per_page=100&page=1": [{ contributions: 10 }],
    ...overrides,
  };
  const transport: GitHubTransport = {
    // The generic method is required by the collector transport contract.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    get<T>(path: `/${string}`, options?: { page?: number; perPage?: number }): Promise<{ data: T; headers: Headers }> {
      const query = [
        ...(options?.perPage === undefined ? [] : [`per_page=${String(options.perPage)}`]),
        ...(options?.page === undefined ? [] : [`page=${String(options.page)}`]),
      ].join("&");
      const key = query === "" ? path : `${path}${path.includes("?") ? "&" : "?"}${query}`;
      const value = responses[key];
      if (value instanceof Error) return Promise.reject(value);
      if (value === undefined) return Promise.reject(new Error(`unexpected_request:${key}`));
      return Promise.resolve({ data: value as T, headers: new Headers({ date: START.toUTCString() }) });
    },
  };
  return (ref) => collectPublicRepository(ref, transport);
}

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("job_did_not_settle");
}

const apps: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("rules scan routes", () => {
  it("creates and completes a rules-only public scan, then serves it after reconnect", async () => {
    const app = buildServer({ clock: () => START, collector: () => Promise.resolve(collected()), jobStore: memoryJobStore({ clock: () => START }) });
    apps.push(app);

    const created = await app.inject({ method: "POST", url: "/api/scans", payload: { repository: "owner/repo", locale: "en" } });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({ stage: "validated" });
    const jobId = created.json<{ jobId: string }>().jobId;

    const settled = await eventually(
      async () => app.inject({ method: "GET", url: `/api/scans/${jobId}` }),
      (response) => response.json<{ stage: string }>().stage === "rendered",
    );
    expect(settled.json()).toMatchObject({ repository: "owner/repo", stage: "rendered" });

    const report = await app.inject({ method: "GET", url: `/api/scans/${jobId}/report` });
    expect(report.statusCode).toBe(200);
    expect(report.json<ReportSnapshot>()).toMatchObject({ locale: "en", repository: { fullName: "owner/repo" } });
    expect(JSON.stringify(report.json())).not.toContain("Production ready");
  });

  it("retains completed evidence when endpoints are restricted or still generating", async () => {
    const app = buildServer({ clock: () => START, collector: () => Promise.resolve(collected({ partial: true })), jobStore: memoryJobStore({ clock: () => START }) });
    apps.push(app);
    const created = await app.inject({ method: "POST", url: "/api/scans", payload: { repository: "owner/repo", locale: "zh" } });
    const jobId = created.json<{ jobId: string }>().jobId;
    await eventually(
      async () => app.inject({ method: "GET", url: `/api/scans/${jobId}` }),
      (response) => response.json<{ stage: string }>().stage === "rendered",
    );
    const report = (await app.inject({ method: "GET", url: `/api/scans/${jobId}/report` })).json<ReportSnapshot>();
    expect(report.evidence.some((item) => item.status === "complete")).toBe(true);
    expect(report.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ limitations: ["github_endpoint_restricted"], status: "restricted" }),
      expect.objectContaining({ limitations: ["github_data_being_generated"], status: "partial" }),
    ]));
    const unavailable = new Set(report.evidence.filter((item) => item.status !== "complete").map((item) => item.id));
    expect(report.findings.flatMap((finding) => finding.evidenceIds.filter((id) => unavailable.has(id)))).toEqual([]);
  });

  it("returns an evidence-only report below the available-weight threshold", async () => {
    const app = buildServer({ clock: () => START, collector: () => Promise.resolve(collected({ sparse: true })), jobStore: memoryJobStore({ clock: () => START }) });
    apps.push(app);
    const created = await app.inject({ method: "POST", url: "/api/scans", payload: { repository: "owner/repo", locale: "en" } });
    const jobId = created.json<{ jobId: string }>().jobId;
    const settled = await eventually(
      async () => app.inject({ method: "GET", url: `/api/scans/${jobId}` }),
      (response) => response.json<{ stage: string }>().stage === "rendered",
    );
    expect(settled.json()).toMatchObject({ errorCode: "insufficient_evidence", stage: "rendered" });
    const report = (await app.inject({ method: "GET", url: `/api/scans/${jobId}/report` })).json<ReportSnapshot>();
    expect(report).toMatchObject({ baseScore: null, score: null, scoreKind: "insufficient_evidence" });
  });

  it("expires jobs after the configured TTL", async () => {
    let now = START;
    const store = memoryJobStore({ clock: () => now, ttlMs: 30 * 60 * 1000 });
    const app = buildServer({ clock: () => now, collector: () => Promise.resolve(collected()), jobStore: store });
    apps.push(app);
    const created = await app.inject({ method: "POST", url: "/api/scans", payload: { repository: "owner/repo", locale: "en" } });
    const jobId = created.json<{ jobId: string }>().jobId;
    await eventually(async () => store.get(jobId), (job) => job?.stage === "rendered");

    now = new Date(START.valueOf() + 30 * 60 * 1000 + 1);
    const response = await app.inject({ method: "GET", url: `/api/scans/${jobId}` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "scan_not_found" } });
  });

  it.each([
    { payload: { locale: "en", repository: "not a repo" }, status: 400 },
    { payload: { locale: "fr", repository: "owner/repo" }, status: 400 },
  ])("returns a stable invalid-repository response", async ({ payload, status }) => {
    const collector = (): Promise<CollectedRepository> => Promise.resolve(collected());
    const app = buildServer({ clock: () => START, collector, jobStore: memoryJobStore({ clock: () => START }) });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/scans", payload });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: { code: "invalid_repository" } });
  });

  it("enforces the configured 30 requests per hour limit", async () => {
    const app = buildServer({ clock: () => START, collector: () => Promise.resolve(collected()), jobStore: memoryJobStore({ clock: () => START }) });
    apps.push(app);
    for (let request = 0; request < 30; request += 1) {
      const response = await app.inject({
        headers: { "x-forwarded-for": `203.0.113.${String(request + 1)}` },
        method: "POST",
        url: "/api/scans",
        payload: { repository: "owner/repo", locale: "en" },
      });
      expect(response.statusCode).toBe(202);
    }
    const limited = await app.inject({
      headers: { "x-forwarded-for": "198.51.100.20" },
      method: "POST",
      url: "/api/scans",
      payload: { repository: "owner/repo", locale: "en" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: { code: "request_rate_limited" }, statusCode: 429 });
  });

  it("keys limits by forwarded client only behind an explicitly trusted proxy", async () => {
    const app = buildServer({
      clock: () => START,
      collector: () => Promise.resolve(collected()),
      jobStore: memoryJobStore({ clock: () => START }),
      trustedProxies: ["127.0.0.1"],
    });
    apps.push(app);
    for (let request = 0; request < 30; request += 1) {
      const response = await app.inject({
        headers: { "x-forwarded-for": "203.0.113.10" },
        method: "POST",
        url: "/api/scans",
        payload: { repository: "owner/repo", locale: "en" },
      });
      expect(response.statusCode).toBe(202);
    }
    const otherClient = await app.inject({
      headers: { "x-forwarded-for": "203.0.113.11" },
      method: "POST",
      url: "/api/scans",
      payload: { repository: "owner/repo", locale: "en" },
    });
    expect(otherClient.statusCode).toBe(202);
  });

  it("contains a terminal job-store rejection from detached background work", async () => {
    const baseStore = memoryJobStore({ clock: () => START });
    const onBackgroundError = vi.fn<(reason: unknown) => void>();
    const app = buildServer({
      clock: () => START,
      collector: () => Promise.reject(new Error("collector_offline")),
      jobStore: {
        ...baseStore,
        update(id, patch) {
          if (patch.stage === "failed") return Promise.reject(new Error("job_store_offline"));
          return baseStore.update(id, patch);
        },
      },
      onBackgroundError,
    });
    apps.push(app);
    const created = await app.inject({ method: "POST", url: "/api/scans", payload: { repository: "owner/repo", locale: "en" } });
    expect(created.statusCode).toBe(202);
    await eventually(
      () => Promise.resolve(onBackgroundError.mock.calls.length),
      (calls) => calls === 1,
    );
    expect(onBackgroundError).toHaveBeenCalledWith(expect.objectContaining({ message: "job_store_offline" }));
  });

  it("preserves real collector evidence for a secondary 403 and 202 response", async () => {
    const restricted = new GitHubTransportError("forbidden", "http_error", 403);
    const generating = new GitHubTransportError("accepted", "http_error", 202);
    const collector = realCollector({
      "/repos/owner/repo/contributors?per_page=100&page=1": restricted,
      "/repos/owner/repo/releases?per_page=100&page=1": generating,
    });
    const app = buildServer({ clock: () => START, collector, jobStore: memoryJobStore({ clock: () => START }) });
    apps.push(app);
    const created = await app.inject({ method: "POST", url: "/api/scans", payload: { repository: "owner/repo", locale: "en" } });
    const jobId = created.json<{ jobId: string }>().jobId;
    await eventually(
      async () => app.inject({ method: "GET", url: `/api/scans/${jobId}` }),
      (response) => response.json<{ stage: string }>().stage === "rendered",
    );
    const report = (await app.inject({ method: "GET", url: `/api/scans/${jobId}/report` })).json<ReportSnapshot>();
    expect(report.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ limitations: ["github_endpoint_restricted"], status: "restricted" }),
      expect.objectContaining({ limitations: ["github_data_being_generated"], status: "partial" }),
    ]));
    expect(report.evidence.some((item) => item.status === "complete")).toBe(true);
  });

  it.each([
    {
      code: "github_rate_limited",
      failure: new GitHubTransportError("rate limited", "rate_limit", 403, new Headers({ "x-ratelimit-remaining": "0" })),
    },
    { code: "private_or_unavailable", failure: new GitHubTransportError("not found", "http_error", 404) },
  ])("maps a real collector failure to $code", async ({ code, failure }) => {
    const app = buildServer({
      clock: () => START,
      collector: realCollector({ "/repos/owner/repo": failure }),
      jobStore: memoryJobStore({ clock: () => START }),
    });
    apps.push(app);
    const created = await app.inject({ method: "POST", url: "/api/scans", payload: { repository: "owner/repo", locale: "en" } });
    const jobId = created.json<{ jobId: string }>().jobId;
    const settled = await eventually(
      async () => app.inject({ method: "GET", url: `/api/scans/${jobId}` }),
      (response) => response.json<{ stage: string }>().stage === "failed",
    );
    expect(settled.json()).toMatchObject({ errorCode: code, stage: "failed" });
    const report = await app.inject({ method: "GET", url: `/api/scans/${jobId}/report` });
    expect(report.statusCode).toBe(502);
    expect(report.json()).toEqual({ error: { code } });
  });
});
