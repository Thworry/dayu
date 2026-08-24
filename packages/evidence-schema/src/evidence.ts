import { createHash } from "node:crypto";

import { z } from "zod";

export const dataStatusSchema = z.enum([
  "complete",
  "partial",
  "restricted",
  "unverifiable",
  "not_applicable",
]);
export type DataStatus = z.infer<typeof dataStatusSchema>;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

export const evidenceKindSchema = z.enum([
  "metadata",
  "file",
  "commit",
  "release",
  "issue",
  "pull_request",
  "community",
  "derived",
]);

export const evidenceSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("api"),
    endpoint: z.string().startsWith("/"),
    queryHash: z.string(),
  }),
  z.object({
    kind: z.literal("file"),
    commitSha: z.string().min(7),
    path: z.string().min(1),
    lineStart: z.number().int().positive().optional(),
  }),
]);

export const evidenceSchema = z.object({
  id: z.string().regex(/^ev_[a-f0-9]{24}$/),
  schemaVersion: z.literal("1"),
  kind: evidenceKindSchema,
  repository: z.object({
    id: z.number().int().positive(),
    fullName: z.string().regex(/^[^/]+\/[^/]+$/),
  }),
  source: evidenceSourceSchema,
  observedAt: z.iso.datetime(),
  status: dataStatusSchema,
  summary: z.string().min(1),
  value: jsonValueSchema,
  fact: z.object({
    metric: z.string(),
    value: jsonValueSchema,
    unit: z.string().optional(),
    window: z.string().optional(),
  }),
  limitations: z.array(z.string()).default([]),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export interface EvidenceIdInput {
  repoId: number;
  commitSha: string;
  kind: string;
  path: string;
}

export function createEvidenceId(input: EvidenceIdInput): string {
  const canonical = [input.repoId, input.commitSha, input.kind, input.path];
  return `ev_${createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 24)}`;
}

export const evidenceEnvelopeSchema = z.object({
  schemaVersion: z.literal("1"),
  repository: z.object({
    id: z.number().int().positive(),
    fullName: z.string().regex(/^[^/]+\/[^/]+$/),
    defaultBranch: z.string().min(1),
  }),
  sourceCommit: z.string().min(7),
  evidence: z.array(evidenceSchema),
});
export type EvidenceEnvelope = z.infer<typeof evidenceEnvelopeSchema>;
