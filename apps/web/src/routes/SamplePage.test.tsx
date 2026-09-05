import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import sample from "../data/dayu-sample.json";
import { SamplePage } from "./SamplePage.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SamplePage", () => {
  it("opens a saved report without asking for scan or sign-in data", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<SamplePage locale="en" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Public self-check · saved snapshot")).toBeVisible();
    expect(screen.getByText(/The rules are uncalibrated/)).toBeVisible();
    expect(screen.getByText("pnpm demo")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="/api/"], a[href^="/en/r/"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("localizes the historical snapshot boundary", () => {
    render(<SamplePage locale="zh" />);

    expect(screen.getByText("公开自检样例 · 历史快照")).toBeVisible();
    expect(screen.getByText(/样例不展示综合分数/)).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
  });

  it("downloads the complete pinned evidence snapshot locally", async () => {
    const createObjectURL = vi.fn<(blob: Blob | MediaSource) => string>().mockReturnValue("blob:local-sample");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("Thworry-dayu-dayu.json");
      expect(this.href).toBe("blob:local-sample");
    });
    render(<SamplePage locale="en" />);
    await userEvent.click(screen.getByRole("button", { name: "Download evidence JSON" }));

    const blob = createObjectURL.mock.calls[0]?.[0];
    if (!(blob instanceof Blob)) throw new Error("Expected a locally generated report Blob");
    expect(blob.type).toBe("application/json");
    const contents = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Expected a JSON text download"));
      };
      reader.onerror = () => { reject(new Error("Cannot read downloaded report")); };
      reader.readAsText(blob);
    });
    expect(JSON.parse(contents)).toEqual(sample);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-sample");
  });
});
