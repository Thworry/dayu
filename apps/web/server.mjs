import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";

import httpProxy from "@fastify/http-proxy";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

function requiredPort(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_024 || parsed > 65_535) {
    throw new Error(`${name} must be an integer between 1024 and 65535`);
  }
  return parsed;
}

function requiredHttpOrigin(value) {
  const parsed = new URL(value);
  if (parsed.origin !== value || parsed.protocol !== "http:" || parsed.username !== "" || parsed.password !== "") {
    throw new Error("DAYU_API_ORIGIN must be an exact internal http origin");
  }
  return parsed.origin;
}

const port = requiredPort(process.env.DAYU_WEB_PORT ?? "3000", "DAYU_WEB_PORT");
const apiOrigin = requiredHttpOrigin(process.env.DAYU_API_ORIGIN ?? "http://127.0.0.1:3001");
const staticRoot = resolve(import.meta.dirname, "dist");
accessSync(resolve(staticRoot, "index.html"), constants.R_OK);

const app = Fastify({ bodyLimit: 64 * 1_024, logger: false, trustProxy: false });

app.addHook("onRequest", (_request, reply, done) => {
  reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-DAYU-App", "repo-reality-check");
  done();
});

app.get("/__dayu/ready", async (_request, reply) => {
  reply.header("Cache-Control", "no-store");
  return { app: "DAYU", ready: true, server: "production-static" };
});

await app.register(httpProxy, {
  prefix: "/api",
  retryMethods: [],
  rewritePrefix: "/api",
  upstream: apiOrigin,
});

await app.register(fastifyStatic, {
  cacheControl: false,
  decorateReply: true,
  dotfiles: "deny",
  index: ["index.html"],
  root: staticRoot,
  setHeaders(reply, filePath) {
    if (filePath.startsWith(resolve(staticRoot, "assets"))) {
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      reply.header("Cache-Control", "no-store");
    }
  },
  wildcard: true,
});

app.setNotFoundHandler(async (request, reply) => {
  const acceptsHtml = request.headers.accept?.split(",").some((value) => value.trim().startsWith("text/html")) ?? false;
  if ((request.method === "GET" || request.method === "HEAD") && acceptsHtml) {
    reply.header("Cache-Control", "no-store");
    return await reply.sendFile("index.html");
  }
  reply.header("Cache-Control", "no-store");
  return reply.code(404).send({ error: { code: "not_found" } });
});

await app.listen({ host: "127.0.0.1", port });

async function shutdown() {
  await app.close();
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
