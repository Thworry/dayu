import "@testing-library/jest-dom/vitest";

import type { Finding, ReportSnapshot } from "@dayu/evidence-schema";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { reportFixture } from "../test/reportFixture.js";
import { ReportPage } from "./ReportPage.js";

const evidenceId = reportFixture.evidence[0]?.id ?? "";
const positive: Finding = { id: "fd_positive", findingId: "fd_positive", producer: "rule", dimension: "substance", severity: "info", risk: 0, scoreImpact: 0, evidenceIds: [evidenceId], counterEvidenceIds: [], titleKey: "finding.substance.artifacts_hold_up.title", explanationKey: "finding.substance.artifacts_hold_up.explanation", copyKey: "finding.substance.artifacts_hold_up", ruleId: "substance.artifacts_hold_up", caveat: "bounded_activity_sample" };
const caution: Finding = { ...positive, id: "fd_caution", findingId: "fd_caution", dimension: "claims", risk: 40, severity: "low", titleKey: "finding.claims.public_mismatch.title", explanationKey: "finding.claims.public_mismatch.explanation", copyKey: "finding.claims.public_mismatch", ruleId: "claims.public_mismatch" };
const report: ReportSnapshot = { ...reportFixture, positiveSignals: [positive, { ...positive, id: "fd_positive_2", findingId: "fd_positive_2" }], findings: [caution, { ...caution, id: "fd_caution_2", findingId: "fd_caution_2" }] };

afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

async function openDisclosure(container: HTMLElement, id: string): Promise<void> {
  const disclosure = container.querySelector<HTMLDetailsElement>(`#${id}`);
  const summary = disclosure?.querySelector("summary");
  if (!(disclosure instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) throw new Error(`missing_${id}`);
  if (!disclosure.open) await userEvent.click(summary);
  expect(disclosure).toHaveAttribute("open");
}

describe("Report reading path", () => {
  it("starts with bounded observations and visible boundaries while retaining hidden detail in the DOM", async () => {
    const { container } = render(<ReportPage locale="en" report={report} />);
    const guide = screen.getByRole("region", { name: "Start with the main observations" });
    expect(within(guide).getAllByRole("article")).toHaveLength(2);
    expect(within(guide).getByText(/2 supportive observations/u)).toBeVisible();
    expect(within(guide).getAllByText(/bounded sample/u)).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open detailed analysis" })).toBeVisible();
    expect(screen.getByText("Pre-beta · uncalibrated research preview")).toBeVisible();
    expect(screen.getByText(/not proof of bought engagement/u)).toBeVisible();
    expect(screen.getByText(/probability that a conclusion is correct/u)).toBeVisible();
    expect(screen.getByText(/Missing data reduces coverage/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "Download evidence JSON" })).toBeVisible();
    expect(container.querySelector("#report-analysis")).not.toHaveAttribute("open");
    expect(container.querySelector("#report-evidence")).not.toHaveAttribute("open");
    expect(container.querySelector("#report-details")).not.toHaveAttribute("open");
    expect(container.querySelector(`#evidence-${evidenceId}`)).toBeInTheDocument();
    expect(container.querySelector(`#evidence-${evidenceId}`)).not.toBeVisible();
    await openDisclosure(container, "report-details");
    expect(screen.getByText(/synthetic reference normalizer normalizer-v1/u)).toBeVisible();
  });

  it("opens a requested section and allows independent manual collapse", async () => {
    const { container } = render(<ReportPage locale="en" report={report} />);
    await userEvent.click(screen.getByRole("link", { name: "Open detailed analysis" }));
    expect(container.querySelector("#report-analysis")).toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "Five signal levels" })).toHaveFocus();
    expect(container.querySelector("#report-evidence")).not.toHaveAttribute("open");
    const disclosure = container.querySelector("#report-analysis summary");
    if (disclosure === null) throw new Error("missing_disclosure");
    await userEvent.click(disclosure);
    expect(container.querySelector("#report-analysis")).not.toHaveAttribute("open");
  });

  it("reveals an initial evidence hash and repeats navigation through a closed, filtered explorer", async () => {
    window.history.replaceState({}, "", `/#evidence-${evidenceId}`);
    const { container } = render(<ReportPage locale="en" report={report} />);
    await waitFor(() => { expect(container.querySelector(`#evidence-${evidenceId}`)).toBeVisible(); });
    expect(container.querySelector(`#evidence-${evidenceId}`)).toHaveFocus();
    expect(container.querySelector(`#evidence-${evidenceId} details`)).toHaveAttribute("open");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search evidence" }), "missing source");
    const disclosure = container.querySelector("#report-evidence summary");
    if (disclosure === null) throw new Error("missing_disclosure");
    await userEvent.click(disclosure);
    await userEvent.click(within(screen.getByRole("region", { name: "Start with the main observations" })).getAllByRole("link", { name: `Check the source: ${evidenceId}` })[0] ?? disclosure);
    await waitFor(() => { expect(container.querySelector(`#evidence-${evidenceId}`)).toBeVisible(); });
    expect(container.querySelector(`#evidence-${evidenceId}`)).toHaveFocus();
    expect(screen.getByRole("searchbox", { name: "Search evidence" })).toHaveValue("");
  });
});
