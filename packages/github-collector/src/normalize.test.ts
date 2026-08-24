import { describe, expect, it } from "vitest";

import fixture from "../test/fixtures/repository.json" with { type: "json" };
import { PUBLIC_SCAN_LIMITS } from "./limits.js";
import { normalizeRepository, normalizeTextBlob, type TextBlobCandidate } from "./normalize.js";

describe("normalizeRepository", () => {
  it("uses subscribers_count for real watchers", () => {
    const repository = normalizeRepository({
      ...fixture,
      stargazers_count: 100,
      subscribers_count: 7,
      watchers_count: 100,
    });

    expect(repository.stars).toBe(100);
    expect(repository.subscribers).toBe(7);
    expect(repository).not.toHaveProperty("watchersCount");
  });

  it("rejects malformed repository metadata", () => {
    expect(() => normalizeRepository({ ...fixture, id: 0 })).toThrow("invalid_repository_metadata");
  });
});

describe("normalizeTextBlob", () => {
  const candidate: TextBlobCandidate = { path: "README.md", sha: "1111111", size: 3 };

  it("rejects a non-base64 alphabet", () => {
    expect(() => normalizeTextBlob(
      { content: "%%%=", encoding: "base64", size: 3 },
      candidate,
      PUBLIC_SCAN_LIMITS,
    )).toThrow("invalid_blob_base64");
  });

  it("rejects decoded content that does not equal the API and tree size", () => {
    expect(() => normalizeTextBlob(
      { content: "YQ==", encoding: "base64", size: 3 },
      candidate,
      PUBLIC_SCAN_LIMITS,
    )).toThrow("file_budget_exceeded");
  });
});
