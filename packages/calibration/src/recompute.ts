import { createHash } from "node:crypto";

import { classifyRepository, TAXONOMY_VERSION } from "@dayu/repository-taxonomy";
import { SCORING_RULES_VERSION, scoreRules, type NormalizerSnapshot, type RulesReport } from "@dayu/scoring-core";

import type { GoldenCase, GoldenCaseSet } from "./schema.js";

export const SCORING_PIPELINE_VERSION = "scoring-pipeline-v1";

function canonical(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_canonical_number");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  }
  throw new Error("unsupported_canonical_value");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function sha256Digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function reviewLabelDigest(item: GoldenCase): string {
  return sha256Digest({
    challengeTags: item.challengeTags,
    expected: item.expected,
    id: item.id,
    review: {
      blinded: item.review.blinded,
      protocolVersion: item.review.provenance.protocolVersion,
      reviewerCount: item.review.reviewerCount,
      source: item.review.provenance.source,
    },
    scoringInputDigest: item.scoringInputDigest,
    scoringOutputDigest: item.scoringOutputDigest,
  });
}

export function reviewedLabelManifestDigest(golden: GoldenCaseSet): string {
  return sha256Digest(golden.cases.map((item) => ({ id: item.id, reviewLabelDigest: reviewLabelDigest(item) })));
}

export function reviewLabelsMatchManifest(golden: GoldenCaseSet): boolean {
  return golden.cases.every((item) => item.review.provenance.manifestDigest === reviewLabelDigest(item))
    && golden.reviewedLabelManifestDigest === reviewedLabelManifestDigest(golden);
}

export interface RecomputedGoldenCase {
  currentScore: number;
  inputDigest: string;
  outputDigest: string;
  report: RulesReport;
  repositoryType: GoldenCase["repositoryType"];
}

export function recomputeScoringInput(scoringInput: GoldenCase["scoringInput"], normalizer: NormalizerSnapshot): RecomputedGoldenCase | null {
  if (scoringInput.evidence.some((evidence) => evidence.status !== "complete")) return null;
  const classification = classifyRepository({ analyzedAt: scoringInput.analyzedAt, evidence: scoringInput.evidence });
  const report = scoreRules({
    analyzedAt: scoringInput.analyzedAt,
    classification,
    collectorVersion: scoringInput.collectorVersion,
    evidence: scoringInput.evidence,
    expiresAt: scoringInput.expiresAt,
    locale: scoringInput.locale,
    normalizer,
    ...(scoringInput.ownerFollowers === undefined ? {} : { ownerFollowers: scoringInput.ownerFollowers }),
    rulesVersion: SCORING_RULES_VERSION,
  });
  if (report.score === null) return null;
  return {
    currentScore: report.score,
    inputDigest: sha256Digest({
      pipelineVersion: SCORING_PIPELINE_VERSION,
      rulesVersion: SCORING_RULES_VERSION,
      scoringInput,
      scoringNormalizer: normalizer,
      taxonomyVersion: TAXONOMY_VERSION,
    }),
    outputDigest: sha256Digest(report),
    report,
    repositoryType: classification.type,
  };
}

export function recomputeGoldenCase(item: GoldenCase, normalizer: NormalizerSnapshot): RecomputedGoldenCase | null {
  return recomputeScoringInput(item.scoringInput, normalizer);
}

export function recomputedManifestDigest(golden: GoldenCaseSet, normalizer: NormalizerSnapshot): string | null {
  const entries = golden.cases.map((item) => {
    const recomputed = recomputeGoldenCase(item, normalizer);
    if (recomputed === null) return null;
    return {
      id: item.id,
      inputDigest: recomputed.inputDigest,
      outputDigest: recomputed.outputDigest,
      score: recomputed.currentScore,
    };
  });
  if (entries.some((entry) => entry === null)) return null;
  return sha256Digest(entries);
}
