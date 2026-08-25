import type { NormalizerSnapshot } from "./types.js";

export const SCORING_RULES_VERSION = "rules-v1";

export const REFERENCE_SCORING_NORMALIZER: Readonly<NormalizerSnapshot> = Object.freeze({
  bands: Object.freeze({
    "popularity.contributors": Object.freeze({ p80Deficit: 3.5, p99Deficit: 7 }),
    "popularity.forks": Object.freeze({ p80Deficit: 3.5, p99Deficit: 7 }),
    "popularity.human_activity": Object.freeze({ p80Deficit: 3.5, p99Deficit: 7 }),
    "popularity.subscribers": Object.freeze({ p80Deficit: 3.5, p99Deficit: 7 }),
  }),
  confidence: 0.4,
  version: "normalizer-v1",
});
