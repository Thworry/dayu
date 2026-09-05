import { reportSnapshotSchema } from "@dayu/evidence-schema/report";
import type { Locale } from "@dayu/report-i18n";

import { SiteShell } from "../components/SiteShell.js";
import { isStaticPreview } from "../app/build-mode.js";
import { previewPath } from "../app/preview-navigation.js";
import sample from "../data/dayu-sample.json";
import { ReportPage } from "./ReportPage.js";

// A pinned public self-observation. No API, session, or live scan is involved.
const report = reportSnapshotSchema.parse({
  ...sample,
  scoreKind: "facts_only",
  score: null,
  baseScore: null,
  enrichedScore: null,
  copilot: undefined,
  promptVersion: undefined,
});

export function SamplePage({ locale }: { locale: Locale }): React.JSX.Element {
  const captured = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(report.createdAt));
  return (
    <SiteShell locale={locale} repositoryPath="/sample">
      <section aria-label={locale === "zh" ? "关于这份样例" : "About this sample"} className="sample-notice">
        <div>
          <p className="sample-notice-label">{locale === "zh" ? "公开自检样例 · 历史快照" : "Public self-check · saved snapshot"}</p>
          <p>{locale === "zh" ? "先读简短发现，有疑问再展开。规则尚未校准，样例不展示综合分数。" : "Start with the observations and open details as needed. The rules are uncalibrated, so this sample withholds the overall score."}</p>
          <p className="sample-capture">{locale === "zh" ? "采集于" : "Captured"} <time dateTime={report.createdAt}>{captured} UTC</time>{locale === "zh" ? "，并非实时结果。" : "; not a live result."}</p>
        </div>
        <div className="sample-local-guide">
          <a className="sample-start" href="#reading-heading">{locale === "zh" ? "开始阅读报告 ↓" : "Start reading the report ↓"}</a>
          <a href={isStaticPreview ? previewPath(locale, "home") : `/${locale}`}>{locale === "zh" ? "← 返回首页" : "← Back to home"}</a>
          <small>{locale === "zh" ? "这是历史样例，不会发起新扫描。" : "This is a saved sample, not a new scan."}</small>
        </div>
      </section>
      <ReportPage locale={locale} report={report} sample />
    </SiteShell>
  );
}
