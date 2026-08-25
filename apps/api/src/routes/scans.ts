import { createHash } from "node:crypto";

import type { Evidence, JsonValue, ReportSnapshot } from "@dayu/evidence-schema";
import {
  GitHubTransportError,
  parseRepositoryInput,
  type CollectedRepository,
  type RepositoryRef,
} from "@dayu/github-collector";
import { classifyRepository } from "@dayu/repository-taxonomy";
import { scoreRules, type NormalizerSnapshot, type RulesReport } from "@dayu/scoring-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { PublicErrorCode, ScanJob, ScanJobStore } from "../jobs/types.js";

const createScanBody = z.object({
  locale: z.enum(["zh", "en"]),
  repository: z.string().min(3).max(200),
}).strict();

const jobParams = z.object({ jobId: z.uuid() });

export type PublicCollector = (ref: RepositoryRef) => Promise<CollectedRepository>;

export interface ScanRoutesDependencies {
  clock: () => Date;
  collector: PublicCollector;
  jobStore: ScanJobStore;
  normalizer: NormalizerSnapshot;
  onBackgroundError: (reason: unknown) => void;
}

function publicError(code: PublicErrorCode): { error: { code: PublicErrorCode } } {
  return { error: { code } };
}

function failureCode(reason: unknown): PublicErrorCode {
  if (reason instanceof GitHubTransportError && reason.code === "rate_limit") return "github_rate_limited";
  if (reason instanceof Error && reason.message === "private_or_unavailable") return "private_or_unavailable";
  return "internal_failure";
}

function sanitizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sanitizeJson);
  if (value === null || typeof value !== "object") return value;
  const output: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "text" && typeof entry === "string") {
      output.contentSha256 = createHash("sha256").update(entry).digest("hex");
      output.contentAvailableDuringScan = true;
    } else {
      output[key] = sanitizeJson(entry);
    }
  }
  return output;
}

function withoutSourceFiles(report: RulesReport, collectedEvidence: readonly Evidence[]): ReportSnapshot {
  const evidence: Evidence[] = collectedEvidence.map((item) => {
    if (item.fact.metric !== "repository.file_content") return item;
    const value = sanitizeJson(item.value);
    return { ...item, fact: { ...item.fact, value }, value };
  });
  return {
    ...report,
    dataStatus: evidence.some((item) => item.status === "restricted")
      ? "restricted"
      : evidence.some((item) => item.status !== "complete") ? "partial" : "complete",
    evidence,
    evidenceIndex: Object.fromEntries(evidence.map((item) => [item.id, item])),
  };
}

function publicJob(job: ScanJob): {
  createdAt: string;
  errorCode?: PublicErrorCode;
  expiresAt: string;
  id: string;
  reportAvailable: boolean;
  repository: string;
  stage: ScanJob["stage"];
} {
  return {
    createdAt: job.createdAt,
    ...(job.errorCode === undefined ? {} : { errorCode: job.errorCode }),
    expiresAt: job.expiresAt,
    id: job.id,
    reportAvailable: job.report !== undefined,
    repository: job.repository,
    stage: job.stage,
  };
}

async function runRules(
  job: ScanJob,
  ref: RepositoryRef,
  locale: "zh" | "en",
  dependencies: ScanRoutesDependencies,
): Promise<void> {
  try {
    const collected = await dependencies.collector(ref);
    await dependencies.jobStore.update(job.id, { stage: "collected" });
    const analyzedAt = dependencies.clock().toISOString();
    const classification = classifyRepository({ analyzedAt, evidence: collected.evidence });
    // Failure placeholders remain visible in coverage, but deterministic rules only
    // receive complete observations so missing upstream data can never add risk.
    const scoreEvidence = collected.evidence.filter((item) => item.status === "complete");
    const scored = scoreRules({
      analyzedAt,
      classification,
      collectorVersion: "collector-v1",
      evidence: scoreEvidence,
      expiresAt: job.expiresAt,
      locale,
      normalizer: dependencies.normalizer,
      rulesVersion: "rules-v1",
    });
    const report = withoutSourceFiles({ ...scored, locale }, collected.evidence);
    const errorCode = report.scoreKind === "insufficient_evidence" ? "insufficient_evidence" : undefined;
    await dependencies.jobStore.update(job.id, {
      ...(errorCode === undefined ? {} : { errorCode }),
      report,
      stage: "scored",
    });
    await dependencies.jobStore.update(job.id, { stage: "rendered" });
  } catch (reason) {
    await dependencies.jobStore.update(job.id, { errorCode: failureCode(reason), stage: "failed" });
  }
}

export function registerScanRoutes(app: FastifyInstance, dependencies: ScanRoutesDependencies): void {
  const inFlight = new Set<Promise<void>>();
  function startBackground(work: Promise<void>): void {
    const tracked = work.catch((reason: unknown) => {
      try {
        dependencies.onBackgroundError(reason);
      } catch {
        app.log.error("background error observer failed");
      }
    }).finally(() => {
      inFlight.delete(tracked);
    });
    inFlight.add(tracked);
  }

  app.addHook("onClose", async () => {
    await Promise.allSettled(inFlight);
  });

  app.post("/api/scans", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = createScanBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(publicError("invalid_repository"));

    let ref: RepositoryRef;
    try {
      ref = parseRepositoryInput(parsed.data.repository);
    } catch {
      return reply.code(400).send(publicError("invalid_repository"));
    }
    const createdAt = dependencies.clock().toISOString();
    const job = await dependencies.jobStore.create({
      createdAt,
      repository: `${ref.owner}/${ref.repo}`,
      stage: "validated",
    });
    startBackground(runRules(job, ref, parsed.data.locale, dependencies));
    return reply.code(202).send({ jobId: job.id, stage: job.stage });
  });

  app.get("/api/scans/:jobId", async (request, reply) => {
    const parsed = jobParams.safeParse(request.params);
    if (!parsed.success) return reply.code(404).send(publicError("scan_not_found"));
    const job = await dependencies.jobStore.get(parsed.data.jobId);
    if (job === null) return reply.code(404).send(publicError("scan_not_found"));
    return publicJob(job);
  });

  app.get("/api/scans/:jobId/report", async (request, reply) => {
    const parsed = jobParams.safeParse(request.params);
    if (!parsed.success) return reply.code(404).send(publicError("scan_not_found"));
    const job = await dependencies.jobStore.get(parsed.data.jobId);
    if (job === null) return reply.code(404).send(publicError("scan_not_found"));
    if (job.report === undefined) {
      if (job.stage === "failed") return reply.code(502).send(publicError(job.errorCode ?? "internal_failure"));
      return reply.code(409).send(publicError("scan_not_ready"));
    }
    return job.report;
  });
}
