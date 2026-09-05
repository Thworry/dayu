import type { Locale } from "@dayu/report-i18n";

const copy = {
  heading: ["Start with the main observations", "先看主要发现"],
  intro: ["Read these observations first. Open the analysis or follow a source when you want to check the details.", "先看下面的主要发现。想了解判断过程，再展开详细分析；想自己核对，就点“查看依据”。"],
  facts: ["This report withholds an overall score. You can still read the public observations and check their sources.", "这份报告暂不提供综合分数。你仍可查看公开观察，并核对来源。"],
  positive: ["A supportive observation", "一项支持信号"],
  caution: ["An observation to check", "一项需核对的信号"],
  source: ["Check the source", "查看依据"],
  counterSource: ["Check the counter-evidence", "查看反向依据"],
  context: ["Keep in mind:", "理解背景："],
  noCautionProof: ["No separate caution was recorded. This does not establish the repository’s quality or authenticity.", "本次没有记录单独的警示发现，这不代表已确认仓库质量或真实性。"],
  missing: ["Missing data reduces coverage; it does not increase risk.", "缺失数据会降低覆盖度，不会提高风险。"],
  data: ["Data status", "数据状态"],
  gaps: ["Still missing:", "尚缺："],
  openAnalysis: ["Open detailed analysis", "查看详细分析"],
  openEvidence: ["Check the evidence", "核对证据来源"],
  analysis: ["Detailed analysis", "详细分析"],
  analysisNote: ["Five dimensions, all findings, and data coverage", "五个维度、全部发现与数据覆盖"],
  evidence: ["Evidence and original records", "证据与原始记录"],
  evidenceNote: ["Search observations and inspect their sources", "搜索公开观察，查看原始来源"],
  technical: ["Collection and scoring details", "采集与评分详情"],
  preview: ["Experimental rules; real-world calibration is incomplete.", "规则仍处于研究阶段，尚未完成真实数据校准。"],
} as const satisfies Record<string, readonly [en: string, zh: string]>;

export function readingCopy(locale: Locale, key: keyof typeof copy): string { return copy[key][locale === "zh" ? 1 : 0]; }

export function findingCounts(locale: Locale, positive: number, caution: number): string {
  return locale === "zh" ? `完整报告中有 ${String(positive)} 项支持信号、${String(caution)} 项需核对信号。`
    : `The full report contains ${String(positive)} supportive observation${positive === 1 ? "" : "s"} and ${String(caution)} observation${caution === 1 ? "" : "s"} to check.`;
}
