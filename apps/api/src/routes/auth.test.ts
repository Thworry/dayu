import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryVault } from "../auth/memory-vault.js";
import { createOAuthService, type GitHubOAuthClient } from "../auth/oauth.js";
import { createAes256GcmEncryptionAdapter, type TokenVault } from "../auth/token-vault.js";
import { buildServer } from "../server.js";

const START = new Date("2026-08-25T00:00:00.000Z");
const ORIGIN = "https://dayu.example";
const apps: { close(): Promise<void> }[] = [];

async function textFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await textFiles(path));
    else if (/\.(?:css|html|js|json|ts|tsx)$/.test(entry.name)) output.push(await readFile(path, "utf8"));
  }
  return output;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function fixture(options: { cleanupFailures?: number; deleteFailures?: number; exchangeFailures?: number; revokeFailures?: number } = {}) {
  let counter = 0;
  const cipher = createAes256GcmEncryptionAdapter(new Uint8Array(32).fill(4));
  const backing = createMemoryVault({ cipher, clock: () => START, hmacSecret: new Uint8Array(32).fill(5) });
  let deleteFailures = options.deleteFailures ?? 0;
  const vault: TokenVault = {
    close: () => backing.close(),
    delete: (id) => {
      if (deleteFailures > 0) {
        deleteFailures -= 1;
        return Promise.reject(new Error("secret delete failure"));
      }
      return backing.delete(id);
    },
    get: (id) => backing.get(id),
    put: (id, value) => backing.put(id, value),
  };
  const revoked: string[] = [];
  let exchangeFailures = options.exchangeFailures ?? 0;
  let revokeFailures = options.revokeFailures ?? 0;
  const githubClient: GitHubOAuthClient = {
    exchangeCode: ({ code }) => {
      if (exchangeFailures > 0) {
        exchangeFailures -= 1;
        return Promise.reject(new Error("secret exchange failure"));
      }
      return Promise.resolve({ accessToken: `ghu_sensitive_${code}`, expiresInSeconds: 28_800 });
    },
    getUser: (accessToken) => Promise.resolve({ id: accessToken.endsWith("alice") ? 101 : 202 }),
    revokeToken: (accessToken) => {
      revoked.push(accessToken);
      if (revokeFailures > 0) {
        revokeFailures -= 1;
        return Promise.reject(new Error("upstream included ghu_sensitive"));
      }
      return Promise.resolve();
    },
  };
  const oauth = createOAuthService({
    cipher,
    clientId: "client-id",
    githubClient,
    redirectUri: `${ORIGIN}/api/auth/github/callback`,
    clock: () => START,
    randomBytes: (size) => new Uint8Array(size).fill((counter += 1)),
    transactionHmacSecret: new Uint8Array(32).fill(6),
    vault,
  });
  let cleanupFailures = options.cleanupFailures ?? 0;
  const destroyCopilotSessions = vi.fn<(githubUserId: number) => Promise<void>>(() => {
    if (cleanupFailures > 0) {
      cleanupFailures -= 1;
      return Promise.reject(new Error("secret Copilot cleanup failure"));
    }
    return Promise.resolve();
  });
  const app = buildServer({
    auth: { appOrigin: ORIGIN, destroyCopilotSessions, oauth, secureCookie: true },
  });
  apps.push(app);
  return { app, destroyCopilotSessions, oauth, revoked, vault };
}

function cookieFrom(response: { headers: Record<string, number | string | string[] | undefined> }, name: string): string {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : typeof header === "string" ? [header] : [];
  const value = values.find((candidate) => candidate.startsWith(`${name}=`));
  if (value === undefined) throw new Error(`missing_cookie:${name}`);
  const cookie = value.split(";", 1)[0];
  if (cookie === undefined) throw new Error("invalid_cookie");
  return cookie;
}

async function startFlow(app: ReturnType<typeof buildServer>) {
  const started = await app.inject({ method: "GET", url: "/api/auth/github/start?returnTo=%2Fen%2Fr%2Fowner%2Frepo" });
  expect(started.statusCode).toBe(302);
  const authorizeUrl = new URL(started.headers.location ?? "");
  const state = authorizeUrl.searchParams.get("state");
  if (state === null) throw new Error("missing_state");
  const transactionCookie = cookieFrom(started, "__Host-dayu_oauth_tx");
  return { started, state, transactionCookie };
}

async function login(app: ReturnType<typeof buildServer>, code = "alice") {
  const { started, state, transactionCookie } = await startFlow(app);
  const callback = await app.inject({ headers: { cookie: transactionCookie }, method: "GET", url: `/api/auth/github/callback?code=${code}&state=${state}` });
  return { callback, cookie: cookieFrom(callback, "__Host-dayu_session"), started, state, transactionCookie };
}

describe("GitHub auth routes", () => {
  it("sets a production-safe host-only session cookie and never exposes the GitHub token", async () => {
    const { app } = fixture();
    const { callback, cookie, started } = await login(app);
    const setCookie = String(callback.headers["set-cookie"]);
    const transactionSetCookie = String(started.headers["set-cookie"]);
    expect(transactionSetCookie).toContain("__Host-dayu_oauth_tx=");
    expect(transactionSetCookie).toContain("Secure");
    expect(transactionSetCookie).toContain("HttpOnly");
    expect(transactionSetCookie).toContain("SameSite=Lax");
    expect(transactionSetCookie).not.toContain("Domain=");
    expect(callback.headers.location).toBe("/en/r/owner/repo");
    expect(setCookie).toContain("__Host-dayu_session=");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Domain=");

    const session = await app.inject({ headers: { cookie }, method: "GET", url: "/api/auth/session" });
    expect(session.json()).toMatchObject({ authenticated: true, githubUserId: 101 });
    const transcript = JSON.stringify([
      { location: callback.headers.location },
      callback.body,
      session.body,
    ]);
    expect(transcript).not.toMatch(/gh[uo]_|access_token|Authorization|ghu_sensitive/);
    expect(transcript).not.toContain(cookie.split("=")[1] ?? "never");
  });

  it("requires exact Origin and CSRF before logout, then removes local and Copilot sessions", async () => {
    const { app, destroyCopilotSessions } = fixture();
    const { cookie } = await login(app);
    const session = await app.inject({ headers: { cookie }, method: "GET", url: "/api/auth/session" });
    const csrfToken = session.json<{ csrfToken: string }>().csrfToken;

    const wrongOrigin = await app.inject({ headers: { cookie, origin: "https://dayu.example.evil", "x-dayu-csrf": csrfToken }, method: "POST", url: "/api/auth/logout" });
    expect(wrongOrigin.statusCode).toBe(403);
    const wrongCsrf = await app.inject({ headers: { cookie, origin: ORIGIN, "x-dayu-csrf": `${csrfToken}x` }, method: "POST", url: "/api/auth/logout" });
    expect(wrongCsrf.statusCode).toBe(403);

    const loggedOut = await app.inject({ headers: { cookie, origin: ORIGIN, "x-dayu-csrf": csrfToken }, method: "POST", url: "/api/auth/logout" });
    expect(loggedOut.statusCode).toBe(204);
    expect(String(loggedOut.headers["set-cookie"])).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(destroyCopilotSessions).toHaveBeenCalledWith(101);
    expect((await app.inject({ headers: { cookie }, method: "GET", url: "/api/auth/session" })).statusCode).toBe(401);
  });

  it("preserves a retry handle when GitHub revocation fails, then disconnects idempotently", async () => {
    const { app, destroyCopilotSessions, revoked } = fixture({ revokeFailures: 1 });
    const { cookie } = await login(app);
    const csrfToken = (await app.inject({ headers: { cookie }, method: "GET", url: "/api/auth/session" })).json<{ csrfToken: string }>().csrfToken;
    const response = await app.inject({ headers: { cookie, origin: ORIGIN, "x-dayu-csrf": csrfToken }, method: "POST", url: "/api/auth/disconnect" });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: { code: "github_disconnect_failed" } });
    expect(response.body).not.toContain("ghu_sensitive");
    expect(revoked).toEqual(["ghu_sensitive_alice"]);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(destroyCopilotSessions).toHaveBeenCalledTimes(1);
    expect((await app.inject({ headers: { cookie }, method: "GET", url: "/api/auth/session" })).statusCode).toBe(200);

    const retried = await app.inject({ headers: { cookie, origin: ORIGIN, "x-dayu-csrf": csrfToken }, method: "POST", url: "/api/auth/disconnect" });
    expect(retried.statusCode).toBe(204);
    expect(revoked).toEqual(["ghu_sensitive_alice", "ghu_sensitive_alice"]);
    expect(destroyCopilotSessions).toHaveBeenCalledWith(101);
    expect(destroyCopilotSessions).toHaveBeenCalledTimes(2);
    expect((await app.inject({ headers: { cookie }, method: "GET", url: "/api/auth/session" })).statusCode).toBe(401);
  });

  it("keeps the browser session retryable when logout deletion fails after idempotent Copilot cleanup", async () => {
    const { app, destroyCopilotSessions } = fixture({ deleteFailures: 1 });
    const { cookie } = await login(app);
    const csrfToken = (await app.inject({ headers: { cookie }, method: "GET", url: "/api/auth/session" })).json<{ csrfToken: string }>().csrfToken;
    const failed = await app.inject({ headers: { cookie, origin: ORIGIN, "x-dayu-csrf": csrfToken }, method: "POST", url: "/api/auth/logout" });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ error: { code: "session_cleanup_failed" } });
    expect(failed.headers["set-cookie"]).toBeUndefined();
    expect(destroyCopilotSessions).toHaveBeenCalledTimes(1);
    expect((await app.inject({ headers: { cookie }, method: "GET", url: "/api/auth/session" })).statusCode).toBe(200);

    const retried = await app.inject({ headers: { cookie, origin: ORIGIN, "x-dayu-csrf": csrfToken }, method: "POST", url: "/api/auth/logout" });
    expect(retried.statusCode).toBe(204);
    expect(destroyCopilotSessions).toHaveBeenCalledWith(101);
    expect(destroyCopilotSessions).toHaveBeenCalledTimes(2);
  });

  it.each(["logout", "disconnect"] as const)("makes %s retryable when Copilot cleanup fails", async (action) => {
    const { app, destroyCopilotSessions, revoked } = fixture({ cleanupFailures: 1 });
    const { cookie } = await login(app);
    const csrfToken = (await app.inject({ headers: { cookie }, method: "GET", url: "/api/auth/session" })).json<{ csrfToken: string }>().csrfToken;
    const first = await app.inject({ headers: { cookie, origin: ORIGIN, "x-dayu-csrf": csrfToken }, method: "POST", url: `/api/auth/${action}` });
    expect(first.statusCode).toBe(502);
    expect(first.json()).toEqual({ error: { code: "session_cleanup_failed" } });
    expect(first.headers["set-cookie"]).toBeUndefined();
    expect(destroyCopilotSessions).toHaveBeenCalledTimes(1);
    expect(revoked).toHaveLength(0);
    expect((await app.inject({ headers: { cookie }, method: "GET", url: "/api/auth/session" })).statusCode).toBe(200);

    const retried = await app.inject({ headers: { cookie, origin: ORIGIN, "x-dayu-csrf": csrfToken }, method: "POST", url: `/api/auth/${action}` });
    expect(retried.statusCode).toBe(204);
    expect(destroyCopilotSessions).toHaveBeenCalledTimes(2);
    expect(revoked).toHaveLength(action === "disconnect" ? 1 : 0);
    expect((await app.inject({ headers: { cookie }, method: "GET", url: "/api/auth/session" })).statusCode).toBe(401);
  });

  it("keeps concurrent identities isolated", async () => {
    const { app } = fixture();
    const alice = await login(app, "alice");
    const bob = await login(app, "bob");
    const [aliceSession, bobSession] = await Promise.all([
      app.inject({ headers: { cookie: alice.cookie }, method: "GET", url: "/api/auth/session" }),
      app.inject({ headers: { cookie: bob.cookie }, method: "GET", url: "/api/auth/session" }),
    ]);
    expect(aliceSession.json()).toMatchObject({ githubUserId: 101 });
    expect(bobSession.json()).toMatchObject({ githubUserId: 202 });
    expect(alice.cookie).not.toBe(bob.cookie);
  });

  it("binds OAuth state to the initiating browser without consuming another browser's flow", async () => {
    const { app } = fixture();
    const browserB = await login(app, "bob");
    const flowA = await startFlow(app);
    const flowB = await startFlow(app);
    const crossed = await app.inject({
      headers: { cookie: `${browserB.cookie}; ${flowB.transactionCookie}` },
      method: "GET",
      url: `/api/auth/github/callback?code=alice&state=${flowA.state}`,
    });
    expect(crossed.statusCode).toBe(400);
    expect(crossed.json()).toEqual({ error: { code: "invalid_oauth_state" } });
    expect(crossed.headers["set-cookie"]).toBeUndefined();
    expect((await app.inject({ headers: { cookie: browserB.cookie }, method: "GET", url: "/api/auth/session" })).json()).toMatchObject({ githubUserId: 202 });

    const browserBRightful = await app.inject({
      headers: { cookie: `${browserB.cookie}; ${flowB.transactionCookie}` },
      method: "GET",
      url: `/api/auth/github/callback?code=bob&state=${flowB.state}`,
    });
    expect(browserBRightful.statusCode).toBe(302);

    const rightful = await app.inject({
      headers: { cookie: flowA.transactionCookie },
      method: "GET",
      url: `/api/auth/github/callback?code=alice&state=${flowA.state}`,
    });
    expect(rightful.statusCode).toBe(302);
  });

  it("preserves the browser transaction cookie after a malformed callback", async () => {
    const { app } = fixture();
    const flow = await startFlow(app);
    const malformed = await app.inject({
      headers: { cookie: flow.transactionCookie },
      method: "GET",
      url: `/api/auth/github/callback?state=${flow.state}`,
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.headers["set-cookie"]).toBeUndefined();

    const rightful = await app.inject({
      headers: { cookie: flow.transactionCookie },
      method: "GET",
      url: `/api/auth/github/callback?code=alice&state=${flow.state}`,
    });
    expect(rightful.statusCode).toBe(302);
  });

  it("clears the browser transaction cookie after a matched transaction is consumed", async () => {
    const { app } = fixture({ exchangeFailures: 1 });
    const flow = await startFlow(app);
    const failed = await app.inject({
      headers: { cookie: flow.transactionCookie },
      method: "GET",
      url: `/api/auth/github/callback?code=bad&state=${flow.state}`,
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ error: { code: "github_oauth_failed" } });
    expect(String(failed.headers["set-cookie"])).toContain("__Host-dayu_oauth_tx=");
    expect(String(failed.headers["set-cookie"])).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it("permits an insecure cookie only for explicit localhost development", async () => {
    const { oauth } = fixture();
    const local = buildServer({ auth: { appOrigin: "http://localhost:5173", oauth, secureCookie: false } });
    apps.push(local);
    await local.ready();
    const started = await local.inject({ method: "GET", url: "/api/auth/github/start?returnTo=%2Fen%2Fr%2Fowner%2Frepo" });
    const transactionCookie = cookieFrom(started, "dayu_oauth_tx_dev");
    expect(String(started.headers["set-cookie"])).not.toContain("Secure");
    const state = new URL(started.headers.location ?? "").searchParams.get("state");
    if (state === null) throw new Error("missing_state");
    const callback = await local.inject({ headers: { cookie: transactionCookie }, method: "GET", url: `/api/auth/github/callback?code=alice&state=${state}` });
    const localSession = cookieFrom(callback, "dayu_session_dev");
    expect(localSession).toContain("dayu_session_dev=");
    expect(String(callback.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(callback.headers["set-cookie"])).not.toContain("Secure");

    const unsafe = buildServer({ auth: { appOrigin: "http://dayu.example", oauth, secureCookie: false } });
    apps.push(unsafe);
    await expect(unsafe.ready()).rejects.toThrow("insecure_session_cookie_configuration");
  });

  it("rejects ambiguous duplicate session and OAuth transaction cookies", async () => {
    const { app } = fixture();
    const loggedIn = await login(app);
    const duplicateSession = await app.inject({
      headers: { cookie: `${loggedIn.cookie}; ${loggedIn.cookie}` },
      method: "GET",
      url: "/api/auth/session",
    });
    expect(duplicateSession.statusCode).toBe(401);

    const flow = await startFlow(app);
    const duplicateTransaction = await app.inject({
      headers: { cookie: `${flow.transactionCookie}; ${flow.transactionCookie}` },
      method: "GET",
      url: `/api/auth/github/callback?code=alice&state=${flow.state}`,
    });
    expect(duplicateTransaction.statusCode).toBe(400);
    expect(duplicateTransaction.json()).toEqual({ error: { code: "invalid_oauth_state" } });
  });

  it("rate-limits session probing locally", async () => {
    const { app } = fixture();
    for (let attempt = 0; attempt < 120; attempt += 1) {
      expect((await app.inject({ method: "GET", url: "/api/auth/session" })).statusCode).toBe(401);
    }
    const limited = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "request_rate_limited" } });
  });

  it("keeps browser-delivered React source and auth production code free of credential sinks", async () => {
    const webRoot = fileURLToPath(new URL("../../../web", import.meta.url));
    const browserText = (await textFiles(join(webRoot, "src"))).join("\n")
      + await readFile(join(webRoot, "index.html"), "utf8");
    expect(browserText).not.toMatch(/gh[uo]_|access_token|Authorization|localStorage|sessionStorage/);

    const productionFiles = [
      new URL("../auth/oauth.ts", import.meta.url),
      new URL("../auth/session.ts", import.meta.url),
      new URL("auth.ts", import.meta.url),
    ];
    const productionText = (await Promise.all(productionFiles.map(async (url) => readFile(url, "utf8")))).join("\n");
    expect(productionText).not.toMatch(/(?:console|request\.log|app\.log)\./);
  });
});
