import type { Evidence, ReportSnapshot } from "@dayu/evidence-schema";
import { createEvidenceId } from "@dayu/evidence-schema";
import type { AiFinding } from "@dayu/copilot-adapter";
import type { RulesReport } from "@dayu/scoring-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession, OAuthService } from "../auth/oauth.js";
import { CSRF_HEADER_NAME, SECURE_SESSION_COOKIE_NAME } from "../auth/session.js";
import { CopilotEnhancementError, type EnhancementAnalyzer } from "../jobs/enhance-runner.js";
import { memoryJobStore } from "../jobs/store.js";
import { createCopilotLimits, type CopilotLimits } from "../limits/copilot.js";
import { buildServer } from "../server.js";

const ORIGIN = "https://dayu.example";
const NOW = new Date("2026-08-25T00:00:00.000Z");
const SESSION_ID = "a".repeat(43);
const SESSION_TWO = "d".repeat(43);
const CSRF = "b".repeat(43);
const SHA = "abcdef1234567890";
const EVIDENCE_ID = createEvidenceId({ commitSha: SHA, kind: "metadata", path: "/repos/owner/repo", repoId: 1 });

const evidence: Evidence = {
  fact: { metric: "repository.metadata", value: { stars: 100 } },
  id: EVIDENCE_ID,
  kind: "metadata",
  limitations: [],
  observedAt: NOW.toISOString(),
  repository: { fullName: "owner/repo", id: 1 },
  schemaVersion: "1",
  source: { endpoint: "/repos/owner/repo", kind: "api", queryHash: "public-v1" },
  status: "complete",
  summary: "Public repository metadata",
  value: { stars: 100 },
};

function report(locale: "en" | "zh" = "en"): RulesReport {
  return {
    availableWeight: 0.7,
    baseScore: 22,
    collectorVersion: "collector-v1",
    confidence: 85,
    createdAt: NOW.toISOString(),
    dataStatus: "complete",
    dimensionAvailableWeights: { claims: 0.05, community: 0.1, maintenance: 0.15, popularity: 0.25, substance: 0.15 },
    dimensionScores: { claims: 20, community: 20, maintenance: 20, popularity: 30, substance: 20 },
    evidence: [evidence],
    evidenceIndex: { [EVIDENCE_ID]: evidence },
    expiresAt: new Date(NOW.valueOf() + 30 * 60 * 1000).toISOString(),
    findings: [],
    locale,
    missingSignals: [],
    normalizerVersion: "normalizer-v1",
    positiveSignals: [],
    reportVersion: "1",
    repository: { defaultBranch: "main", fullName: "owner/repo", id: 1 },
    repositoryType: "software",
    rulesVersion: "rules-v1",
    score: 22,
    scoreKind: "rules_only",
    sourceCommit: SHA,
  };
}

function finding(): AiFinding {
  return {
    counterEvidenceIds: [],
    dimension: "claims",
    en: "[SUPPORTED] Public evidence supports this bounded claim.",
    evidenceIds: [EVIDENCE_ID],
    risk: 0,
    rubricId: "claims.install",
    verdict: "supported",
    zh: "[支持] 公开证据支持这项有限判断。",
  };
}

function oauth(userId = 101): OAuthService {
  const active = new Set([SESSION_ID, SESSION_TWO]);
  function session(rawSessionId: string): AuthSession {
    if (!active.has(rawSessionId)) throw new Error("invalid_session");
    return {
      csrfToken: CSRF,
      githubUserId: rawSessionId === SESSION_TWO ? 202 : userId,
      rawSessionId,
      tokenExpiresAt: new Date(NOW.valueOf() + 60_000).toISOString(),
    };
  }
  return {
    begin: vi.fn(),
    close: () => Promise.resolve(),
    complete: vi.fn(),
    disconnect: (rawSessionId) => { active.delete(rawSessionId); return Promise.resolve(); },
    logout: (rawSessionId) => { active.delete(rawSessionId); return Promise.resolve(); },
    requireAccessToken: (rawSessionId) => { session(rawSessionId); return Promise.resolve("github-user-token-secret"); },
    requireSession: (rawSessionId) => Promise.resolve().then(() => session(rawSessionId)),
    withAccessToken: async (rawSessionId, operation) => { session(rawSessionId); return await operation("github-user-token-secret"); },
  };
}

function headers(options: { authenticated?: boolean; csrf?: string; origin?: string; sessionId?: string } = {}): Record<string, string> {
  return {
    ...(options.authenticated === false ? {} : { cookie: `${SECURE_SESSION_COOKIE_NAME}=${options.sessionId ?? SESSION_ID}` }),
    [CSRF_HEADER_NAME]: options.csrf ?? CSRF,
    origin: options.origin ?? ORIGIN,
  };
}

const apps: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => { await app.close(); }));
});

async function fixture(options: { analyze?: EnhancementAnalyzer; limits?: CopilotLimits; userId?: number } = {}) {
  const store = memoryJobStore({ clock: () => NOW });
  const created = await store.create({ createdAt: NOW.toISOString(), report: report(), repository: "owner/repo", stage: "rendered" });
  const analyze = options.analyze ?? vi.fn<EnhancementAnalyzer>(() => Promise.resolve({ findings: [finding()], model: "gpt-5-mini" }));
  const oauthService = oauth(options.userId);
  const app = buildServer({
    auth: { appOrigin: ORIGIN, oauth: oauthService, secureCookie: true },
    clock: () => NOW,
    copilot: { analyze, ...(options.limits === undefined ? {} : { limits: options.limits }) },
    jobStore: store,
  });
  apps.push(app);
  return { analyze, app, jobId: created.id, oauth: oauthService, store };
}

function request(app: Awaited<ReturnType<typeof fixture>>["app"], jobId: string, options: {
  authenticated?: boolean;
  consent?: boolean;
  idempotencyKey?: string;
  csrf?: string;
  origin?: string;
  sessionId?: string;
} = {}) {
  return app.inject({
    headers: headers(options),
    method: "POST",
    payload: { consent: options.consent ?? true, idempotencyKey: options.idempotencyKey ?? "client-request-0001" },
    url: `/api/scans/${jobId}/copilot`,
  });
}

describe("user-owned Copilot enhancement route", () => {
  it("uses the vaulted user token and returns before/after scores with actual model and versions", async () => {
    const analyze = vi.fn<EnhancementAnalyzer>((input) => {
      expect(input.githubToken).toBe("github-user-token-secret");
      expect(JSON.stringify(input)).not.toContain(SESSION_ID);
      return Promise.resolve({ findings: [finding()], model: "gpt-5-mini" });
    });
    const { app, jobId } = await fixture({ analyze });
    const response = await request(app, jobId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      baseReport: { score: 22, scoreKind: "rules_only" },
      enhancedReport: { baseScore: 22, scoreKind: "enhanced" },
      metadata: { model: "gpt-5-mini", promptVersion: "copilot-prompt-v1", rubricVersion: "copilot-rubric-v1" },
    });
    expect(JSON.stringify(response.json())).not.toContain("github-user-token-secret");
  });

  it("requires authentication, exact Origin, CSRF, and explicit consent", async () => {
    const { analyze, app, jobId } = await fixture();
    expect((await request(app, jobId, { authenticated: false })).statusCode).toBe(401);
    expect((await request(app, jobId, { origin: "https://evil.example" })).json()).toEqual({ error: { code: "invalid_origin" } });
    expect((await request(app, jobId, { csrf: "c".repeat(43) })).json()).toEqual({ error: { code: "invalid_csrf" } });
    expect((await request(app, jobId, { consent: false })).json()).toEqual({ error: { code: "copilot_consent_required" } });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("binds a ready scan to the first authenticated owner and rejects another user", async () => {
    const { app, jobId, store } = await fixture({ userId: 101 });
    expect((await request(app, jobId)).statusCode).toBe(200);
    const claimed = await store.get(jobId);
    expect(claimed?.copilotOwnerId).toBe(101);
    expect(JSON.stringify((await app.inject({ method: "GET", url: `/api/scans/${jobId}` })).json())).not.toContain("copilotOwnerId");
    expect((await request(app, jobId, { idempotencyKey: "other-user-key-01", sessionId: SESSION_TWO })).json()).toEqual({ error: { code: "scan_not_owned" } });
  });

  it("does not let a pre-ready request claim or lock a guessed job UUID", async () => {
    const { app, store } = await fixture();
    const pending = await store.create({ createdAt: NOW.toISOString(), repository: "owner/pending", stage: "validated" });
    expect((await request(app, pending.id)).json()).toEqual({ error: { code: "scan_not_ready" } });
    expect((await store.get(pending.id))?.copilotOwnerId).toBeUndefined();
  });

  it("deduplicates double clicks for five minutes without consuming a second run", async () => {
    let resolve!: (value: { findings: AiFinding[]; model: string }) => void;
    const analyze = vi.fn<EnhancementAnalyzer>(() => new Promise((done) => { resolve = done; }));
    const { app, jobId } = await fixture({ analyze });
    const first = request(app, jobId, { idempotencyKey: "same-client-key-01" });
    await vi.waitFor(() => { expect(analyze).toHaveBeenCalledTimes(1); });
    const second = request(app, jobId, { idempotencyKey: "same-client-key-01" });
    resolve({ findings: [finding()], model: "gpt-5-mini" });
    expect((await first).json()).toEqual((await second).json());
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it.each(["copilot_not_entitled", "copilot_quota_exhausted", "copilot_policy_disabled", "copilot_invalid_output"] as const)(
    "retains the exact rules report on %s without retry",
    async (code) => {
      const analyze = vi.fn<EnhancementAnalyzer>(() => Promise.reject(new CopilotEnhancementError(code)));
      const { app, jobId } = await fixture({ analyze });
      const body = (await request(app, jobId)).json<{ baseReport: ReportSnapshot; enhancedReport: ReportSnapshot | null; errorCode: string }>();
      expect(body).toMatchObject({ baseReport: { score: 22, scoreKind: "rules_only" }, enhancedReport: null, errorCode: code });
      expect(analyze).toHaveBeenCalledTimes(1);
    },
  );

  it("does not redispatch a timed-out provider call and therefore cannot double-charge", async () => {
    const analyze = vi.fn<EnhancementAnalyzer>(() => Promise.reject(new CopilotEnhancementError("copilot_timeout")));
    const { app, jobId } = await fixture({ analyze });
    const body = (await request(app, jobId)).json<{ errorCode: string }>();
    expect(body.errorCode).toBe("copilot_timeout");
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("deletes the vaulted auth session immediately on a typed revoked-token failure", async () => {
    const analyze = vi.fn<EnhancementAnalyzer>(() => Promise.reject(new CopilotEnhancementError("copilot_revoked")));
    const { app, jobId, oauth: oauthService } = await fixture({ analyze });
    const body = (await request(app, jobId)).json<{ errorCode: string }>();
    expect(body.errorCode).toBe("copilot_revoked");
    expect(analyze).toHaveBeenCalledTimes(1);
    await expect(oauthService.requireSession(SESSION_ID)).rejects.toThrow("invalid_session");
  });

  it("keeps the public rules report and status identical for no-auth, owner, and other-user polling", async () => {
    const { app, jobId } = await fixture();
    const before = (await app.inject({ method: "GET", url: `/api/scans/${jobId}` })).json<unknown>();
    expect((await request(app, jobId)).statusCode).toBe(200);
    for (const requestHeaders of [{}, headers(), headers({ sessionId: SESSION_TWO })]) {
      const status = await app.inject({ headers: requestHeaders, method: "GET", url: `/api/scans/${jobId}` });
      const publicReport = await app.inject({ headers: requestHeaders, method: "GET", url: `/api/scans/${jobId}/report` });
      expect(status.json()).toEqual(before);
      expect(publicReport.json()).toMatchObject({ score: 22, scoreKind: "rules_only" });
      expect(publicReport.json()).not.toHaveProperty("copilot");
    }
  });

  it("scopes identical client keys across scan jobs and locales", async () => {
    const analyze = vi.fn<EnhancementAnalyzer>(() => Promise.resolve({ findings: [finding()], model: "gpt-5-mini" }));
    const { app, jobId, store } = await fixture({ analyze });
    const second = await store.create({ createdAt: NOW.toISOString(), report: report("zh"), repository: "owner/repo", stage: "rendered" });
    expect((await request(app, jobId, { idempotencyKey: "cross-job-client-01" })).statusCode).toBe(200);
    expect((await request(app, second.id, { idempotencyKey: "cross-job-client-01" })).statusCode).toBe(200);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze.mock.calls[0]?.[0].idempotencyKey).not.toBe(analyze.mock.calls[1]?.[0].idempotencyKey);
  });

  it.each(["logout", "disconnect"] as const)("cancels an in-flight Copilot request on %s and never writes enhanced state", async (action) => {
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const analyze = vi.fn<EnhancementAnalyzer>((input) => new Promise((_resolve, reject) => {
      started();
      input.signal.addEventListener("abort", () => { reject(new Error("cancelled")); }, { once: true });
    }));
    const { app, jobId } = await fixture({ analyze });
    const enhancement = request(app, jobId);
    await didStart;
    const authResponse = await app.inject({ headers: headers(), method: "POST", payload: {}, url: `/api/auth/${action}` });
    expect(authResponse.statusCode).toBe(204);
    expect((await enhancement).json()).toEqual({ error: { code: "copilot_cancelled" } });
    expect((await app.inject({ method: "GET", url: `/api/scans/${jobId}/report` })).json()).toMatchObject({ scoreKind: "rules_only" });
  });

  it("aborts an in-flight Copilot request before server shutdown completes", async () => {
    let started!: () => void;
    let aborted = false;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const analyze = vi.fn<EnhancementAnalyzer>((input) => new Promise((_resolve, reject) => {
      started();
      input.signal.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }, { once: true });
    }));
    const { app, jobId } = await fixture({ analyze });
    const enhancement = request(app, jobId);
    await didStart;
    await app.close();
    expect(aborted).toBe(true);
    expect((await enhancement).json()).toEqual({ error: { code: "copilot_cancelled" } });
  });

  it.each(["copilot_busy", "copilot_account_daily_limit", "copilot_ip_daily_limit"] as const)(
    "returns %s before creating an SDK session",
    async (code) => {
      const limits: CopilotLimits = { acquire: () => ({ code }) };
      const { analyze, app, jobId } = await fixture({ limits });
      const response = await request(app, jobId);
      expect(response.json()).toEqual({ error: { code } });
      expect(analyze).not.toHaveBeenCalled();
    },
  );

  it("enforces one active run per user and four global runs", () => {
    const limits = createCopilotLimits({ clock: () => NOW, globalConcurrent: 4 });
    const permits = [1, 2, 3, 4].map((githubUserId) => limits.acquire({ githubUserId, ip: `203.0.113.${String(githubUserId)}` }));
    expect(limits.acquire({ githubUserId: 1, ip: "203.0.113.1" })).toEqual({ code: "copilot_busy" });
    expect(limits.acquire({ githubUserId: 5, ip: "203.0.113.5" })).toEqual({ code: "copilot_busy" });
    for (const acquired of permits) if ("permit" in acquired) acquired.permit.release();
  });

  it("enforces ten runs per account and thirty runs per IP each UTC day", () => {
    const accountLimits = createCopilotLimits({ clock: () => NOW });
    for (let run = 0; run < 10; run += 1) {
      const acquired = accountLimits.acquire({ githubUserId: 101, ip: `203.0.113.${String(run + 1)}` });
      expect("permit" in acquired).toBe(true);
      if ("permit" in acquired) acquired.permit.release();
    }
    expect(accountLimits.acquire({ githubUserId: 101, ip: "203.0.113.99" })).toEqual({ code: "copilot_account_daily_limit" });

    const ipLimits = createCopilotLimits({ clock: () => NOW });
    for (let run = 0; run < 30; run += 1) {
      const acquired = ipLimits.acquire({ githubUserId: run + 1, ip: "203.0.113.200" });
      expect("permit" in acquired).toBe(true);
      if ("permit" in acquired) acquired.permit.release();
    }
    expect(ipLimits.acquire({ githubUserId: 999, ip: "203.0.113.200" })).toEqual({ code: "copilot_ip_daily_limit" });
  });
});
