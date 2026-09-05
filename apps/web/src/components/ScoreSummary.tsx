import type { ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale, type MessageKey } from "@dayu/report-i18n";
import { readingCopy } from "./report-reading-copy.js";

const typeKeys: Readonly<Record<string, MessageKey>> = {
  creative_demo: "report.type.creative_demo",
  data_model: "report.type.data_model",
  docs_content: "report.type.docs_content",
  generic: "report.type.generic",
  software: "report.type.software",
  template: "report.type.template",
};

function levelKey(score: number): MessageKey {
  if (score < 20) return "level.solid";
  if (score < 40) return "level.glossy";
  if (score < 60) return "level.showing";
  if (score < 80) return "level.heavy";
  return "level.flood";
}

function repositoryType(locale: Locale, value: string): string {
  return t(locale, typeKeys[value] ?? "report.type.generic");
}

export function ScoreSummary({ description, locale, report }: { description: string | null; locale: Locale; report: ReportSnapshot }): React.JSX.Element {
  const modeKey = report.scoreKind === "enhanced" ? "report.mode.enhanced" : "report.mode.rules";
  const unscored = report.scoreKind === "facts_only" || report.scoreKind === "insufficient_evidence" || report.score === null;
  const score = report.score ?? 0;
  return (
    <section aria-labelledby="report-title" className="score-summary">
      <div className="summary-mode"><span aria-hidden="true" />{t(locale, modeKey)}</div>
      <div className="research-preview" role="note">
        <strong>{t(locale, "report.preview.label")}</strong>
        <span>{readingCopy(locale, "preview")}</span>
      </div>
      <h1 id="report-title">{report.repository.fullName}</h1>
      <p className="repository-description">{description ?? t(locale, "report.noDescription")}</p>
      <p className="reading-capture">{t(locale, "report.scannedAt")}: <time dateTime={report.createdAt}>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.createdAt))}</time></p>
      <div className="reading-score-status">
        {unscored ? (
          <div>
            <strong>{t(locale, report.scoreKind === "facts_only" ? "report.factsOnly" : "report.insufficient")}</strong>
            <p>{t(locale, report.scoreKind === "facts_only" ? "report.factsOnlyBody" : "report.insufficientBody")}</p>
          </div>
        ) : (
          <p><span>{t(locale, "report.score")}</span> <strong>{score} / 100</strong> <span>{t(locale, levelKey(score))}</span></p>
        )}
      </div>
      <div className="reading-confidence"><p><strong>{t(locale, "report.confidence")}: {report.confidence}%</strong></p><p className="confidence-context">{t(locale, "report.confidenceContext")}</p></div>
      <details className="report-disclosure report-technical" id="report-details">
        <summary>{readingCopy(locale, "technical")}</summary>
        <div className="report-disclosure-body">
          <p className="reading-normalizer">{t(locale, "report.preview.body", { version: report.researchPreview.normalizerVersion })}</p>
          {unscored ? null : <div className="score-instrument">
            <meter aria-hidden="true" className="score-waterline" max={100} min={0} value={score} />
            <span className="score-label">{t(locale, "report.score")}</span>
            <div className="precise-score" data-testid="precise-score"><strong>{score}</strong><span>/100</span><p>{t(locale, levelKey(score))}</p></div>
          </div>}
          <dl className="summary-facts">
            <div><dt>{t(locale, "report.repositoryType")}</dt><dd>{repositoryType(locale, report.repositoryType)}</dd></div>
            <div><dt>{t(locale, "report.defaultBranch")}</dt><dd><code>{report.repository.defaultBranch}</code></dd></div>
            <div><dt>{t(locale, "report.sourceCommit")}</dt><dd><code>{report.sourceCommit.slice(0, 12)}</code></dd></div>
            <div><dt>{t(locale, "report.scannedAt")}</dt><dd><time dateTime={report.createdAt}>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.createdAt))}</time></dd></div>
          </dl>
        </div>
      </details>
    </section>
  );
}
