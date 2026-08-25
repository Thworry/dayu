import type { FastifyInstance } from "fastify";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function registerSecurityHeaders(app: FastifyInstance, production = process.env.NODE_ENV === "production"): void {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
      .header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-DAYU-App", "repo-reality-check");
    if (production) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    return payload;
  });
}
