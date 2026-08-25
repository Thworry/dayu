import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

const MAX_URL_BYTES = 2_048;
const MAX_BODY_BYTES = 64 * 1_024;

export function registerAbuseProtection(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (Buffer.byteLength(request.raw.url ?? "", "utf8") > MAX_URL_BYTES) {
      return await reply.code(414).send({ error: { code: "request_uri_too_long" } });
    }
    const rawLength = request.headers["content-length"];
    if (rawLength !== undefined) {
      const length = Number(rawLength);
      if (!Number.isSafeInteger(length) || length < 0) {
        return await reply.code(400).send({ error: { code: "invalid_content_length" } });
      }
      if (length > MAX_BODY_BYTES) {
        return await reply.code(413).send({ error: { code: "request_body_too_large" } });
      }
    }
  });
  void app.register(rateLimit, {
    errorResponseBuilder: () => ({ error: { code: "request_rate_limited" }, statusCode: 429 }),
    global: true,
    keyGenerator: (request) => request.ip,
    max: 600,
    timeWindow: "1 hour",
  });
}
