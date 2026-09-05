import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const buildMode = vi.hoisted(() => ({ isStaticPreview: false }));
vi.mock("../app/build-mode.js", () => buildMode);

import { SiteShell } from "./SiteShell.js";

afterEach(() => {
  cleanup();
  buildMode.isStaticPreview = false;
  window.history.replaceState(null, "", "/");
});

describe("SiteShell navigation", () => {
  it("keeps the normal sample route when changing language", () => {
    render(<SiteShell locale="en" repositoryPath="/sample"><main>Sample</main></SiteShell>);

    expect(screen.getByRole("link", { name: "Sample report" })).toHaveAttribute("href", "/en/sample");
    expect(document.querySelector(".locale-switch")).toHaveAttribute("href", "/zh/sample");
  });

  it("keeps static navigation on Pages and preserves the evidence anchor", () => {
    buildMode.isStaticPreview = true;
    window.history.replaceState(null, "", "/dayu/?lang=en#ev_aaaaaaaaaaaaaaaaaaaaaaaa");
    render(<SiteShell locale="en" repositoryPath="/sample"><main>Sample</main></SiteShell>);

    expect(document.querySelector(".brand")).toHaveAttribute("href", "?lang=en");
    expect(document.querySelector(".locale-switch")).toHaveAttribute("href", "?lang=zh#ev_aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/Thworry/dayu");
    expect(screen.queryByRole("link", { name: "Sample report" })).not.toBeInTheDocument();
  });
});
