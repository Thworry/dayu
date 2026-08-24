import type { AiConfidenceInput } from "./types.js";
import { clampUnit } from "./types.js";

export function ruleConfidence(input: { data: number; cohort: number; taxonomy: number }): number {
  return Math.round(100 * (0.6 * clampUnit(input.data) + 0.25 * clampUnit(input.cohort) + 0.15 * clampUnit(input.taxonomy)));
}

export function aiConfidence(input: AiConfidenceInput): number {
  return Math.round(100 * (
    0.55 * clampUnit(input.applicableCoverage) +
    0.25 * clampUnit(input.evidenceScopeCompleteness) +
    0.2 * clampUnit(input.sampleAdequacy)
  ));
}

export function enhancedConfidence(rule: number, ai: number): number {
  return Math.round(0.7 * Math.min(100, Math.max(0, rule)) + 0.3 * Math.min(100, Math.max(0, ai)));
}
