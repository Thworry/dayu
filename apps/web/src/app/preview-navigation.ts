import type { Locale } from "@dayu/report-i18n";

export type PreviewView = "home" | "sample";

const reportTargets = new Set([
  "evidence", "coverage", "report-title", "reading-heading", "overview-heading",
  "dimensions-heading", "findings-heading", "coverage-heading", "evidence-heading",
  "report-analysis", "report-evidence", "report-details",
]);

export function previewView(search: string, hash: string): PreviewView {
  if (new URLSearchParams(search).get("view") === "sample") return "sample";
  let target: string;
  try { target = decodeURIComponent(hash.replace(/^#/u, "")); } catch { return "home"; }
  return reportTargets.has(target) || /^evidence-ev_[a-f0-9]+$/u.test(target) ? "sample" : "home";
}

export function previewPath(locale: Locale, view: PreviewView, hash = ""): string {
  const fragment = hash === "" ? "" : `#${hash.replace(/^#/u, "")}`;
  return `?lang=${locale}${view === "sample" ? "&view=sample" : ""}${fragment}`;
}
