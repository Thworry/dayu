export interface RepositoryRef {
  owner: string;
  repo: string;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function parseRepositoryInput(raw: string): RepositoryRef {
  const trimmed = raw.trim();
  let path = trimmed;

  if (trimmed.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("invalid_repository");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "github.com" ||
      parsed.port !== "" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new Error("unsupported_host");
    }
    path = parsed.pathname;
  }

  const segments = path.replace(/^\/+|\/+$/g, "").split("/");
  const owner = segments[0];
  const rawRepo = segments[1];
  const repo = rawRepo?.replace(/\.git$/i, "");

  if (
    segments.length !== 2 ||
    owner === undefined ||
    repo === undefined ||
    !SEGMENT.test(owner) ||
    !SEGMENT.test(repo)
  ) {
    throw new Error("invalid_repository");
  }

  return { owner, repo };
}
