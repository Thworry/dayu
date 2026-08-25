import { createHash } from "node:crypto";

import { analyzeWithCopilot } from "@dayu/copilot-adapter";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { OAuthService } from "../auth/oauth.js";
import { requireStateChange, sessionCookieName } from "../auth/session.js";
import { CopilotRunCancelledError, enhanceJob, type EnhancementAnalyzer, type EnhancementResult } from "../jobs/enhance-runner.js";
import type { CopilotRunRegistry } from "../jobs/copilot-runs.js";
import type { ScanJobStore } from "../jobs/types.js";
import { createCopilotLimits, type CopilotLimitCode, type CopilotLimits } from "../limits/copilot.js";
import { setSafeRequestLogContext } from "../plugins/redacted-logger.js";

const copilotBody = z.object({
  consent: z.literal(true),
  idempotencyKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9._~-]+$/),
}).strict();
const jobParams = z.object({ jobId: z.uuid() });
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const MAX_IDEMPOTENCY_ENTRIES = 10_000;

type RouteErrorCode =
  | CopilotLimitCode
  | "copilot_consent_required"
  | "copilot_cancelled"
  | "invalid_csrf"
  | "invalid_origin"
  | "invalid_session"
  | "scan_not_found"
  | "scan_not_owned"
  | "scan_not_ready";

export interface CopilotRoutesDependencies {
  analyze?: EnhancementAnalyzer;
  appOrigin: string;
  clock?: () => Date;
  jobStore: ScanJobStore;
  limits?: CopilotLimits;
  oauth: OAuthService;
  runs: CopilotRunRegistry;
  secureCookie: boolean;
}

interface CachedResult {
  expiresAt: number;
  promise: Promise<EnhancementResult>;
}

function publicError(code: RouteErrorCode): { error: { code: RouteErrorCode } } {
  return { error: { code } };
}

function limitStatus(code: CopilotLimitCode): number {
  return code === "copilot_busy" ? 503 : 429;
}

function markEnhancementFallback(request: Parameters<typeof setSafeRequestLogContext>[0], result: EnhancementResult): EnhancementResult {
  if (result.errorCode !== undefined) setSafeRequestLogContext(request, { errorCode: result.errorCode });
  return result;
}

function appOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.origin !== value || parsed.username !== "" || parsed.password !== "") throw new Error("invalid_app_origin");
  return parsed.origin;
}

function scopedIdempotencyKey(input: {
  clientKey: string;
  githubUserId: number;
  repositoryId: number;
  rulesVersion: string;
  sourceCommit: string;
  jobId: string;
  locale: "en" | "zh";
}): string {
  return createHash("sha256").update([
    String(input.githubUserId),
    String(input.repositoryId),
    input.sourceCommit,
    input.rulesVersion,
    input.jobId,
    input.locale,
    input.clientKey,
  ].join("\0")).digest("hex");
}

export function registerCopilotRoutes(app: FastifyInstance, dependencies: CopilotRoutesDependencies): void {
  const expectedOrigin = appOrigin(dependencies.appOrigin);
  const cookieName = sessionCookieName(dependencies.secureCookie);
  const clock = dependencies.clock ?? (() => new Date());
  const limits = dependencies.limits ?? createCopilotLimits({ clock });
  const analyze = dependencies.analyze ?? (async (input) => await analyzeWithCopilot({
    evidence: input.evidence,
    githubToken: input.githubToken,
    signal: input.signal,
  }));
  const cache = new Map<string, CachedResult>();

  function purgeCache(now: number): void {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    while (cache.size >= MAX_IDEMPOTENCY_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  app.post("/api/scans/:jobId/copilot", { config: { rateLimit: { max: 60, timeWindow: "1 hour" } } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const params = jobParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send(publicError("scan_not_found"));
    const body = copilotBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(publicError("copilot_consent_required"));

    let session;
    try {
      session = await requireStateChange(request, dependencies.oauth, expectedOrigin, cookieName);
    } catch (reason) {
      if (reason instanceof Error && reason.message === "invalid_origin") return reply.code(403).send(publicError("invalid_origin"));
      if (reason instanceof Error && reason.message === "invalid_csrf") return reply.code(403).send(publicError("invalid_csrf"));
      return reply.code(401).send(publicError("invalid_session"));
    }

    const claimed = await dependencies.jobStore.claimForCopilot(params.data.jobId, session.githubUserId);
    if (claimed === null) return reply.code(404).send(publicError("scan_not_found"));
    if (claimed === "forbidden") return reply.code(403).send(publicError("scan_not_owned"));
    if (claimed === "not_ready") return reply.code(409).send(publicError("scan_not_ready"));
    if (claimed.report === undefined) return reply.code(409).send(publicError("scan_not_ready"));

    const now = clock().valueOf();
    purgeCache(now);
    const key = scopedIdempotencyKey({
      clientKey: body.data.idempotencyKey,
      githubUserId: session.githubUserId,
      jobId: claimed.id,
      locale: claimed.report.locale,
      repositoryId: claimed.report.repository.id,
      rulesVersion: claimed.report.rulesVersion,
      sourceCommit: claimed.report.sourceCommit,
    });
    const existing = cache.get(key);
    if (existing !== undefined && existing.expiresAt > now) {
      try {
        return markEnhancementFallback(request, await existing.promise);
      } catch (reason) {
        cache.delete(key);
        if (reason instanceof CopilotRunCancelledError) return reply.code(409).send(publicError("copilot_cancelled"));
        throw reason;
      }
    }

    const acquired = limits.acquire({ githubUserId: session.githubUserId, ip: request.ip });
    if ("code" in acquired) return reply.code(limitStatus(acquired.code)).send(publicError(acquired.code));

    const run = dependencies.runs.start(session.githubUserId);
    const promise = enhanceJob({
      analyze,
      idempotencyKey: key,
      jobId: params.data.jobId,
      jobStore: dependencies.jobStore,
      oauth: dependencies.oauth,
      session,
      signal: run.signal,
    }).finally(() => {
      acquired.permit.release();
      run.finish();
    });
    run.bind(promise);
    cache.set(key, { expiresAt: now + IDEMPOTENCY_TTL_MS, promise });
    try {
      return markEnhancementFallback(request, await promise);
    } catch (reason) {
      cache.delete(key);
      if (reason instanceof CopilotRunCancelledError) return reply.code(409).send(publicError("copilot_cancelled"));
      throw reason;
    }
  });
}
