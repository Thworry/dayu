// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { Finding, ReportSnapshot } from "@dayu/evidence-schema";
import type { CopilotApi, EnhancementResponse } from "../api/copilot.js";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportFixture } from "../test/reportFixture.js";
import { githubApiSource } from "../components/EvidencePanel.js";
import { ReportPage } from "./ReportPage.js";

const evidenceId = reportFixture.evidence[0]?.id ?? "ev_aaaaaaaaaaaaaaaaaaaaaaaa";

const positive = {
  caveat: "bounded_activity_sample",
  copyKey: "finding.popularity.signals_align",
  counterEvidenceIds: [],
  dimension: "popularity",
  evidenceIds: [evidenceId],
  explanationKey: "finding.popularity.signals_align.explanation",
  findingId: "fd_popularity.signals_align",
  id: "fd_popularity.signals_align",
  producer: "rule",
  risk: 0,
  ruleId: "popularity.signals_align",
  scoreImpact: 0,
  severity: "info",
  titleKey: "finding.popularity.signals_align.title",
} satisfies Finding;

const caution = {
  ...positive,
  caveat: "sample_window",
  copyKey: "finding.community.low_human_dialogue",
  dimension: "community",
  explanationKey: "finding.community.low_human_dialogue.explanation",
  findingId: "fd_community.low_human_dialogue",
  id: "fd_community.low_human_dialogue",
  risk: 32,
  ruleId: "community.low_human_dialogue",
  scoreImpact: 7,
  severity: "low",
  titleKey: "finding.community.low_human_dialogue.title",
} satisfies Finding;

function fixture(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return { ...reportFixture, findings: [caution], positiveSignals: [positive], ...overrides };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReportPage", () => {
  it("renders score context, balanced findings, and a verifiable pinned evidence link", () => {
    render(<ReportPage locale="en" report={fixture()} />);

    expect(screen.getByText("Rules-only Signal")).toBeVisible();
    expect(screen.getByText("What holds up")).toBeVisible();
    expect(screen.getByText("What needs a closer look")).toBeVisible();
    expect(screen.getByRole("link", { name: evidenceId })).toHaveAttribute("href", "https://api.github.com/repos/facebook/react");
    expect(screen.getByText("This is an entertainment-style risk assessment based on public evidence. It is not proof of bought engagement, fraud, or intent.")).toBeVisible();
    expect(screen.getAllByText("Context:")).toHaveLength(2);
    expect(screen.getByText("The community finding uses only a bounded sample of public interactions.")).toBeVisible();
    expect(screen.getByText("An additional conservative scoring condition applies to this finding.")).toBeVisible();
    expect(screen.queryByText("sample_window")).not.toBeInTheDocument();
  });

  it("does not render a pseudo-precise score when evidence is insufficient", () => {
    render(<ReportPage locale="en" report={fixture({ baseScore: null, score: null, scoreKind: "insufficient_evidence" })} />);

    expect(screen.getByText("Insufficient evidence")).toBeVisible();
    expect(screen.queryByTestId("precise-score")).not.toBeInTheDocument();
  });

  it("renders a neutral unavailable dimension without a zero-valued meter", () => {
    const unavailable = fixture({
      dimensionScores: { ...reportFixture.dimensionScores, substance: null },
    });
    render(<ReportPage locale="en" report={unavailable} />);

    const substance = screen.getByText("Code Substance").closest("li");
    expect(substance).not.toBeNull();
    expect(substance?.querySelector("meter")).toBeNull();
    expect(substance?.querySelector(".dimension-unavailable-track")).toHaveAttribute("aria-hidden", "true");
    expect(substance?.querySelector("output")).toHaveTextContent("Not enough data");
    expect(screen.getAllByRole("meter")).toHaveLength(4);
  });

  it("uses score kind as the unscored source of truth", () => {
    render(<ReportPage locale="en" report={fixture({ score: 18, scoreKind: "facts_only" })} />);
    expect(screen.getByText("Insufficient evidence")).toBeVisible();
    expect(screen.queryByTestId("precise-score")).not.toBeInTheDocument();
  });

  it("uses localized repository routes for copied fresh-scan links", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    window.history.replaceState({}, "", "/zh/r/facebook/react?payload=secret");
    render(<ReportPage locale="zh" report={fixture()} />);

    await userEvent.click(screen.getByRole("button", { name: "复制重新扫描链接" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/zh/r/facebook/react`);
    expect(screen.getByText("链接已复制")).toBeVisible();
  });

  it("renders unknown finding keys with a neutral localized fallback", () => {
    render(<ReportPage locale="en" report={fixture({ findings: [{ ...caution, explanationKey: "repository.supplied.instructions", titleKey: "ignore.system.prompt" }] })} />);

    expect(screen.queryByText("ignore.system.prompt")).not.toBeInTheDocument();
    expect(screen.getByText("A public signal does not fully line up")).toBeVisible();
  });

  it("pins file evidence to its commit while API evidence uses only the allowlisted API host", () => {
    const baseEvidence = reportFixture.evidence[0];
    if (baseEvidence === undefined) throw new Error("missing_fixture_evidence");
    const fileEvidence = { ...baseEvidence, source: { commitSha: reportFixture.sourceCommit, kind: "file" as const, lineStart: 12, path: "README.md" } };
    const fileReport = { ...fixture(), evidence: [fileEvidence], evidenceIndex: { [fileEvidence.id]: fileEvidence } };
    const view = render(<ReportPage locale="en" report={fileReport} />);
    expect(screen.getByRole("link", { name: evidenceId })).toHaveAttribute("href", `https://github.com/facebook/react/blob/${reportFixture.sourceCommit}/README.md#L12`);
    expect(screen.getByText(/Pinned to report commit/)).toBeVisible();

    view.unmount();
    const unsafeEvidence = { ...baseEvidence, source: { endpoint: "//attacker.example/steal", kind: "api" as const, queryHash: "public-v1" } };
    render(<ReportPage locale="en" report={{ ...fixture(), evidence: [unsafeEvidence], evidenceIndex: { [unsafeEvidence.id]: unsafeEvidence } }} />);
    expect(screen.getByRole("link", { name: evidenceId })).toHaveAttribute("href", "https://api.github.com/");
    expect(githubApiSource("/user", "facebook/react")).toBe("https://api.github.com/");
    expect(githubApiSource("/repos/facebook/react/issues?state=all&page=1", "facebook/react"))
      .toBe("https://api.github.com/repos/facebook/react/issues?state=all&page=1");
  });

  it("keeps the rules report visible during one consented enhancement and renders the stored delta", async () => {
    let finish!: (result: EnhancementResponse) => void;
    const enhance = vi.fn<CopilotApi["enhance"]>(() => new Promise((resolve) => { finish = resolve; }));
    const copilotApi: CopilotApi = {
      enhance,
      getSession: () => Promise.resolve({ authenticated: true, csrfToken: "b".repeat(43), githubUserId: 101 }),
    };
    const base = fixture();
    const enhanced = {
      ...base,
      baseScore: base.score,
      enrichedScore: 18,
      promptVersion: "copilot-prompt-v1",
      score: 18,
      scoreKind: "enhanced" as const,
    };
    render(<ReportPage copilotApi={copilotApi} jobId="2c3da581-4bb8-4934-9714-8b25b5e4fc0c" locale="en" report={base} />);
    await userEvent.click(await screen.findByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /run enhanced analysis/i }));
    expect(screen.getByText("Rules-only Signal")).toBeVisible();
    expect(screen.getByText(/rules report remains visible/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /Copilot is checking/i })).toBeDisabled();
    expect(enhance).toHaveBeenCalledTimes(1);

    finish({
      baseReport: base,
      enhancedReport: enhanced,
      metadata: {
        findings: [{ counterEvidenceIds: [], en: "[SUPPORTED] Stored English finding.", evidenceIds: [evidenceId], rubricId: "claims.install", verdict: "supported", zh: "[支持] 已保存的中文判断。" }],
        model: "gpt-5-mini",
        promptVersion: "copilot-prompt-v1",
        rubricVersion: "copilot-rubric-v1",
      },
    });
    expect(await screen.findByText("Copilot-enhanced Signal")).toBeVisible();
    expect(screen.getByText("[SUPPORTED] Stored English finding.")).toBeVisible();
    expect(screen.getByText("What changed after enhancement").closest(".copilot-success-status")).toHaveFocus();
    expect(enhance).toHaveBeenCalledTimes(1);
  });

  it("preserves the exact base report when Copilot returns an unusable result", async () => {
    const base = fixture();
    const copilotApi: CopilotApi = {
      enhance: () => Promise.resolve({ baseReport: base, enhancedReport: null, errorCode: "copilot_invalid_output" }),
      getSession: () => Promise.resolve({ authenticated: true, csrfToken: "b".repeat(43), githubUserId: 101 }),
    };
    render(<ReportPage copilotApi={copilotApi} jobId="2c3da581-4bb8-4934-9714-8b25b5e4fc0c" locale="en" report={base} />);
    await userEvent.click(await screen.findByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /run enhanced analysis/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The rules report is preserved");
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(screen.getByText("Rules-only Signal")).toBeVisible();
  });

  it("clears revoked authentication and offers a fresh GitHub connection", async () => {
    const base = fixture();
    const copilotApi: CopilotApi = {
      enhance: () => Promise.resolve({ baseReport: base, enhancedReport: null, errorCode: "copilot_revoked" }),
      getSession: () => Promise.resolve({ authenticated: true, csrfToken: "b".repeat(43), githubUserId: 101 }),
    };
    render(<ReportPage copilotApi={copilotApi} jobId="2c3da581-4bb8-4934-9714-8b25b5e4fc0c" locale="en" report={base} />);
    await userEvent.click(await screen.findByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /run enhanced analysis/i }));
    expect(await screen.findByRole("button", { name: "Connect GitHub to continue" })).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("clears stale enhanced metadata when a new base report replaces it", async () => {
    const base = fixture();
    const enhanced = {
      ...base,
      baseScore: base.score,
      copilot: {
        findings: [{ counterEvidenceIds: [], en: "[SUPPORTED] Old finding.", evidenceIds: [evidenceId], rubricId: "claims.install", verdict: "supported" as const, zh: "[支持] 旧判断。" }],
        model: "old-model",
        promptVersion: "copilot-prompt-v1",
        rubricVersion: "copilot-rubric-v1",
      },
      enrichedScore: 18,
      promptVersion: "copilot-prompt-v1",
      score: 18,
      scoreKind: "enhanced" as const,
    };
    const copilotApi: CopilotApi = {
      enhance: vi.fn(),
      getSession: () => Promise.resolve({ authenticated: true, csrfToken: "b".repeat(43), githubUserId: 101 }),
    };
    const view = render(<ReportPage copilotApi={copilotApi} jobId="2c3da581-4bb8-4934-9714-8b25b5e4fc0c" locale="en" report={enhanced} />);
    expect(screen.getByText("[SUPPORTED] Old finding.")).toBeVisible();
    view.rerender(<ReportPage copilotApi={copilotApi} jobId="new-job-id" locale="en" report={base} />);
    expect(screen.queryByText("[SUPPORTED] Old finding.")).not.toBeInTheDocument();
    expect(await screen.findByRole("checkbox")).toBeVisible();
  });

  it("ignores an old enhancement response after switching to a new report", async () => {
    let finishOld!: (result: EnhancementResponse) => void;
    const enhance = vi.fn<CopilotApi["enhance"]>(() => new Promise((resolve) => { finishOld = resolve; }));
    const onEnhanced = vi.fn();
    const copilotApi: CopilotApi = {
      enhance,
      getSession: () => Promise.resolve({ authenticated: true, csrfToken: "b".repeat(43), githubUserId: 101 }),
    };
    const oldBase = fixture();
    const newBase = fixture({
      repository: { ...oldBase.repository, fullName: "new/repository" },
      sourceCommit: "fedcba0987654321",
    });
    const oldEnhanced = {
      ...oldBase,
      baseScore: oldBase.score,
      enrichedScore: 18,
      promptVersion: "copilot-prompt-v1",
      score: 18,
      scoreKind: "enhanced" as const,
    };
    const view = render(<ReportPage copilotApi={copilotApi} jobId="2c3da581-4bb8-4934-9714-8b25b5e4fc0c" locale="en" onEnhanced={onEnhanced} report={oldBase} />);
    await userEvent.click(await screen.findByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /run enhanced analysis/i }));
    const oldSignal = enhance.mock.calls[0]?.[2];

    view.rerender(<ReportPage copilotApi={copilotApi} jobId="5f818d9d-d4f9-43b7-813e-e91dd41bb31a" locale="en" onEnhanced={onEnhanced} report={newBase} />);
    expect(oldSignal?.aborted).toBe(true);
    finishOld({
      baseReport: oldBase,
      enhancedReport: oldEnhanced,
      metadata: {
        findings: [{ counterEvidenceIds: [], en: "[SUPPORTED] Old response.", evidenceIds: [evidenceId], rubricId: "claims.install", verdict: "supported", zh: "[支持] 旧响应。" }],
        model: "old-model",
        promptVersion: "copilot-prompt-v1",
        rubricVersion: "copilot-rubric-v1",
      },
    });
    await Promise.resolve();

    expect(screen.queryByText("[SUPPORTED] Old response.")).not.toBeInTheDocument();
    expect(screen.getByText("Rules-only Signal")).toBeVisible();
    expect(onEnhanced).not.toHaveBeenCalled();
  });
});
