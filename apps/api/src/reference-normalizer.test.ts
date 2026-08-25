import { REFERENCE_SCORING_NORMALIZER } from "@dayu/scoring-core";
import { expect, it } from "vitest";

import { API_REFERENCE_NORMALIZER } from "./server.js";

it("uses the exported versioned scoring normalizer as the API default", () => {
  expect(API_REFERENCE_NORMALIZER).toBe(REFERENCE_SCORING_NORMALIZER);
  expect(API_REFERENCE_NORMALIZER.version).toBe("normalizer-v1");
});
