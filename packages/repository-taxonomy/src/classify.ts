import type { Evidence } from "@dayu/evidence-schema";

import { detectModifiers, type RepositoryModifier } from "./modifiers.js";

export type RepositoryType = "software" | "docs_content" | "data_model" | "template" | "creative_demo" | "generic";
export type { RepositoryModifier } from "./modifiers.js";

export interface RepositoryClassificationInput {
  analyzedAt?: string;
  archived?: boolean;
  createdAt?: string;
  evidence?: readonly Evidence[];
  files?: readonly string[];
  fork?: boolean;
  isTemplate?: boolean;
  languages?: Readonly<Record<string, number>>;
  matureStable?: boolean;
  mirror?: boolean;
  text?: string;
}

type CoverageScope = "complete" | "partial" | "restricted" | "unverifiable" | "not_available";

export interface TaxonomyCoverage {
  ratio: number;
  scopes: { metadata: CoverageScope; tree: CoverageScope; languages: CoverageScope; content: CoverageScope };
}

export interface RepositoryClassification {
  type: RepositoryType;
  confidence: number;
  scoreMode: "normal" | "facts_only";
  modifiers: RepositoryModifier[];
  evidenceIds: string[];
  coverage: TaxonomyCoverage;
}

interface Extracted {
  archived: boolean;
  createdAt?: string;
  files: string[];
  fork: boolean;
  isTemplate: boolean;
  languages: Record<string, number>;
  mirror: boolean;
  text: string;
  treeEntries: { path: string; size: number | null }[];
  ids: { metadata: string[]; tree: string[]; languages: string[]; content: string[] };
  fieldIds: { archived: string[]; createdAt: string[]; fork: string[]; isTemplate: string[]; mirror: string[] };
  fieldQuality: { archived: number; createdAt: number; fork: number; isTemplate: number; mirror: number };
  contentSources: { id: string; text: string }[];
  coverage: TaxonomyCoverage;
}

const STATUS_WEIGHT: Record<CoverageScope, number> = { complete: 1, partial: 0.5, restricted: 0, unverifiable: 0, not_available: 0 };

function scopeStatus(evidence: readonly Evidence[], metric: string): CoverageScope {
  const matches = evidence.filter((item) => item.fact.metric === metric);
  if (matches.length === 0) return "not_available";
  const statuses = matches.map((item) => item.status);
  if (statuses.includes("complete")) return "complete";
  if (statuses.includes("partial")) return "partial";
  if (statuses.includes("restricted")) return "restricted";
  if (statuses.includes("unverifiable")) return "unverifiable";
  return "not_available";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function usable(item: Evidence): boolean {
  return item.status === "complete" || item.status === "partial";
}

function extract(input: RepositoryClassificationInput): Extracted {
  const evidence = input.evidence ?? [];
  const byMetric = (metric: string): Evidence[] => evidence.filter((item) => item.fact.metric === metric && usable(item));
  const metadataEvidence = byMetric("repository.metadata");
  const treeEvidence = byMetric("repository.tree");
  const languageEvidence = byMetric("repository.languages");
  const contentEvidence = byMetric("repository.file_content");
  const metadata = record(metadataEvidence[0]?.value) ?? {};
  const treeValue = record(treeEvidence[0]?.value);
  const treeEntries = Array.isArray(treeValue?.files) ? treeValue.files.flatMap((entry) => {
    const item = record(entry);
    const path = item?.path;
    if (typeof path !== "string") return [];
    const size = item?.size;
    return [{ path, size: typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : null }];
  }) : [];
  const treeFiles = treeEntries.map((entry) => entry.path);
  const languageValue = record(languageEvidence[0]?.value) ?? {};
  const evidenceLanguages = Object.fromEntries(Object.entries(languageValue).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
  const evidenceContent = contentEvidence.flatMap((item) => {
    const value = record(item.value);
    return typeof value?.text === "string" ? [value.text] : [];
  }).join("\n");
  const contentSources = input.text === undefined ? contentEvidence.flatMap((item) => {
    const value = record(item.value);
    return typeof value?.text === "string" ? [{ id: item.id, text: value.text }] : [];
  }) : [];
  const directMetadataComplete = input.archived !== undefined && input.createdAt !== undefined && input.fork !== undefined && input.isTemplate !== undefined && input.mirror !== undefined;
  const scopes = {
    metadata: directMetadataComplete ? "complete" as const : scopeStatus(evidence, "repository.metadata"),
    tree: input.files !== undefined ? "complete" as const : scopeStatus(evidence, "repository.tree"),
    languages: input.languages !== undefined ? "complete" as const : scopeStatus(evidence, "repository.languages"),
    content: input.text !== undefined ? "complete" as const : scopeStatus(evidence, "repository.file_content"),
  };
  const ratio = (STATUS_WEIGHT[scopes.metadata] + STATUS_WEIGHT[scopes.tree] + STATUS_WEIGHT[scopes.languages] + STATUS_WEIGHT[scopes.content]) / 4;
  const metadataIds = metadataEvidence.map((item) => item.id);
  const metadataFieldIds = (override: unknown, value: unknown, expected: "boolean" | "string"): string[] =>
    override === undefined && typeof value === expected ? metadataIds : [];
  const metadataFieldQuality = (override: unknown, value: unknown, expected: "boolean" | "string"): number => {
    if (override !== undefined) return typeof override === expected ? 1 : 0;
    return typeof value === expected ? STATUS_WEIGHT[scopeStatus(evidence, "repository.metadata")] : 0;
  };
  return {
    archived: input.archived ?? metadata.archived === true,
    ...(input.createdAt ?? (typeof metadata.createdAt === "string" ? metadata.createdAt : undefined)) !== undefined
      ? { createdAt: input.createdAt ?? metadata.createdAt as string }
      : {},
    files: [...new Set(input.files ?? treeFiles)].sort(),
    fork: input.fork ?? metadata.fork === true,
    isTemplate: input.isTemplate ?? metadata.isTemplate === true,
    languages: input.languages === undefined ? evidenceLanguages : { ...input.languages },
    mirror: input.mirror ?? metadata.mirror === true,
    text: input.text ?? evidenceContent,
    treeEntries: input.files === undefined ? treeEntries : [],
    ids: {
      metadata: metadataIds,
      tree: input.files === undefined ? treeEvidence.map((item) => item.id) : [],
      languages: input.languages === undefined ? languageEvidence.map((item) => item.id) : [],
      content: input.text === undefined ? contentEvidence.map((item) => item.id) : [],
    },
    fieldIds: {
      archived: metadataFieldIds(input.archived, metadata.archived, "boolean"),
      createdAt: metadataFieldIds(input.createdAt, metadata.createdAt, "string"),
      fork: metadataFieldIds(input.fork, metadata.fork, "boolean"),
      isTemplate: metadataFieldIds(input.isTemplate, metadata.isTemplate, "boolean"),
      mirror: metadataFieldIds(input.mirror, metadata.mirror, "boolean"),
    },
    fieldQuality: {
      archived: metadataFieldQuality(input.archived, metadata.archived, "boolean"),
      createdAt: metadataFieldQuality(input.createdAt, metadata.createdAt, "string"),
      fork: metadataFieldQuality(input.fork, metadata.fork, "boolean"),
      isTemplate: metadataFieldQuality(input.isTemplate, metadata.isTemplate, "boolean"),
      mirror: metadataFieldQuality(input.mirror, metadata.mirror, "boolean"),
    },
    contentSources,
    coverage: { ratio, scopes },
  };
}

interface Candidate {
  type: Exclude<RepositoryType, "generic">;
  baseConfidence: number;
  evidenceIds: string[];
  explicit?: boolean;
  scopes: (keyof TaxonomyCoverage["scopes"])[];
  signals: number;
  sourceQuality?: number;
}

function candidate(data: Extracted): { type: Exclude<RepositoryType, "generic">; confidence: number; evidenceIds: string[] } | null {
  const lower = data.files.map((path) => path.toLowerCase());
  const treeIds = data.ids.tree;
  const candidates: Candidate[] = [];
  if (data.isTemplate) candidates.push({ type: "template", baseConfidence: 0.99, evidenceIds: data.fieldIds.isTemplate, explicit: true, scopes: ["metadata"], signals: 1, sourceQuality: data.fieldQuality.isTemplate });
  const strongDataManifest = lower.some((path) => /(?:^|\/)(?:dataset_infos\.json|model-index\.ya?ml)$/.test(path));
  const modelCard = lower.some((path) => /(?:^|\/)model_card\.md$/.test(path));
  const binaryData = lower.some((path) => /\.(?:parquet|arrow|safetensors|onnx)$/.test(path));
  const dataDirectory = lower.some((path) => /(?:^|\/)data(?:\/|$)/.test(path));
  if (strongDataManifest || (binaryData && dataDirectory) || modelCard) {
    candidates.push({
      type: "data_model",
      baseConfidence: strongDataManifest ? 0.95 : binaryData && dataDirectory ? 0.9 : 0.72,
      evidenceIds: treeIds,
      scopes: ["tree"],
      signals: (strongDataManifest ? 2 : modelCard ? 1 : 0) + (binaryData ? 1 : 0) + (dataDirectory ? 1 : 0),
    });
  }
  const awesomeSignals = Number(/^#\s*awesome\b/im.test(data.text)) + Number(/\bcurated list\b/i.test(data.text));
  if (awesomeSignals > 0) {
    const matchingIds = data.contentSources.filter((source) => /^#\s*awesome\b|\bcurated list\b/im.test(source.text)).map((source) => source.id);
    candidates.push({ type: "docs_content", baseConfidence: 0.95, evidenceIds: matchingIds, scopes: ["content"], signals: awesomeSignals });
  }
  const docsGenerator = lower.some((path) => /^(?:mkdocs\.ya?ml|docs\/conf\.py|docusaurus\.config\.[cm]?[jt]s)$/.test(path));
  const meaningful = lower.filter((path) => !/^(?:readme|license|contributing)(?:\.|$)/.test(path));
  const docs = meaningful.filter((path) => /^(?:docs?|guide)(?:\/|$)|\.(?:md|mdx|rst)$/.test(path));
  const docsRatio = meaningful.length >= 2 && docs.length / meaningful.length >= 0.6;
  const docsDirectory = docs.length > 0;
  if (docsGenerator || docsRatio) candidates.push({ type: "docs_content", baseConfidence: docsGenerator ? 0.94 : 0.78, evidenceIds: treeIds, scopes: ["tree"], signals: Number(docsGenerator) + Number(docsRatio || docsDirectory) });
  const softwareManifest = lower.some((path) => /(?:^|\/)(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|composer\.json|gemfile)$/.test(path));
  if (softwareManifest) {
    const source = lower.some((path) => /^(?:src|lib|app)(?:\/|$)|(?:^|\/)main\.(?:[cm]?[jt]sx?|py|go|rs)$/.test(path));
    const tests = lower.some((path) => /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\./.test(path));
    const workspace = lower.some((path) => /^(?:pnpm-workspace\.yaml|lerna\.json|nx\.json|turbo\.json)$/.test(path)) || lower.filter((path) => /(?:^|\/)package\.json$/.test(path)).length >= 2;
    candidates.push({ type: "software", baseConfidence: 0.92, evidenceIds: treeIds, scopes: ["tree"], signals: 1 + Number(source) + Number(tests) + Number(workspace) });
  }
  const creativeMarker = lower.some((path) => /\.(?:blend|godot|unity|pde)$/.test(path));
  const creativeAssets = lower.includes("index.html") && lower.some((path) => path.startsWith("assets/"));
  if (creativeMarker || creativeAssets) candidates.push({ type: "creative_demo", baseConfidence: 0.84, evidenceIds: treeIds, scopes: ["tree"], signals: Number(creativeMarker) + Number(creativeAssets) });
  const adjusted = candidates.map((item) => {
    const sourceQuality = item.sourceQuality ?? item.scopes.reduce((sum, scope) => sum + STATUS_WEIGHT[data.coverage.scopes[scope]], 0) / item.scopes.length;
    const coverageFactor = 0.75 + 0.25 * data.coverage.ratio;
    const independentFactor = item.explicit === true ? 1 : item.signals >= 3 ? 1 : item.signals === 2 ? 0.9 : 0.65;
    return { type: item.type, evidenceIds: item.evidenceIds, confidence: item.baseConfidence * sourceQuality * coverageFactor * independentFactor };
  }).sort((left, right) => right.confidence - left.confidence || left.type.localeCompare(right.type));
  return adjusted[0] ?? null;
}

export function classifyRepository(input: RepositoryClassificationInput): RepositoryClassification {
  const data = extract(input);
  const modifiers = detectModifiers({
    ...(input.analyzedAt === undefined ? {} : { analyzedAt: input.analyzedAt }),
    archived: data.archived,
    ...(data.createdAt === undefined ? {} : { createdAt: data.createdAt }),
    files: data.files,
    fork: data.fork,
    isTemplate: data.isTemplate,
    mirror: data.mirror,
    text: data.text,
    treeComplete: data.coverage.scopes.tree === "complete",
    treeEntries: data.treeEntries,
  });
  if (input.matureStable === true && !modifiers.includes("mature_stable")) modifiers.push("mature_stable");
  const validIds = new Set(input.evidence?.map((item) => item.id) ?? []);
  const factsOnly = modifiers.some((modifier) => modifier === "fork" || modifier === "mirror" || modifier === "archived");
  if (factsOnly) {
    const factsEvidence = [
      ...(modifiers.includes("fork") ? data.fieldIds.fork : []),
      ...(modifiers.includes("mirror") ? data.fieldIds.mirror : []),
      ...(modifiers.includes("archived") ? data.fieldIds.archived : []),
    ];
    return {
      confidence: 0.45,
      coverage: data.coverage,
      evidenceIds: [...new Set(factsEvidence)].filter((id) => validIds.has(id)),
      modifiers,
      scoreMode: "facts_only",
      type: "generic",
    };
  }
  const matched = candidate(data);
  const type = matched !== null && matched.confidence >= 0.6 ? matched.type : "generic";
  const confidence = matched?.confidence ?? 0.45;
  const matchingContentIds = (pattern: RegExp): string[] => (input.evidence ?? []).flatMap((item) => {
    if (!data.ids.content.includes(item.id)) return [];
    const value = record(item.value);
    return typeof value?.text === "string" && pattern.test(value.text) ? [item.id] : [];
  });
  const modifierIds = modifiers.flatMap((modifier): string[] => {
    switch (modifier) {
      case "new_repo": return data.fieldIds.createdAt;
      case "external_tracker": return matchingContentIds(/(?:atlassian\.net\/browse|\bjira\b|linear\.app\/|bugzilla|bugs\.chromium\.org|youtrack|external issue tracker)/i);
      case "monorepo":
      case "generated_heavy": return data.ids.tree;
      case "binary_lfs": return [...data.ids.tree, ...matchingContentIds(/filter\s*=\s*lfs/i)];
      case "mature_stable": return [...data.fieldIds.createdAt, ...matchingContentIds(/(?:\bstable\b.{0,40}\bfeature complete\b|\bmaintenance mode\b)/is)];
      case "fork": return data.fieldIds.fork;
      case "mirror": return data.fieldIds.mirror;
      case "archived": return data.fieldIds.archived;
    }
  });
  const evidenceIds = [...new Set([
    ...(type === "generic" ? [] : matched?.evidenceIds ?? []),
    ...modifierIds,
  ])].filter((id) => validIds.has(id));
  return {
    confidence,
    coverage: data.coverage,
    evidenceIds,
    modifiers,
    scoreMode: "normal",
    type,
  };
}
