import type { CalibrationEvaluation, ReleaseGate } from "./evaluate.js";
import type { GoldenCaseSet, NormalizerSnapshot } from "./schema.js";

export interface CalibrationReport {
  evaluation: CalibrationEvaluation;
  generatedAt: string;
  goldenCases: { classification: GoldenCaseSet["dataClassification"]; count: number; version: string };
  normalizer: { classification: NormalizerSnapshot["dataClassification"]; repositoryCount: number; version: string };
  releaseGate: ReleaseGate;
  reportSchemaVersion: "1";
}

export function createCalibrationReport(input: {
  gate: ReleaseGate;
  golden: GoldenCaseSet;
  normalizer: NormalizerSnapshot;
}): CalibrationReport {
  return {
    evaluation: input.gate.evaluation,
    generatedAt: new Date().toISOString(),
    goldenCases: { classification: input.golden.dataClassification, count: input.golden.cases.length, version: input.golden.version },
    normalizer: { classification: input.normalizer.dataClassification, repositoryCount: input.normalizer.repositoryCount, version: input.normalizer.version },
    releaseGate: input.gate,
    reportSchemaVersion: "1",
  };
}
