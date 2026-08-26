export {
  createGitHubTransport,
  GitHubTransportError,
  readGitHubRateLimit,
} from "./client.js";
export type {
  GitHubTransport,
  GitHubTransportOptions,
  GitHubRateLimit,
  GitHubTransportResponse,
} from "./client.js";

export { collectPublicRepository, readRateLimit } from "./collect.js";
export type { CollectedRepository } from "./collect.js";

export { parseRepositoryInput } from "./input.js";
export type { RepositoryRef } from "./input.js";

export { PUBLIC_SCAN_LIMITS } from "./limits.js";
export type { PublicScanLimits } from "./limits.js";

export {
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
} from "./normalize.js";
export type {
  GitHubRepository,
  NormalizedEndpoint,
  NormalizedRepository,
  PaginationMetadata,
  TextBlobCandidate,
} from "./normalize.js";
