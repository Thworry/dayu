import type { Evidence, ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale } from "@dayu/report-i18n";
import { renderShareCard } from "@dayu/share-card";
import { useEffect, useRef, useState } from "react";

import { CopilotApiError, createCopilotApi, createNoChangeReview, parseNoChangeReview, sameReportBinding, type AuthSessionState, type CopilotApi, type EnhancedMetadata, type NoChangeReview } from "../api/copilot.js";
import { BalancedFindings } from "../components/BalancedFindings.js";
import { CopilotConsent } from "../components/CopilotConsent.js";
import { CopilotProgress } from "../components/CopilotProgress.js";
import { DataCoverage } from "../components/DataCoverage.js";
import { DimensionList } from "../components/DimensionList.js";
import { Disclaimer } from "../components/Disclaimer.js";
import { EvidencePanel } from "../components/EvidencePanel.js";
import { EnhancedDelta } from "../components/EnhancedDelta.js";
import { ScoreSummary } from "../components/ScoreSummary.js";
import { ReportOverview } from "../components/ReportOverview.js";
import { ReportReadingGuide } from "../components/ReportReadingGuide.js";
import { readingCopy } from "../components/report-reading-copy.js";
import { revealReportTarget } from "../components/report-disclosure.js";
import { isStaticPreview } from "../app/build-mode.js";
import { previewPath } from "../app/preview-navigation.js";
import "../styles/report-reading.css";

function record(value: Evidence["value"]): Record<string, Evidence["value"]> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function repositoryDescription(report: ReportSnapshot): string | null {
  const metadata = report.evidence.find((item) => item.fact.metric === "repository.metadata");
  const description = metadata === undefined ? undefined : record(metadata.value)?.description;
  return typeof description === "string" && description.trim() !== "" ? description : null;
}

function freshScanPath(locale: Locale, fullName: string): string {
  const [owner = "", repository = ""] = fullName.split("/");
  return `/${locale}/r/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

async function copyText(value: string): Promise<void> {
  const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
  if (clipboard === undefined) throw new Error("clipboard_unavailable");
  await clipboard.writeText(value);
}

export interface ReportPageProps {
  copilotApi?: CopilotApi;
  jobId?: string;
  locale: Locale;
  onEnhanced?: (report: ReportSnapshot) => void;
  initialReview?: NoChangeReview;
  onReviewed?: (review: NoChangeReview) => void;
  report: ReportSnapshot;
  sample?: boolean;
}

export function evidenceFeedbackUrl(report: ReportSnapshot): string {
  return `https://github.com/Thworry/dayu/issues/new?${new URLSearchParams({
    template: "evidence-dispute.yml",
    commit: report.sourceCommit,
    evidence: report.evidence.slice(0, 8).map((item) => item.id).join(","),
    repository: report.repository.fullName,
  }).toString()}`;
}

const defaultCopilotApi = createCopilotApi();

export function reportDownloadPayload(report: ReportSnapshot, review?: NoChangeReview): ReportSnapshot | { schemaVersion: "dayu-review-export-v1"; baseReport: ReportSnapshot; review: NoChangeReview } {
  const boundReview = parseNoChangeReview(review, report);
  return boundReview === undefined ? report : { schemaVersion: "dayu-review-export-v1", baseReport: report, review: boundReview };
}

export function ReportPage({ copilotApi = defaultCopilotApi, initialReview, jobId, locale, onEnhanced, onReviewed, report, sample = false }: ReportPageProps): React.JSX.Element {
  const [shareState, setShareState] = useState<"copied" | "downloading" | "failed" | "idle">("idle");
  const [displayReport, setDisplayReport] = useState(report);
  const [authState, setAuthState] = useState<AuthSessionState>({ kind: "signed_out" });
  const [sessionChecked, setSessionChecked] = useState(false);
  const [copilotState, setCopilotState] = useState<"failed" | "idle" | "running" | "succeeded">(report.copilot === undefined ? "idle" : "succeeded");
  const [enhancedMetadata, setEnhancedMetadata] = useState<EnhancedMetadata | null>(report.copilot ?? null);
  const [review, setReview] = useState<NoChangeReview | undefined>(() => parseNoChangeReview(initialReview, report));
  const idempotencyKey = useRef<string | null>(null);
  const terminalStatus = useRef<HTMLDivElement>(null);
  const reportRoot = useRef<HTMLElement>(null);
  const enhancementAbort = useRef<AbortController | null>(null);
  const enhancementGeneration = useRef(0);
  const route = freshScanPath(locale, displayReport.repository.fullName);

  useEffect(() => {
    const reveal = (hash: string): void => {
      if (!hash.startsWith("#")) return;
      let id: string;
      try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
      const target = document.getElementById(id);
      if (target !== null && reportRoot.current?.contains(target) === true) revealReportTarget(target);
    };
    const onHashChange = (): void => { reveal(window.location.hash); };
    const onClick = (event: MouseEvent): void => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = anchor?.getAttribute("href");
      if (href !== undefined && href !== null) reveal(href);
    };
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick);
    return () => { window.removeEventListener("hashchange", onHashChange); document.removeEventListener("click", onClick); };
  }, [locale, report.repository.fullName, report.sourceCommit]);

  useEffect(() => {
    enhancementGeneration.current += 1;
    enhancementAbort.current?.abort();
    enhancementAbort.current = null;
    setDisplayReport(report);
    const restoredReview = parseNoChangeReview(initialReview, report);
    setReview(restoredReview);
    if (restoredReview !== undefined) {
      setEnhancedMetadata(restoredReview.metadata);
      setCopilotState("succeeded");
    } else if (report.copilot !== undefined) {
      setEnhancedMetadata(report.copilot);
      setCopilotState("succeeded");
    } else {
      setEnhancedMetadata(null);
      setCopilotState("idle");
      idempotencyKey.current = null;
    }
  }, [initialReview, jobId, locale, report]);
  useEffect(() => () => { enhancementAbort.current?.abort(); }, []);
  useEffect(() => {
    if (copilotState === "failed" || copilotState === "succeeded") terminalStatus.current?.focus();
  }, [copilotState]);
  useEffect(() => {
    if (jobId === undefined || sample) return;
    const controller = new AbortController();
    void copilotApi.getSession(controller.signal).then((value) => {
      if (!controller.signal.aborted) {
        setAuthState(value);
        setSessionChecked(true);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setAuthState({ kind: "unavailable" });
        setSessionChecked(true);
      }
    });
    return () => { controller.abort(); };
  }, [copilotApi, jobId, sample]);

  function downloadJson(): void {
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(reportDownloadPayload(displayReport, review), null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.download = `${displayReport.repository.fullName.replace(/[^a-z0-9._-]+/gi, "-")}-dayu.json`;
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
      setShareState("idle");
    } catch { setShareState("failed"); }
  }

  async function downloadCard(): Promise<void> {
    setShareState("downloading");
    try {
      const blob = await renderShareCard(displayReport, locale);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.download = `${displayReport.repository.fullName.replace(/[^a-z0-9._-]+/gi, "-")}-dayu.png`;
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
      setShareState("idle");
    } catch {
      setShareState("failed");
    }
  }

  function connectGitHub(): void {
    const returnTo = freshScanPath(locale, displayReport.repository.fullName);
    window.location.assign(`/api/auth/github/start?${new URLSearchParams({ returnTo }).toString()}`);
  }

  async function enhance(): Promise<void> {
    if (jobId === undefined || authState.kind !== "authenticated" || copilotState === "running") return;
    const key = idempotencyKey.current ?? globalThis.crypto.randomUUID();
    idempotencyKey.current = key;
    enhancementAbort.current?.abort();
    const controller = new AbortController();
    enhancementAbort.current = controller;
    const generation = enhancementGeneration.current + 1;
    enhancementGeneration.current = generation;
    setCopilotState("running");
    try {
      const result = await copilotApi.enhance(jobId, { consent: true, csrfToken: authState.session.csrfToken, idempotencyKey: key }, controller.signal);
      if (controller.signal.aborted || generation !== enhancementGeneration.current) return;
      if (!sameReportBinding(result.baseReport, report)) {
        setCopilotState("failed");
        return;
      }
      if (result.noChangeReason === "no_scorable_judgments" && result.metadata !== undefined && result.errorCode === undefined) {
        const completedReview = createNoChangeReview(result.baseReport, result.metadata);
        if (completedReview === undefined || result.enhancedReport !== null) {
          setCopilotState("failed");
          return;
        }
        setDisplayReport(result.baseReport);
        setEnhancedMetadata(result.metadata);
        setReview(completedReview);
        setCopilotState("succeeded");
        onReviewed?.(completedReview);
        return;
      }
      if (result.enhancedReport === null || result.metadata === undefined) {
        setDisplayReport(result.baseReport);
        if (result.errorCode === "copilot_revoked") setAuthState({ kind: "signed_out" });
        setCopilotState("failed");
        return;
      }
      setDisplayReport(result.enhancedReport);
      setEnhancedMetadata(result.metadata);
      setReview(undefined);
      setCopilotState("succeeded");
      onEnhanced?.(result.enhancedReport);
    } catch (reason) {
      if (controller.signal.aborted || generation !== enhancementGeneration.current) return;
      if (reason instanceof CopilotApiError && reason.code === "copilot_revoked") setAuthState({ kind: "signed_out" });
      setCopilotState("failed");
    } finally {
      if (enhancementAbort.current === controller) enhancementAbort.current = null;
    }
  }

  async function copyFreshScanLink(): Promise<void> {
    try {
      await copyText(new URL(route, window.location.origin).href);
      setShareState("copied");
    } catch {
      setShareState("failed");
    }
  }

  return (
    <main className="report-main report-reading" id="main-content" ref={reportRoot} tabIndex={-1}>
      <div className="report-layout">
        <aside className="report-summary-column">
          <ScoreSummary description={repositoryDescription(displayReport)} locale={locale} report={displayReport} />
        </aside>
        <div className="report-detail-column">
          <Disclaimer locale={locale} />
          <ReportReadingGuide locale={locale} report={displayReport} />
          <div className="share-actions">
            <div>
              <button disabled={shareState === "downloading"} onClick={() => { void downloadCard(); }} type="button">
                <span aria-hidden="true" className="download-icon" />
                {t(locale, shareState === "downloading" ? "report.share.downloading" : "report.share.download")}
              </button>
              <button className="secondary-action" onClick={downloadJson} type="button">{t(locale, review === undefined ? "report.share.json" : "report.share.reviewJson")}</button>
              {sample ? null : <button className="secondary-action" onClick={() => { void copyFreshScanLink(); }} type="button">
                <span aria-hidden="true" className="link-icon" />
                {t(locale, "report.share.copy")}
              </button>}
            </div>
            <p>{t(locale, sample ? "report.share.snapshot" : "report.share.freshScan")}</p>
            {review === undefined ? null : <p>{t(locale, "report.share.reviewJsonNote")}</p>}
            <p aria-live="polite" className="share-status">
              {shareState === "copied" ? t(locale, "report.share.copied") : shareState === "failed" ? t(locale, "report.share.failed") : ""}
            </p>
          </div>
          {!sample && jobId !== undefined && sessionChecked && copilotState !== "succeeded" ? (
            <CopilotConsent
              authState={authState.kind}
              busy={copilotState === "running"}
              locale={locale}
              onConnect={connectGitHub}
              onConfirm={() => { void enhance(); }}
            />
          ) : null}
          {copilotState === "running" ? <CopilotProgress locale={locale} /> : null}
          {copilotState === "failed" ? (
            <div className="copilot-failure" ref={terminalStatus} role="alert" tabIndex={-1}><strong>{t(locale, "copilot.failure.title")}</strong><p>{t(locale, "copilot.failure.body")}</p></div>
          ) : null}
          {enhancedMetadata === null ? null : (
            <div className="copilot-success-status" ref={terminalStatus} tabIndex={-1}><EnhancedDelta enhancedScore={displayReport.score} locale={locale} metadata={enhancedMetadata} rulesScore={displayReport.baseScore} unchanged={review !== undefined} /></div>
          )}
          <details className="report-disclosure" id="report-analysis">
            <summary>{readingCopy(locale, "analysis")}<span>{readingCopy(locale, "analysisNote")}</span></summary>
            <div className="report-disclosure-body">
              <ReportOverview locale={locale} report={displayReport} />
              <DimensionList locale={locale} report={displayReport} />
              <BalancedFindings locale={locale} report={displayReport} />
              <DataCoverage locale={locale} report={displayReport} />
            </div>
          </details>
          <details className="report-disclosure" id="report-evidence">
            <summary>{readingCopy(locale, "evidence")}<span>{readingCopy(locale, "evidenceNote")}</span></summary>
            <div className="report-disclosure-body"><EvidencePanel locale={locale} report={displayReport} /></div>
          </details>
          <nav aria-label={t(locale, "report.back")} className="report-links">
            <a href={sample && isStaticPreview ? previewPath(locale, "home", "local-guide") : `/${locale}`}>{t(locale, sample && isStaticPreview ? "report.runLocally" : "report.back")}</a>
            <a href={evidenceFeedbackUrl(displayReport)}>{t(locale, "report.feedback")}</a>
          </nav>
        </div>
      </div>
    </main>
  );
}
