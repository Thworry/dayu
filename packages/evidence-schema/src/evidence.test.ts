import { describe, expect, it } from "vitest";

import { createEvidenceId } from "./evidence-id.js";
import { evidenceSchema } from "./evidence.js";

describe("Evidence", () => {
  it("creates a stable id for the same pinned source", () => {
    const source = {
      repoId: 1024,
      commitSha: "abc123",
      kind: "file",
      path: "README.md",
    } as const;

    expect(createEvidenceId(source)).toBe(createEvidenceId(source));
  });

  it("rejects a file source without a commit SHA", () => {
    const parsed = evidenceSchema.safeParse({
      id: "ev_aaaaaaaaaaaaaaaaaaaaaaaa",
      schemaVersion: "1",
      kind: "file",
      repository: { id: 1024, fullName: "owner/repo" },
      source: { kind: "file", path: "README.md" },
      observedAt: "2026-08-24T00:00:00Z",
      status: "complete",
      summary: "README at the pinned default branch",
      value: "# Example",
      fact: { metric: "file_exists", value: true },
      limitations: [],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ["source", "commitSha"] })]),
      );
    }
  });
});
