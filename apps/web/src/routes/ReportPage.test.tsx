// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { Finding, ReportSnapshot } from "@dayu/evidence-schema";
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
});
