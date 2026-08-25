import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";

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

function securityAndIdentity(): Plugin {
  function install(server: PreviewServer | ViteDevServer): void {
    server.middlewares.use((request, response, next) => {
      response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
      response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-DAYU-App", "repo-reality-check");
      if (process.env.NODE_ENV === "production") {
        response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      }
      if (request.url === "/__dayu/ready") {
        response.statusCode = 200;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ app: "DAYU", ready: true }));
        return;
      }
      next();
    });
  }
  return {
    configurePreviewServer(server) { install(server); },
    configureServer(server) { install(server); },
    name: "dayu-security-and-identity",
  };
}

const apiPort = Number(process.env.DAYU_E2E_API_PORT ?? "43174");
if (!Number.isInteger(apiPort) || apiPort < 1_024 || apiPort > 65_535) throw new Error("invalid DAYU_E2E_API_PORT");
const proxy = { "/api": { target: `http://127.0.0.1:${String(apiPort)}` } };

export default defineConfig({
  plugins: [react(), securityAndIdentity()],
  preview: { proxy },
  server: { proxy },
});
