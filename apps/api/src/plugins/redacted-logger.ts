import type { FastifyInstance, FastifyRequest } from "fastify";

export interface SafeLogRecord {
  collectorVersion: "collector-v1";
  durationMs: number;
  errorCode?: string;
  requestId: string;
  route: string;
  rulesVersion: "rules-v1";
  sdkVersion: string;
  status: number;
}

export type SafeLogSink = (record: Readonly<SafeLogRecord>) => void;

export interface SafeRequestLogContext {
  errorCode: string;
}

const startedAt = new WeakMap<FastifyRequest, bigint>();
const responseError = new WeakMap<FastifyRequest, string>();

function safeErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : undefined;
}

/** Attach only a validated operational code; arbitrary request/provider context is rejected. */
export function setSafeRequestLogContext(request: FastifyRequest, context: Readonly<SafeRequestLogContext>): void {
  const errorCode = safeErrorCode(context.errorCode);
  if (errorCode === undefined) throw new Error("invalid_safe_log_error_code");
  responseError.set(request, errorCode);
}

/** Emit a fixed allowlist; no request input or response body reaches the sink. */
export function registerRedactedLogger(app: FastifyInstance, sink: SafeLogSink): void {
  app.addHook("onRequest", (request, _reply, done) => { startedAt.set(request, process.hrtime.bigint()); done(); });
  app.addHook("onSend", async (request, _reply, payload) => {
    if (typeof payload === "string" && payload.length <= 2_048) {
      try {
        const parsed: unknown = JSON.parse(payload);
        if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
          const error = (parsed as { error?: unknown }).error;
          if (error !== null && typeof error === "object" && "code" in error) {
            const code = safeErrorCode((error as { code?: unknown }).code);
            if (code !== undefined) setSafeRequestLogContext(request, { errorCode: code });
          }
        }
      } catch {
        // Non-JSON responses have no public error code to record.
      }
    }
    return payload;
  });
  app.addHook("onResponse", (request, reply, done) => {
    const start = startedAt.get(request) ?? process.hrtime.bigint();
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const errorCode = responseError.get(request);
    sink(Object.freeze({
      collectorVersion: "collector-v1",
      durationMs: Math.max(0, Math.round(durationMs * 100) / 100),
      ...(errorCode === undefined ? {} : { errorCode }),
      requestId: request.id,
      route: request.routeOptions.url ?? "unmatched",
      rulesVersion: "rules-v1",
      sdkVersion: "copilot-sdk-1.0.11",
      status: reply.statusCode,
    }));
    done();
  });
}

export function stdoutSafeLogSink(record: Readonly<SafeLogRecord>): void {
  if (process.env.NODE_ENV === "test") return;
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
