import type { Finding, ReportSnapshot } from "@dayu/evidence-schema";
import { caveatMessage, findingMessage, t, type Locale, type MessageKey } from "@dayu/report-i18n";

import { observationLabel } from "./evidence-presentation.js";
import { findingCounts, readingCopy } from "./report-reading-copy.js";

const dataStatusKeys = {
  complete: "report.status.complete", partial: "report.status.partial", restricted: "report.status.restricted",
  unverifiable: "report.status.unverifiable", not_applicable: "report.status.not_applicable",
} as const satisfies Record<ReportSnapshot["dataStatus"], MessageKey>;

function KeyObservation({ finding, locale, tone }: { finding: Finding; locale: Locale; tone: "positive" | "caution" }): React.JSX.Element {
  const primary = finding.evidenceIds[0];
  const counter = finding.counterEvidenceIds[0];
  return <article className={`reading-observation is-${tone}`}>
    <p className="reading-tone">{readingCopy(locale, tone)}</p>
    {finding.producer === "copilot" ? <span className="finding-producer">{t(locale, "report.producer.copilot")}</span> : null}
    <h3>{findingMessage(locale, finding.titleKey, tone === "positive" ? "positiveTitle" : "cautionTitle")}</h3>
    <p>{findingMessage(locale, finding.explanationKey, tone === "positive" ? "positiveExplanation" : "cautionExplanation")}</p>
    {finding.caveat === "" ? null : <p className="reading-caveat"><strong>{readingCopy(locale, "context")}</strong> {caveatMessage(locale, finding.caveat)}</p>}
    <div className="reading-sources">
      {primary === undefined ? null : <a aria-label={`${readingCopy(locale, "source")}: ${primary}`} href={`#evidence-${primary}`}>{readingCopy(locale, "source")}</a>}
      {counter === undefined ? null : <a aria-label={`${readingCopy(locale, "counterSource")}: ${counter}`} href={`#evidence-${counter}`}>{readingCopy(locale, "counterSource")}</a>}
    </div>
  </article>;
}

export function ReportReadingGuide({ locale, report }: { locale: Locale; report: ReportSnapshot }): React.JSX.Element {
  const positive = report.positiveSignals[0];
  const caution = report.findings[0];
  const unscored = report.scoreKind === "facts_only" || report.scoreKind === "insufficient_evidence" || report.score === null;
  return <section aria-labelledby="reading-heading" className="report-reading-guide">
    <h2 id="reading-heading">{readingCopy(locale, "heading")}</h2>
    <p className="reading-intro">{readingCopy(locale, unscored ? "facts" : "intro")}</p>
    <nav aria-label={t(locale, "report.navigation")} className="reading-actions">
      <a className="reading-primary" href="#dimensions-heading">{readingCopy(locale, "openAnalysis")}</a>
      <a href="#evidence-heading">{readingCopy(locale, "openEvidence")}</a>
    </nav>
    <div className="reading-observations">
      {positive === undefined ? null : <KeyObservation finding={positive} locale={locale} tone="positive" />}
      {caution === undefined ? null : <KeyObservation finding={caution} locale={locale} tone="caution" />}
    </div>
    {positive === undefined ? <p className="reading-empty">{t(locale, "report.noPositive")}</p> : null}
    {caution === undefined ? <p className="reading-empty">{readingCopy(locale, "noCautionProof")}</p> : null}
    <p className="reading-counts">{findingCounts(locale, report.positiveSignals.length, report.findings.length)}</p>
    <div className="reading-data-context">
      <p><strong>{readingCopy(locale, "data")}:</strong> {t(locale, dataStatusKeys[report.dataStatus])}. {readingCopy(locale, "missing")}</p>
      {report.missingSignals.length === 0 ? null : <p>{readingCopy(locale, "gaps")} {report.missingSignals.slice(0, 2).map((signal) => observationLabel(locale, signal)).join(locale === "zh" ? "、" : "; ")}{report.missingSignals.length > 2 ? "…" : ""}</p>}
    </div>
  </section>;
}
