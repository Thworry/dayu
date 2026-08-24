import { describe, expect, it } from "vitest";

import { challengeCases, fixtureInput } from "../test/cases.js";
import { classifyRepository } from "./classify.js";

describe("classifyRepository", () => {
  it("recognizes a documentation repository without penalizing low code volume", () => {
    expect(classifyRepository({ files: ["README.md", "docs/index.md", "mkdocs.yml"], languages: {} }).type)
      .toBe("docs_content");
  });

  it.each(["fork", "mirror", "archived"] as const)("marks %s as facts-only", (modifier) => {
    const result = classifyRepository({ files: ["README.md"], languages: {}, [modifier]: true });
    expect(result.scoreMode).toBe("facts_only");
  });

  it.each(["fork", "mirror", "archived"] as const)("gives %s precedence over template and software markers", (modifier) => {
    const input = fixtureInput({
      files: ["README.md", "package.json", "src/index.ts", "template/index.ts"],
      metadata: { [modifier]: true, isTemplate: true },
    });
    const result = classifyRepository(input);
    const metadataId = input.evidence?.find((item) => item.fact.metric === "repository.metadata")?.id;
    expect(result).toMatchObject({ type: "generic", scoreMode: "facts_only" });
    expect(result.evidenceIds).toEqual(metadataId === undefined ? [] : [metadataId]);
  });

  it.each(challengeCases)("classifies the $name challenge fixture", (challenge) => {
    const result = classifyRepository(challenge.input);
    expect(result.type).toBe(challenge.type);
    expect(result.modifiers).toEqual(challenge.modifiers);
    expect(result.scoreMode).toBe(challenge.scoreMode);
    expect(result.confidence).toBeGreaterThanOrEqual(challenge.minimumConfidence);
  });

  it("falls back to Generic below 0.60 classification confidence", () => {
    const result = classifyRepository(fixtureInput({ files: ["README.md", "notes.txt"] }));
    expect(result.type).toBe("generic");
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("only references Evidence IDs that exist in the input", () => {
    const input = fixtureInput({ files: ["README.md", "package.json", "src/index.ts"] });
    const availableIds = new Set(input.evidence?.map((item) => item.id));
    const result = classifyRepository(input);
    expect(result.evidenceIds.length).toBeGreaterThan(0);
    expect(result.evidenceIds.every((id) => availableIds.has(id))).toBe(true);
  });

  it("does not invent Evidence IDs for direct normalized inputs", () => {
    const result = classifyRepository({ files: ["package.json", "src/index.ts"], languages: { TypeScript: 100 } });
    expect(result.type).toBe("software");
    expect(result.evidenceIds).toEqual([]);
  });

  it("turns restricted data into reduced coverage, never a modifier", () => {
    const complete = classifyRepository(fixtureInput({ files: ["README.md", "package.json"] }));
    const restricted = classifyRepository(fixtureInput({
      files: ["README.md", "package.json"],
      statuses: { languages: "restricted", readme: "restricted" },
      readme: "Status: stable and feature complete.",
    }));
    expect(restricted.modifiers).not.toContain("mature_stable");
    expect(restricted.coverage.ratio).toBeLessThan(complete.coverage.ratio);
  });

  it("lowers type confidence for missing and restricted sources", () => {
    const complete = classifyRepository(fixtureInput({
      files: ["README.md", "package.json", "src/index.ts", "tests/index.test.ts"],
      readme: "A software package.",
    }));
    const restricted = classifyRepository(fixtureInput({
      files: ["README.md", "package.json", "src/index.ts", "tests/index.test.ts"],
      readme: "A software package.",
      statuses: { languages: "restricted", readme: "restricted" },
    }));
    const missing = classifyRepository({ files: ["README.md", "package.json", "src/index.ts", "tests/index.test.ts"] });
    expect(restricted.confidence).toBeLessThan(complete.confidence);
    expect(missing.confidence).toBeLessThan(complete.confidence);
  });

  it("reports partial tree coverage without treating absent files as evidence", () => {
    const result = classifyRepository(fixtureInput({
      files: ["README.md", "mkdocs.yml"],
      statuses: { tree: "partial" },
    }));
    expect(result.type).toBe("generic");
    expect(result.coverage.scopes.tree).toBe("partial");
    expect(result.coverage.ratio).toBeLessThan(1);
  });

  it("does not classify from a lone mkdocs marker in a partial tree", () => {
    const result = classifyRepository(fixtureInput({ files: ["mkdocs.yml"], statuses: { tree: "partial" } }));
    expect(result.type).toBe("generic");
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("does not let a lone model card override stronger software evidence", () => {
    const result = classifyRepository(fixtureInput({
      files: ["README.md", "model_card.md", "package.json", "src/index.ts", "tests/index.test.ts"],
      languages: { TypeScript: 10_000 },
    }));
    expect(result.type).toBe("software");
  });

  it("does not cite Evidence overridden by contradictory direct metadata", () => {
    const input = fixtureInput({ files: ["README.md", "package.json", "src/index.ts"], metadata: { archived: true, isTemplate: true } });
    const result = classifyRepository({ ...input, archived: false, isTemplate: false });
    const metadataId = input.evidence?.find((item) => item.fact.metric === "repository.metadata")?.id;
    expect(result).toMatchObject({ type: "software", scoreMode: "normal" });
    expect(result.evidenceIds).not.toContain(metadataId);
  });

  it("does not cite tree Evidence when direct files override it", () => {
    const input = fixtureInput({ files: ["README.md", "model-index.yml"] });
    const result = classifyRepository({ ...input, files: ["README.md", "package.json", "src/index.ts"] });
    const treeId = input.evidence?.find((item) => item.fact.metric === "repository.tree")?.id;
    expect(result.type).toBe("software");
    expect(result.evidenceIds).not.toContain(treeId);
  });

  it("cites only the content file that matched an awesome-list signal", () => {
    const input = fixtureInput({
      contents: {
        "CONTRIBUTING.md": "Use the issue template and follow the code of conduct.",
        "README.md": "# Awesome River Tools\n\nA curated list of useful projects.",
      },
      files: ["README.md", "CONTRIBUTING.md"],
    });
    const result = classifyRepository(input);
    const contentEvidence = input.evidence?.filter((item) => item.fact.metric === "repository.file_content") ?? [];
    const readmeId = contentEvidence.find((item) => item.source.kind === "file" && item.source.path === "README.md")?.id;
    const contributingId = contentEvidence.find((item) => item.source.kind === "file" && item.source.path === "CONTRIBUTING.md")?.id;
    expect(result.type).toBe("docs_content");
    expect(result.evidenceIds).toContain(readmeId);
    expect(result.evidenceIds).not.toContain(contributingId);
  });

  it("does not let one direct metadata boolean inflate a tree-only classification", () => {
    const treeOnly = { files: ["README.md", "package.json", "src/index.ts"], languages: { TypeScript: 100 } } as const;
    const baseline = classifyRepository(treeOnly);
    const withOneBoolean = classifyRepository({ ...treeOnly, archived: false });
    expect(withOneBoolean.coverage.scopes.metadata).toBe("not_available");
    expect(withOneBoolean.confidence).toBe(baseline.confidence);
  });

  it("does not mark direct metadata complete when mirror is missing", () => {
    const treeOnly = { files: ["README.md", "package.json", "src/index.ts"], languages: { TypeScript: 100 } } as const;
    const baseline = classifyRepository(treeOnly);
    const withoutMirror = classifyRepository({
      ...treeOnly,
      analyzedAt: "2026-08-25T00:00:00Z",
      archived: false,
      createdAt: "2024-01-01T00:00:00Z",
      fork: false,
      isTemplate: false,
    });
    expect(withoutMirror.coverage.scopes.metadata).toBe("not_available");
    expect(withoutMirror.confidence).toBe(baseline.confidence);
  });

  it.each([
    { age: "29 days", createdAt: "2026-07-27T00:00:00Z", expected: true },
    { age: "30 days", createdAt: "2026-07-26T00:00:00Z", expected: false },
    { age: "30 offset days", createdAt: "2026-07-26T08:00:00+08:00", expected: false },
    { age: "invalid date", createdAt: "2026-02-30T00:00:00Z", expected: false },
    { age: "future date", createdAt: "2026-09-01T00:00:00Z", expected: false },
  ])("handles the $age new-repository boundary", ({ createdAt, expected }) => {
    const result = classifyRepository({
      analyzedAt: "2026-08-25T00:00:00Z",
      createdAt,
      files: ["package.json", "src/index.ts"],
      languages: { TypeScript: 100 },
    });
    expect(result.modifiers.includes("new_repo")).toBe(expected);
  });

  it.each([
    {
      name: "binary-heavy",
      input: fixtureInput({
        files: ["README.md", "model-index.yml", "weights/model.safetensors"],
        fileSizes: { "README.md": 1, "model-index.yml": 1, "weights/model.safetensors": 10_000 },
        statuses: { tree: "partial" },
      }),
      modifier: "binary_lfs",
    },
    {
      name: "generated-heavy",
      input: fixtureInput({
        files: ["package.json", "src/index.ts", "vendor/a.js", "vendor/b.js", "generated/a.js", "dist/a.js"],
        statuses: { tree: "partial" },
      }),
      modifier: "generated_heavy",
    },
  ] as const)("does not infer $name ratios from a partial tree", ({ input, modifier }) => {
    expect(classifyRepository(input).modifiers).not.toContain(modifier);
  });
});
