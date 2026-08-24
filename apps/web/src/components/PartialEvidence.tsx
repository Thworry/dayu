import type { ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale } from "@dayu/report-i18n";

export function PartialEvidence({ locale, report }: { locale: Locale; report: ReportSnapshot }): React.JSX.Element {
  return (
    <section className="partial-evidence" id="evidence" tabIndex={-1}>
      <h2>{t(locale, "scan.partialHeading")}</h2>
      <p>{t(locale, "scan.partialBody")}</p>
      <ol>
        {report.evidence.map((item) => (
          <li id={item.id} key={item.id}>
            <code>{item.id}</code>
            <span>{item.fact.metric}</span>
            <time dateTime={item.observedAt}>{item.observedAt}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
