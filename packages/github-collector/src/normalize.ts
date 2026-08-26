import type { JsonValue } from "@dayu/evidence-schema";

import type { PublicScanLimits } from "./limits.js";

export interface GitHubRepository {
  id: number;
  full_name: string;
  description?: string | null;
  private: boolean;
  default_branch: string;
  stargazers_count: number;
  watchers_count?: number;
  subscribers_count: number;
  forks_count: number;
  open_issues_count: number;
  archived: boolean;
  fork: boolean;
  has_issues: boolean;
  is_template: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string | null;
}

export interface NormalizedRepository {
  id: number;
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  stars: number;
  subscribers: number;
  forks: number;
  openIssues: number;
  archived: boolean;
  fork: boolean;
  hasIssues: boolean;
  isTemplate: boolean;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
}

export interface NormalizedEndpoint {
  value: JsonValue;
  partial: boolean;
  limitations: string[];
}

export interface PaginationMetadata {
  page: number;
  perPage: number;
  hasNext: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error("invalid_repository_metadata");
  return value;
}

function requiredCount(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!finiteNonNegative(value)) throw new Error("invalid_repository_metadata");
  return value;
}

export function normalizeRepository(input: unknown): NormalizedRepository {
  if (!isRecord(input) || !Number.isInteger(input.id) || (input.id as number) <= 0) {
    throw new Error("invalid_repository_metadata");
  }

  const fullName = requiredString(input, "full_name");
  if (!/^[^/]+\/[^/]+$/.test(fullName)) throw new Error("invalid_repository_metadata");

  const pushedAt = input.pushed_at;
  if (pushedAt !== null && typeof pushedAt !== "string") throw new Error("invalid_repository_metadata");
  const description = input.description;
  if (description !== undefined && description !== null && typeof description !== "string") throw new Error("invalid_repository_metadata");

  for (const key of ["private", "archived", "fork", "has_issues", "is_template"] as const) {
    if (typeof input[key] !== "boolean") throw new Error("invalid_repository_metadata");
  }

  return {
    archived: input.archived as boolean,
    createdAt: requiredString(input, "created_at"),
    defaultBranch: requiredString(input, "default_branch"),
    description: typeof description === "string" ? description : null,
    fork: input.fork as boolean,
    forks: requiredCount(input, "forks_count"),
    fullName,
    hasIssues: input.has_issues as boolean,
    id: input.id as number,
    isTemplate: input.is_template as boolean,
    openIssues: requiredCount(input, "open_issues_count"),
    private: input.private as boolean,
    pushedAt,
    stars: requiredCount(input, "stargazers_count"),
    subscribers: requiredCount(input, "subscribers_count"),
    updatedAt: requiredString(input, "updated_at"),
  };
}

export interface TextBlobCandidate {
  path: string;
  sha: string;
  size: number;
}

const ROOT_TEXT_FILES = /^(readme(?:\.[a-z0-9]+)?|license(?:\.[a-z0-9]+)?|contributing(?:\.[a-z0-9]+)?|changelog(?:\.[a-z0-9]+)?|security\.md|package\.json|pyproject\.toml|cargo\.toml|go\.mod|gemfile|composer\.json|pom\.xml|build\.gradle(?:\.kts)?|requirements\.txt)$/i;
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.(?:ya?ml)$/i;
const TEST_FILE = /(?:^|\/)(?:test|tests|__tests__)\/.*\.(?:[cm]?[jt]sx?|py|rb|go|rs)$/i;

function textFilePriority(path: string): number {
  const lower = path.toLowerCase();
  if (/^readme(?:\.[a-z0-9]+)?$/.test(lower)) return 0;
  if (/^license(?:\.[a-z0-9]+)?$/.test(lower)) return 1;
  if (/^(?:contributing|security|changelog)(?:\.[a-z0-9]+)?$/.test(lower)) return 2;
  if (ROOT_TEXT_FILES.test(path)) return 3;
  if (WORKFLOW_FILE.test(path)) return 4;
  if (TEST_FILE.test(path)) return 5;
  const basename = path.split("/").at(-1) ?? path;
  return ROOT_TEXT_FILES.test(basename) ? 6 : -1;
}

function treeEntries(input: unknown): Record<string, unknown>[] {
  if (!isRecord(input) || !Array.isArray(input.tree)) throw new Error("invalid_tree_response");
  return input.tree.filter(isRecord);
}

export function normalizeTree(input: unknown): NormalizedEndpoint {
  const entries = treeEntries(input)
    .flatMap((entry) => {
      if (typeof entry.path !== "string" || (entry.type !== "blob" && entry.type !== "tree")) return [];
      const size = finiteNonNegative(entry.size) ? entry.size : null;
      return [{ path: entry.path, size, type: entry.type }];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const apiTruncated = isRecord(input) && input.truncated === true;
  const limitations = apiTruncated ? ["github_tree_truncated", "negative_file_conclusions_disabled"] : [];

  return {
    limitations,
    partial: apiTruncated,
    value: {
      apiTruncated,
      completeForNegativeEvidence: !apiTruncated,
      files: entries,
      observedEntries: entries.length,
    },
  };
}

export function selectTextBlobCandidates(input: unknown, limits: PublicScanLimits): TextBlobCandidate[] {
  if (!isRecord(input) || input.truncated === true) return [];
  const ranked = treeEntries(input).flatMap((entry) => {
    if (
      entry.type !== "blob" ||
      typeof entry.path !== "string" ||
      typeof entry.sha !== "string" ||
      !/^[a-f0-9]{7,64}$/i.test(entry.sha) ||
      !finiteNonNegative(entry.size) ||
      entry.size > limits.maxFileBytes
    ) return [];
    const path = entry.path;
    const priority = textFilePriority(path);
    return priority < 0 ? [] : [{ path, priority, sha: entry.sha, size: entry.size }];
  }).sort((left, right) => left.priority - right.priority || left.path.localeCompare(right.path));

  const selected: TextBlobCandidate[] = [];
  let bytes = 0;
  const requestCapacity = Math.max(0, limits.maxRequests - 9);
  for (const candidate of ranked) {
    if (selected.length >= Math.min(limits.maxFiles, requestCapacity)) break;
    if (bytes + candidate.size > limits.maxTotalBytes) continue;
    selected.push({ path: candidate.path, sha: candidate.sha, size: candidate.size });
    bytes += candidate.size;
  }
  return selected;
}

export function normalizeTextBlob(input: unknown, candidate: TextBlobCandidate, limits: PublicScanLimits): NormalizedEndpoint {
  if (
    !isRecord(input) ||
    input.encoding !== "base64" ||
    typeof input.content !== "string" ||
    !Number.isInteger(input.size) ||
    input.size !== candidate.size
  ) {
    throw new Error("invalid_blob_response");
  }
  const compact = input.content.replace(/[\t\n\r ]/g, "");
  if (
    compact.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)
  ) {
    throw new Error("invalid_blob_base64");
  }
  const bytes = Buffer.from(compact, "base64");
  if (
    bytes.toString("base64") !== compact ||
    bytes.byteLength !== candidate.size ||
    bytes.byteLength > limits.maxFileBytes
  ) {
    throw new Error("file_budget_exceeded");
  }
  if (bytes.includes(0)) throw new Error("binary_file_rejected");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("binary_file_rejected");
  }
  return { limitations: [], partial: false, value: { bytes: bytes.byteLength, path: candidate.path, text } };
}

export function normalizeLanguages(input: unknown): NormalizedEndpoint {
  if (!isRecord(input)) throw new Error("invalid_languages_response");
  const languages: Record<string, JsonValue> = {};
  for (const [language, bytes] of Object.entries(input).sort(([left], [right]) => left.localeCompare(right))) {
    if (finiteNonNegative(bytes)) languages[language] = bytes;
  }
  return { limitations: [], partial: false, value: languages };
}

export function normalizeCommunityProfile(input: unknown): NormalizedEndpoint {
  if (!isRecord(input)) throw new Error("invalid_community_response");
  const health = finiteNonNegative(input.health_percentage) ? input.health_percentage : null;
  return { limitations: [], partial: false, value: { healthPercentage: health } };
}

function normalizedActivityItem(item: Record<string, unknown>, fields: readonly string[]): JsonValue {
  const result: Record<string, JsonValue> = {};
  for (const field of fields) {
    const value = item[field];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      result[field] = value;
    }
  }
  return result;
}

function normalizeActivity(
  input: unknown,
  fields: readonly string[],
  filter?: (item: Record<string, unknown>) => boolean,
  pagination?: PaginationMetadata,
): NormalizedEndpoint {
  if (!Array.isArray(input)) throw new Error("invalid_activity_response");
  const items = input.filter(isRecord).filter((item) => filter?.(item) ?? true).map((item) => normalizedActivityItem(item, fields));
  return {
    limitations: pagination?.hasNext === true ? ["bounded_first_page"] : [],
    partial: pagination?.hasNext === true,
    value: {
      count: items.length,
      items,
      ...(pagination === undefined ? {} : {
        pagination: {
          complete: !pagination.hasNext,
          countSemantics: pagination.hasNext ? "lower_bound" : "exact",
          page: pagination.page,
          perPage: pagination.perPage,
        },
      }),
    },
  };
}

export function normalizeIssues(input: unknown, pagination?: PaginationMetadata): NormalizedEndpoint {
  return normalizeActivity(
    input,
    ["id", "state", "comments", "created_at", "updated_at", "closed_at", "author_association"],
    (item) => !("pull_request" in item),
    pagination,
  );
}

export function normalizePulls(input: unknown, pagination?: PaginationMetadata): NormalizedEndpoint {
  return normalizeActivity(input, [
    "id",
    "state",
    "comments",
    "review_comments",
    "created_at",
    "updated_at",
    "closed_at",
    "merged_at",
    "author_association",
  ], undefined, pagination);
}

export function normalizeReleases(input: unknown, pagination?: PaginationMetadata): NormalizedEndpoint {
  return normalizeActivity(input, ["id", "tag_name", "draft", "prerelease", "created_at", "published_at"], undefined, pagination);
}

export function normalizeContributors(input: unknown, pagination?: PaginationMetadata): NormalizedEndpoint {
  return normalizeActivity(input, ["contributions"], undefined, pagination);
}
