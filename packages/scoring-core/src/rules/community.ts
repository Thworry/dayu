import type { Evidence } from "@dayu/evidence-schema";

import { evidenceFor, evidenceQuality, finding, valueItems, valueRecord, type DimensionRuleResult, type RuleContext } from "../types.js";

function bot(item: Record<string, unknown>): boolean {
  return item.authorType === "Bot" || item.type === "Bot" || (typeof item.login === "string" && /\[bot\]$/i.test(item.login));
}

export function scoreCommunity(context: RuleContext): DimensionRuleResult {
  if (context.classification.modifiers.includes("external_tracker")) {
    return { coverage: 0, dimension: "community", findings: [], missingSignals: ["community.external_tracker"], positiveSignals: [], quality: 0, risk: null };
  }
  const issuesEnabled = valueRecord(evidenceFor(context, "repository.metadata"))?.hasIssues !== false;
  const sources = [
    ...(issuesEnabled ? [evidenceFor(context, "repository.issues")] : []),
    evidenceFor(context, "repository.pull_requests"),
  ]
    .filter((item): item is Evidence => item !== undefined)
    .filter((item) => item.status === "complete");
  if (sources.length === 0) return { coverage: 0, dimension: "community", findings: [], missingSignals: [...(!issuesEnabled ? ["community.issues_disabled"] : []), "community.human_activity"], positiveSignals: [], quality: 0, risk: null };
  const applicableSourceCount = issuesEnabled ? 2 : 1;
  if (context.classification.modifiers.includes("new_repo")) {
    const ids = sources.map((item) => item.id);
    const result = finding({ copyKey: "finding.community.new_repository", dimension: "community", evidenceIds: ids, limitations: ["new_repo_history_guard"], positiveEvidenceIds: ids, risk: 0, ruleId: "community.new_repository_guard" }, context.rulesVersion);
    return { coverage: sources.length / applicableSourceCount, dimension: "community", findings: [], missingSignals: [], positiveSignals: result === null ? [] : [result], quality: sources.reduce((sum, item) => sum + evidenceQuality(item), 0) / sources.length, risk: 0 };
  }
  const coverage = sources.length / applicableSourceCount;
  const sourceWeight = 1 / applicableSourceCount;
  const risk = sources.reduce((sum, source) => {
    const humans = valueItems(source).filter((item) => !bot(item));
    const dialogue = humans.filter((item) => (typeof item.comments === "number" && item.comments > 0) || (typeof item.review_comments === "number" && item.review_comments > 0));
    return sum + sourceWeight * 100 * (1 - (dialogue.length + 1) / (humans.length + 2));
  }, 0) / coverage;
  const ids = sources.map((item) => item.id);
  const result = finding({ copyKey: risk > 0 ? "finding.community.low_human_dialogue" : "finding.community.dialogue_holds_up", dimension: "community", evidenceIds: ids, limitations: ["bounded_activity_sample"], positiveEvidenceIds: risk === 0 ? ids : [], risk, ruleId: "community.human_dialogue" }, context.rulesVersion);
  return {
    coverage,
    dimension: "community",
    findings: result !== null && risk > 0 ? [result] : [],
    missingSignals: [],
    positiveSignals: result !== null && risk === 0 ? [result] : [],
    quality: sources.reduce((sum, item) => sum + evidenceQuality(item), 0) / sources.length,
    risk,
  };
}
