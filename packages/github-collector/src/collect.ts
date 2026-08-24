import { createHash } from "node:crypto";

import {
  createEvidenceId,
  evidenceSchema,
  type DataStatus,
  type Evidence,
  type JsonValue,
} from "@dayu/evidence-schema";

import {
  GitHubTransportError,
  readGitHubRateLimit,
  type GitHubRateLimit,
  type GitHubTransport,
} from "./client.js";
import type { RepositoryRef } from "./input.js";
import { PUBLIC_SCAN_LIMITS } from "./limits.js";
import {
  normalizeCommunityProfile,
  normalizeContributors,
  normalizeIssues,
  normalizeLanguages,
  normalizePulls,
  normalizeReleases,
  normalizeRepository,
  normalizeTextBlob,
  normalizeTree,
  selectTextBlobCandidates,
  type NormalizedEndpoint,
  type NormalizedRepository,
} from "./normalize.js";

export interface CollectedRepository {
  repository: {
    id: number;
    fullName: string;
    defaultBranch: string;
    defaultSha: string;
    stars: number;
    subscribers: number;
  };
  evidence: Evidence[];
  coverage: { attempted: number; complete: number; restricted: number; truncated: number };
  rateLimit: { remaining: number | null; resetAt: string | null };
}

interface GitHubBranch {
  commit: { sha: string };
}

interface EndpointDescriptor {
  kind: Evidence["kind"];
  metric: string;
  requestOptions?: { page?: number; perPage?: number };
  requestPath: `/${string}`;
  sourceEndpoint: `/${string}`;
  summary: string;
  normalize(input: unknown): NormalizedEndpoint;
}

function queryHash(path: string): string {
  const query = new URL(path, "https://api.github.com").searchParams.toString();
  return createHash("sha256").update(query).digest("hex").slice(0, 16);
}

function apiEvidence(input: {
  repository: NormalizedRepository;
  defaultSha: string;
  kind: Evidence["kind"];
  endpoint: string;
  observedAt: string;
  status: DataStatus;
  summary: string;
  value: JsonValue;
  limitations?: string[];
}): Evidence {
  return evidenceSchema.parse({
    fact: { metric: input.endpoint, value: input.value },
    id: createEvidenceId({
      commitSha: input.defaultSha,
      kind: input.kind,
      path: input.endpoint,
      repoId: input.repository.id,
    }),
    kind: input.kind,
    limitations: input.limitations ?? [],
    observedAt: input.observedAt,
    repository: { fullName: input.repository.fullName, id: input.repository.id },
    schemaVersion: "1",
    source: { endpoint: input.endpoint, kind: "api", queryHash: queryHash(input.endpoint) },
    status: input.status,
    summary: input.summary,
    value: input.value,
  });
}

function metricEvidence(input: Omit<Parameters<typeof apiEvidence>[0], "endpoint"> & { metric: string; path: string }): Evidence {
  const evidence = apiEvidence({ ...input, endpoint: input.path });
  return evidenceSchema.parse({ ...evidence, fact: { ...evidence.fact, metric: input.metric } });
}

function fileEvidence(input: {
  repository: NormalizedRepository;
  defaultSha: string;
  path: string;
  observedAt: string;
  status: DataStatus;
  summary: string;
  value: JsonValue;
  limitations?: string[];
}): Evidence {
  return evidenceSchema.parse({
    fact: { metric: "repository.file_content", value: input.value },
    id: createEvidenceId({ repoId: input.repository.id, commitSha: input.defaultSha, kind: "file", path: input.path }),
    kind: "file",
    limitations: input.limitations ?? [],
    observedAt: input.observedAt,
    repository: { fullName: input.repository.fullName, id: input.repository.id },
    schemaVersion: "1",
    source: { commitSha: input.defaultSha, kind: "file", path: input.path },
    status: input.status,
    summary: input.summary,
    value: input.value,
  });
}

function validSha(input: unknown): string {
  if (typeof input !== "object" || input === null || !("commit" in input)) throw new Error("invalid_default_branch");
  const commit = input.commit;
  if (typeof commit !== "object" || commit === null || !("sha" in commit)) throw new Error("invalid_default_branch");
  const sha = commit.sha;
  if (typeof sha !== "string" || !/^[a-f0-9]{7,64}$/i.test(sha)) throw new Error("invalid_default_branch");
  return sha;
}

function observedAtFrom(headers: Headers): string {
  const header = headers.get("date");
  if (header !== null) {
    const parsed = new Date(header);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

export const readRateLimit = readGitHubRateLimit;

function aggregateRateLimits(observations: GitHubRateLimit[]): GitHubRateLimit {
  let selected: GitHubRateLimit = { remaining: null, resetAt: null };
  for (const observation of observations) {
    if (observation.remaining !== null) {
      if (selected.remaining === null || observation.remaining <= selected.remaining) selected = observation;
    } else if (selected.remaining === null && observation.resetAt !== null) {
      selected = observation;
    }
  }
  return selected;
}

function failureStatus(reason: unknown): { status: DataStatus; limitation: string } {
  if (reason instanceof GitHubTransportError) {
    if (reason.code === "rate_limit") return { limitation: "github_rate_limit_exhausted", status: "partial" };
    if (reason.status === 403) return { limitation: "github_endpoint_restricted", status: "restricted" };
    if (reason.status === 404) return { limitation: "github_endpoint_unavailable", status: "unverifiable" };
    if (reason.status === 202) return { limitation: "github_data_being_generated", status: "partial" };
    if (reason.code === "request_budget" || reason.code === "response_budget") {
      return { limitation: "collector_budget_exhausted", status: "partial" };
    }
    if (reason.code === "timeout") return { limitation: "github_request_timeout", status: "partial" };
  }
  return { limitation: "github_endpoint_incomplete", status: "partial" };
}

export async function collectPublicRepository(
  ref: RepositoryRef,
  transport: GitHubTransport,
): Promise<CollectedRepository> {
  const root = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}` as const;
  let metadataResponse;
  try {
    metadataResponse = await transport.get<unknown>(root);
  } catch (error) {
    if (
      error instanceof GitHubTransportError &&
      error.code !== "rate_limit" &&
      (error.status === 403 || error.status === 404)
    ) {
      throw new Error("private_or_unavailable");
    }
    throw error;
  }

  const repository = normalizeRepository(metadataResponse.data);
  if (repository.private) throw new Error("private_or_unavailable");

  const branchPath = `${root}/branches/${encodeURIComponent(repository.defaultBranch)}` as const;
  const branchResponse = await transport.get<GitHubBranch>(branchPath);
  const defaultSha = validSha(branchResponse.data);
  const observedAt = observedAtFrom(metadataResponse.headers);

  const descriptors: EndpointDescriptor[] = [
    {
      kind: "file",
      metric: "repository.tree",
      normalize: normalizeTree,
      requestPath: `${root}/git/trees/${defaultSha}?recursive=1`,
      sourceEndpoint: `${root}/git/trees/${defaultSha}?recursive=1`,
      summary: "Default-branch file tree pinned to the collected commit.",
    },
    {
      kind: "metadata",
      metric: "repository.languages",
      normalize: normalizeLanguages,
      requestPath: `${root}/languages`,
      sourceEndpoint: `${root}/languages`,
      summary: "Language byte totals reported by GitHub.",
    },
    {
      kind: "community",
      metric: "repository.community_profile",
      normalize: normalizeCommunityProfile,
      requestPath: `${root}/community/profile`,
      sourceEndpoint: `${root}/community/profile`,
      summary: "GitHub community profile coverage.",
    },
    {
      kind: "issue",
      metric: "repository.issues",
      normalize: normalizeIssues,
      requestOptions: { page: 1, perPage: 100 },
      requestPath: `${root}/issues?state=all`,
      sourceEndpoint: `${root}/issues?state=all&per_page=100&page=1`,
      summary: "First bounded page of issues, excluding pull requests.",
    },
    {
      kind: "pull_request",
      metric: "repository.pull_requests",
      normalize: normalizePulls,
      requestOptions: { page: 1, perPage: 100 },
      requestPath: `${root}/pulls?state=all`,
      sourceEndpoint: `${root}/pulls?state=all&per_page=100&page=1`,
      summary: "First bounded page of pull requests.",
    },
    {
      kind: "release",
      metric: "repository.releases",
      normalize: normalizeReleases,
      requestOptions: { page: 1, perPage: 100 },
      requestPath: `${root}/releases`,
      sourceEndpoint: `${root}/releases?per_page=100&page=1`,
      summary: "First bounded page of releases.",
    },
    {
      kind: "community",
      metric: "repository.contributors",
      normalize: normalizeContributors,
      requestOptions: { page: 1, perPage: 100 },
      requestPath: `${root}/contributors`,
      sourceEndpoint: `${root}/contributors?per_page=100&page=1`,
      summary: "First bounded page of anonymized contribution totals.",
    },
  ];

  const settled = await Promise.allSettled(descriptors.map(async (descriptor) => {
    const response = await transport.get<unknown>(descriptor.requestPath, descriptor.requestOptions);
    return { descriptor, response };
  }));

  const metadataValue: JsonValue = {
    archived: repository.archived,
    createdAt: repository.createdAt,
    defaultBranch: repository.defaultBranch,
    fork: repository.fork,
    forks: repository.forks,
    isTemplate: repository.isTemplate,
    openIssues: repository.openIssues,
    pushedAt: repository.pushedAt,
    stars: repository.stars,
    subscribers: repository.subscribers,
    updatedAt: repository.updatedAt,
  };
  const evidence: Evidence[] = [
    metricEvidence({
      defaultSha,
      kind: "metadata",
      metric: "repository.metadata",
      observedAt,
      path: root,
      repository,
      status: "complete",
      summary: "Public repository metadata. Stars use stargazers_count; real Watch uses subscribers_count.",
      value: metadataValue,
    }),
    metricEvidence({
      defaultSha,
      kind: "commit",
      metric: "repository.default_commit",
      observedAt,
      path: branchPath,
      repository,
      status: "complete",
      summary: "Default branch head used to pin this collection.",
      value: { sha: defaultSha },
    }),
  ];

  for (const [index, result] of settled.entries()) {
    const descriptor = descriptors[index];
    if (descriptor === undefined) continue;

    if (result.status === "rejected") {
      const failure = failureStatus(result.reason);
      evidence.push(metricEvidence({
        defaultSha,
        kind: descriptor.kind,
        limitations: [failure.limitation],
        metric: descriptor.metric,
        observedAt,
        path: descriptor.sourceEndpoint,
        repository,
        status: failure.status,
        summary: descriptor.summary,
        value: { available: false },
      }));
      continue;
    }

    try {
      const normalized = descriptor.normalize(result.value.response.data);
      const hasNextPage = result.value.response.headers.get("link")?.includes('rel="next"') ?? false;
      const partial = normalized.partial || hasNextPage;
      evidence.push(metricEvidence({
        defaultSha,
        kind: descriptor.kind,
        limitations: [...normalized.limitations, ...(hasNextPage ? ["page_budget_incomplete"] : [])],
        metric: descriptor.metric,
        observedAt,
        path: descriptor.sourceEndpoint,
        repository,
        status: partial ? "partial" : "complete",
        summary: descriptor.summary,
        value: normalized.value,
      }));
    } catch {
      evidence.push(metricEvidence({
        defaultSha,
        kind: descriptor.kind,
        limitations: ["github_response_invalid"],
        metric: descriptor.metric,
        observedAt,
        path: descriptor.sourceEndpoint,
        repository,
        status: "partial",
        summary: descriptor.summary,
        value: { available: false },
      }));
    }
  }

  const treeResult = settled[0];
  const candidates = treeResult?.status === "fulfilled"
    ? selectTextBlobCandidates(treeResult.value.response.data, PUBLIC_SCAN_LIMITS)
    : [];
  const blobResults = await Promise.allSettled(candidates.map(async (candidate) => {
    const response = await transport.get<unknown>(`${root}/git/blobs/${candidate.sha}`);
    return { candidate, response };
  }));
  for (const [index, result] of blobResults.entries()) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    if (result.status === "rejected") {
      const failure = failureStatus(result.reason);
      evidence.push(fileEvidence({
        defaultSha,
        limitations: [failure.limitation],
        observedAt,
        path: candidate.path,
        repository,
        status: failure.status,
        summary: `Selected text file ${candidate.path} could not be collected.`,
        value: { available: false, path: candidate.path },
      }));
      continue;
    }
    try {
      const normalized = normalizeTextBlob(result.value.response.data, candidate, PUBLIC_SCAN_LIMITS);
      evidence.push(fileEvidence({
        defaultSha,
        observedAt,
        path: candidate.path,
        repository,
        status: "complete",
        summary: `Bounded text content from ${candidate.path}.`,
        value: normalized.value,
      }));
    } catch {
      evidence.push(fileEvidence({
        defaultSha,
        limitations: ["invalid_or_truncated_blob"],
        observedAt,
        path: candidate.path,
        repository,
        status: "partial",
        summary: `Selected file ${candidate.path} was not accepted as bounded UTF-8 text.`,
        value: { available: false, path: candidate.path },
      }));
    }
  }

  const complete = evidence.filter((item) => item.status === "complete").length;
  const restricted = evidence.filter((item) => item.status === "restricted").length;
  const truncated = evidence.length - complete - restricted;

  const secondaryRateLimits = [...settled, ...blobResults].flatMap((result): GitHubRateLimit[] => {
    if (result.status === "fulfilled") return [readRateLimit(result.value.response.headers)];
    if (!(result.reason instanceof GitHubTransportError) || result.reason.rateLimit === undefined) return [];
    return [result.reason.rateLimit];
  });
  const rateLimit = aggregateRateLimits([
    readRateLimit(metadataResponse.headers),
    readRateLimit(branchResponse.headers),
    ...secondaryRateLimits,
  ]);

  return {
    coverage: { attempted: evidence.length, complete, restricted, truncated },
    evidence,
    rateLimit,
    repository: {
      defaultBranch: repository.defaultBranch,
      defaultSha,
      fullName: repository.fullName,
      id: repository.id,
      stars: repository.stars,
      subscribers: repository.subscribers,
    },
  };
}
