import { evidenceFor, evidenceQuality, finding, valueRecord, type DimensionRuleResult, type RuleContext } from "../types.js";

function paths(context: RuleContext): string[] | null {
  const tree = evidenceFor(context, "repository.tree");
  const value = valueRecord(tree);
  if (tree === undefined || evidenceQuality(tree) === 0 || tree.status !== "complete" || value?.completeForNegativeEvidence === false) return null;
  const files = value?.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((entry) => {
    const record = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
    return typeof record?.path === "string" ? [record.path.toLowerCase()] : [];
  });
}

export function scoreSubstance(context: RuleContext): DimensionRuleResult {
  const tree = evidenceFor(context, "repository.tree");
  const files = paths(context);
  if (tree === undefined || files === null) {
    return { coverage: 0, dimension: "substance", findings: [], missingSignals: ["substance.complete_tree"], positiveSignals: [], quality: tree === undefined ? 0 : evidenceQuality(tree), risk: null };
  }
  const manifest = files.some((path) => /(?:^|\/)(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|composer\.json|gemfile)$/.test(path));
  const source = files.some((path) => /^(?:src|lib|app)(?:\/|$)|(?:^|\/)main\.(?:[cm]?[jt]sx?|py|go|rs)$/.test(path));
  const docs = files.some((path) => /^(?:docs?|guide)(?:\/|$)|\.(?:md|mdx|rst)$/.test(path));
  const data = files.some((path) => /\.(?:parquet|arrow|safetensors|onnx|csv|jsonl)$/.test(path));
  const core = context.classification.type === "docs_content" ? docs : context.classification.type === "data_model" ? data : manifest || source;
  const install = manifest || context.classification.type === "docs_content" || context.classification.type === "creative_demo";
  const tests = files.some((path) => /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\./.test(path));
  const delivery = files.some((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) || files.some((path) => /(?:^|\/)(?:dockerfile|compose\.ya?ml)$/.test(path));
  const completeness = files.some((path) => /^readme(?:\.|$)/.test(path)) && files.some((path) => /^license(?:\.|$)/.test(path));
  const readme = files.some((path) => /^readme(?:\.|$)/.test(path));
  const license = files.some((path) => /^license(?:\.|$)/.test(path));
  const binaryArtifact = files.some((path) => /\.(?:parquet|arrow|safetensors|onnx|tflite|bin|zip)$/.test(path));
  const workspace = files.some((path) => /^(?:pnpm-workspace\.yaml|lerna\.json|nx\.json|turbo\.json)$/.test(path)) || files.filter((path) => /(?:^|\/)package\.json$/.test(path)).length >= 2;
  let weighted: number;
  if (context.classification.modifiers.includes("binary_lfs")) {
    weighted = 0.45 * Number(binaryArtifact || data) + 0.25 * Number(readme) + 0.15 * Number(delivery) + 0.15 * Number(license || files.includes(".gitattributes"));
  } else if (context.classification.modifiers.includes("generated_heavy")) {
    weighted = 0.4 * Number(manifest || source) + 0.15 * Number(tests) + 0.2 * Number(delivery) + 0.15 * Number(readme) + 0.1 * Number(license);
  } else if (context.classification.modifiers.includes("monorepo")) {
    weighted = 0.4 * Number(workspace || manifest) + 0.2 * Number(tests) + 0.15 * Number(delivery) + 0.15 * Number(readme) + 0.1 * Number(license);
  } else {
    weighted = 0.3 * Number(core) + 0.25 * Number(install) + 0.2 * Number(tests) + 0.15 * Number(delivery) + 0.1 * Number(completeness);
  }
  const risk = 100 * (1 - weighted);
  const result = finding({
    copyKey: risk > 0 ? "finding.substance.artifact_gaps" : "finding.substance.artifacts_hold_up",
    dimension: "substance",
    evidenceIds: [tree.id],
    limitations: context.classification.modifiers.filter((modifier) => modifier === "binary_lfs" || modifier === "generated_heavy" || modifier === "monorepo"),
    positiveEvidenceIds: risk === 0 ? [tree.id] : [],
    risk,
    ruleId: "substance.type_artifacts",
  }, context.rulesVersion);
  return {
    coverage: 1,
    dimension: "substance",
    findings: result !== null && risk > 0 ? [result] : [],
    missingSignals: [],
    positiveSignals: result !== null && risk === 0 ? [result] : [],
    quality: evidenceQuality(tree),
    risk,
  };
}
