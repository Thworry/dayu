import { afterEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../server.js";
import { CONTENT_SECURITY_POLICY } from "./security.js";
import { setSafeRequestLogContext, type SafeLogRecord } from "./redacted-logger.js";

const apps: { close(): Promise<void> }[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(async (app) => app.close())); });

describe("release security plugins", () => {
  it("sets the restrictive browser policy on success and errors", async () => {
    const app = buildServer();
    apps.push(app);
    for (const url of ["/health", "/not-found"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.headers).toMatchObject({
        "content-security-policy": CONTENT_SECURITY_POLICY,
        "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-dayu-app": "repo-reality-check",
      });
      expect(response.headers).not.toHaveProperty("strict-transport-security");
    }
  });

  it("enables HSTS only for an explicitly production process", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = buildServer();
      apps.push(app);
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("rejects oversized request targets and bodies before route work", async () => {
    const app = buildServer();
    apps.push(app);
    const longUrl = await app.inject({ method: "GET", url: `/health?value=${"x".repeat(2_100)}` });
    expect(longUrl.statusCode).toBe(414);
    expect(longUrl.json()).toEqual({ error: { code: "request_uri_too_long" } });

    const largeBody = await app.inject({
      headers: { "content-length": String(65 * 1_024), "content-type": "application/json" },
      method: "POST",
      payload: "{}",
      url: "/api/scans",
    });
    expect(largeBody.statusCode).toBe(413);
    expect(largeBody.json()).toEqual({ error: { code: "request_body_too_large" } });
  });

  it("logs only the operational allowlist even when secrets are supplied", async () => {
    const records: SafeLogRecord[] = [];
    const app = buildServer({ logSink: (record) => { records.push(record); } });
    apps.push(app);
    await app.inject({
      headers: { authorization: "Bearer never-log-me", cookie: "session=never-log-me" },
      method: "GET",
      url: "/health?code=oauth-secret&evidence=private-body",
    });
    await app.inject({ method: "POST", payload: { locale: "en", repository: "private-body" }, url: "/api/scans" });
    expect(records).toHaveLength(2);
    expect(Object.keys(records[0] ?? {}).sort()).toEqual([
      "collectorVersion", "durationMs", "requestId", "route", "rulesVersion", "sdkVersion", "status",
    ]);
    expect(records[1]).toMatchObject({ errorCode: "invalid_repository", route: "/api/scans", status: 400 });
    expect(Object.keys(records[1] ?? {}).sort()).toEqual([
      "collectorVersion", "durationMs", "errorCode", "requestId", "route", "rulesVersion", "sdkVersion", "status",
    ]);
    expect(JSON.stringify(records)).not.toMatch(/never-log-me|oauth-secret|private-body|authorization|cookie|query|evidence/iu);
  });

  it("uses the safe stdout sink by default outside tests", async () => {
    const previous = process.env.NODE_ENV;
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    process.env.NODE_ENV = "production";
    try {
      const app = buildServer();
      apps.push(app);
      await app.inject({ headers: { authorization: "never-log-default" }, method: "GET", url: "/health?secret=never-log-default" });
      expect(write).toHaveBeenCalledOnce();
      const output = String(write.mock.calls[0]?.[0]);
      expect(JSON.parse(output)).toMatchObject({ route: "/health", status: 200 });
      expect(output).not.toContain("never-log-default");
    } finally {
      write.mockRestore();
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("rejects uncontrolled logger context values", async () => {
    const app = buildServer();
    apps.push(app);
    app.get("/unsafe-log-context", (request) => {
      expect(() => { setSafeRequestLogContext(request, { errorCode: "token=do-not-log" }); }).toThrow("invalid_safe_log_error_code");
      return { ok: true };
    });
    expect((await app.inject({ method: "GET", url: "/unsafe-log-context" })).statusCode).toBe(200);
  });
});
