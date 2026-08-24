import type { ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale } from "@dayu/report-i18n";

type DrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface CanvasSurface {
  context: DrawingContext;
  toPng(): Promise<Blob>;
}

function surface(): CanvasSurface {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(1200, 630);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("canvas_unavailable");
    return { context, toPng: () => canvas.convertToBlob({ type: "image/png" }) };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("canvas_unavailable");
    return {
      context,
      toPng: () => new Promise((resolve, reject) => {
        canvas.toBlob((blob) => { if (blob === null) reject(new Error("canvas_export_failed")); else resolve(blob); }, "image/png");
      }),
    };
  }
  throw new Error("canvas_unavailable");
}

function safeText(value: string, maximum = 120): string {
  let sanitized = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    sanitized += code < 32 || code === 127 ? " " : character;
  }
  const normalized = sanitized.replace(/\s+/g, " ").trim();
  const parts = graphemes(normalized);
  return parts.length <= maximum ? normalized : `${parts.slice(0, maximum - 1).join("")}…`;
}

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

function ellipsize(context: DrawingContext, value: string, maxWidth: number): string {
  const parts = graphemes(value.trimEnd());
  while (parts.length > 0 && context.measureText(`${parts.join("")}…`).width > maxWidth) parts.pop();
  return `${parts.join("")}…`;
}

export function measuredLines(context: DrawingContext, value: string, maxWidth: number, maxLines: number): string[] {
  const parts = graphemes(safeText(value, 2_000));
  const lines: string[] = [];
  let current = "";
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    const candidate = `${current}${part}`;
    if (current === "" || context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (lines.length === maxLines - 1) {
      return [...lines, ellipsize(context, `${current}${parts.slice(index).join("")}`, maxWidth)];
    }
    lines.push(current.trimEnd());
    current = part.trimStart();
  }
  if (current !== "" && lines.length < maxLines) lines.push(current.trimEnd());
  return lines;
}

function drawMeasuredText(context: DrawingContext, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number): void {
  for (const [index, line] of measuredLines(context, text, maxWidth, maxLines).entries()) {
    context.fillText(line, x, y + index * lineHeight);
  }
}

function modeLabel(report: ReportSnapshot, locale: Locale): string {
  return t(locale, report.scoreKind === "enhanced" ? "report.mode.enhanced" : "report.mode.rules");
}

export async function renderShareCard(report: ReportSnapshot, locale: Locale): Promise<Blob> {
  const canvas = surface();
  const { context } = canvas;
  context.fillStyle = "#f3f3ea";
  context.fillRect(0, 0, 1200, 630);
  context.fillStyle = "#071c24";
  context.fillRect(0, 0, 26, 630);
  context.fillStyle = "#087d91";
  context.fillRect(26, 0, 10, 630);

  context.fillStyle = "#087d91";
  context.font = "700 24px ui-monospace, monospace";
  context.textBaseline = "alphabetic";
  context.fillText("DAYU · REPO REALITY CHECK", 82, 72);

  context.fillStyle = "#071c24";
  context.font = "700 50px ui-sans-serif, sans-serif";
  drawMeasuredText(context, report.repository.fullName, 82, 142, 1036, 58, 2);
  context.font = "500 23px ui-monospace, monospace";
  context.fillStyle = "#36545e";
  drawMeasuredText(context, modeLabel(report, locale), 84, 240, 1034, 24, 1);

  context.strokeStyle = "#aebeb9";
  context.beginPath();
  context.moveTo(82, 266);
  context.lineTo(1118, 266);
  context.stroke();

  context.fillStyle = "#071c24";
  context.font = "700 24px ui-sans-serif, sans-serif";
  context.fillText(t(locale, "report.score"), 84, 310);
  const unscored = report.scoreKind === "facts_only" || report.scoreKind === "insufficient_evidence" || report.score === null;
  if (unscored) {
    context.fillStyle = "#b04a3e";
    context.font = "750 50px ui-sans-serif, sans-serif";
    context.fillText(t(locale, "report.insufficient"), 84, 390);
  } else {
    context.fillStyle = "#071c24";
    context.font = "760 112px ui-sans-serif, sans-serif";
    context.fillText(String(report.score), 82, 430);
    context.font = "700 30px ui-sans-serif, sans-serif";
    context.fillStyle = "#36545e";
    context.fillText("/ 100", 250, 424);
  }

  context.fillStyle = "#071c24";
  context.font = "700 24px ui-sans-serif, sans-serif";
  context.fillText(t(locale, "report.confidence"), 680, 310);
  context.font = "760 72px ui-sans-serif, sans-serif";
  context.fillText(`${String(report.confidence)}%`, 680, 405);

  context.fillStyle = "#36545e";
  context.font = "500 18px ui-sans-serif, sans-serif";
  drawMeasuredText(context, t(locale, "report.disclaimer"), 84, 505, 1010, 24, 3);
  context.fillStyle = "#087d91";
  context.fillRect(84, 582, 220, 5);
  context.fillStyle = "#36545e";
  context.font = "600 16px ui-monospace, monospace";
  drawMeasuredText(context, `${safeText(report.sourceCommit, 16)} · ${safeText(report.createdAt, 28)}`, 330, 592, 788, 18, 1);
  return canvas.toPng();
}
