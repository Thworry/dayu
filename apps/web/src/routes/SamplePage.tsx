import { reportSnapshotSchema } from "@dayu/evidence-schema/report";
import type { Locale } from "@dayu/report-i18n";

import { SiteShell } from "../components/SiteShell.js";
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
          <p>{locale === "zh" ? "浏览 DAYU 自己的公开数据，体验完整报告。规则尚未校准，样例不展示综合分数。" : "Explore DAYU’s own public data in a complete report. The rules are uncalibrated, so this sample withholds the overall score."}</p>
          <p className="sample-capture">{locale === "zh" ? "采集于" : "Captured"} <time dateTime={report.createdAt}>{captured} UTC</time>{locale === "zh" ? "，并非实时结果。" : "; not a live result."}</p>
        </div>
        <div className="sample-local-guide">
          <p>{locale === "zh" ? "扫描你关心的仓库" : "Check a repository yourself"}</p>
          <code>pnpm demo</code>
          <a href="https://github.com/Thworry/dayu#quick-start">{locale === "zh" ? "查看本地运行指南" : "Local setup guide"}<span aria-hidden="true">↗</span></a>
          <small>{locale === "zh" ? "此预览不连接扫描或登录服务。" : "This preview does not connect to scan or sign-in services."}</small>
        </div>
      </section>
      <ReportPage locale={locale} report={report} sample />
    </SiteShell>
  );
}
