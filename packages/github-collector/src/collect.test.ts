import { describe, expect, it } from "vitest";

import fixture from "../test/fixtures/repository.json" with { type: "json" };
import { collectPublicRepository } from "./collect.js";
import { GitHubTransportError, type GitHubTransport } from "./client.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function jsonHeaders(values: Record<string, string> = {}): Headers {
  return new Headers(values);
}

function fixtureTransport(
  overrides: Record<string, unknown> = {},
  headerOverrides: Record<string, Headers> = {},
): GitHubTransport {
  const responses: Record<string, unknown> = {
    "/repos/facebook/react": fixture,
    "/repos/facebook/react/branches/main": { commit: { sha: SHA } },
    [`/repos/facebook/react/git/trees/${SHA}?recursive=1`]: {
      sha: SHA,
      truncated: true,
      tree: [
        { path: "README.md", type: "blob", size: 4000 },
        { path: "package.json", type: "blob", size: 2000 },
      ],
    },
    "/repos/facebook/react/languages": { JavaScript: 1000, TypeScript: 500 },
    "/repos/facebook/react/community/profile": { health_percentage: 90 },
    "/repos/facebook/react/issues?state=all&per_page=100&page=1": [
      { id: 1, state: "open", comments: 2, created_at: "2026-08-01T00:00:00Z", author_association: "NONE" },
      { id: 2, state: "closed", pull_request: {}, comments: 1, created_at: "2026-08-02T00:00:00Z" },
    ],
    "/repos/facebook/react/pulls?state=all&per_page=100&page=1": [
      { id: 2, state: "closed", merged_at: "2026-08-03T00:00:00Z", comments: 1, review_comments: 2 },
    ],
    "/repos/facebook/react/releases?per_page=100&page=1": [
      { id: 3, tag_name: "v1.0.0", draft: false, prerelease: false, published_at: "2026-08-04T00:00:00Z" },
    ],
    "/repos/facebook/react/contributors?per_page=100&page=1": [{ contributions: 20 }, { contributions: 5 }],
    ...overrides,
  };

  return {
    // The generic method is required by the production transport contract.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    get<T>(path: `/${string}`, options?: { page?: number; perPage?: number }): Promise<{ data: T; headers: Headers }> {
      const pagination = [
        ...(options?.perPage === undefined ? [] : [`per_page=${String(options.perPage)}`]),
        ...(options?.page === undefined ? [] : [`page=${String(options.page)}`]),
      ].join("&");
      const key = pagination.length === 0 ? path : `${path}${path.includes("?") ? "&" : "?"}${pagination}`;
      const value = responses[key];
      if (value instanceof Error) return Promise.reject(value);
      if (value === undefined) return Promise.reject(new Error(`unexpected_request:${key}`));
      const headers = headerOverrides[key] ?? (path === "/repos/facebook/react"
        ? jsonHeaders({ "x-ratelimit-remaining": "51", "x-ratelimit-reset": "1787558400" })
        : jsonHeaders());
      return Promise.resolve({ data: value as T, headers });
    },
  };
}

describe("collectPublicRepository", () => {
  it("collects a bounded pinned envelope and marks a truncated tree partial", async () => {
    const result = await collectPublicRepository({ owner: "facebook", repo: "react" }, fixtureTransport());

    expect(result.repository).toEqual({
      defaultBranch: "main",
      defaultSha: SHA,
      fullName: "facebook/react",
      id: 10270250,
      stars: 238000,
      subscribers: 6700,
    });
    expect(result.coverage).toEqual({ attempted: 9, complete: 8, restricted: 0, truncated: 1 });
    expect(result.rateLimit).toEqual({ remaining: 51, resetAt: "2026-08-24T08:00:00.000Z" });
    expect(result.evidence).toHaveLength(9);
    expect(result.evidence.every((item) => item.repository.fullName === "facebook/react")).toBe(true);
    expect(result.evidence.find((item) => item.fact.metric === "repository.tree")).toMatchObject({
      limitations: ["github_tree_truncated", "negative_file_conclusions_disabled"],
      status: "partial",
    });
    expect(result.evidence.some((item) => item.fact.metric === "repository.file_content")).toBe(false);

    const issues = result.evidence.find((item) => item.fact.metric === "repository.issues");
    expect(issues?.value).toMatchObject({
      count: 1,
      pagination: { complete: true, countSemantics: "exact", page: 1, perPage: 100 },
    });
    expect(JSON.stringify(issues?.value)).not.toContain("login");
  });

  it("marks a bounded first page as a partial lower bound when GitHub links a next page", async () => {
    const contributorPath = "/repos/facebook/react/contributors?per_page=100&page=1";
    const contributors = Array.from({ length: 100 }, (_, index) => ({ contributions: index + 1 }));
    const result = await collectPublicRepository(
      { owner: "facebook", repo: "react" },
      fixtureTransport({ [contributorPath]: contributors }, {
        [contributorPath]: jsonHeaders({
          link: '<https://api.github.com/repositories/10270250/contributors?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/10270250/contributors?per_page=100&page=3>; rel="last"',
        }),
      }),
    );

    expect(result.coverage).toEqual({ attempted: 9, complete: 7, restricted: 0, truncated: 2 });
    expect(result.evidence.find((item) => item.fact.metric === "repository.contributors")).toMatchObject({
      limitations: ["bounded_first_page"],
      status: "partial",
      value: {
        count: 100,
        pagination: { complete: false, countSemantics: "lower_bound", page: 1, perPage: 100 },
      },
    });
  });

  it("turns a restricted endpoint into evidence instead of risk", async () => {
    const restricted = new GitHubTransportError("forbidden", "http_error", 403);
    const result = await collectPublicRepository(
      { owner: "facebook", repo: "react" },
      fixtureTransport({ "/repos/facebook/react/contributors?per_page=100&page=1": restricted }),
    );

    expect(result.coverage).toEqual({ attempted: 9, complete: 7, restricted: 1, truncated: 1 });
    expect(result.evidence.find((item) => item.fact.metric === "repository.contributors")?.status).toBe("restricted");
  });

  it("fetches only selected bounded text blobs after a complete tree", async () => {
    const readmeSha = "1111111111111111111111111111111111111111";
    const manifestSha = "2222222222222222222222222222222222222222";
    const result = await collectPublicRepository({ owner: "facebook", repo: "react" }, fixtureTransport({
      [`/repos/facebook/react/git/trees/${SHA}?recursive=1`]: {
        sha: SHA,
        truncated: false,
        tree: [
          { path: "README.md", sha: readmeSha, size: 11, type: "blob" },
          { path: "package.json", sha: manifestSha, size: 16, type: "blob" },
          { path: "docs/screenshot.png", sha: "3333333333333333333333333333333333333333", size: 100, type: "blob" },
          { path: "LICENSE", sha: "4444444444444444444444444444444444444444", size: 200000, type: "blob" },
        ],
      },
      [`/repos/facebook/react/git/blobs/${readmeSha}`]: {
        content: Buffer.from("Hello DAYU\n").toString("base64"), encoding: "base64", size: 11,
      },
      [`/repos/facebook/react/git/blobs/${manifestSha}`]: {
        content: Buffer.from('{"name":"dayu"}\n').toString("base64"), encoding: "base64", size: 16,
      },
    }));

    const files = result.evidence.filter((item) => item.source.kind === "file" && item.fact.metric === "repository.file_content");
    expect(files).toHaveLength(2);
    expect(files.map((item) => item.source.kind === "file" ? item.source.path : "")).toEqual(["README.md", "package.json"]);
    expect(files.every((item) => item.source.kind === "file" && item.source.commitSha === SHA)).toBe(true);
    expect(JSON.stringify(files)).not.toContain("screenshot.png");
  });

  it("reports secondary rate limiting as partial evidence and exposes reset time", async () => {
    const headers = jsonHeaders({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1787558400" });
    const rateLimit = new GitHubTransportError("rate limited", "rate_limit", 403, headers);
    const result = await collectPublicRepository(
      { owner: "facebook", repo: "react" },
      fixtureTransport({ "/repos/facebook/react/contributors?per_page=100&page=1": rateLimit }),
    );

    expect(result.evidence.find((item) => item.fact.metric === "repository.contributors")).toMatchObject({
      limitations: ["github_rate_limit_exhausted"], status: "partial",
    });
    expect(result.rateLimit).toEqual({ remaining: 0, resetAt: "2026-08-24T08:00:00.000Z" });
  });

  it("aggregates the lowest rate limit across metadata, branch, endpoints, and blobs", async () => {
    const readmeSha = "5555555555555555555555555555555555555555";
    const treePath = `/repos/facebook/react/git/trees/${SHA}?recursive=1`;
    const blobPath = `/repos/facebook/react/git/blobs/${readmeSha}`;
    const result = await collectPublicRepository(
      { owner: "facebook", repo: "react" },
      fixtureTransport({
        [treePath]: {
          sha: SHA,
          truncated: false,
          tree: [{ path: "README.md", sha: readmeSha, size: 2, type: "blob" }],
        },
        [blobPath]: { content: "e30=", encoding: "base64", size: 2 },
      }, {
        "/repos/facebook/react": jsonHeaders({ "x-ratelimit-remaining": "51", "x-ratelimit-reset": "1787558400" }),
        "/repos/facebook/react/branches/main": jsonHeaders({ "x-ratelimit-remaining": "50", "x-ratelimit-reset": "1787558400" }),
        "/repos/facebook/react/languages": jsonHeaders({ "x-ratelimit-remaining": "44", "x-ratelimit-reset": "1787558500" }),
        [blobPath]: jsonHeaders({ "x-ratelimit-remaining": "37", "x-ratelimit-reset": "1787558600" }),
      }),
    );

    expect(result.rateLimit).toEqual({ remaining: 37, resetAt: "2026-08-24T08:03:20.000Z" });
  });

  it("marks an invalid or truncated selected blob as partial evidence", async () => {
    const readmeSha = "6666666666666666666666666666666666666666";
    const result = await collectPublicRepository({ owner: "facebook", repo: "react" }, fixtureTransport({
      [`/repos/facebook/react/git/trees/${SHA}?recursive=1`]: {
        sha: SHA,
        truncated: false,
        tree: [{ path: "README.md", sha: readmeSha, size: 3, type: "blob" }],
      },
      [`/repos/facebook/react/git/blobs/${readmeSha}`]: { content: "YQ==", encoding: "base64", size: 3 },
    }));

    expect(result.evidence.find((item) => item.fact.metric === "repository.file_content")).toMatchObject({
      limitations: ["invalid_or_truncated_blob"], status: "partial",
    });
  });

  it("does not misreport a metadata rate limit as a private repository", async () => {
    const headers = jsonHeaders({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1787558400" });
    const rateLimit = new GitHubTransportError("rate limited", "rate_limit", 403, headers);
    const error = await collectPublicRepository(
      { owner: "facebook", repo: "react" },
      fixtureTransport({ "/repos/facebook/react": rateLimit }),
    ).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "rate_limit", rateLimit: { remaining: 0 } });
    expect((error as Error).message).not.toBe("private_or_unavailable");
  });

  it("rejects private repositories before secondary requests", async () => {
    const transport = fixtureTransport({ "/repos/facebook/react": { ...fixture, private: true } });
    await expect(collectPublicRepository({ owner: "facebook", repo: "react" }, transport)).rejects.toThrow(
      "private_or_unavailable",
    );
  });
});
