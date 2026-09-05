import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/build-mode.js", () => ({ isStaticPreview: true }));

import { PreviewHomePage } from "./PreviewHomePage.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PreviewHomePage", () => {
  it("gives Chinese visitors a sample action and an honest local analysis path", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<PreviewHomePage locale="zh" />);
    const main = within(screen.getByRole("main"));

    expect(main.getByRole("link", { name: "查看样例报告" })).toHaveAttribute("href", "?lang=zh&view=sample");
    expect(main.getByRole("link", { name: "分析自己的仓库" })).toHaveAttribute("href", "#local-guide");
    expect(main.getByText(/线上仅提供固定样例，不能扫描其他仓库/)).toBeVisible();
    expect(main.queryByRole("textbox")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("includes complete English setup steps and tells users to open the printed URL", () => {
    render(<PreviewHomePage locale="en" />);

    expect(screen.getByRole("link", { name: "View sample report" })).toHaveAttribute("href", "?lang=en&view=sample");
    expect(screen.getByText(/Node.js 24/)).toBeVisible();
    expect(screen.getByText(/pnpm 10/)).toBeVisible();
    const commands = screen.getByLabelText("Local setup commands");
    for (const command of ["git clone https://github.com/Thworry/dayu.git", "cd dayu", "corepack enable", "pnpm install --frozen-lockfile", "pnpm demo"]) {
      expect(commands).toHaveTextContent(command);
    }
    expect(screen.getByText(/Open the local URL printed in your terminal/)).toBeVisible();
    expect(document.querySelector('a[href*="localhost"], a[href*="127.0.0.1"]')).toBeNull();
  });
});
