import { t, type Locale } from "@dayu/report-i18n";

import type { EnhancedMetadata } from "../api/copilot.js";

export interface EnhancedDeltaProps {
  enhancedScore: number | null;
  locale: Locale;
  metadata: EnhancedMetadata;
  rulesScore: number | null;
  unchanged?: boolean;
}

export function EnhancedDelta({ enhancedScore, locale, metadata, rulesScore, unchanged = false }: EnhancedDeltaProps): React.JSX.Element {
  return (
    <section aria-labelledby="enhanced-delta-title" className="enhanced-delta">
      <div className="section-heading"><span>AI</span><h2 id="enhanced-delta-title">{t(locale, unchanged ? "copilot.unchanged.title" : "copilot.delta.title")}</h2></div>
      {unchanged ? <p className="overview-note">{t(locale, "copilot.unchanged.body")}</p> : <div className="delta-scoreline">
        <div><span>{t(locale, "copilot.delta.rules")}</span><strong>{rulesScore ?? "—"}</strong></div>
        <span aria-hidden="true" className="delta-arrow" />
        <div><span>{t(locale, "copilot.delta.enhanced")}</span><strong>{enhancedScore ?? "—"}</strong></div>
      </div>}
      <dl className="copilot-versions">
        <div><dt>{t(locale, "copilot.delta.model")}</dt><dd><code>{metadata.model}</code></dd></div>
        <div><dt>{t(locale, "copilot.delta.prompt")}</dt><dd><code>{metadata.promptVersion}</code></dd></div>
        <div><dt>{t(locale, "copilot.delta.rubric")}</dt><dd><code>{metadata.rubricVersion}</code></dd></div>
      </dl>
      <h3>{t(locale, "copilot.findings.label")}</h3>
      {metadata.findings.length === 0 ? <p>{t(locale, "copilot.findings.empty")}</p> : (
        <ol className="copilot-finding-list">
          {metadata.findings.map((finding) => (
            <li key={finding.rubricId}>
              <span>{t(locale, "report.producer.copilot")}</span>
              <p>{locale === "zh" ? finding.zh : finding.en}</p>
              <small>{finding.rubricId}</small>
              <div className="copilot-evidence-links">{[...new Set([...finding.evidenceIds, ...finding.counterEvidenceIds])].map((id) => <a aria-label={t(locale, "report.viewEvidence", { id })} href={`#evidence-${id}`} key={id}>{id}</a>)}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
