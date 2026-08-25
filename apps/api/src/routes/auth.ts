import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { OAuthError, type OAuthService } from "../auth/oauth.js";
import {
  readUniqueCookie,
  requireSession,
  requireStateChange,
  sessionCookieName,
} from "../auth/session.js";

const startQuery = z.object({ returnTo: z.string().min(4).max(512) }).strict();
const callbackQuery = z.object({ code: z.string().min(1).max(512), state: z.string().min(43).max(128) }).strict();
const emptyBody = z.union([z.undefined(), z.object({}).strict()]);
const SECURE_TRANSACTION_COOKIE_NAME = "__Host-dayu_oauth_tx";
const DEVELOPMENT_TRANSACTION_COOKIE_NAME = "dayu_oauth_tx_dev";

export interface AuthRoutesDependencies {
  appOrigin: string;
  oauth: OAuthService;
  secureCookie: boolean;
  destroyCopilotSessions?: (githubUserId: number) => Promise<void>;
}

type AuthErrorCode =
  | "github_disconnect_failed"
  | "github_identity_failed"
  | "github_oauth_failed"
  | "invalid_csrf"
  | "invalid_oauth_request"
  | "invalid_oauth_state"
  | "invalid_origin"
  | "invalid_return_to"
  | "invalid_session"
  | "oauth_unavailable"
  | "session_cleanup_failed"
  | "session_rotation_failed";

function publicError(code: AuthErrorCode): { error: { code: AuthErrorCode } } {
  return { error: { code } };
}

function cookieOptions(secure: boolean, maxAge?: number): {
  httpOnly: true;
  maxAge?: number;
  path: "/";
  sameSite: "lax";
  secure: boolean;
} {
  return {
    httpOnly: true,
    ...(maxAge === undefined ? {} : { maxAge }),
    path: "/",
    sameSite: "lax",
    secure,
  };
}

function clearCookie(reply: FastifyReply, name: string, secure: boolean): void {
  reply.clearCookie(name, cookieOptions(secure));
}

function errorStatus(reason: unknown): { code: AuthErrorCode; status: number } {
  if (reason instanceof OAuthError) {
    if (reason.code === "invalid_session") return { code: reason.code, status: 401 };
    if (reason.code === "github_disconnect_failed") return { code: reason.code, status: 502 };
    if (reason.code === "invalid_oauth_state" || reason.code === "invalid_return_to") {
      return { code: reason.code, status: 400 };
    }
    return { code: reason.code, status: 502 };
  }
  if (reason instanceof Error && (reason.message === "invalid_csrf" || reason.message === "invalid_origin")) {
    return { code: reason.message, status: 403 };
  }
  return { code: "github_oauth_failed", status: 502 };
}

async function destroyCopilot(
  callback: AuthRoutesDependencies["destroyCopilotSessions"],
  githubUserId: number,
): Promise<void> {
  if (callback === undefined) return;
  try {
    await callback(githubUserId);
  } catch {
    throw new OAuthError("session_cleanup_failed");
  }
}

function assertOriginConfiguration(appOrigin: string, secureCookie: boolean): string {
  const origin = new URL(appOrigin);
  if (origin.origin !== appOrigin || origin.username !== "" || origin.password !== "") throw new Error("invalid_app_origin");
  const localhost = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (!secureCookie && (!localhost || origin.protocol !== "http:" || process.env.NODE_ENV === "production")) {
    throw new Error("insecure_session_cookie_configuration");
  }
  if (secureCookie && origin.protocol !== "https:") throw new Error("secure_cookie_requires_https");
  return origin.origin;
}

export function registerAuthRoutes(app: FastifyInstance, dependencies: AuthRoutesDependencies): void {
  const appOrigin = assertOriginConfiguration(dependencies.appOrigin, dependencies.secureCookie);
  const sessionCookie = sessionCookieName(dependencies.secureCookie);
  const transactionCookie = dependencies.secureCookie
    ? SECURE_TRANSACTION_COOKIE_NAME
    : DEVELOPMENT_TRANSACTION_COOKIE_NAME;
  const mutationRateLimit = { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } };
  const startRateLimit = { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } };
  const callbackRateLimit = { config: { rateLimit: { max: 60, timeWindow: "1 hour" } } };
  // This in-process limiter is a first line of defense. Multi-instance production
  // deployments must add the shared edge/Redis limiter documented in Task 12.
  const sessionRateLimit = { config: { rateLimit: { max: 120, timeWindow: "1 hour" } } };

  app.get("/api/auth/github/start", startRateLimit, async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    const parsed = startQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(publicError("invalid_oauth_request"));
    try {
      const started = dependencies.oauth.begin(parsed.data);
      reply.setCookie(transactionCookie, started.transactionSecret, cookieOptions(dependencies.secureCookie, 10 * 60));
      return await reply.redirect(started.authorizationUrl);
    } catch (reason) {
      const failure = errorStatus(reason);
      return reply.code(failure.status).send(publicError(failure.code));
    }
  });

  app.get("/api/auth/github/callback", callbackRateLimit, async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    const parsed = callbackQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(publicError("invalid_oauth_request"));
    }
    let transactionConsumed = false;
    try {
      let transactionSecret: string | undefined;
      let previousSessionId: string | undefined;
      try {
        transactionSecret = readUniqueCookie(request, transactionCookie);
      } catch {
        throw new OAuthError("invalid_oauth_state");
      }
      try {
        previousSessionId = readUniqueCookie(request, sessionCookie);
      } catch {
        throw new OAuthError("invalid_session");
      }
      const session = await dependencies.oauth.complete({
        code: parsed.data.code,
        ...(previousSessionId === undefined ? {} : { previousSessionId }),
        state: parsed.data.state,
        transactionSecret: transactionSecret ?? "",
      });
      transactionConsumed = true;
      const maxAge = Math.max(1, Math.floor((Date.parse(session.tokenExpiresAt) - Date.now()) / 1000));
      clearCookie(reply, transactionCookie, dependencies.secureCookie);
      reply.setCookie(sessionCookie, session.rawSessionId, cookieOptions(dependencies.secureCookie, maxAge));
      return await reply.redirect(session.returnTo);
    } catch (reason) {
      if (transactionConsumed || (reason instanceof OAuthError && reason.transactionConsumed)) {
        clearCookie(reply, transactionCookie, dependencies.secureCookie);
      }
      const failure = errorStatus(reason);
      return reply.code(failure.status).send(publicError(failure.code));
    }
  });

  app.get("/api/auth/session", sessionRateLimit, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await requireSession(request, dependencies.oauth, sessionCookie);
      return { authenticated: true, csrfToken: session.csrfToken, githubUserId: session.githubUserId };
    } catch (reason) {
      if (reason instanceof OAuthError && reason.code === "invalid_session") {
        clearCookie(reply, sessionCookie, dependencies.secureCookie);
      }
      const failure = errorStatus(reason);
      return reply.code(failure.status).send(publicError(failure.code));
    }
  });

  app.post("/api/auth/logout", mutationRateLimit, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!emptyBody.safeParse(request.body).success) return reply.code(400).send(publicError("invalid_oauth_request"));
    try {
      const session = await requireStateChange(request, dependencies.oauth, appOrigin, sessionCookie);
      await destroyCopilot(dependencies.destroyCopilotSessions, session.githubUserId);
      await dependencies.oauth.logout(session.rawSessionId);
      clearCookie(reply, sessionCookie, dependencies.secureCookie);
      return await reply.code(204).send();
    } catch (reason) {
      if (reason instanceof OAuthError && reason.code === "invalid_session") {
        clearCookie(reply, sessionCookie, dependencies.secureCookie);
      }
      const failure = errorStatus(reason);
      return reply.code(failure.status).send(publicError(failure.code));
    }
  });

  app.post("/api/auth/disconnect", mutationRateLimit, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!emptyBody.safeParse(request.body).success) return reply.code(400).send(publicError("invalid_oauth_request"));
    try {
      const session = await requireStateChange(request, dependencies.oauth, appOrigin, sessionCookie);
      await destroyCopilot(dependencies.destroyCopilotSessions, session.githubUserId);
      await dependencies.oauth.disconnect(session.rawSessionId);
      clearCookie(reply, sessionCookie, dependencies.secureCookie);
      return await reply.code(204).send();
    } catch (reason) {
      if (reason instanceof OAuthError && reason.code === "invalid_session") {
        clearCookie(reply, sessionCookie, dependencies.secureCookie);
      }
      const failure = errorStatus(reason);
      return reply.code(failure.status).send(publicError(failure.code));
    }
  });
}

export function registerUnavailableAuthRoutes(app: FastifyInstance): void {
  const routes = [
    { method: "GET" as const, url: "/api/auth/github/start" },
    { method: "GET" as const, url: "/api/auth/github/callback" },
    { method: "GET" as const, url: "/api/auth/session" },
    { method: "POST" as const, url: "/api/auth/logout" },
    { method: "POST" as const, url: "/api/auth/disconnect" },
  ];
  for (const route of routes) {
    app.route({
      handler: async (_request, reply) => await reply.code(503).send(publicError("oauth_unavailable")),
      method: route.method,
      url: route.url,
    });
  }
}
