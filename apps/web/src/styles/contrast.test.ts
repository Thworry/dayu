import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { describe, expect, it } from "vitest";

function luminance(hex: string): number {
  const channels = hex.match(/[a-f\d]{2}/giu)?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (channels?.length !== 3) throw new Error("Expected a six-digit color");
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("scan color tokens", () => {
  it("keeps river-colored small text above WCAG AA contrast", () => {
    const webRoot = basename(process.cwd()) === "web" ? process.cwd() : resolve(process.cwd(), "apps/web");
    const css = readFileSync(resolve(webRoot, "src/styles/scan.css"), "utf8");
    const riverText = /--river-text:\s*(#[a-f\d]{6})/iu.exec(css)?.[1];
    const paper = /--paper:\s*(#[a-f\d]{6})/iu.exec(css)?.[1];

    expect(riverText).toBeDefined();
    expect(paper).toBeDefined();
    expect(contrast(riverText ?? "#ffffff", paper ?? "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});
