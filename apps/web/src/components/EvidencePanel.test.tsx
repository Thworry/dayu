import "@testing-library/jest-dom/vitest";

import type { Evidence, Finding, ReportSnapshot } from "@dayu/evidence-schema";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { reportFixture } from "../test/reportFixture.js";
import { DataCoverage } from "./DataCoverage.js";
import { EvidencePanel } from "./EvidencePanel.js";
import { observationLabel } from "./evidence-presentation.js";

const base = reportFixture.evidence[0];
if (base === undefined) throw new Error("missing_fixture");
const evidence: Evidence[] = [
  { ...base, fact: { metric: "repository.metadata", value: { stars: 42 } } },
  { ...base, id: `ev_${"b".repeat(24)}`, kind: "file", status: "partial", source: { kind: "file", path: "README.md", commitSha: reportFixture.sourceCommit }, fact: { metric: "repository.file_content", value: "Install and run the sample" }, limitations: ["bounded_first_page"] },
  { ...base, id: `ev_${"c".repeat(24)}`, kind: "release", status: "restricted", fact: { metric: "repository.releases", value: null }, limitations: ["github_endpoint_restricted"] },
  { ...base, id: `ev_${"d".repeat(24)}`, kind: "derived", status: "not_applicable", fact: { metric: "unknown.metric", value: "<img src=x onerror=alert(1)>" }, summary: "<b>Unknown original observation</b>", limitations: ["<script>untrusted</script>"] },
];
const finding: Finding = {
  caveat: "", copyKey: "finding.substance.artifacts_hold_up", counterEvidenceIds: [evidence[1]?.id ?? ""], dimension: "substance",
  evidenceIds: [base.id], explanationKey: "finding.substance.artifacts_hold_up.explanation", findingId: "fd_substance.artifacts_hold_up",
  id: "fd_substance.artifacts_hold_up", producer: "rule", risk: 0, ruleId: "substance.artifacts_hold_up", scoreImpact: 0,
  severity: "info", titleKey: "finding.substance.artifacts_hold_up.title",
};
const report: ReportSnapshot = { ...reportFixture, evidence, evidenceIndex: Object.fromEntries(evidence.map((item) => [item.id, item])), positiveSignals: [finding] };

afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

describe("Evidence explorer", () => {
  it("searches source paths, IDs, and raw contents and combines search with reference filters", async () => {
    render(<EvidencePanel locale="en" report={report} />);
    const search = screen.getByRole("searchbox", { name: "Search evidence" });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 4 of 4 observations");
    await userEvent.type(search, "README.md");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 4 observations");
    await userEvent.clear(search);
    await userEvent.type(search, "Install and run");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 4 observations");
    await userEvent.clear(search);
    await userEvent.click(screen.getByRole("button", { name: "Referenced" }));
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 4 observations");
    await userEvent.type(search, base.id);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 4 observations");
    await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByRole("status")).toHaveTextContent("Showing 4 of 4 observations");
    expect(search).toHaveValue("");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters limitations and localizes owned labels while safely preserving original text", async () => {
    const { container } = render(<EvidencePanel locale="zh" report={report} />);
    await userEvent.click(screen.getByRole("button", { name: "有限制" }));
    expect(screen.getByRole("status")).toHaveTextContent("显示 3 / 4 条证据");
    expect(screen.getByText("只采集了第一页")).toBeVisible();
    expect(screen.getByText("GitHub 限制了此数据源的访问")).toBeVisible();
    expect(screen.getByText("<b>Unknown original observation</b>", { selector: "h3" })).toBeVisible();
    expect(screen.getByText("<script>untrusted</script>", { selector: "dd" })).toBeVisible();
    expect(container.querySelector("img, script")).toBeNull();
    const row = document.getElementById(`evidence-${evidence[1]?.id ?? ""}`);
    if (row === null) throw new Error("missing_evidence_row");
    const details = row.querySelector("details");
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(within(row).getByText("展开原始记录", { selector: "summary" }));
    expect(details).toHaveAttribute("open");
    expect(within(row).getByLabelText(/原始公开观察/u)).toHaveTextContent("bounded_first_page");
    expect(observationLabel("zh", "constructor")).toBe("constructor");
  });

  it("reveals, expands, and focuses hash targets after filtering, including repeated same-hash clicks", async () => {
    const id = evidence[1]?.id ?? "";
    render(<><a href={`#evidence-${id}`}>Finding source</a><EvidencePanel locale="en" report={report} /></>);
    const search = screen.getByRole("searchbox", { name: "Search evidence" });
    await userEvent.type(search, "no matching evidence");
    expect(screen.getByText("No evidence matches these filters.")).toBeVisible();
    window.history.replaceState({}, "", `/#evidence-${id}`);
    fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() => { expect(document.getElementById(`evidence-${id}`)).toHaveFocus(); });
    expect(document.getElementById(`evidence-${id}`)?.querySelector("details")).toHaveAttribute("open");
    expect(search).toHaveValue("");
    await userEvent.type(search, "hidden again");
    await userEvent.click(screen.getByRole("link", { name: "Finding source" }));
    await waitFor(() => { expect(document.getElementById(`evidence-${id}`)).toHaveFocus(); });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 4 of 4 observations");
  });

  it("includes Copilot-only evidence references without treating unknown hash IDs as targets", async () => {
    render(<EvidencePanel locale="en" report={{ ...report, findings: [], positiveSignals: [], copilot: {
      findings: [{ counterEvidenceIds: [], en: "A cited observation", zh: "一条有引用的观察", evidenceIds: [base.id], rubricId: "claims.install", verdict: "supported" }],
      model: "test", promptVersion: "test", rubricVersion: "test",
    } }} />);
    await userEvent.click(screen.getByRole("button", { name: "Referenced" }));
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 4 observations");
    window.history.replaceState({}, "", "/#evidence-invalid");
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(screen.getByRole("button", { name: "Referenced" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Evidence status coverage", () => {
  it("counts actual observation statuses independently of report confidence and localizes missing signals", () => {
    const { container } = render(<DataCoverage locale="zh" report={{ ...report, confidence: 99, missingSignals: ["claims.release_evidence", "taxonomy.low_confidence", "custom_missing"] }} />);
    expect(screen.getByText(/这里按实际记录统计/u)).toBeVisible();
    const chart = container.querySelector(".evidence-status-counts");
    expect(chart?.querySelector(".is-complete dd")).toHaveTextContent("1");
    expect(chart?.querySelector(".is-partial dd")).toHaveTextContent("1");
    expect(chart?.querySelector(".is-restricted dd")).toHaveTextContent("1");
    expect(chart?.querySelector(".is-unverifiable dd")).toHaveTextContent("0");
    expect(chart?.querySelector(".is-not_applicable dd")).toHaveTextContent("1");
    expect(screen.queryByText("99%")).not.toBeInTheDocument();
    expect(screen.getByText("可核对的发布证据")).toBeVisible();
    expect(screen.getByText("足够可靠的仓库类型判断")).toBeVisible();
    expect(screen.getByText("custom_missing")).toBeVisible();
  });

  it("renders an empty collection without a meaningless chart", () => {
    const { container } = render(<DataCoverage locale="en" report={{ ...report, evidence: [], evidenceIndex: {} }} />);
    expect(screen.getByText("No observations were stored.")).toBeVisible();
    expect(container.querySelector("svg")).toBeNull();
  });
});
