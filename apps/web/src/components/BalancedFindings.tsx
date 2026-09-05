import type { Finding, ReportSnapshot } from "@dayu/evidence-schema";
import { caveatMessage, findingMessage, t, type Locale } from "@dayu/report-i18n";

function FindingItem({ finding, locale, tone }: { finding: Finding; locale: Locale; tone: "caution" | "positive" }): React.JSX.Element {
  return (
    <li className={`finding-item is-${tone}`}>
      <span aria-hidden="true" className="finding-symbol">{tone === "positive" ? "+" : "!"}</span>
      <div>
        {finding.producer === "copilot" ? <span className="finding-producer">{t(locale, "report.producer.copilot")}</span> : null}
        <h3>{findingMessage(locale, finding.titleKey, tone === "positive" ? "positiveTitle" : "cautionTitle")}</h3>
        <p>{findingMessage(locale, finding.explanationKey, tone === "positive" ? "positiveExplanation" : "cautionExplanation")}</p>
        {finding.caveat === "" ? null : <p className="finding-caveat"><strong>{t(locale, "report.caveat")}</strong> {caveatMessage(locale, finding.caveat)}</p>}
        <dl>
          <div><dt>{t(locale, "report.dimensionRisk")}</dt><dd>{String(finding.risk)} / 100</dd></div>
          <div>
            <dt>{t(locale, "report.evidenceReferences")}</dt>
            <dd>{finding.evidenceIds.map((id) => <a aria-label={t(locale, "report.viewEvidence", { id })} href={`#evidence-${id}`} key={id}><span aria-hidden="true">{id}</span></a>)}</dd>
          </div>
          {finding.counterEvidenceIds.length === 0 ? null : (
            <div>
              <dt>{t(locale, "report.counterEvidenceReferences")}</dt>
              <dd>{finding.counterEvidenceIds.map((id) => <a aria-label={t(locale, "report.viewEvidence", { id })} href={`#evidence-${id}`} key={id}><span aria-hidden="true">{id}</span></a>)}</dd>
            </div>
          )}
        </dl>
      </div>
    </li>
  );
}

function FindingColumn({ findings, heading, locale, tone }: { findings: Finding[]; heading: string; locale: Locale; tone: "caution" | "positive" }): React.JSX.Element {
  return (
    <section className={`finding-column is-${tone}`}>
      <h3><span aria-hidden="true">{tone === "positive" ? "+" : "!"}</span>{heading}</h3>
      {findings.length === 0
        ? <p className="empty-finding">{t(locale, tone === "positive" ? "report.noPositive" : "report.noCaution")}</p>
        : <ol>{findings.map((finding) => <FindingItem finding={finding} key={finding.id} locale={locale} tone={tone} />)}</ol>}
    </section>
  );
}

export function BalancedFindings({ locale, report }: { locale: Locale; report: ReportSnapshot }): React.JSX.Element {
  return (
    <section aria-labelledby="findings-heading" className="findings-section">
      <div className="section-heading"><span>03</span><h2 id="findings-heading">{t(locale, "report.positiveHeading")} / {t(locale, "report.cautionHeading")}</h2></div>
      <div className="balanced-findings">
        <FindingColumn findings={report.positiveSignals} heading={t(locale, "report.positiveHeading")} locale={locale} tone="positive" />
        <FindingColumn findings={report.findings} heading={t(locale, "report.cautionHeading")} locale={locale} tone="caution" />
      </div>
    </section>
  );
}
