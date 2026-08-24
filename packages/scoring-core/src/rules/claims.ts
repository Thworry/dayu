import { evidenceFor, evidenceQuality, finding, valueRecord, type DimensionRuleResult, type RuleContext } from "../types.js";

function filePaths(context: RuleContext): string[] | null {
  const tree = evidenceFor(context, "repository.tree");
  const value = valueRecord(tree);
  if (tree?.status !== "complete" || value?.completeForNegativeEvidence === false) return null;
  return Array.isArray(value?.files) ? value.files.flatMap((entry) => {
    const item = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
    return typeof item?.path === "string" ? [item.path.toLowerCase()] : [];
  }) : [];
}

export function scoreClaims(context: RuleContext): DimensionRuleResult {
  const tree = evidenceFor(context, "repository.tree");
  const files = filePaths(context);
  const content = context.evidence.filter((item) => item.fact.metric === "repository.file_content" && evidenceQuality(item) > 0);
  if (tree === undefined || files === null || content.length === 0) {
    return { coverage: 0, dimension: "claims", findings: [], missingSignals: ["claims.complete_tree_and_readme"], positiveSignals: [], quality: tree === undefined ? 0 : evidenceQuality(tree), risk: null };
  }
  const text = content.map((item) => valueRecord(item)?.text).filter((value): value is string => typeof value === "string").join("\n");
  const claimsInstall = /\b(?:install|npm i|pip install|cargo add|go get)\b/i.test(text);
  const claimsRelease = /\b(?:production[ -]ready|stable|release|ready for production)\b/i.test(text);
  const manifest = files.some((path) => /(?:^|\/)(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|composer\.json|gemfile)$/.test(path));
  const delivery = files.some((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path));
  const releases = evidenceFor(context, "repository.releases");
  const releaseCount = valueRecord(releases)?.count;
  const checks: { mismatch: boolean; weight: number }[] = [];
  if (claimsInstall) checks.push({ mismatch: !manifest, weight: 0.3 });
  if (claimsRelease) checks.push({ mismatch: !delivery && !(typeof releaseCount === "number" && releaseCount > 0), weight: 0.2 });
  const applicable = checks.reduce((sum, check) => sum + check.weight, 0);
  if (applicable === 0) {
    return { coverage: 0, dimension: "claims", findings: [], missingSignals: ["claims.not_applicable"], positiveSignals: [], quality: Math.min(evidenceQuality(tree), ...content.map(evidenceQuality)), risk: null };
  }
  const risk = 100 * checks.reduce((sum, check) => sum + Number(check.mismatch) * check.weight, 0) / applicable;
  const ids = [tree.id, ...content.map((item) => item.id), ...(releases === undefined ? [] : [releases.id])];
  const result = finding({ copyKey: risk > 0 ? "finding.claims.public_mismatch" : "finding.claims.no_public_mismatch", dimension: "claims", evidenceIds: ids, limitations: [], positiveEvidenceIds: risk === 0 ? ids : [], risk, ruleId: "claims.files_and_delivery" }, context.rulesVersion);
  return {
    coverage: 1,
    dimension: "claims",
    findings: result !== null && risk > 0 ? [result] : [],
    missingSignals: [],
    positiveSignals: result !== null && risk === 0 ? [result] : [],
    quality: Math.min(evidenceQuality(tree), ...content.map(evidenceQuality)),
    risk,
  };
}
