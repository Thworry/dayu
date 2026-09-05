// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScanApi } from "../api/scans.js";
import { reportFixture } from "../test/reportFixture.js";
import { HomePage } from "./HomePage.js";
import { ScanPage } from "./ScanPage.js";

function api(overrides: Partial<ScanApi> = {}): ScanApi {
  return {
    createScan: vi.fn().mockResolvedValue({ jobId: "f4082d03-6bea-4d90-a901-e15c3f899a3e", stage: "validated" }),
    getReport: vi.fn(),
    getScan: vi.fn().mockResolvedValue({
      id: "f4082d03-6bea-4d90-a901-e15c3f899a3e",
      repository: "facebook/react",
      stage: "rendered",
      createdAt: "2026-08-25T00:00:00.000Z",
      expiresAt: "2099-08-25T00:30:00.000Z",
      reportAvailable: true,
    }),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HomePage", () => {
  it.each(["zh", "en"] as const)("makes the scan and sample paths explicit in %s", (locale) => {
    const scanApi = api();
    render(<HomePage api={scanApi} locale={locale} />);
    expect(screen.getByRole("button", { name: locale === "zh" ? "开始分析" : "Analyze repository" })).toBeVisible();
    expect(screen.getByRole("link", { name: locale === "zh" ? "先看看样例报告" : "Explore a sample report" })).toHaveAttribute("href", `/${locale}/sample`);
    expect(screen.getByText(locale === "zh" ? "Pre-beta · 分析公开 GitHub 仓库" : "Pre-beta · Analyze public GitHub repositories")).toBeVisible();
    expect(screen.getByRole("heading", { name: locale === "zh" ? "先读主要发现" : "Read the main findings" })).toBeVisible();
    expect(document.querySelector(".hero-body")?.textContent).not.toContain("Copilot");
    // Entry discovery must not start a scan or use a sample as live data.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(scanApi.createScan).not.toHaveBeenCalled();
  });

  it("starts a Chinese rules scan without requiring login", async () => {
    const scanApi = api();
    const onReportRoute = vi.fn();
    render(<HomePage api={scanApi} locale="zh" onReportRoute={onReportRoute} />);

    await userEvent.type(screen.getByLabelText("GitHub 仓库"), "facebook/react");
    await userEvent.click(screen.getByRole("button", { name: "开始分析" }));

    // The API method is a Vitest spy in this contract test.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(scanApi.createScan).toHaveBeenCalledWith({ repository: "facebook/react", locale: "zh" }, expect.any(AbortSignal));
    await waitFor(() => {
      expect(onReportRoute.mock.calls[0]?.[0]).toBe("/zh/r/facebook/react");
    });
  });

  it("preserves invalid input and focuses the error summary", async () => {
    const scanApi = api({
      createScan: vi.fn().mockRejectedValue({ code: "invalid_repository", status: 400 }),
    });
    render(<HomePage api={scanApi} locale="en" />);

    const input = screen.getByLabelText("GitHub repository");
    await userEvent.type(input, "not a repository");
    await userEvent.click(screen.getByRole("button", { name: "Analyze repository" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveFocus();
    expect(input).toHaveValue("not a repository");
  });

  it("renders only real stages without a fake progress percentage", async () => {
    const scanApi = api({
      getScan: vi.fn()
        .mockResolvedValueOnce({
          id: "f4082d03-6bea-4d90-a901-e15c3f899a3e",
          repository: "facebook/react",
          stage: "collected",
          createdAt: "2026-08-25T00:00:00.000Z",
          expiresAt: "2099-08-25T00:30:00.000Z",
          reportAvailable: false,
        })
        .mockResolvedValueOnce({
          id: "f4082d03-6bea-4d90-a901-e15c3f899a3e",
          repository: "facebook/react",
          stage: "rendered",
          createdAt: "2026-08-25T00:00:00.000Z",
          expiresAt: "2099-08-25T00:30:00.000Z",
          reportAvailable: true,
        }),
    });
    render(<HomePage api={scanApi} locale="en" onReportRoute={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("GitHub repository"), "facebook/react");
    await userEvent.click(screen.getByRole("button", { name: "Analyze repository" }));

    expect(await screen.findByText("Identify repository")).toBeVisible();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });

  it("shows the retry time from a rate-limited response", async () => {
    const scanApi = api({
      createScan: vi.fn().mockRejectedValue({
        code: "request_rate_limited",
        resetAt: "2026-08-25T06:30:00.000Z",
        status: 429,
      }),
    });
    render(<HomePage api={scanApi} locale="en" />);

    await userEvent.type(screen.getByLabelText("GitHub repository"), "facebook/react");
    await userEvent.click(screen.getByRole("button", { name: "Analyze repository" }));

    expect(await screen.findByText(/Try again after/)).toBeVisible();
    expect(screen.getByText(/2026/)).toBeVisible();
  });

  it("updates the document language when the locale changes", () => {
    const view = render(<HomePage api={api()} locale="zh" />);
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
    view.rerender(<HomePage api={api()} locale="en" />);
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });

  it("passes a partial snapshot to the repository route", async () => {
    const onReportRoute = vi.fn();
    const scanApi = api({
      getReport: vi.fn().mockResolvedValue(reportFixture),
      getScan: vi.fn().mockResolvedValue({
        createdAt: "2026-08-25T00:00:00.000Z",
        errorCode: "github_rate_limited",
        expiresAt: "2099-08-25T00:30:00.000Z",
        id: "f4082d03-6bea-4d90-a901-e15c3f899a3e",
        reportAvailable: true,
        repository: "facebook/react",
        stage: "failed",
      }),
    });
    render(<HomePage api={scanApi} locale="en" onReportRoute={onReportRoute} />);
    await userEvent.type(screen.getByLabelText("GitHub repository"), "facebook/react");
    await userEvent.click(screen.getByRole("button", { name: "Analyze repository" }));

    await waitFor(() => {
      expect(onReportRoute).toHaveBeenCalledWith("/en/r/facebook/react", reportFixture, "github_rate_limited", expect.any(String));
    });
  });

  it("renders routed partial evidence without starting another scan", () => {
    const createScan = vi.fn();
    render(
      <ScanPage
        api={{ createScan, getReport: vi.fn(), getScan: vi.fn() }}
        initialErrorCode="github_rate_limited"
        initialReport={reportFixture}
        locale="en"
        owner="facebook"
        repo="react"
      />,
    );

    expect(document.querySelector("#evidence")).toBeVisible();
    expect(screen.getByText("ev_aaaaaaaaaaaaaaaaaaaaaaaa")).toBeVisible();
    expect(createScan).not.toHaveBeenCalled();
  });

  it("creates exactly one direct-route scan across stage rerenders", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ jobId: "f4082d03-6bea-4d90-a901-e15c3f899a3e", stage: "validated" }), { status: 202 }));
      }
      const url = typeof _input === "string" ? _input : _input instanceof URL ? _input.href : _input.url;
      if (url.endsWith("/report")) return Promise.resolve(new Response(JSON.stringify(reportFixture), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({
        createdAt: "2026-08-25T00:00:00.000Z",
        expiresAt: "2099-08-25T00:30:00.000Z",
        id: "f4082d03-6bea-4d90-a901-e15c3f899a3e",
        reportAvailable: true,
        repository: "facebook/react",
        stage: "rendered",
      }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ScanPage locale="en" owner="facebook" repo="react" />);

    expect(await screen.findByText("Rules-only Signal")).toBeVisible();
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });

  it("does not navigate after the home scan is cancelled", async () => {
    let resolveCreate: ((value: { jobId: string; stage: "validated" }) => void) | undefined;
    const createScan = vi.fn(() => new Promise<{ jobId: string; stage: "validated" }>((resolve) => {
      resolveCreate = resolve;
    }));
    const onReportRoute = vi.fn();
    const view = render(<HomePage api={{ createScan, getReport: vi.fn(), getScan: vi.fn() }} locale="en" onReportRoute={onReportRoute} />);
    await userEvent.type(screen.getByLabelText("GitHub repository"), "facebook/react");
    await userEvent.click(screen.getByRole("button", { name: "Analyze repository" }));
    view.unmount();

    await act(async () => {
      resolveCreate?.({ jobId: "f4082d03-6bea-4d90-a901-e15c3f899a3e", stage: "validated" });
      await Promise.resolve();
    });

    expect(onReportRoute).not.toHaveBeenCalled();
  });
});
