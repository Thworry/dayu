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
  | { kind: "report"; report: ReportSnapshot }
  | { kind: "error"; code: PublicErrorCode; partial?: ReportSnapshot; resetAt?: string };

export interface HomePageProps {
  api?: ScanApi;
  locale: Locale;
  onReportRoute?: (path: string, report: ReportSnapshot, errorCode?: PublicErrorCode) => void;
}

const defaultScanApi = createScanApi();

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
    try {
      const created = await api.createScan({ locale, repository }, controller.signal);
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
      setState({ kind: "report", report });
      onReportRoute?.(repositoryRoute(locale, repository), report);
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
          onReportRoute?.(repositoryRoute(locale, reason.partial.repository.fullName), reason.partial, reason.code);
        }
      } else {
        setState({ code: "internal_failure", kind: "error" });
      }
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  const errorId = state.kind === "error" ? "scan-error" : undefined;
  return (
    <SiteShell locale={locale}>
      <main className="home-main">
        <section className="hero-copy">
          <p className="eyebrow"><span aria-hidden="true" />{t(locale, "home.eyebrow")}</p>
          <h1>{t(locale, "home.title")}</h1>
          <p className="hero-body">{t(locale, "home.body")}</p>
          <RepositoryForm
            {...(errorId === undefined ? {} : { errorId })}
            locale={locale}
            onRepositoryChange={setRepository}
            onSubmit={() => { void submit(); }}
            repository={repository}
            submitting={submitting}
          />
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
      </main>
    </SiteShell>
  );
}
