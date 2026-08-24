import { describe, expect, it, vi } from "vitest";

import { createGitHubTransport, GitHubTransportError, readGitHubRateLimit } from "./client.js";

describe("createGitHubTransport", () => {
  it("always requests the fixed GitHub API host", async () => {
    const fetchMock = vi.fn((input: URL, init: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }));
    });
    const transport = createGitHubTransport({ fetch: fetchMock });

    await transport.get("/repos/facebook/react", { page: 1, perPage: 10 });

    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(URL);
    if (!(request instanceof URL)) throw new Error("request URL was not captured");
    expect(request.origin).toBe("https://api.github.com");
    expect(request.pathname).toBe("/repos/facebook/react");
    expect(request.searchParams.get("page")).toBe("1");
    expect(request.searchParams.get("per_page")).toBe("10");
  });

  it.each(["//evil.example/repos/a/b", "/../../https://evil.example"]) (
    "rejects paths that cannot stay on the fixed host: %s",
    async (path) => {
      const fetchMock = vi.fn();
      const transport = createGitHubTransport({ fetch: fetchMock });

      await expect(transport.get(path as `/${string}`)).rejects.toMatchObject({ code: "invalid_path" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("enforces its request budget", async () => {
    const fetchMock = vi.fn((input: URL, init: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const transport = createGitHubTransport({ fetch: fetchMock, limits: { maxRequests: 1 } });

    await transport.get("/rate_limit");
    await expect(transport.get("/rate_limit")).rejects.toBeInstanceOf(GitHubTransportError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/repos/a/b/issues?page=5", undefined],
    ["/repos/a/b/issues?page=1", { page: 2 }],
    ["/repos/a/b/issues?per_page=20", { perPage: 50 }],
    ["/repos/a/b/issues?page=1&page=2", undefined],
  ] as const)("rejects unbounded or conflicting pagination in %s", async (path, requestOptions) => {
    const fetchMock = vi.fn();
    const transport = createGitHubTransport({ fetch: fetchMock });
    await expect(transport.get(path, requestOptions)).rejects.toMatchObject({ code: "request_budget" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves rate limit headers and exposes their reset time", async () => {
    const headers = new Headers({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "1787558400",
    });
    const fetchMock = vi.fn((input: URL, init: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response("{}", { headers, status: 403 }));
    });
    const transport = createGitHubTransport({ fetch: fetchMock });

    const error = await transport.get("/repos/facebook/react").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(GitHubTransportError);
    expect(error).toMatchObject({
      code: "rate_limit",
      rateLimit: { remaining: 0, resetAt: "2026-08-24T08:00:00.000Z" },
      status: 403,
    });
    expect((error as GitHubTransportError).headers?.get("x-ratelimit-remaining")).toBe("0");
  });

  it("does not treat an ordinary forbidden response with quota remaining as rate limiting", async () => {
    const headers = new Headers({
      "x-ratelimit-remaining": "51",
      "x-ratelimit-reset": "1787558400",
    });
    const fetchMock = vi.fn((input: URL, init: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response("{}", { headers, status: 403 }));
    });
    const error = await createGitHubTransport({ fetch: fetchMock })
      .get("/repos/facebook/react/contributors")
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "http_error", status: 403 });
  });

  it("cancels a streaming response immediately when a chunk exceeds the byte budget", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"too":"large"}'));
      },
    });
    const fetchMock = vi.fn((input: URL, init: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const transport = createGitHubTransport({ fetch: fetchMock, limits: { maxTotalBytes: 4 } });

    await expect(transport.get("/rate_limit")).rejects.toMatchObject({ code: "response_budget" });
    expect(cancelled).toBe(true);
  });

  it("shares the streaming byte budget across concurrent responses", async () => {
    const fetchMock = vi.fn((input: URL, init: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const transport = createGitHubTransport({ fetch: fetchMock, limits: { maxTotalBytes: 3 } });

    const results = await Promise.allSettled([transport.get("/one"), transport.get("/two")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "response_budget" },
    });
  });
});

describe("readGitHubRateLimit", () => {
  it("converts Retry-After delta seconds into a reset time", () => {
    const headers = new Headers({ "retry-after": "90" });
    expect(readGitHubRateLimit(headers, new Date("2026-08-25T00:00:00.000Z")).resetAt).toBe(
      "2026-08-25T00:01:30.000Z",
    );
  });

  it("parses an HTTP-date Retry-After value", () => {
    const headers = new Headers({ "retry-after": "Tue, 25 Aug 2026 00:05:00 GMT" });
    expect(readGitHubRateLimit(headers, new Date("2026-08-25T00:00:00.000Z")).resetAt).toBe(
      "2026-08-25T00:05:00.000Z",
    );
  });

  it("prefers a valid x-ratelimit-reset value", () => {
    const headers = new Headers({
      "retry-after": "90",
      "x-ratelimit-reset": "1787558400",
    });
    expect(readGitHubRateLimit(headers, new Date("2026-08-25T00:00:00.000Z")).resetAt).toBe(
      "2026-08-24T08:00:00.000Z",
    );
  });
});
