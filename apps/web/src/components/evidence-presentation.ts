import type { DataStatus, Evidence } from "@dayu/evidence-schema";
import type { Locale } from "@dayu/report-i18n";

type Translation = readonly [en: string, zh: string];

const labels: Readonly<Record<string, Translation>> = {
  "repository.metadata": ["Public repository metadata", "公开仓库信息"],
  "repository.default_branch": ["Default branch at collection", "采集时的默认分支"],
  "repository.default_commit": ["Pinned default-branch commit", "固定的默认分支提交"],
  "repository.branch": ["Default branch at collection", "采集时的默认分支"],
  "repository.tree": ["File tree at the pinned commit", "固定提交中的文件目录"],
  "repository.languages": ["Language totals", "语言用量"],
  "repository.community_profile": ["Community documentation", "社区协作文档"],
  "repository.issues": ["Sampled issues", "采样的 Issue"],
  "repository.pull_requests": ["Sampled pull requests", "采样的 Pull Request"],
  "repository.releases": ["Sampled releases", "采样的发布记录"],
  "repository.contributors": ["Anonymized contribution totals", "匿名化贡献统计"],
  "repository.file_content": ["Selected file content", "选取的文件内容"],
  "repository.stargazers_count": ["Stars at collection", "采集时的 Star 数"],
  "repository.subscribers_count": ["True watches at collection", "采集时的真实 Watch 数"],
  "repository.forks_count": ["Forks at collection", "采集时的 Fork 数"],
  bounded_first_page: ["Only the first page was collected", "只采集了第一页"],
  bounded_public_sample: ["Bounded public sample", "仅覆盖有限的公开样本"],
  github_tree_truncated: ["GitHub returned an incomplete file tree", "GitHub 返回的文件目录不完整"],
  negative_file_conclusions_disabled: ["Missing files cannot be inferred from this tree", "无法据此判断某个文件不存在"],
  github_rate_limit_exhausted: ["GitHub API rate limit reached", "GitHub API 额度已用尽"],
  github_endpoint_restricted: ["GitHub restricted this data source", "GitHub 限制了此数据源的访问"],
  github_endpoint_unavailable: ["This GitHub data source was unavailable", "此 GitHub 数据源暂不可用"],
  github_data_being_generated: ["GitHub was still preparing the data", "GitHub 仍在生成数据"],
  collector_budget_exhausted: ["Collection budget reached", "已达到本次采集上限"],
  github_request_timeout: ["GitHub request timed out", "GitHub 请求超时"],
  github_endpoint_incomplete: ["The request did not return complete data", "请求未返回完整数据"],
  github_response_invalid: ["The GitHub response could not be used", "GitHub 响应无法用于分析"],
  invalid_or_truncated_blob: ["File content was invalid or truncated", "文件内容无效或被截断"],
  releases: ["Release history", "发布历史"],
  "substance.complete_tree": ["A complete file tree", "完整文件目录"],
  "claims.complete_tree_and_readme": ["A complete file tree and README", "完整文件目录与 README"],
  "claims.release_evidence": ["Verifiable release evidence", "可核对的发布证据"],
  "claims.not_applicable": ["No applicable installation or release claim", "没有适用的安装或发布声明"],
  "maintenance.history": ["Maintenance history", "维护历史"],
  "maintenance.active_weeks": ["Complete weekly maintenance history", "完整的每周维护记录"],
  "maintenance.external_tracker_activity": ["Activity in external trackers", "外部协作平台中的活动"],
  "maintenance.issues_disabled": ["Issues are disabled for this repository", "此仓库未启用 Issue"],
  "community.issues_disabled": ["Issues are disabled for this repository", "此仓库未启用 Issue"],
  "community.external_tracker": ["Discussion on external platforms", "外部平台上的讨论"],
  "community.human_activity": ["Human collaboration activity", "人工协作活动"],
  "taxonomy.low_confidence": ["A reliable repository type classification", "足够可靠的仓库类型判断"],
  "popularity.cohort_signals": ["Comparable popularity signals", "可用于比较的热度信号"],
  "popularity.forks": ["Fork-to-star comparison", "Fork 与 Star 的比较"],
  "popularity.subscribers": ["Watch-to-star comparison", "Watch 与 Star 的比较"],
  "popularity.contributors": ["Contributor-to-star comparison", "贡献者与 Star 的比较"],
  "popularity.human_activity": ["Collaboration-to-star comparison", "协作活动与 Star 的比较"],
};

const kinds: Record<Evidence["kind"], Translation> = {
  metadata: ["Metadata", "仓库信息"], file: ["File", "文件"], commit: ["Commit", "提交"],
  release: ["Release", "发布"], issue: ["Issue", "Issue"], pull_request: ["Pull request", "Pull Request"],
  community: ["Community", "社区"], derived: ["Derived observation", "衍生观察"],
};

export const evidenceStatuses = ["complete", "partial", "restricted", "unverifiable", "not_applicable"] as const;
const statuses: Record<DataStatus, Translation> = {
  complete: ["Complete", "已采集"], partial: ["Partial", "部分采集"], restricted: ["Restricted", "访问受限"],
  unverifiable: ["Unverifiable", "无法核对"], not_applicable: ["Not applicable", "不适用"],
};

export const explorerCopy = {
  search: ["Search evidence", "搜索证据"],
  searchHint: ["Evidence ID, source, or content", "证据 ID、来源或内容"],
  filters: ["Evidence filters", "证据筛选"],
  all: ["All", "全部"], referenced: ["Referenced", "被引用"], limited: ["With limitations", "有限制"],
  reset: ["Reset filters", "重置筛选"],
  empty: ["No evidence matches these filters.", "没有符合筛选条件的证据。"],
  details: ["Inspect original record", "展开原始记录"],
  original: ["Original public observation", "原始公开观察"],
  recordNote: ["Original source text is shown verbatim as data, not instructions.", "以下保留原始记录文字，作为数据展示。"],
  collection: ["Collected evidence", "已记录的证据"],
  collectionNote: ["These are counts of stored observations, separate from heuristic analysis confidence. Neither measures accuracy.", "这里按实际记录统计，与启发式分析置信度分别展示，两者都不代表准确率。"],
  completeNote: ["Complete means the selected observation was collected. Sampling limits may still apply.", "“已采集”表示选取的观察已记录，仍可能存在采样范围限制。"],
  noRecords: ["No observations were stored.", "尚未保存观察记录。"],
} as const satisfies Record<string, Translation>;

export function evidenceCopy(locale: Locale, key: keyof typeof explorerCopy): string {
  return explorerCopy[key][locale === "zh" ? 1 : 0];
}

export function observationLabel(locale: Locale, value: string): string {
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value]?.[locale === "zh" ? 1 : 0] ?? value : value;
}

export function evidenceKindLabel(locale: Locale, kind: Evidence["kind"]): string { return kinds[kind][locale === "zh" ? 1 : 0]; }
export function evidenceStatusLabel(locale: Locale, status: DataStatus): string { return statuses[status][locale === "zh" ? 1 : 0]; }

export function evidenceTitle(locale: Locale, evidence: Evidence): string {
  const label = observationLabel(locale, evidence.fact.metric);
  return label === evidence.fact.metric ? evidence.summary : label;
}

export function sourcePath(evidence: Evidence): string {
  return evidence.source.kind === "file" ? evidence.source.path : evidence.source.endpoint;
}

export function isLimitedEvidence(evidence: Evidence): boolean {
  return evidence.limitations.length > 0 || evidence.status === "partial" || evidence.status === "restricted" || evidence.status === "unverifiable";
}

export function evidenceCountLabel(locale: Locale, shown: number, total: number): string {
  return locale === "zh" ? `显示 ${String(shown)} / ${String(total)} 条证据` : `Showing ${String(shown)} of ${String(total)} observations`;
}

export function evidenceStatusCounts(evidence: readonly Evidence[]): Record<DataStatus, number> {
  const counts: Record<DataStatus, number> = { complete: 0, partial: 0, restricted: 0, unverifiable: 0, not_applicable: 0 };
  for (const item of evidence) counts[item.status] += 1;
  return counts;
}
