import type { ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale } from "@dayu/report-i18n";

const metrics = [
  ["stars", "report.metric.stars"],
  ["subscribers", "report.metric.watch"],
  ["forks", "report.metric.forks"],
] as const;

export function ReportOverview({ locale, report }: { locale: Locale; report: ReportSnapshot }): React.JSX.Element {
  const metadata = report.evidence.find((item) => item.fact.metric === "repository.metadata");
  const value = metadata?.value;
  const facts = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  return (
    <section aria-labelledby="overview-heading" className="report-overview">
      <div className="section-heading"><span>01</span><h2 id="overview-heading">{t(locale, "report.overview")}</h2></div>
      <dl className="observed-metrics">
        {metrics.map(([key, label]) => {
          const count = facts[key];
          return <div key={key}><dt>{t(locale, label)}</dt><dd>{typeof count === "number" && Number.isFinite(count) ? new Intl.NumberFormat(locale).format(count) : "—"}</dd></div>;
        })}
        <div><dt>{t(locale, "report.metric.evidence")}</dt><dd>{report.evidence.length}</dd></div>
      </dl>
      <p className="overview-note">{t(locale, "report.overviewContext")}{metadata === undefined ? null : <> <a href={`#evidence-${metadata.id}`}>{t(locale, "report.inspectSource")}</a></>}</p>
      <nav aria-label={t(locale, "report.navigation")} className="report-jump-links">
        <a href="#dimensions-heading">{t(locale, "report.dimensions")}</a>
        <a href="#findings-heading">{t(locale, "report.nav.findings")}</a>
        <a href="#coverage-heading">{t(locale, "report.coverage")}</a>
        <a href="#evidence-heading">{t(locale, "report.evidenceHeading")}</a>
      </nav>
    </section>
  );
}
