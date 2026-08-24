import type { ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale, type MessageKey } from "@dayu/report-i18n";

const statusKeys = {
  complete: "report.status.complete",
  not_applicable: "report.status.not_applicable",
  partial: "report.status.partial",
  restricted: "report.status.restricted",
  unverifiable: "report.status.unverifiable",
} as const satisfies Record<ReportSnapshot["dataStatus"], MessageKey>;

export function DataCoverage({ locale, report }: { locale: Locale; report: ReportSnapshot }): React.JSX.Element {
  return (
    <section aria-labelledby="coverage-heading" className="coverage-section">
      <div className="section-heading"><span>04</span><h2 id="coverage-heading">{t(locale, "report.coverage")}</h2></div>
      <div className="coverage-grid">
        <div>
          <h3>{t(locale, "report.dataStatus")}</h3>
          <p className={`status-line is-${report.dataStatus}`}><span aria-hidden="true" />{t(locale, statusKeys[report.dataStatus])}</p>
        </div>
        <div>
          <h3>{t(locale, "report.missingSignals")}</h3>
          {report.missingSignals.length === 0
            ? <p>{t(locale, "report.noMissingSignals")}</p>
            : <ul>{report.missingSignals.map((signal) => <li key={signal}><code>{signal}</code></li>)}</ul>}
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
