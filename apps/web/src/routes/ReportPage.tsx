import type { Evidence, ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale } from "@dayu/report-i18n";
import { renderShareCard } from "@dayu/share-card";
import { useState } from "react";

import { BalancedFindings } from "../components/BalancedFindings.js";
import { DataCoverage } from "../components/DataCoverage.js";
import { DimensionList } from "../components/DimensionList.js";
import { Disclaimer } from "../components/Disclaimer.js";
import { EvidencePanel } from "../components/EvidencePanel.js";
import { ScoreSummary } from "../components/ScoreSummary.js";

function record(value: Evidence["value"]): Record<string, Evidence["value"]> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function repositoryDescription(report: ReportSnapshot): string | null {
  const metadata = report.evidence.find((item) => item.fact.metric === "repository.metadata");
  const description = metadata === undefined ? undefined : record(metadata.value)?.description;
  return typeof description === "string" && description.trim() !== "" ? description : null;
}

function freshScanPath(locale: Locale, fullName: string): string {
  const [owner = "", repository = ""] = fullName.split("/");
  return `/${locale}/r/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

async function copyText(value: string): Promise<void> {
  const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
  if (clipboard === undefined) throw new Error("clipboard_unavailable");
  await clipboard.writeText(value);
}

export function ReportPage({ locale, report }: { locale: Locale; report: ReportSnapshot }): React.JSX.Element {
  const [shareState, setShareState] = useState<"copied" | "downloading" | "failed" | "idle">("idle");
  const route = freshScanPath(locale, report.repository.fullName);

  async function downloadCard(): Promise<void> {
    setShareState("downloading");
    try {
      const blob = await renderShareCard(report, locale);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.download = `${report.repository.fullName.replace(/[^a-z0-9._-]+/gi, "-")}-dayu.png`;
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
      setShareState("idle");
    } catch {
      setShareState("failed");
    }
  }

  async function copyFreshScanLink(): Promise<void> {
    try {
      await copyText(new URL(route, window.location.origin).href);
      setShareState("copied");
    } catch {
      setShareState("failed");
    }
  }

  const feedback = `/feedback?${new URLSearchParams({
    commit: report.sourceCommit,
    evidence: report.evidence.map((item) => item.id).join(","),
    repository: report.repository.fullName,
    rules: report.rulesVersion,
  }).toString()}`;

  return (
    <main className="report-main">
      <div className="report-layout">
        <aside className="report-summary-column">
          <ScoreSummary description={repositoryDescription(report)} locale={locale} report={report} />
        </aside>
        <div className="report-detail-column">
          <div className="section-heading report-context-heading"><span>01</span><h2>{t(locale, "report.score")}</h2></div>
          <Disclaimer locale={locale} />
          <div className="share-actions">
            <div>
              <button disabled={shareState === "downloading"} onClick={() => { void downloadCard(); }} type="button">
                <span aria-hidden="true" className="download-icon" />
                {t(locale, shareState === "downloading" ? "report.share.downloading" : "report.share.download")}
              </button>
              <button className="secondary-action" onClick={() => { void copyFreshScanLink(); }} type="button">
                <span aria-hidden="true" className="link-icon" />
                {t(locale, "report.share.copy")}
              </button>
            </div>
            <p>{t(locale, "report.share.freshScan")}</p>
            <p aria-live="polite" className="share-status">
              {shareState === "copied" ? t(locale, "report.share.copied") : shareState === "failed" ? t(locale, "report.share.failed") : ""}
            </p>
          </div>
          <BalancedFindings locale={locale} report={report} />
          <DimensionList locale={locale} report={report} />
          <DataCoverage locale={locale} report={report} />
          <EvidencePanel locale={locale} report={report} />
          <nav aria-label={t(locale, "report.back")} className="report-links">
            <a href={`/${locale}`}>{t(locale, "report.back")}</a>
            <a href={feedback}>{t(locale, "report.feedback")}</a>
          </nav>
        </div>
      </div>
    </main>
  );
}
