import { describe, expect, it, vi } from "vitest";

import { createMemoryVault } from "./memory-vault.js";
import {
  createOAuthService,
  createGitHubOAuthClient,
  GitHubAuthenticationError,
  OAuthError,
  type GitHubOAuthClient,
} from "./oauth.js";
import type { PlatformEncryptionAdapter, TokenVault } from "./token-vault.js";

const START = new Date("2026-08-25T00:00:00.000Z");
const KEY = new Uint8Array(32).fill(9);
const cipher: PlatformEncryptionAdapter = {
  decrypt: (value) => Promise.resolve(value.slice("sealed:".length)),
  encrypt: (value) => Promise.resolve(`sealed:${value}`),
};

function githubClient(userId: number): GitHubOAuthClient {
  return {
    exchangeCode: ({ codeVerifier }) => {
      expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
      return Promise.resolve({ accessToken: `ghu_user_${String(userId)}`, expiresInSeconds: 36_000 });
    },
    getUser: () => Promise.resolve({ id: userId }),
    revokeToken: () => Promise.resolve(),
  };
}

function setup(userId = 42) {
  let counter = 0;
  const vault = createMemoryVault({ cipher, clock: () => START, hmacSecret: new Uint8Array(32).fill(3) });
  const oauth = createOAuthService({
    cipher,
    clientId: "client-id",
    githubClient: githubClient(userId),
    redirectUri: "https://dayu.example/api/auth/github/callback",
    clock: () => START,
    randomBytes: (size) => new Uint8Array(size).fill((userId + (counter += 1)) % 256),
    transactionHmacSecret: KEY,
    vault,
  });
  return { oauth, vault };
}

describe("GitHub OAuth service", () => {
  it("uses S256 PKCE, zero scope, and rejects reused state", async () => {
    const { oauth, vault } = setup();
    const began = oauth.begin({ returnTo: "/en/r/owner/repo" });
    const authorization = new URL(began.authorizationUrl);
    expect(authorization.origin).toBe("https://github.com");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("scope")).toBeNull();

    await oauth.complete({ code: "first", state: began.state, transactionSecret: began.transactionSecret });
    await expect(oauth.complete({ code: "second", state: began.state, transactionSecret: began.transactionSecret })).rejects.toMatchObject({ code: "invalid_oauth_state" });
    await vault.close();
  });

  it.each([
    "https://evil.test/en/r/a/b",
    "//evil.test/en/r/a/b",
    "/en\\evil.test/r/a/b",
    "/en/%2f%2fevil.test",
    "/en/%5cevil.test",
    "/en/r/a/b?next=https://evil.test",
    "/en/r/a/b#https://evil.test",
    "/fr/r/a/b",
  ])("rejects unsafe returnTo %s", (returnTo) => {
    const { oauth } = setup();
    expect(() => oauth.begin({ returnTo })).toThrow(OAuthError);
  });

  it("expires state after ten minutes", async () => {
    let now = START;
    const vault = createMemoryVault({ cipher, clock: () => now, hmacSecret: new Uint8Array(32).fill(3) });
    const oauth = createOAuthService({
      cipher,
      clientId: "client-id",
      githubClient: githubClient(42),
      redirectUri: "https://dayu.example/api/auth/github/callback",
      clock: () => now,
      transactionHmacSecret: KEY,
      vault,
    });
    const began = oauth.begin({ returnTo: "/zh/r/owner/repo" });
    now = new Date(START.valueOf() + 10 * 60_000 + 1);
    await expect(oauth.complete({ code: "late", state: began.state, transactionSecret: began.transactionSecret })).rejects.toMatchObject({ code: "invalid_oauth_state" });
    await vault.close();
  });

  it("binds separate rotated sessions to immutable numeric GitHub identities", async () => {
    const first = setup(11);
    const second = setup(22);
    const a = first.oauth.begin({ returnTo: "/en/r/a/a" });
    const b = second.oauth.begin({ returnTo: "/zh/r/b/b" });
    const sessionA = await first.oauth.complete({ code: "a", state: a.state, previousSessionId: "fixed-old-session", transactionSecret: a.transactionSecret });
    const sessionB = await second.oauth.complete({ code: "b", state: b.state, transactionSecret: b.transactionSecret });

    expect(sessionA.rawSessionId).not.toBe("fixed-old-session");
    expect((await first.oauth.requireSession(sessionA.rawSessionId)).githubUserId).toBe(11);
    expect((await second.oauth.requireSession(sessionB.rawSessionId)).githubUserId).toBe(22);
    await expect(first.oauth.requireSession(sessionB.rawSessionId)).rejects.toMatchObject({ code: "invalid_session" });
    await Promise.all([first.vault.close(), second.vault.close()]);
  });

  it.each([401, 403] as const)("deletes a session after an upstream %s", async (status) => {
    const { oauth, vault } = setup();
    const began = oauth.begin({ returnTo: "/en/r/owner/repo" });
    const session = await oauth.complete({ code: "ok", state: began.state, transactionSecret: began.transactionSecret });
    await expect(oauth.withAccessToken(session.rawSessionId, () => Promise.reject(new GitHubAuthenticationError(status)))).rejects.toThrow("github_authentication_failed");
    await expect(oauth.requireSession(session.rawSessionId)).rejects.toMatchObject({ code: "invalid_session" });
    await vault.close();
  });

  it("does not consume a transaction presented by the wrong browser", async () => {
    const { oauth, vault } = setup();
    const rightful = oauth.begin({ returnTo: "/en/r/owner/repo" });
    const other = oauth.begin({ returnTo: "/en/r/other/repo" });
    await expect(oauth.complete({ code: "wrong", state: rightful.state, transactionSecret: other.transactionSecret })).rejects.toMatchObject({ code: "invalid_oauth_state" });
    await expect(oauth.complete({ code: "right", state: rightful.state, transactionSecret: rightful.transactionSecret })).resolves.toMatchObject({ githubUserId: 42 });
    await vault.close();
  });

  it("evicts the oldest transaction in O(1)-amortized order at the configured bound", async () => {
    const vault = createMemoryVault({ cipher, clock: () => START, hmacSecret: new Uint8Array(32).fill(3) });
    const oauth = createOAuthService({
      cipher,
      clientId: "client-id",
      githubClient: githubClient(42),
      maxTransactions: 2,
      redirectUri: "https://dayu.example/api/auth/github/callback",
      transactionHmacSecret: KEY,
      vault,
    });
    const first = oauth.begin({ returnTo: "/en/r/a/a" });
    const second = oauth.begin({ returnTo: "/en/r/b/b" });
    oauth.begin({ returnTo: "/en/r/c/c" });
    await expect(oauth.complete({ code: "first", state: first.state, transactionSecret: first.transactionSecret })).rejects.toMatchObject({ code: "invalid_oauth_state" });
    await expect(oauth.complete({ code: "second", state: second.state, transactionSecret: second.transactionSecret })).resolves.toMatchObject({ githubUserId: 42 });
    await vault.close();
  });

  it.each(["invalid_state", "invalid_code", "github_5xx", "identity", "encryption", "vault_put"] as const)(
    "preserves the prior session when replacement fails at %s",
    async (failure) => {
      let activeFailure: typeof failure | "none" = "none";
      const backing = createMemoryVault({ cipher, clock: () => START, hmacSecret: new Uint8Array(32).fill(13) });
      const vault: TokenVault = {
        close: () => backing.close(),
        delete: (id) => backing.delete(id),
        get: (id) => backing.get(id),
        put: (id, value) => activeFailure === "vault_put" ? Promise.reject(new Error("secret vault failure")) : backing.put(id, value),
      };
      const guardedCipher: PlatformEncryptionAdapter = {
        decrypt: (value) => cipher.decrypt(value),
        encrypt: (value) => activeFailure === "encryption" ? Promise.reject(new Error("secret encryption failure")) : cipher.encrypt(value),
      };
      const client: GitHubOAuthClient = {
        exchangeCode: () => activeFailure === "invalid_code" || activeFailure === "github_5xx"
          ? Promise.reject(new Error("secret exchange failure"))
          : Promise.resolve({ accessToken: "ghu_sensitive", expiresInSeconds: 3600 }),
        getUser: () => activeFailure === "identity"
          ? Promise.reject(new Error("secret identity failure"))
          : Promise.resolve({ id: 42 }),
        revokeToken: () => Promise.resolve(),
      };
      const oauth = createOAuthService({
        cipher: guardedCipher,
        clientId: "client-id",
        githubClient: client,
        redirectUri: "https://dayu.example/api/auth/github/callback",
        transactionHmacSecret: KEY,
        vault,
      });
      const initial = oauth.begin({ returnTo: "/en/r/a/a" });
      const oldSession = await oauth.complete({ code: "old", state: initial.state, transactionSecret: initial.transactionSecret });
      const replacement = oauth.begin({ returnTo: "/en/r/b/b" });
      activeFailure = failure;
      const state = failure === "invalid_state" ? "invalid" : replacement.state;
      await expect(oauth.complete({
        code: "new",
        previousSessionId: oldSession.rawSessionId,
        state,
        transactionSecret: replacement.transactionSecret,
      })).rejects.toBeInstanceOf(OAuthError);
      expect((await oauth.requireSession(oldSession.rawSessionId)).githubUserId).toBe(42);
      await backing.close();
    },
  );

  it("rolls back an unissued replacement when deleting the old session fails", async () => {
    const backing = createMemoryVault({ cipher, clock: () => START, hmacSecret: new Uint8Array(32).fill(14) });
    let failOnce = true;
    const vault: TokenVault = {
      close: () => backing.close(),
      delete: (id) => {
        if (id === protectedSession && failOnce) {
          failOnce = false;
          return Promise.reject(new Error("delete_failed"));
        }
        return backing.delete(id);
      },
      get: (id) => backing.get(id),
      put: (id, value) => backing.put(id, value),
    };
    const oauth = createOAuthService({
      cipher,
      clientId: "client-id",
      githubClient: githubClient(42),
      redirectUri: "https://dayu.example/api/auth/github/callback",
      transactionHmacSecret: KEY,
      vault,
    });
    const initial = oauth.begin({ returnTo: "/en/r/a/a" });
    const oldSession = await oauth.complete({ code: "old", state: initial.state, transactionSecret: initial.transactionSecret });
    const protectedSession = oldSession.rawSessionId;
    const replacement = oauth.begin({ returnTo: "/en/r/b/b" });
    await expect(oauth.complete({ code: "new", previousSessionId: oldSession.rawSessionId, state: replacement.state, transactionSecret: replacement.transactionSecret })).rejects.toMatchObject({ code: "session_rotation_failed" });
    await expect(oauth.requireSession(oldSession.rawSessionId)).resolves.toMatchObject({ githubUserId: 42 });
    await backing.close();
  });

  it("keeps logout retryable when vault deletion fails", async () => {
    const backing = createMemoryVault({ cipher, clock: () => START, hmacSecret: new Uint8Array(32).fill(15) });
    let failOnce = true;
    const vault: TokenVault = {
      close: () => backing.close(),
      delete: (id) => {
        if (failOnce) {
          failOnce = false;
          return Promise.reject(new Error("delete_failed"));
        }
        return backing.delete(id);
      },
      get: (id) => backing.get(id),
      put: (id, value) => backing.put(id, value),
    };
    const oauth = createOAuthService({
      cipher,
      clientId: "client-id",
      githubClient: githubClient(42),
      redirectUri: "https://dayu.example/api/auth/github/callback",
      transactionHmacSecret: KEY,
      vault,
    });
    const began = oauth.begin({ returnTo: "/en/r/a/a" });
    const session = await oauth.complete({ code: "old", state: began.state, transactionSecret: began.transactionSecret });
    await expect(oauth.logout(session.rawSessionId)).rejects.toMatchObject({ code: "session_cleanup_failed" });
    await expect(oauth.requireSession(session.rawSessionId)).resolves.toMatchObject({ githubUserId: 42 });
    await oauth.logout(session.rawSessionId);
    await expect(oauth.requireSession(session.rawSessionId)).rejects.toMatchObject({ code: "invalid_session" });
    await backing.close();
  });

  it("keeps disconnect retryable when local deletion fails after remote revoke", async () => {
    const backing = createMemoryVault({ cipher, clock: () => START, hmacSecret: new Uint8Array(32).fill(16) });
    let failOnce = true;
    let revokeCount = 0;
    const vault: TokenVault = {
      close: () => backing.close(),
      delete: (id) => {
        if (failOnce) {
          failOnce = false;
          return Promise.reject(new Error("delete_failed"));
        }
        return backing.delete(id);
      },
      get: (id) => backing.get(id),
      put: (id, value) => backing.put(id, value),
    };
    const client = githubClient(42);
    client.revokeToken = () => {
      revokeCount += 1;
      return Promise.resolve();
    };
    const oauth = createOAuthService({
      cipher,
      clientId: "client-id",
      githubClient: client,
      redirectUri: "https://dayu.example/api/auth/github/callback",
      transactionHmacSecret: KEY,
      vault,
    });
    const began = oauth.begin({ returnTo: "/en/r/a/a" });
    const session = await oauth.complete({ code: "old", state: began.state, transactionSecret: began.transactionSecret });
    await expect(oauth.disconnect(session.rawSessionId)).rejects.toMatchObject({ code: "session_cleanup_failed" });
    await expect(oauth.requireSession(session.rawSessionId)).resolves.toMatchObject({ githubUserId: 42 });
    await oauth.disconnect(session.rawSessionId);
    expect(revokeCount).toBe(2);
    await expect(oauth.requireSession(session.rawSessionId)).rejects.toMatchObject({ code: "invalid_session" });
    await backing.close();
  });
});

describe("fixed-origin GitHub OAuth HTTP client", () => {
  it("uses only GitHub endpoints, disables redirects, and keeps tokens out of URLs", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "ghu_sensitive", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createGitHubOAuthClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: request,
      redirectUri: "https://dayu.example/api/auth/github/callback",
    });
    const exchanged = await client.exchangeCode({ code: "temporary-code", codeVerifier: "v".repeat(43) });
    await client.getUser(exchanged.accessToken);
    await client.revokeToken(exchanged.accessToken);

    const urls = request.mock.calls.map(([url]) => {
      if (typeof url === "string") return url;
      return url instanceof URL ? url.href : url.url;
    });
    expect(urls).toEqual([
      "https://github.com/login/oauth/access_token",
      "https://api.github.com/user",
      "https://api.github.com/applications/client-id/token",
    ]);
    expect(urls.join(" ")).not.toContain("ghu_sensitive");
    expect(request.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
  });

  it("rejects redirects and oversized GitHub responses without leaking response content", async () => {
    const redirected = createGitHubOAuthClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: () => Promise.resolve(new Response(null, { headers: { location: "https://evil.test/ghu_sensitive" }, status: 302 })),
      redirectUri: "https://dayu.example/api/auth/github/callback",
    });
    const redirectError: unknown = await redirected.exchangeCode({ code: "code", codeVerifier: "v".repeat(43) }).catch((reason: unknown) => reason);
    expect(redirectError).toBeInstanceOf(Error);
    expect(redirectError instanceof Error ? redirectError.message : "").toBe("github_redirect_rejected");
    expect(redirectError instanceof Error ? redirectError.message : "").not.toContain("ghu_sensitive");

    const oversized = createGitHubOAuthClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: () => Promise.resolve(new Response("x".repeat(64 * 1024 + 1), { status: 200 })),
      redirectUri: "https://dayu.example/api/auth/github/callback",
    });
    await expect(oversized.exchangeCode({ code: "code", codeVerifier: "v".repeat(43) })).rejects.toThrow("github_response_too_large");
  });

  it("keeps the deadline active through body consumption and cancels slow streams", async () => {
    let aborted = false;
    const slow = createGitHubOAuthClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: (_input, init) => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            controller.error(new Error("secret slow body"));
          }, { once: true });
        },
      }), { status: 200 })),
      redirectUri: "https://dayu.example/api/auth/github/callback",
      timeoutMs: 5,
    });
    await expect(slow.exchangeCode({ code: "code", codeVerifier: "v".repeat(43) })).rejects.toThrow();
    expect(aborted).toBe(true);
  });

  it("cancels unread bodies on non-success responses", async () => {
    let cancelled = false;
    const failed = createGitHubOAuthClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ghu_sensitive"));
        },
      }), { status: 500 })),
      redirectUri: "https://dayu.example/api/auth/github/callback",
    });
    await expect(failed.exchangeCode({ code: "code", codeVerifier: "v".repeat(43) })).rejects.toThrow("github_oauth_exchange_failed");
    expect(cancelled).toBe(true);
  });
});
