import type { ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale, type MessageKey } from "@dayu/report-i18n";
import { useEffect, useRef, useState } from "react";

import { createScanApi, isScanFailure, pollScan, throwIfAborted, type PublicErrorCode, type ScanApi, type ScanStage } from "../api/scans.js";
import { PartialEvidence } from "../components/PartialEvidence.js";
import { RepositoryForm } from "../components/RepositoryForm.js";
import { ScanProgress } from "../components/ScanProgress.js";
import { SiteShell } from "../components/SiteShell.js";

export type ScanViewState =
  | { kind: "idle" }
  | { kind: "running"; jobId: string; stage: Exclude<ScanStage, "failed"> }
  | { kind: "report"; jobId?: string; report: ReportSnapshot }
  | { kind: "error"; code: PublicErrorCode; partial?: ReportSnapshot; resetAt?: string };

export interface HomePageProps {
  api?: ScanApi;
  locale: Locale;
  onReportRoute?: (path: string, report: ReportSnapshot, errorCode?: PublicErrorCode, jobId?: string) => void;
}

const defaultScanApi = createScanApi();

const discoveryCopy = {
  en: {
    sample: "Explore a sample report",
    sampleNote: "A saved DAYU self-check. No sign-in needed.",
    process: "From repository to evidence",
    steps: [
      { title: "Name a public repo", body: "Start with a GitHub URL. The basic report works without Copilot." },
      { title: "Read the signals", body: "Compare five dimensions, with missing data and limits in view." },
      { title: "Follow the evidence", body: "Open the sources behind each finding and make your own call." },
    ],
  },
  zh: {
    sample: "先看看样例报告",
    sampleNote: "DAYU 的一次公开自检，无需登录。",
    process: "从一个仓库，到一份有据可查的报告",
    steps: [
      { title: "贴一个公开仓库", body: "输入 GitHub 地址即可开始。基础报告无需 Copilot。" },
      { title: "看看信号是否一致", body: "五个维度放在一起看，缺了什么数据、有哪些局限，一并说明。" },
      { title: "顺着证据自己判断", body: "每条发现都能追溯来源，值得深挖的地方，由你做判断。" },
    ],
  },
} as const;

const errorKeys: Record<PublicErrorCode, MessageKey> = {
  github_rate_limited: "error.github_rate_limited",
  insufficient_evidence: "error.insufficient_evidence",
  internal_failure: "error.internal_failure",
  invalid_repository: "error.invalid_repository",
  private_or_unavailable: "error.private_or_unavailable",
  request_rate_limited: "error.request_rate_limited_unknown",
  scan_not_found: "error.scan_not_found",
  scan_not_ready: "error.scan_not_ready",
};

export function repositoryRoute(locale: Locale, repository: string): string {
  const withoutQuery = repository.trim().replace(/^https?:\/\/(?:www\.)?github\.com\//i, "").split(/[?#]/u)[0] ?? "";
  const [owner = "", repoWithSuffix = ""] = withoutQuery.split("/");
  const repo = repoWithSuffix.replace(/\.git$/i, "");
  return `/${locale}/r/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function localizedFailure(locale: Locale, state: Extract<ScanViewState, { kind: "error" }>): string {
  if (state.code === "request_rate_limited" && state.resetAt !== undefined) {
    const reset = new Date(state.resetAt);
    if (!Number.isNaN(reset.getTime())) {
      const resetAt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(reset);
      return t(locale, "error.request_rate_limited", { resetAt });
    }
  }
  return t(locale, errorKeys[state.code]);
}

function isAbort(value: unknown): boolean {
  return value instanceof DOMException && value.name === "AbortError";
}

export function HomePage({ api = defaultScanApi, locale, onReportRoute }: HomePageProps): React.JSX.Element {
  const [repository, setRepository] = useState("");
  const [state, setState] = useState<ScanViewState>({ kind: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);
  useEffect(() => {
    if (state.kind === "error") errorRef.current?.focus();
  }, [state]);

  async function submit(): Promise<void> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitting(true);
    setState({ kind: "idle" });
    let currentJobId: string | undefined;
    try {
      const created = await api.createScan({ locale, repository }, controller.signal);
      currentJobId = created.jobId;
      throwIfAborted(controller.signal);
      const initialStage = created.stage === "failed" ? "validated" : created.stage;
      setState({ jobId: created.jobId, kind: "running", stage: initialStage });
      const report = await pollScan(api, created.jobId, {
        onStage(stage) {
          if (stage !== "failed") setState({ jobId: created.jobId, kind: "running", stage });
        },
        signal: controller.signal,
      });
      throwIfAborted(controller.signal);
      setState({ jobId: created.jobId, kind: "report", report });
      onReportRoute?.(repositoryRoute(locale, repository), report, undefined, created.jobId);
    } catch (reason) {
      if (controller.signal.aborted || isAbort(reason)) return;
      if (isScanFailure(reason)) {
        const errorState: Extract<ScanViewState, { kind: "error" }> = {
          code: reason.code,
          kind: "error",
          ...(reason.partial === undefined ? {} : { partial: reason.partial }),
          ...(reason.resetAt === undefined ? {} : { resetAt: reason.resetAt }),
        };
        setState(errorState);
        if (reason.partial !== undefined) {
          throwIfAborted(controller.signal);
          onReportRoute?.(repositoryRoute(locale, reason.partial.repository.fullName), reason.partial, reason.code, currentJobId);
        }
      } else {
        setState({ code: "internal_failure", kind: "error" });
      }
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  const errorId = state.kind === "error" ? "scan-error" : undefined;
  const discovery = discoveryCopy[locale];
  return (
    <SiteShell locale={locale}>
      <main className="home-main" id="main-content" tabIndex={-1}>
        <section className="hero-copy">
          <p className="eyebrow"><span aria-hidden="true" />{t(locale, "home.eyebrow")}</p>
          <h1 className={locale === "zh" ? "hero-title-zh" : "hero-title-en"}>{locale === "zh" ? <><span>给 GitHub 项目</span><span>测测含水量</span></> : t(locale, "home.title")}</h1>
          <p className="hero-body">{t(locale, "home.body")}</p>
          <RepositoryForm
            {...(errorId === undefined ? {} : { errorId })}
            locale={locale}
            onRepositoryChange={setRepository}
            onSubmit={() => { void submit(); }}
            repository={repository}
            submitting={submitting}
          />
          <div className="sample-entry">
            <a href={`/${locale}/sample`}>{discovery.sample}<span aria-hidden="true">↗</span></a>
            <p>{discovery.sampleNote}</p>
          </div>
          {state.kind === "error" ? (
            <div className="error-summary" id="scan-error" ref={errorRef} role="alert" tabIndex={-1}>
              <strong>{t(locale, "error.summary")}</strong>
              <p>{localizedFailure(locale, state)}</p>
              {state.partial !== undefined ? (
                <a href="#evidence">
                  {t(locale, "scan.partialEvidence")}
                </a>
              ) : null}
            </div>
          ) : null}
          {state.kind === "error" && state.partial !== undefined ? <PartialEvidence locale={locale} report={state.partial} /> : null}
          {state.kind === "running" ? <ScanProgress locale={locale} stage={state.stage} /> : null}
          {state.kind === "report" && onReportRoute === undefined ? (
            <div className="ready-summary" role="status"><strong>{t(locale, "scan.ready")}</strong></div>
          ) : null}
        </section>
        <aside aria-label={t(locale, "home.gaugeLabel")} className="waterline-instrument">
          <div className="instrument-grid" aria-hidden="true">
            <span className="water-fill" />
            <span className="gauge-axis" />
            <span className="gauge-sensor" />
            <span className="gauge-label top">{t(locale, "home.gaugeTop")}</span>
            <span className="gauge-label middle">{t(locale, "home.gaugeMiddle")}</span>
            <span className="gauge-label bottom">{t(locale, "home.gaugeBottom")}</span>
          </div>
          <dl className="signal-list">
            <div><dt>{t(locale, "home.signal.public")}</dt><dd>{t(locale, "home.signal.publicNote")}</dd></div>
            <div><dt>{t(locale, "home.signal.evidence")}</dt><dd>{t(locale, "home.signal.evidenceNote")}</dd></div>
            <div><dt>{t(locale, "home.signal.ai")}</dt><dd>{t(locale, "home.signal.aiNote")}</dd></div>
          </dl>
        </aside>
        <section aria-labelledby="home-process-heading" className="home-process">
          <h2 id="home-process-heading">{discovery.process}</h2>
          <ol>
            {discovery.steps.map((step, index) => (
              <li key={step.title}>
                <span aria-hidden="true" className="process-number">0{index + 1}</span>
                <div><h3>{step.title}</h3><p>{step.body}</p></div>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </SiteShell>
  );
}
