import type { ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale, type MessageKey } from "@dayu/report-i18n";

const dimensions = [
  { key: "popularity", label: "report.dimension.popularity", weight: 25 },
  { key: "substance", label: "report.dimension.substance", weight: 25 },
  { key: "maintenance", label: "report.dimension.maintenance", weight: 20 },
  { key: "community", label: "report.dimension.community", weight: 15 },
  { key: "claims", label: "report.dimension.claims", weight: 15 },
] as const satisfies readonly { key: keyof ReportSnapshot["dimensionScores"]; label: MessageKey; weight: number }[];

export function DimensionList({ locale, report }: { locale: Locale; report: ReportSnapshot }): React.JSX.Element {
  return (
    <section aria-labelledby="dimensions-heading" className="dimension-section">
      <div className="section-heading"><span>03</span><h2 id="dimensions-heading">{t(locale, "report.dimensions")}</h2></div>
      <ol className="dimension-list">
        {dimensions.map(({ key, label, weight }) => {
          const score = report.dimensionScores[key];
          return (
            <li key={key}>
              <div className="dimension-copy">
                <strong>{t(locale, label)}</strong>
                <span>{t(locale, "report.weight", { weight })}</span>
              </div>
              {score === null
                ? <span aria-hidden="true" className="dimension-unavailable-track" />
                : (
                    <meter
                      aria-label={`${t(locale, label)}: ${String(score)}`}
                      className="dimension-meter"
                      max={100}
                      min={0}
                      value={score}
                    />
                  )}
              <output className={score === null ? "dimension-unavailable" : undefined}>
                {score ?? t(locale, "report.dimensionUnavailable")}
              </output>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
