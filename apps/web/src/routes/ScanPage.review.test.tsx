import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNoChangeReview } from "../api/copilot.js";
import { RepositoryRoute } from "../app/router.js";
import { reportFixture } from "../test/reportFixture.js";
import { reportDownloadPayload } from "./ReportPage.js";

const metadata = {
  model: "test-model", promptVersion: "test-prompt", rubricVersion: "test-rubric",
  findings: [{ en: "Unable to verify delivery.", zh: "无法验证交付。", evidenceIds: [reportFixture.evidence[0]?.id ?? ""], counterEvidenceIds: [], rubricId: "claims.install", verdict: "unverifiable" }],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Completed no-change review", () => {
  it("survives language navigation without a second Copilot call and exports an explicit review envelope", async () => {
    const reviewResponse = { baseReport: reportFixture, enhancedReport: null, noChangeReason: "no_scorable_judgments", metadata };
    let analysisCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/copilot")) { analysisCalls += 1; return Promise.resolve(new Response(JSON.stringify(reviewResponse))); }
      if (url === "/api/auth/session") return Promise.resolve(new Response(JSON.stringify({ authenticated: true, csrfToken: "b".repeat(43), githubUserId: 101 })));
      throw new Error(`unexpected_request:${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:review"; }) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<MemoryRouter initialEntries={[{ pathname: "/en/r/facebook/react", state: { report: reportFixture, jobId: "2c3da581-4bb8-4934-9714-8b25b5e4fc0c" } }]}><Routes><Route element={<RepositoryRoute />} path="/:locale/r/:owner/:repo" /></Routes></MemoryRouter>);
    await userEvent.click(await screen.findByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /run enhanced analysis/i }));
    expect(await screen.findByText("Review complete · score unchanged")).toBeVisible();
    expect(screen.getByText("Unable to verify delivery.")).toBeVisible();
    await userEvent.click(screen.getByRole("link", { name: /中文/u }));
    expect(await screen.findByText("复核完成 · 分数未变")).toBeVisible();
    expect(screen.getByText("无法验证交付。")).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(analysisCalls).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "下载报告与复核 JSON" }));
    const blob = blobs[0];
    if (blob === undefined) throw new Error("missing_review_export");
    const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => { resolve(typeof reader.result === "string" ? reader.result : ""); }; reader.readAsText(blob); });
    expect(JSON.parse(text)).toEqual({ schemaVersion: "dayu-review-export-v1", baseReport: reportFixture, review: createNoChangeReview(reportFixture, metadata) });
    expect(reportFixture).not.toHaveProperty("copilot");
    expect(reportFixture.scoreKind).toBe("rules_only");
  });

  it("does not restore review state from another repository or commit and keeps ordinary JSON unchanged", async () => {
    const valid = createNoChangeReview(reportFixture, metadata);
    const stale = { ...valid, sourceCommit: "fedcba0987654321" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ authenticated: true, csrfToken: "b".repeat(43), githubUserId: 101 }))));
    render(<MemoryRouter initialEntries={[{ pathname: "/en/r/facebook/react", state: { report: reportFixture, review: stale, jobId: "2c3da581-4bb8-4934-9714-8b25b5e4fc0c" } }]}><Routes><Route element={<RepositoryRoute />} path="/:locale/r/:owner/:repo" /></Routes></MemoryRouter>);
    expect(await screen.findByRole("checkbox")).toBeVisible();
    expect(screen.queryByText("Unable to verify delivery.")).not.toBeInTheDocument();
    expect(reportDownloadPayload(reportFixture)).toBe(reportFixture);
  });
});
