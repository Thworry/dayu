import type { FastifyRequest } from "fastify";

import { OAuthError, type AuthSession, type OAuthService } from "./oauth.js";
import { isRandomSecret } from "./pkce.js";
import { safeEqual } from "./token-vault.js";

export const SECURE_SESSION_COOKIE_NAME = "__Host-dayu_session";
export const DEVELOPMENT_SESSION_COOKIE_NAME = "dayu_session_dev";
export const CSRF_HEADER_NAME = "x-dayu-csrf";

export interface CookieRequest extends FastifyRequest {
  cookies: Record<string, string | undefined>;
}

export function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_SESSION_COOKIE_NAME : DEVELOPMENT_SESSION_COOKIE_NAME;
}

export function readUniqueCookie(request: FastifyRequest, name: string): string | undefined {
  const matches = (request.headers.cookie ?? "").split(";").map((part) => part.trim()).filter((part) => {
    const separator = part.indexOf("=");
    return separator > 0 && part.slice(0, separator) === name;
  });
  if (matches.length > 1) throw new Error("duplicate_cookie");
  const match = matches[0];
  if (match === undefined) return undefined;
  return match.slice(match.indexOf("=") + 1);
}

export async function requireSession(
  request: CookieRequest,
  oauth: OAuthService,
  cookieName: string,
): Promise<AuthSession> {
  let rawSessionId: string | undefined;
  try {
    rawSessionId = readUniqueCookie(request, cookieName);
  } catch {
    throw new OAuthError("invalid_session");
  }
  if (rawSessionId === undefined || !isRandomSecret(rawSessionId)) throw new OAuthError("invalid_session");
  return oauth.requireSession(rawSessionId);
}

export async function requireStateChange(
  request: CookieRequest,
  oauth: OAuthService,
  expectedOrigin: string,
  cookieName: string,
): Promise<AuthSession> {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || origin !== expectedOrigin) throw new Error("invalid_origin");
  const session = await requireSession(request, oauth, cookieName);
  const csrf = request.headers[CSRF_HEADER_NAME];
  if (typeof csrf !== "string" || !isRandomSecret(csrf) || !safeEqual(csrf, session.csrfToken)) throw new Error("invalid_csrf");
  return session;
}
