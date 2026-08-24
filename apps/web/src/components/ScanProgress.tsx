import { t, type Locale, type MessageKey } from "@dayu/report-i18n";

import type { ScanStage } from "../api/scans.js";

export interface ScanProgressProps {
  locale: Locale;
  stage: Exclude<ScanStage, "failed">;
}

const steps: readonly { key: MessageKey; stage: Exclude<ScanStage, "enriched" | "failed"> }[] = [
  { key: "scan.stage.identify", stage: "validated" },
  { key: "scan.stage.collect", stage: "collected" },
  { key: "scan.stage.check", stage: "scored" },
  { key: "scan.stage.build", stage: "rendered" },
];

const stageOrder: Record<Exclude<ScanStage, "failed">, number> = {
  collected: 1,
  enriched: 2,
  rendered: 3,
  scored: 2,
  validated: 0,
};

export function ScanProgress({ locale, stage }: ScanProgressProps): React.JSX.Element {
  const activeIndex = stageOrder[stage];
  return (
    <section aria-label={t(locale, "scan.progressLabel")} aria-live="polite" className="scan-progress">
      <div aria-hidden="true" className="scan-waterline" data-stage={activeIndex} />
      <ol>
        {steps.map((step, index) => (
          <li
            aria-current={index === activeIndex ? "step" : undefined}
            className={index < activeIndex ? "is-complete" : index === activeIndex ? "is-current" : undefined}
            key={step.stage}
          >
            <span aria-hidden="true" className="step-index">{String(index + 1).padStart(2, "0")}</span>
            <span>{t(locale, step.key)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
