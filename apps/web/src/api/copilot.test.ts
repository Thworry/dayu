import { afterEach, describe, expect, it, vi } from "vitest";

import { createCopilotApi, createNoChangeReview, parseNoChangeReview } from "./copilot.js";
import { reportFixture } from "../test/reportFixture.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Copilot session capability", () => {
  it("preserves the no-scorable-judgments outcome at the API boundary", async () => {
    const response = { baseReport: reportFixture, enhancedReport: null, noChangeReason: "no_scorable_judgments", metadata: { findings: [], model: "test", promptVersion: "test", rubricVersion: "test" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(response))));
    await expect(createCopilotApi().enhance("job", { consent: true, csrfToken: "test", idempotencyKey: "test" })).resolves.toEqual(response);
  });
  it("distinguishes an unconfigured OAuth service from a signed-out session", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "oauth_unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "invalid_session" } }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createCopilotApi();

    await expect(api.getSession()).resolves.toEqual({ kind: "unavailable" });
    await expect(api.getSession()).resolves.toEqual({ kind: "signed_out" });
  });

  it("returns a validated authenticated session without exposing a token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      authenticated: true,
      csrfToken: "b".repeat(43),
      githubUserId: 101,
    }), { status: 200 })));

    await expect(createCopilotApi().getSession()).resolves.toEqual({
      kind: "authenticated",
      session: { authenticated: true, csrfToken: "b".repeat(43), githubUserId: 101 },
    });
  });

  it("binds separate no-change review state to the repository, commit, versions, time, and known evidence", () => {
    const metadata = { model: "test", promptVersion: "test", rubricVersion: "test", findings: [{ en: "Unable to verify delivery.", zh: "无法验证交付。", evidenceIds: [reportFixture.evidence[0]?.id ?? ""], counterEvidenceIds: [], rubricId: "claims.install", verdict: "unverifiable" }] };
    const review = createNoChangeReview(reportFixture, metadata);
    expect(review).toBeDefined();
    expect(parseNoChangeReview(review, reportFixture)).toEqual(review);
    expect(parseNoChangeReview({ ...review, sourceCommit: "fedcba9876543210" }, reportFixture)).toBeUndefined();
    expect(parseNoChangeReview({ ...review, repository: { ...reportFixture.repository, id: 44 } }, reportFixture)).toBeUndefined();
    expect(parseNoChangeReview({ ...review, rulesVersion: "other-rules" }, reportFixture)).toBeUndefined();
    expect(parseNoChangeReview({ ...review, createdAt: "2026-09-06T01:00:00.000Z" }, reportFixture)).toBeUndefined();
    expect(parseNoChangeReview({ ...review, accessToken: "must-not-survive" }, reportFixture)).toBeUndefined();
    const finding = metadata.findings[0];
    if (finding === undefined) throw new Error("missing_finding");
    expect(createNoChangeReview(reportFixture, { ...metadata, findings: [{ ...finding, evidenceIds: [`ev_${"f".repeat(24)}`] }] })).toBeUndefined();
  });

  it("rejects contradictory no-change responses and malformed retained review metadata", async () => {
    const metadata = { model: "test", promptVersion: "test", rubricVersion: "test", findings: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ baseReport: reportFixture, enhancedReport: reportFixture, noChangeReason: "no_scorable_judgments", metadata })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ baseReport: reportFixture, enhancedReport: null, noChangeReason: "no_scorable_judgments", metadata: { ...metadata, token: "unexpected" } })));
    vi.stubGlobal("fetch", fetchMock);
    const api = createCopilotApi();
    await expect(api.enhance("job", { consent: true, csrfToken: "test", idempotencyKey: "test" })).rejects.toMatchObject({ code: "copilot_invalid_output" });
    await expect(api.enhance("job", { consent: true, csrfToken: "test", idempotencyKey: "test" })).rejects.toMatchObject({ code: "copilot_invalid_output" });
  });
});
