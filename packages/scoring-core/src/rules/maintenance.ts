import { countValue, evidenceFor, evidenceQuality, finding, valueRecord, type DimensionRuleResult, type RuleContext } from "../types.js";

function daysBetween(earlier: unknown, later: string): number | null {
  if (typeof earlier !== "string") return null;
  const start = Date.parse(earlier);
  const end = Date.parse(later);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 86_400_000 : null;
}

export function scoreMaintenance(context: RuleContext): DimensionRuleResult {
  const metadata = evidenceFor(context, "repository.metadata");
  if (context.classification.modifiers.includes("new_repo")) {
    const result = metadata === undefined ? null : finding({ copyKey: "finding.maintenance.new_repository", dimension: "maintenance", evidenceIds: [metadata.id], limitations: ["new_repo_history_guard"], positiveEvidenceIds: [metadata.id], risk: 0, ruleId: "maintenance.new_repository_guard" }, context.rulesVersion);
    return { coverage: metadata === undefined ? 0 : 1, dimension: "maintenance", findings: [], missingSignals: [], positiveSignals: result === null ? [] : [result], quality: metadata === undefined ? 0 : evidenceQuality(metadata), risk: 0 };
  }
  const components: { risk: number; weight: number; id: string; quality: number; name: string }[] = [];
  const issuesEnabled = valueRecord(metadata)?.hasIssues !== false;
  const pushedAge = daysBetween(valueRecord(metadata)?.pushedAt, context.analyzedAt);
  const rawWeights = {
    issue_response: 0.25,
    pr_response: 0.2,
    recent_push: 0.2,
    release_lifecycle: 0.1,
  } as const;
  const external = context.classification.modifiers.includes("external_tracker");
  const applicableNames = [
    "recent_push" as const,
    ...(!external && issuesEnabled ? ["issue_response" as const] : []),
    ...(!external ? ["pr_response" as const] : []),
    "release_lifecycle" as const,
  ];
  const applicableWeight = applicableNames.reduce((sum, name) => sum + rawWeights[name], 0);
  const normalizedWeight = (name: keyof typeof rawWeights): number => rawWeights[name] / applicableWeight;
  if (metadata !== undefined && evidenceQuality(metadata) > 0 && pushedAge !== null) components.push({ id: metadata.id, name: "recent_push", quality: evidenceQuality(metadata), risk: Math.min(100, Math.max(0, (pushedAge - 90) / 275 * 100)), weight: normalizedWeight("recent_push") });
  for (const [metric, name] of [
    ["repository.issues", "issue_response"],
    ["repository.pull_requests", "pr_response"],
  ] as const) {
    if (external || (metric === "repository.issues" && !issuesEnabled)) continue;
    const item = evidenceFor(context, metric);
    const count = countValue(item);
    if (item?.status === "complete" && count !== null) components.push({ id: item.id, name, quality: evidenceQuality(item), risk: count === 0 ? 100 : 0, weight: normalizedWeight(name) });
  }
  const releases = evidenceFor(context, "repository.releases");
  const releaseCount = countValue(releases);
  if (releases?.status === "complete" && releaseCount !== null) components.push({ id: releases.id, name: "release_lifecycle", quality: evidenceQuality(releases), risk: releaseCount === 0 ? 100 : 0, weight: normalizedWeight("release_lifecycle") });
  const coverage = components.reduce((sum, item) => sum + item.weight, 0);
  if (coverage === 0) return { coverage: 0, dimension: "maintenance", findings: [], missingSignals: ["maintenance.history"], positiveSignals: [], quality: 0, risk: null };
  const risk = components.reduce((sum, item) => sum + item.risk * item.weight, 0) / coverage;
  const ids = [...new Set(components.map((item) => item.id))];
  const result = finding({ copyKey: risk > 0 ? "finding.maintenance.history_gaps" : "finding.maintenance.history_holds_up", dimension: "maintenance", evidenceIds: ids, limitations: external ? ["external_tracker"] : ["active_weeks_unavailable"], positiveEvidenceIds: risk === 0 ? ids : [], risk, ruleId: "maintenance.public_history" }, context.rulesVersion);
  return {
    coverage,
    dimension: "maintenance",
    findings: result !== null && risk > 0 ? [result] : [],
    missingSignals: ["maintenance.active_weeks", ...(external ? ["maintenance.external_tracker_activity"] : []), ...(!issuesEnabled ? ["maintenance.issues_disabled"] : [])],
    positiveSignals: result !== null && risk === 0 ? [result] : [],
    quality: components.reduce((sum, item) => sum + item.quality * item.weight, 0) / coverage,
    risk,
  };
}
