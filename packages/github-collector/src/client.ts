import { PUBLIC_SCAN_LIMITS, type PublicScanLimits } from "./limits.js";

export interface GitHubTransportResponse<T> {
  data: T;
  headers: Headers;
}

export interface GitHubTransport {
  get<T>(
    path: `/${string}`,
    options?: { page?: number; perPage?: number },
  ): Promise<GitHubTransportResponse<T>>;
}

export interface GitHubRateLimit {
  remaining: number | null;
  resetAt: string | null;
}

export function readGitHubRateLimit(headers: Headers, now: Date = new Date()): GitHubRateLimit {
  const remainingHeader = headers.get("x-ratelimit-remaining");
  const remainingNumber = remainingHeader === null ? Number.NaN : Number(remainingHeader);
  const resetHeader = headers.get("x-ratelimit-reset");
  const resetNumber = resetHeader === null ? Number.NaN : Number(resetHeader);
  const retryAfter = headers.get("retry-after");
  let retryAt: string | null = null;
  if (retryAfter !== null) {
    if (/^\d+$/.test(retryAfter)) {
      retryAt = new Date(now.valueOf() + Number(retryAfter) * 1000).toISOString();
    } else {
      const parsed = new Date(retryAfter);
      if (!Number.isNaN(parsed.valueOf())) retryAt = parsed.toISOString();
    }
  }
  return {
    remaining: Number.isInteger(remainingNumber) && remainingNumber >= 0 ? remainingNumber : retryAfter === null ? null : 0,
    resetAt: Number.isFinite(resetNumber) && resetNumber > 0 ? new Date(resetNumber * 1000).toISOString() : retryAt,
  };
}

export class GitHubTransportError extends Error {
  readonly code: "invalid_path" | "request_budget" | "response_budget" | "timeout" | "http_error" | "invalid_json" | "rate_limit";
  readonly status: number | undefined;
  readonly headers: Headers | undefined;
  readonly rateLimit: GitHubRateLimit | undefined;

  constructor(
    message: string,
    code: GitHubTransportError["code"],
    status?: number,
    headers?: Headers,
  ) {
    super(message);
    this.name = "GitHubTransportError";
    this.code = code;
    this.status = status;
    this.headers = headers;
    this.rateLimit = headers === undefined ? undefined : readGitHubRateLimit(headers);
  }
}

type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export interface GitHubTransportOptions {
  fetch?: FetchLike;
  limits?: Partial<PublicScanLimits>;
}

function checkedUrl(path: string): URL {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("..") ||
    path.includes("://") ||
    path.includes("#")
  ) {
    throw new GitHubTransportError("GitHub API path is invalid", "invalid_path");
  }

  const url = new URL(path, "https://api.github.com");
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new GitHubTransportError("GitHub API host cannot be changed", "invalid_path");
  }
  return url;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

function applyPagination(
  url: URL,
  options: { page?: number; perPage?: number },
  limits: PublicScanLimits,
): void {
  if (url.searchParams.getAll("page").length > 1 || url.searchParams.getAll("per_page").length > 1) {
    throw new GitHubTransportError("GitHub pagination is ambiguous", "request_budget");
  }
  const embeddedPage = parsePositiveInteger(url.searchParams.get("page"));
  const embeddedPerPage = parsePositiveInteger(url.searchParams.get("per_page"));
  if (
    (options.page !== undefined && embeddedPage !== undefined && options.page !== embeddedPage) ||
    (options.perPage !== undefined && embeddedPerPage !== undefined && options.perPage !== embeddedPerPage)
  ) {
    throw new GitHubTransportError("GitHub pagination parameters conflict", "request_budget");
  }
  const page = options.page ?? embeddedPage;
  const perPage = options.perPage ?? embeddedPerPage;
  if (page !== undefined) {
    if (!Number.isInteger(page) || page < 1 || page > limits.maxPagesPerCollection) {
      throw new GitHubTransportError("GitHub page is outside the collection budget", "request_budget");
    }
    url.searchParams.set("page", String(page));
  }
  if (perPage !== undefined) {
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
      throw new GitHubTransportError("GitHub page size is invalid", "request_budget");
    }
    url.searchParams.set("per_page", String(perPage));
  }
}

export function createGitHubTransport(options: GitHubTransportOptions = {}): GitHubTransport {
  const fetchImplementation: FetchLike = options.fetch ?? fetch;
  const limits: PublicScanLimits = { ...PUBLIC_SCAN_LIMITS, ...options.limits };
  let requests = 0;
  let receivedBytes = 0;
  let responseBudgetExhausted = false;

  return {
    async get<T>(
      path: `/${string}`,
      requestOptions: { page?: number; perPage?: number } = {},
    ): Promise<GitHubTransportResponse<T>> {
      const url = checkedUrl(path);
      applyPagination(url, requestOptions, limits);
      if (requests >= limits.maxRequests) {
        throw new GitHubTransportError("GitHub request budget exhausted", "request_budget");
      }
      if (responseBudgetExhausted) {
        throw new GitHubTransportError("GitHub response budget exhausted", "response_budget");
      }
      requests += 1;

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, limits.timeoutMs);

      try {
        const response = await fetchImplementation(url, {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": "DAYU-Repo-Reality-Check",
            "x-github-api-version": "2022-11-28",
          },
          method: "GET",
          redirect: "error",
          signal: controller.signal,
        });

        if (response.status === 202 || !response.ok) {
          const rateLimited = response.status === 429 || (
            response.status === 403 && (
              response.headers.get("x-ratelimit-remaining") === "0" ||
              response.headers.has("retry-after")
            )
          );
          throw new GitHubTransportError(
            `GitHub API returned ${String(response.status)}`,
            rateLimited ? "rate_limit" : "http_error",
            response.status,
            response.headers,
          );
        }

        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > limits.maxTotalBytes - receivedBytes) {
          responseBudgetExhausted = true;
          await response.body?.cancel();
          throw new GitHubTransportError("GitHub response budget exhausted", "response_budget", response.status, response.headers);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        const chunks: string[] = [];
        if (reader !== undefined) {
          let chunk = await reader.read();
          while (!chunk.done) {
            receivedBytes += chunk.value.byteLength;
            if (receivedBytes > limits.maxTotalBytes) {
              responseBudgetExhausted = true;
              await reader.cancel();
              throw new GitHubTransportError(
                "GitHub response budget exhausted",
                "response_budget",
                response.status,
                response.headers,
              );
            }
            chunks.push(decoder.decode(chunk.value, { stream: true }));
            chunk = await reader.read();
          }
        }
        chunks.push(decoder.decode());
        const body = chunks.join("");

        try {
          return { data: JSON.parse(body) as T, headers: response.headers };
        } catch {
          throw new GitHubTransportError("GitHub returned invalid JSON", "invalid_json", response.status, response.headers);
        }
      } catch (error) {
        if (error instanceof GitHubTransportError) throw error;
        if (controller.signal.aborted) {
          throw new GitHubTransportError("GitHub request timed out", "timeout");
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
