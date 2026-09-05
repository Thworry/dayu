// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { reportFixture } from "../test/reportFixture.js";
import { ReportOverview } from "./ReportOverview.js";

afterEach(cleanup);

describe("public observation overview", () => {
  it("uses recorded subscribers for Watch and distinguishes a missing counter from zero", () => {
    const initial = reportFixture.evidence[0];
    if (initial === undefined) throw new Error("missing_fixture");
    const value = { stars: 14, subscribers: 3, watchers_count: 9000 };
    const evidence = { ...initial, fact: { metric: "repository.metadata", value }, value };
    render(<ReportOverview locale="en" report={{ ...reportFixture, evidence: [evidence], evidenceIndex: { [evidence.id]: evidence } }} />);
    expect(screen.getByText("Stars").nextElementSibling).toHaveTextContent("14");
    expect(screen.getByText("Watch subscribers").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText("Forks").nextElementSibling).toHaveTextContent("—");
    expect(screen.queryByText("9,000")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inspect the source" })).toHaveAttribute("href", `#evidence-${evidence.id}`);
  });
});
