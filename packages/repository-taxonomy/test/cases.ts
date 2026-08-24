import { createEvidenceId, evidenceSchema, type Evidence, type JsonValue } from "@dayu/evidence-schema";

import type {
  RepositoryClassificationInput,
  RepositoryModifier,
  RepositoryType,
} from "../src/classify.js";

const REPO_ID = 42;
const SHA = "0123456789abcdef0123456789abcdef01234567";
const OBSERVED_AT = "2026-08-25T00:00:00Z";

interface FixtureOptions {
  contents?: Record<string, string>;
  files?: string[];
  fileSizes?: Record<string, number>;
  languages?: Record<string, number>;
  metadata?: Record<string, JsonValue>;
  readme?: string;
  statuses?: Partial<Record<"metadata" | "tree" | "languages" | "readme", Evidence["status"]>>;
}

function apiEvidence(metric: string, value: JsonValue, status: Evidence["status"] = "complete"): Evidence {
  const endpoint = `/repos/dayu/challenge/${metric.replaceAll(".", "/")}`;
  return evidenceSchema.parse({
    fact: { metric, value },
    id: createEvidenceId({ commitSha: SHA, kind: "metadata", path: endpoint, repoId: REPO_ID }),
    kind: "metadata",
    limitations: status === "complete" ? [] : ["fixture_incomplete"],
    observedAt: OBSERVED_AT,
    repository: { fullName: "dayu/challenge", id: REPO_ID },
    schemaVersion: "1",
    source: { endpoint, kind: "api", queryHash: "fixture" },
    status,
    summary: `Challenge fixture for ${metric}.`,
    value,
  });
}

function fileEvidence(path: string, text: string, status: Evidence["status"] = "complete"): Evidence {
  return evidenceSchema.parse({
    fact: { metric: "repository.file_content", value: { bytes: text.length, path, text } },
    id: createEvidenceId({ commitSha: SHA, kind: "file", path, repoId: REPO_ID }),
    kind: "file",
    limitations: status === "complete" ? [] : ["fixture_incomplete"],
    observedAt: OBSERVED_AT,
    repository: { fullName: "dayu/challenge", id: REPO_ID },
    schemaVersion: "1",
    source: { commitSha: SHA, kind: "file", path },
    status,
    summary: `Challenge fixture content for ${path}.`,
    value: { bytes: text.length, path, text },
  });
}

export function fixtureInput(options: FixtureOptions): RepositoryClassificationInput {
  const files = options.files ?? ["README.md"];
  const evidence: Evidence[] = [
    apiEvidence("repository.metadata", {
      archived: false,
      createdAt: "2024-01-01T00:00:00Z",
      fork: false,
      isTemplate: false,
      ...options.metadata,
    }, options.statuses?.metadata),
    apiEvidence("repository.tree", {
      apiTruncated: options.statuses?.tree === "partial",
      files: files.map((path) => ({ path, size: options.fileSizes?.[path] ?? 1, type: "blob" })),
      observedEntries: files.length,
    }, options.statuses?.tree),
    apiEvidence("repository.languages", options.languages ?? {}, options.statuses?.languages),
  ];
  if (options.readme !== undefined) {
    evidence.push(fileEvidence("README.md", options.readme, options.statuses?.readme));
  }
  for (const [path, text] of Object.entries(options.contents ?? {})) {
    evidence.push(fileEvidence(path, text));
  }
  if (files.includes(".gitattributes")) {
    evidence.push(fileEvidence(".gitattributes", "*.bin filter=lfs diff=lfs merge=lfs -text\n"));
  }
  return { analyzedAt: OBSERVED_AT, evidence };
}

export interface ChallengeCase {
  input: RepositoryClassificationInput;
  minimumConfidence: number;
  name: string;
  scoreMode: "normal" | "facts_only";
  type: RepositoryType;
  modifiers: RepositoryModifier[];
}

export const challengeCases: readonly ChallengeCase[] = [
  {
    name: "software",
    input: fixtureInput({ files: ["README.md", "package.json", "src/index.ts", "tests/index.test.ts"], languages: { TypeScript: 12000 } }),
    type: "software", modifiers: [], scoreMode: "normal", minimumConfidence: 0.8,
  },
  {
    name: "documentation",
    input: fixtureInput({ files: ["README.md", "docs/index.md", "docs/guide.md", "mkdocs.yml"] }),
    type: "docs_content", modifiers: [], scoreMode: "normal", minimumConfidence: 0.75,
  },
  {
    name: "awesome list",
    input: fixtureInput({ files: ["README.md", "contributing.md"], readme: "# Awesome River Tools\n\nA curated list of useful projects." }),
    type: "docs_content", modifiers: [], scoreMode: "normal", minimumConfidence: 0.8,
  },
  {
    name: "template",
    input: fixtureInput({ files: ["README.md", "package.json", "template/src/index.ts"], metadata: { isTemplate: true } }),
    type: "template", modifiers: [], scoreMode: "normal", minimumConfidence: 0.9,
  },
  {
    name: "dataset with LFS",
    input: fixtureInput({ files: ["README.md", ".gitattributes", "dataset_infos.json", "data/train.parquet"] }),
    type: "data_model", modifiers: ["binary_lfs"], scoreMode: "normal", minimumConfidence: 0.8,
  },
  {
    name: "binary-heavy model without LFS",
    input: fixtureInput({
      files: ["README.md", "model-index.yml", "weights/model.safetensors"],
      fileSizes: { "README.md": 2000, "model-index.yml": 500, "weights/model.safetensors": 2_000_000 },
    }),
    type: "data_model", modifiers: ["binary_lfs"], scoreMode: "normal", minimumConfidence: 0.8,
  },
  {
    name: "creative demo",
    input: fixtureInput({ files: ["README.md", "index.html", "assets/scene.blend", "assets/preview.png"], languages: { HTML: 2000 } }),
    type: "creative_demo", modifiers: [], scoreMode: "normal", minimumConfidence: 0.7,
  },
  {
    name: "monorepo",
    input: fixtureInput({ files: ["README.md", "pnpm-workspace.yaml", "apps/web/package.json", "packages/core/package.json"] }),
    type: "software", modifiers: ["monorepo"], scoreMode: "normal", minimumConfidence: 0.75,
  },
  {
    name: "generated and vendor heavy software",
    input: fixtureInput({
      files: ["README.md", "package.json", "src/index.ts", "vendor/a.js", "vendor/b.js", "generated/a.ts", "dist/bundle.js"],
    }),
    type: "software", modifiers: ["generated_heavy"], scoreMode: "normal", minimumConfidence: 0.75,
  },
  {
    name: "external tracker",
    input: fixtureInput({ files: ["README.md", "pyproject.toml", "src/dayu.py"], readme: "Please report issues in our Jira project at https://dayu.atlassian.net/browse/DAYU." }),
    type: "software", modifiers: ["external_tracker"], scoreMode: "normal", minimumConfidence: 0.8,
  },
  {
    name: "new repository",
    input: fixtureInput({ files: ["README.md", "go.mod", "main.go"], metadata: { createdAt: "2026-08-10T00:00:00Z" } }),
    type: "software", modifiers: ["new_repo"], scoreMode: "normal", minimumConfidence: 0.75,
  },
  {
    name: "mature stable",
    input: fixtureInput({ files: ["README.md", "Cargo.toml", "src/lib.rs"], readme: "Status: stable and feature complete. Security fixes continue to be maintained." }),
    type: "software", modifiers: ["mature_stable"], scoreMode: "normal", minimumConfidence: 0.8,
  },
  {
    name: "fork",
    input: fixtureInput({ files: ["README.md", "package.json"], metadata: { fork: true } }),
    type: "generic", modifiers: ["fork"], scoreMode: "facts_only", minimumConfidence: 0.4,
  },
  {
    name: "mirror",
    input: fixtureInput({ files: ["README.md", "package.json"], metadata: { mirror: true } }),
    type: "generic", modifiers: ["mirror"], scoreMode: "facts_only", minimumConfidence: 0.4,
  },
  {
    name: "archived",
    input: fixtureInput({ files: ["README.md", "package.json"], metadata: { archived: true } }),
    type: "generic", modifiers: ["archived"], scoreMode: "facts_only", minimumConfidence: 0.4,
  },
] as const;
