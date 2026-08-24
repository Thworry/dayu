import type { Evidence } from "@dayu/evidence-schema";

import {
  countValue,
  evidenceFor,
  evidenceQuality,
  finding,
  valueItems,
  valueRecord,
  type DimensionRuleResult,
  type PercentileBand,
  type RuleContext,
} from "../types.js";

const SIGNAL_WEIGHTS = { forks: 0.3, subscribers: 0.1, contributors: 0.25, human_activity: 0.35 } as const;

function isBot(item: Record<string, unknown>): boolean {
  return item.authorType === "Bot" || item.type === "Bot" || (typeof item.login === "string" && /\[bot\]$/i.test(item.login));
}

function humanCount(context: RuleContext): { count: number; ids: string[]; quality: number } | null {
  const issuesEnabled = valueRecord(evidenceFor(context, "repository.metadata"))?.hasIssues !== false;
  const issues = evidenceFor(context, "repository.issues");
  const pulls = evidenceFor(context, "repository.pull_requests");
  const expected = [...(issuesEnabled ? [issues] : []), pulls];
  if (expected.some((item) => item?.status !== "complete")) return null;
  const available = expected.filter((item): item is Evidence => item !== undefined);
  if (available.length === 0) return null;
  const count = available.reduce((sum, item) => sum + valueItems(item).filter((entry) => !isBot(entry)).length, 0);
  return {
    count,
    ids: available.map((item) => item.id),
    quality: available.reduce((sum, item) => sum + evidenceQuality(item), 0) / available.length,
  };
}

function band(context: RuleContext, key: string): PercentileBand | null {
  return context.normalizer.bands[key] ?? null;
}

function riskFromDeficit(stars: number, observed: number, percentile: PercentileBand): number {
  const deficit = Math.max(0, Math.log((stars + 1) / (observed + 1)));
  if (deficit <= percentile.p80Deficit) return 0;
  if (deficit >= percentile.p99Deficit) return 100;
  return 100 * (deficit - percentile.p80Deficit) / (percentile.p99Deficit - percentile.p80Deficit);
}

export function scorePopularity(context: RuleContext): DimensionRuleResult {
  const metadata = evidenceFor(context, "repository.metadata");
  const metadataValue = valueRecord(metadata);
  const stars = typeof metadataValue?.stars === "number" ? metadataValue.stars : null;
  const signals: { name: keyof typeof SIGNAL_WEIGHTS; observed: number; ids: string[]; quality: number }[] = [];
  if (metadata !== undefined && evidenceQuality(metadata) > 0 && stars !== null) {
    if (typeof metadataValue?.forks === "number") signals.push({ ids: [metadata.id], name: "forks", observed: metadataValue.forks, quality: evidenceQuality(metadata) });
    if (typeof metadataValue?.subscribers === "number") signals.push({ ids: [metadata.id], name: "subscribers", observed: metadataValue.subscribers, quality: evidenceQuality(metadata) });
  }
  const contributors = evidenceFor(context, "repository.contributors");
  const contributorCount = countValue(contributors);
  if (contributors?.status === "complete" && contributorCount !== null) {
    signals.push({ ids: [contributors.id], name: "contributors", observed: contributorCount, quality: evidenceQuality(contributors) });
  }
  const activity = humanCount(context);
  if (activity !== null) signals.push({ ...activity, name: "human_activity", observed: activity.count });

  const scored = stars === null ? [] : signals.flatMap((signal) => {
    const percentile = band(context, `popularity.${signal.name}`);
    if (percentile === null || percentile.p99Deficit <= percentile.p80Deficit) return [];
    return [{ ...signal, risk: stars < 50 ? 0 : riskFromDeficit(stars, signal.observed, percentile), weight: SIGNAL_WEIGHTS[signal.name] }];
  });
  const coverage = scored.reduce((sum, signal) => sum + signal.weight, 0);
  if (coverage === 0) {
    return { coverage: 0, dimension: "popularity", findings: [], missingSignals: ["popularity.cohort_signals"], positiveSignals: [], quality: 0, risk: null };
  }
  const risk = scored.reduce((sum, signal) => sum + signal.risk * signal.weight, 0) / coverage;
  const ids = [...new Set(scored.flatMap((signal) => signal.ids))];
  const result = finding({
    copyKey: risk > 0 ? "finding.popularity.cohort_mismatch" : "finding.popularity.signals_align",
    dimension: "popularity",
    evidenceIds: ids,
    limitations: stars !== null && stars < 50 ? ["low_star_wording_guard"] : [],
    positiveEvidenceIds: risk === 0 ? ids : [],
    risk,
    ruleId: "popularity.cohort_residuals",
  }, context.rulesVersion);
  const quality = scored.reduce((sum, signal) => sum + signal.quality * signal.weight, 0) / coverage;
  return {
    coverage,
    dimension: "popularity",
    findings: result !== null && risk > 0 ? [result] : [],
    missingSignals: Object.keys(SIGNAL_WEIGHTS).filter((name) => !scored.some((signal) => signal.name === name)).map((name) => `popularity.${name}`),
    positiveSignals: result !== null && risk === 0 ? [result] : [],
    quality,
    risk,
  };
}
