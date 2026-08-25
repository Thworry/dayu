// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EnhancedMetadata } from "../api/copilot.js";
import { CopilotConsent } from "./CopilotConsent.js";
import { EnhancedDelta } from "./EnhancedDelta.js";

afterEach(cleanup);

describe("Copilot consent", () => {
  it("explains selected redacted evidence, provider handling, and user-owned quota before confirmation", async () => {
    const confirm = vi.fn();
    render(<CopilotConsent locale="en" onConfirm={confirm} />);

    expect(screen.getAllByText(/selected, redacted public evidence/i)).toHaveLength(2);
    expect(screen.getByText(/may count toward your Copilot usage/i)).toBeVisible();
    expect(screen.getByText(/data handling depend on your GitHub plan/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /run enhanced analysis/i })).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /run enhanced analysis/i }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("offers GitHub connection without pretending consent has already been granted", async () => {
    const connect = vi.fn();
    const confirm = vi.fn();
    render(<CopilotConsent authenticated={false} locale="zh" onConnect={connect} onConfirm={confirm} />);
    await userEvent.click(screen.getByRole("button", { name: "连接 GitHub 后继续" }));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("enhanced delta", () => {
  const metadata: EnhancedMetadata = {
    findings: [{
      counterEvidenceIds: [], en: "[SUPPORTED] English bounded finding.", evidenceIds: ["ev_aaaaaaaaaaaaaaaaaaaaaaaa"],
      rubricId: "claims.install", verdict: "supported", zh: "[支持] 中文有限判断。",
    }],
    model: "gpt-5-mini",
    promptVersion: "copilot-prompt-v1",
    rubricVersion: "copilot-rubric-v1",
  };

  it("switches stored bilingual findings without another network request", () => {
    const view = render(<EnhancedDelta enhancedScore={18} locale="en" metadata={metadata} rulesScore={22} />);
    expect(screen.getByText("[SUPPORTED] English bounded finding.")).toBeVisible();
    expect(screen.getByText("gpt-5-mini")).toBeVisible();
    view.rerender(<EnhancedDelta enhancedScore={18} locale="zh" metadata={metadata} rulesScore={22} />);
    expect(screen.getByText("[支持] 中文有限判断。")).toBeVisible();
  });
});
