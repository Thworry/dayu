import { createHmac } from "node:crypto";

import { isRandomSecret, pkceChallenge, randomSecret, secureRandomBytes, type RandomBytes } from "./pkce.js";
import {
  MAX_TOKEN_TTL_MS,
  assertKey,
  safeEqual,
  type PlatformEncryptionAdapter,
  type TokenRecord,
  type TokenVault,
} from "./token-vault.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_ORIGIN = "https://api.github.com";
const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_OAUTH_TRANSACTIONS = 10_000;

export type OAuthErrorCode =
  | "github_disconnect_failed"
  | "github_identity_failed"
  | "github_oauth_failed"
  | "invalid_oauth_state"
  | "invalid_return_to"
  | "invalid_session"
  | "session_cleanup_failed"
  | "session_rotation_failed";

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  readonly transactionConsumed: boolean;

  constructor(code: OAuthErrorCode, options: { transactionConsumed?: boolean } = {}) {
    super(code);
    this.name = "OAuthError";
    this.code = code;
    this.transactionConsumed = options.transactionConsumed ?? false;
  }
}

export class GitHubAuthenticationError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403) {
    super("github_authentication_failed");
    this.name = "GitHubAuthenticationError";
    this.status = status;
  }
}

export interface GitHubTokenResult {
  accessToken: string;
  expiresInSeconds?: number;
}

export interface GitHubOAuthClient {
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<GitHubTokenResult>;
  getUser(accessToken: string): Promise<{ id: number }>;
  revokeToken(accessToken: string): Promise<void>;
}

export interface OAuthServiceOptions {
  cipher: PlatformEncryptionAdapter;
  clientId: string;
  githubClient: GitHubOAuthClient;
  redirectUri: string;
  transactionHmacSecret: Uint8Array;
  vault: TokenVault;
  clock?: () => Date;
  randomBytes?: RandomBytes;
  maxTransactions?: number;
}

export interface AuthSession {
  csrfToken: string;
  githubUserId: number;
  rawSessionId: string;
  tokenExpiresAt: string;
}

export interface OAuthService {
  begin(input: { returnTo: string; transactionSecret?: string }): {
    authorizationUrl: string;
    state: string;
    transactionSecret: string;
  };
  close(): Promise<void>;
  complete(input: {
    code: string;
    state: string;
    transactionSecret: string;
    previousSessionId?: string;
  }): Promise<AuthSession & { returnTo: string }>;
  disconnect(rawSessionId: string): Promise<void>;
  logout(rawSessionId: string): Promise<void>;
  requireAccessToken(rawSessionId: string): Promise<string>;
  requireSession(rawSessionId: string): Promise<AuthSession>;
  withAccessToken<T>(rawSessionId: string, operation: (accessToken: string) => Promise<T>): Promise<T>;
}

interface OAuthTransaction {
  bindingDigest: string;
  codeVerifier: string;
  expiresAt: number;
  returnTo: string;
}

function transactionKey(state: string, secret: Uint8Array): string {
  return createHmac("sha256", secret).update(state, "utf8").digest("hex");
}

export function validateReturnTo(value: string): string {
  let hasControlCharacter = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) hasControlCharacter = true;
  }
  if (
    value.length > 512
    || !/^\/(?:en|zh)\/[A-Za-z0-9._~/-]*$/.test(value)
    || value.includes("//")
    || value.includes("\\")
    || value.includes("%")
    || hasControlCharacter
  ) throw new OAuthError("invalid_return_to");
  const resolved = new URL(value, "https://dayu.invalid");
  if (resolved.origin !== "https://dayu.invalid" || resolved.pathname !== value) {
    throw new OAuthError("invalid_return_to");
  }
  return value;
}

function tokenExpiry(now: Date, expiresInSeconds?: number): string {
  if (expiresInSeconds !== undefined && (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0)) {
    throw new OAuthError("github_oauth_failed");
  }
  const githubTtl = expiresInSeconds === undefined ? MAX_TOKEN_TTL_MS : expiresInSeconds * 1000;
  return new Date(now.valueOf() + Math.min(MAX_TOKEN_TTL_MS, githubTtl)).toISOString();
}

export function createOAuthService(options: OAuthServiceOptions): OAuthService {
  assertKey(options.transactionHmacSecret, "invalid_transaction_hmac_secret");
  if (options.clientId.trim() === "") throw new Error("invalid_github_client_id");
  const redirectUri = validateRedirectUri(options.redirectUri);
  const transactionHmacSecret = Buffer.from(options.transactionHmacSecret);
  const clock = options.clock ?? (() => new Date());
  const randomBytes = options.randomBytes ?? secureRandomBytes;
  const maxTransactions = options.maxTransactions ?? MAX_OAUTH_TRANSACTIONS;
  if (!Number.isSafeInteger(maxTransactions) || maxTransactions < 1 || maxTransactions > MAX_OAUTH_TRANSACTIONS) {
    throw new Error("invalid_oauth_transaction_limit");
  }
  const transactions = new Map<string, OAuthTransaction>();

  function evictOldestExpired(): void {
    const now = clock().valueOf();
    while (transactions.size > 0) {
      const oldest = transactions.entries().next().value;
      if (oldest === undefined || oldest[1].expiresAt > now) break;
      transactions.delete(oldest[0]);
    }
  }

  function takeTransaction(state: string, transactionSecret: string): OAuthTransaction {
    if (!isRandomSecret(state)) throw new OAuthError("invalid_oauth_state");
    const key = transactionKey(state, transactionHmacSecret);
    const transaction = transactions.get(key);
    if (transaction === undefined || transaction.expiresAt <= clock().valueOf()) {
      transactions.delete(key);
      throw new OAuthError("invalid_oauth_state");
    }
    const bindingDigest = transactionKey(transactionSecret, transactionHmacSecret);
    const bindingMatches = safeEqual(bindingDigest, transaction.bindingDigest);
    if (!isRandomSecret(transactionSecret) || !bindingMatches) {
      // A callback from the wrong browser must not consume the rightful browser's transaction.
      throw new OAuthError("invalid_oauth_state");
    }
    // Consume only after both state and browser binding pass validation.
    transactions.delete(key);
    return transaction;
  }

  async function recordFor(rawSessionId: string): Promise<TokenRecord> {
    const record = await options.vault.get(rawSessionId);
    if (record === null) throw new OAuthError("invalid_session");
    return record;
  }

  async function requireAccessToken(rawSessionId: string): Promise<string> {
    const record = await recordFor(rawSessionId);
    try {
      return await options.cipher.decrypt(record.encryptedAccessToken);
    } catch {
      await options.vault.delete(rawSessionId);
      throw new OAuthError("invalid_session");
    }
  }

  return {
    begin(input) {
      const returnTo = validateReturnTo(input.returnTo);
      const state = randomSecret(randomBytes);
      const codeVerifier = randomSecret(randomBytes);
      const transactionSecret = input.transactionSecret ?? randomSecret(randomBytes);
      if (!isRandomSecret(transactionSecret)) throw new OAuthError("invalid_oauth_state");
      const key = transactionKey(state, transactionHmacSecret);
      evictOldestExpired();
      while (transactions.size >= maxTransactions) {
        const oldest = transactions.keys().next().value;
        if (oldest === undefined) break;
        transactions.delete(oldest);
      }
      transactions.set(key, {
        bindingDigest: transactionKey(transactionSecret, transactionHmacSecret),
        codeVerifier,
        expiresAt: clock().valueOf() + OAUTH_TRANSACTION_TTL_MS,
        returnTo,
      });
      const authorization = new URL(GITHUB_AUTHORIZE_URL);
      authorization.searchParams.set("client_id", options.clientId);
      authorization.searchParams.set("code_challenge", pkceChallenge(codeVerifier));
      authorization.searchParams.set("code_challenge_method", "S256");
      authorization.searchParams.set("redirect_uri", redirectUri);
      authorization.searchParams.set("state", state);
      return { authorizationUrl: authorization.toString(), state, transactionSecret };
    },
    async close() {
      transactions.clear();
      await options.vault.close?.();
    },
    async complete(input) {
      const transaction = takeTransaction(input.state, input.transactionSecret);
      try {
      let token: GitHubTokenResult;
      try {
        token = await options.githubClient.exchangeCode({ code: input.code, codeVerifier: transaction.codeVerifier });
      } catch {
        throw new OAuthError("github_oauth_failed");
      }
      if (token.accessToken.length < 8) throw new OAuthError("github_oauth_failed");
      let user: { id: number };
      try {
        user = await options.githubClient.getUser(token.accessToken);
      } catch {
        throw new OAuthError("github_identity_failed");
      }
      if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new OAuthError("github_identity_failed");

      const now = clock();
      const rawSessionId = randomSecret(randomBytes);
      const csrfToken = randomSecret(randomBytes);
      const tokenExpiresAt = tokenExpiry(now, token.expiresInSeconds);
      try {
        await options.vault.put(rawSessionId, {
          createdAt: now.toISOString(),
          encryptedAccessToken: await options.cipher.encrypt(token.accessToken),
          encryptedCsrfToken: await options.cipher.encrypt(csrfToken),
          githubUserId: user.id,
          tokenExpiresAt,
        });
      } catch {
        throw new OAuthError("github_oauth_failed");
      }
      if (input.previousSessionId !== undefined) {
        try {
          await options.vault.delete(input.previousSessionId);
        } catch {
          try {
            await options.vault.delete(rawSessionId);
          } catch {
            // The unissued replacement remains encrypted and expires within eight hours.
          }
          throw new OAuthError("session_rotation_failed");
        }
      }
        return { csrfToken, githubUserId: user.id, rawSessionId, returnTo: transaction.returnTo, tokenExpiresAt };
      } catch (reason) {
        const code = reason instanceof OAuthError ? reason.code : "github_oauth_failed";
        throw new OAuthError(code, { transactionConsumed: true });
      }
    },
    async disconnect(rawSessionId) {
      const accessToken = await requireAccessToken(rawSessionId);
      try {
        await options.githubClient.revokeToken(accessToken);
      } catch {
        throw new OAuthError("github_disconnect_failed");
      }
      try {
        await options.vault.delete(rawSessionId);
      } catch {
        throw new OAuthError("session_cleanup_failed");
      }
    },
    async logout(rawSessionId) {
      try {
        await options.vault.delete(rawSessionId);
      } catch {
        throw new OAuthError("session_cleanup_failed");
      }
    },
    requireAccessToken,
    async requireSession(rawSessionId) {
      const record = await recordFor(rawSessionId);
      try {
        return {
          csrfToken: await options.cipher.decrypt(record.encryptedCsrfToken),
          githubUserId: record.githubUserId,
          rawSessionId,
          tokenExpiresAt: record.tokenExpiresAt,
        };
      } catch {
        await options.vault.delete(rawSessionId);
        throw new OAuthError("invalid_session");
      }
    },
    async withAccessToken(rawSessionId, operation) {
      const accessToken = await requireAccessToken(rawSessionId);
      try {
        return await operation(accessToken);
      } catch (reason) {
        if (reason instanceof GitHubAuthenticationError || (
          reason !== null
          && typeof reason === "object"
          && "status" in reason
          && (reason.status === 401 || reason.status === 403)
        )) await options.vault.delete(rawSessionId);
        throw reason;
      }
    },
  };
}

export interface GitHubOAuthHttpClientOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function validateRedirectUri(value: string): string {
  const redirect = new URL(value);
  const localhost = ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
  if (
    redirect.username !== ""
    || redirect.password !== ""
    || redirect.hash !== ""
    || redirect.search !== ""
    || (redirect.protocol !== "https:" && !(redirect.protocol === "http:" && localhost))
  ) throw new Error("invalid_github_redirect_uri");
  return redirect.toString();
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > MAX_RESPONSE_BYTES) throw new Error("github_response_too_large");
  if (response.body === null) throw new Error("github_empty_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  try {
    while (!complete) {
      const result = await reader.read();
      complete = result.done;
      if (result.done) continue;
      total += result.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("github_response_too_large");
      chunks.push(result.value);
    }
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // Abort/cancellation errors are intentionally reduced to stable caller errors.
      }
    }
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body) as unknown;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_github_response");
  return value as Record<string, unknown>;
}

export function createGitHubOAuthClient(options: GitHubOAuthHttpClientOptions): GitHubOAuthClient {
  if (options.clientId.trim() === "" || options.clientSecret.trim() === "") throw new Error("invalid_github_oauth_config");
  const redirectUri = validateRedirectUri(options.redirectUri);
  const request = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function githubFetch<T>(
    url: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let response: Response | undefined;
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      response = await request(url, { ...init, redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) throw new Error("github_redirect_rejected");
      return await consume(response);
    } finally {
      clearTimeout(timeout);
      if (response?.body !== null && response?.body !== undefined && !response.bodyUsed) {
        try {
          await response.body.cancel();
        } catch {
          // Cancellation is best-effort and must not replace the sanitized request error.
        }
      }
    }
  }

  return {
    async exchangeCode({ code, codeVerifier }) {
      const body = new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      });
      return await githubFetch(GITHUB_TOKEN_URL, {
        body,
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }, async (response) => {
        if (!response.ok) throw new Error("github_oauth_exchange_failed");
        const result = objectValue(await boundedJson(response));
        if (typeof result.access_token !== "string") throw new Error("github_oauth_exchange_failed");
        return {
          accessToken: result.access_token,
          ...(typeof result.expires_in === "number" ? { expiresInSeconds: result.expires_in } : {}),
        };
      });
    },
    async getUser(accessToken) {
      return await githubFetch(`${GITHUB_API_ORIGIN}/user`, {
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${accessToken}` },
        method: "GET",
      }, async (response) => {
        if (response.status === 401 || response.status === 403) throw new GitHubAuthenticationError(response.status);
        if (!response.ok) throw new Error("github_identity_failed");
        const result = objectValue(await boundedJson(response));
        if (!Number.isSafeInteger(result.id) || Number(result.id) <= 0) throw new Error("github_identity_failed");
        return { id: Number(result.id) };
      });
    },
    async revokeToken(accessToken) {
      const basic = Buffer.from(`${options.clientId}:${options.clientSecret}`, "utf8").toString("base64");
      await githubFetch(`${GITHUB_API_ORIGIN}/applications/${encodeURIComponent(options.clientId)}/token`, {
        body: JSON.stringify({ access_token: accessToken }),
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Basic ${basic}`,
          "content-type": "application/json",
        },
        method: "DELETE",
      }, (response) => {
        if (!response.ok && response.status !== 404) throw new Error("github_revoke_failed");
        return Promise.resolve();
      });
    },
  };
}
