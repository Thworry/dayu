import type { ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale } from "@dayu/report-i18n";
import { useEffect, useState } from "react";

import { createScanApi, isScanFailure, pollScan, throwIfAborted, type PublicErrorCode, type ScanApi } from "../api/scans.js";
import { PartialEvidence } from "../components/PartialEvidence.js";
import { ScanProgress } from "../components/ScanProgress.js";
import { SiteShell } from "../components/SiteShell.js";
import { localizedFailure, type ScanViewState } from "./HomePage.js";
import { ReportPage } from "./ReportPage.js";

export interface ScanPageProps {
  api?: ScanApi;
  initialReport?: ReportSnapshot;
  initialErrorCode?: PublicErrorCode;
  initialJobId?: string;
  locale: Locale;
  owner: string;
  repo: string;
}

const defaultScanApi = createScanApi();

export function ScanPage({ api = defaultScanApi, initialErrorCode, initialJobId, initialReport, locale, owner, repo }: ScanPageProps): React.JSX.Element {
  const repository = `${owner}/${repo}`;
  const [state, setState] = useState<ScanViewState>(() => initialReport === undefined
    ? { kind: "idle" }
    : initialErrorCode === undefined
      ? { ...(initialJobId === undefined ? {} : { jobId: initialJobId }), kind: "report", report: initialReport }
      : { code: initialErrorCode, kind: "error", partial: initialReport });

  useEffect(() => {
    if (initialReport !== undefined) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const created = await api.createScan({ locale, repository }, controller.signal);
        throwIfAborted(controller.signal);
        setState({ jobId: created.jobId, kind: "running", stage: created.stage === "failed" ? "validated" : created.stage });
        const report = await pollScan(api, created.jobId, {
          onStage(stage) {
            if (stage !== "failed") setState({ jobId: created.jobId, kind: "running", stage });
          },
          signal: controller.signal,
        });
        throwIfAborted(controller.signal);
        setState({ jobId: created.jobId, kind: "report", report });
      } catch (reason) {
        if (controller.signal.aborted || (reason instanceof DOMException && reason.name === "AbortError")) return;
        if (isScanFailure(reason)) {
          setState({ code: reason.code, kind: "error", ...(reason.partial === undefined ? {} : { partial: reason.partial }), ...(reason.resetAt === undefined ? {} : { resetAt: reason.resetAt }) });
        } else {
          setState({ code: "internal_failure", kind: "error" });
        }
      }
    })();
    return () => { controller.abort(); };
  }, [api, initialReport, locale, repository]);

  return (
    <SiteShell
      locale={locale}
      {...(state.kind === "report" ? { navigationState: { report: state.report, ...(state.jobId === undefined ? {} : { jobId: state.jobId }) } } : {})}
      repositoryPath={`/r/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`}
    >
      {state.kind === "report" ? <ReportPage {...(state.jobId === undefined ? {} : { jobId: state.jobId })} locale={locale} onEnhanced={(enhanced) => {
        const nextState = { ...(state.jobId === undefined ? {} : { jobId: state.jobId }), kind: "report" as const, report: enhanced };
        setState(nextState);
      }} report={state.report} /> : (
      <main className="scan-main">
        <p className="eyebrow"><span aria-hidden="true" />{t(locale, "home.eyebrow")}</p>
        <h1>{t(locale, "scan.heading", { repository })}</h1>
        <p>{t(locale, "scan.body")}</p>
        {state.kind === "idle" ? <ScanProgress locale={locale} stage="validated" /> : null}
        {state.kind === "running" ? <ScanProgress locale={locale} stage={state.stage} /> : null}
        {state.kind === "error" ? (
          <div className="error-summary" role="alert">
            <strong>{t(locale, "error.summary")}</strong>
            <p>{localizedFailure(locale, state)}</p>
            {state.partial !== undefined ? <a href="#evidence">{t(locale, "scan.partialEvidence")}</a> : null}
          </div>
        ) : null}
        {state.kind === "error" && state.partial !== undefined ? <PartialEvidence locale={locale} report={state.partial} /> : null}
        <a className="back-link" href={`/${locale}`}>{t(locale, "scan.back")}</a>
      </main>
      )}
    </SiteShell>
  );
}
