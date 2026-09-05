import { describe, expect, it } from "vitest";

import { previewPath, previewView } from "./preview-navigation.js";

describe("preview navigation", () => {
  it("opens the welcome screen by default and for home guide fragments", () => {
    for (const hash of ["", "#local-guide", "#main-content", "#unknown"]) {
      expect(previewView("?lang=zh", hash)).toBe("home");
    }
    expect(previewView("?lang=en&view=unknown", "")).toBe("home");
  });

  it("opens an explicit sample and supports existing report fragment links", () => {
    expect(previewView("?lang=zh&view=sample", "")).toBe("sample");
    for (const hash of ["#evidence-ev_aaaaaaaaaaaaaaaaaaaaaaaa", "#evidence", "#coverage", "#coverage-heading", "#dimensions-heading", "#findings-heading", "#report-title"]) {
      expect(previewView("?lang=en", hash)).toBe("sample");
    }
  });

  it("generates relative localized home and sample URLs without losing the target", () => {
    expect(previewPath("zh", "home")).toBe("?lang=zh");
    expect(previewPath("en", "sample")).toBe("?lang=en&view=sample");
    expect(previewPath("zh", "sample", "#evidence-ev_aaaaaaaaaaaaaaaaaaaaaaaa")).toBe("?lang=zh&view=sample#evidence-ev_aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(previewPath("en", "home", "local-guide")).toBe("?lang=en#local-guide");
  });
});
