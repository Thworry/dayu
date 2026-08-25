import { z } from "zod";

export const RUBRIC_IDS = [
  "substance.artifact",
  "maintenance.status",
  "community.claim",
  "claims.install",
  "claims.badge",
  "claims.roadmap",
] as const;

export const VERDICTS = ["supported", "mixed", "contradicted", "unverifiable", "not_applicable"] as const;

export const copilotFindingSchema = z.object({
  rubricId: z.enum(RUBRIC_IDS),
  verdict: z.enum(VERDICTS),
  evidenceIds: z.array(z.string().regex(/^ev_[a-f0-9]{24}$/)).max(6),
  counterEvidenceIds: z.array(z.string().regex(/^ev_[a-f0-9]{24}$/)).max(6),
  zh: z.string().min(1).max(240),
  en: z.string().min(1).max(300),
}).strict();

export const copilotAnalysisSchema = z.object({
  findings: z.array(copilotFindingSchema).max(12),
}).strict();

export type CopilotFindingOutput = z.infer<typeof copilotFindingSchema>;
export type CopilotAnalysisOutput = z.infer<typeof copilotAnalysisSchema>;
export type RubricId = CopilotFindingOutput["rubricId"];
export type Verdict = CopilotFindingOutput["verdict"];

export type AiDimension = "substance" | "maintenance" | "community" | "claims";

export interface AiFinding extends CopilotFindingOutput {
  dimension: AiDimension;
  risk: 0 | 50 | 100 | null;
}

export interface CopilotAnalysis {
  findings: AiFinding[];
}
