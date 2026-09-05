import type { ReportSnapshot } from "@dayu/evidence-schema";
import { t } from "@dayu/report-i18n";
import { afterEach, describe, expect, it, vi } from "vitest";

import { measuredLines, renderShareCard } from "./render.js";

const report = {
  baseScore: 43,
  collectorVersion: "collector-v1",
  confidence: 78,
  createdAt: "2026-08-25T00:00:00.000Z",
  dataStatus: "complete",
  dimensionScores: { claims: 35, community: 46, maintenance: 28, popularity: 55, substance: 40 },
  evidence: [],
  evidenceIndex: {},
  expiresAt: "2026-08-25T00:30:00.000Z",
  findings: [],
  locale: "en",
  missingSignals: [],
  positiveSignals: [],
  reportVersion: "1",
  researchPreview: {
    calibrationStatus: "uncalibrated",
    normalizerKind: "synthetic_reference",
    normalizerVersion: "normalizer-v1",
    releaseStage: "pre_beta",
  },
  repository: { defaultBranch: "main", fullName: "owner/<img onerror=alert(1)>", id: 1 },
  repositoryType: "software",
  rulesVersion: "rules-v1",
  score: 43,
  scoreKind: "rules_only",
  sourceCommit: "abcdef1234567",
} satisfies ReportSnapshot;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderShareCard", () => {
  it("wraps English at word boundaries when a complete word fits", () => {
    const context = { measureText: (text: string) => ({ width: text.length * 10 }) } as CanvasRenderingContext2D;
    expect(measuredLines(context, "known words stay whole", 100, 4)).toEqual(["known", "words stay", "whole"]);
  });
  it.each(["en", "zh"] as const)("keeps the confidence caveat on the %s card", async (locale) => {
    const drawn: string[] = [];
    class FakeCanvas {
      convertToBlob = () => Promise.resolve(new Blob([], { type: "image/png" }));
      getContext = () => ({
        beginPath: vi.fn(), fillRect: vi.fn(), fillStyle: "", fillText: (text: string) => { drawn.push(text); }, font: "",
        lineTo: vi.fn(), measureText: (text: string) => ({ width: text.length * 10 }), moveTo: vi.fn(), stroke: vi.fn(), strokeStyle: "", textBaseline: "alphabetic",
      });
    }
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    await renderShareCard(report, locale);
    expect(drawn.join("").replace(/\s/g, "")).toContain(t(locale, "report.share.confidenceContext").replace(/\s/g, ""));
  });
  it("draws repository strings as canvas text and returns a 1200 by 630 PNG", async () => {
    const fillText = vi.fn();
    const context = {
      beginPath: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
      fillText,
      font: "",
      lineTo: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 12 }),
      moveTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      textBaseline: "alphabetic",
    };
    const convertToBlob = vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    class FakeCanvas {
      readonly height: number;
      readonly width: number;
      constructor(width: number, height: number) { this.width = width; this.height = height; }
      convertToBlob = convertToBlob;
      getContext = () => context;
    }
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);

    const result = await renderShareCard(report, "en");

    expect(result.type).toBe("image/png");
    expect(fillText).toHaveBeenCalledWith("owner/<img onerror=alert(1)>", expect.any(Number), expect.any(Number));
    expect(fillText).toHaveBeenCalledWith("Pre-beta · uncalibrated research preview", expect.any(Number), expect.any(Number));
    expect(convertToBlob).toHaveBeenCalledWith({ type: "image/png" });
  });

  it("never draws a precise score for an insufficient-evidence report", async () => {
    const drawn: string[] = [];
    class FakeCanvas {
      convertToBlob = () => Promise.resolve(new Blob([], { type: "image/png" }));
      getContext = () => ({
        beginPath: vi.fn(), fillRect: vi.fn(), fillStyle: "", fillText: vi.fn((text: string) => { drawn.push(text); }), font: "",
        lineTo: vi.fn(), measureText: (text: string) => ({ width: text.length * 12 }), moveTo: vi.fn(), stroke: vi.fn(), strokeStyle: "", textBaseline: "alphabetic",
      });
    }
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);

    await renderShareCard({ ...report, baseScore: null, score: null, scoreKind: "insufficient_evidence" }, "en");
    expect(drawn).toContain("Insufficient evidence");
    expect(drawn).not.toContain("43");
  });

  it("wraps and ellipsizes long grapheme text inside the card bounds", async () => {
    const drawn: { text: string; x: number; y: number }[] = [];
    const textWidth = (text: string): number => Array.from(text).length * 30;
    class FakeCanvas {
      convertToBlob = () => Promise.resolve(new Blob([], { type: "image/png" }));
      getContext = () => ({
        beginPath: vi.fn(), fillRect: vi.fn(), fillStyle: "", fillText: vi.fn((text: string, x: number, y: number) => { drawn.push({ text, x, y }); }), font: "",
        lineTo: vi.fn(), measureText: (text: string) => ({ width: textWidth(text) }), moveTo: vi.fn(), stroke: vi.fn(), strokeStyle: "", textBaseline: "alphabetic",
      });
    }
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    const longName = `owner/${"legal-repository-name-".repeat(12)}👩🏽‍💻`;

    await renderShareCard({ ...report, repository: { ...report.repository, fullName: longName } }, "zh");

    const repositoryLines = drawn.filter(({ y }) => y === 142 || y === 200);
    const disclaimerLines = drawn.filter(({ y }) => y >= 505 && y <= 553);
    expect(repositoryLines).toHaveLength(2);
    expect(repositoryLines[1]?.text.endsWith("…")).toBe(true);
    expect(disclaimerLines.length).toBeGreaterThan(1);
    const boundedDynamicText = drawn.filter(({ y }) => y === 142 || y === 200 || y === 240 || (y >= 505 && y <= 553) || y === 592);
    expect(boundedDynamicText.every(({ text, x, y }) => x + textWidth(text) <= 1120 && y <= 592)).toBe(true);
  });
});
