import type { ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale, type MessageKey } from "@dayu/report-i18n";

import { evidenceCopy, evidenceStatuses, evidenceStatusCounts, evidenceStatusLabel, observationLabel } from "./evidence-presentation.js";
import "../styles/evidence-explorer.css";

const statusKeys = {
  complete: "report.status.complete",
  not_applicable: "report.status.not_applicable",
  partial: "report.status.partial",
  restricted: "report.status.restricted",
  unverifiable: "report.status.unverifiable",
} as const satisfies Record<ReportSnapshot["dataStatus"], MessageKey>;

export function DataCoverage({ locale, report }: { locale: Locale; report: ReportSnapshot }): React.JSX.Element {
  const counts = evidenceStatusCounts(report.evidence);
  const total = report.evidence.length;
  const distribution = evidenceStatuses.map((status, index) => ({
    status,
    width: total === 0 ? 0 : counts[status] / total * 100,
    start: total === 0 ? 0 : evidenceStatuses.slice(0, index).reduce((sum, previous) => sum + counts[previous], 0) / total * 100,
  }));
  return (
    <section aria-labelledby="coverage-heading" className="coverage-section" id="coverage">
      <div className="section-heading"><span>04</span><h2 id="coverage-heading">{t(locale, "report.coverage")}</h2></div>
      <div className="evidence-coverage">
        <h3>{evidenceCopy(locale, "collection")} <span>{total}</span></h3>
        <p>{evidenceCopy(locale, "collectionNote")}</p>
        {total === 0 ? <p>{evidenceCopy(locale, "noRecords")}</p> : <svg aria-hidden="true" className="evidence-distribution" preserveAspectRatio="none" viewBox="0 0 100 8">
          {distribution.filter((segment) => segment.width > 0).map(({ status, start, width }) => <rect className={`is-${status}`} height={8} key={status} width={width} x={start} y={0} />)}
        </svg>}
        <dl className="evidence-status-counts">
          {evidenceStatuses.map((status) => <div className={`is-${status}`} key={status}><dt><span aria-hidden="true" />{evidenceStatusLabel(locale, status)}</dt><dd>{counts[status]}</dd></div>)}
        </dl>
        <p className="evidence-coverage-note">{evidenceCopy(locale, "completeNote")}</p>
      </div>
      <div className="coverage-grid">
        <div>
          <h3>{t(locale, "report.dataStatus")}</h3>
          <p className={`status-line is-${report.dataStatus}`}><span aria-hidden="true" />{t(locale, statusKeys[report.dataStatus])}</p>
        </div>
        <div>
          <h3>{t(locale, "report.missingSignals")}</h3>
          {report.missingSignals.length === 0
            ? <p>{t(locale, "report.noMissingSignals")}</p>
            : <ul>{report.missingSignals.map((signal) => <li key={signal}>{observationLabel(locale, signal)}</li>)}</ul>}
        </div>
        <div>
          <h3>{t(locale, "report.versions")}</h3>
          <dl>
            <div><dt>{t(locale, "report.version.collector")}</dt><dd><code>{report.collectorVersion}</code></dd></div>
            <div><dt>{t(locale, "report.version.rules")}</dt><dd><code>{report.rulesVersion}</code></dd></div>
            <div><dt>{t(locale, "report.version.report")}</dt><dd><code>{report.reportVersion}</code></dd></div>
            {report.promptVersion === undefined ? null : <div><dt>{t(locale, "report.version.prompt")}</dt><dd><code>{report.promptVersion}</code></dd></div>}
          </dl>
        </div>
      </div>
    </section>
  );
}
