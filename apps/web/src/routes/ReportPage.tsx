import type { Evidence, ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale } from "@dayu/report-i18n";
import { renderShareCard } from "@dayu/share-card";
import { useEffect, useRef, useState } from "react";

import { CopilotApiError, createCopilotApi, type AuthSessionResponse, type CopilotApi, type EnhancedMetadata } from "../api/copilot.js";
import { BalancedFindings } from "../components/BalancedFindings.js";
import { CopilotConsent } from "../components/CopilotConsent.js";
import { CopilotProgress } from "../components/CopilotProgress.js";
import { DataCoverage } from "../components/DataCoverage.js";
import { DimensionList } from "../components/DimensionList.js";
import { Disclaimer } from "../components/Disclaimer.js";
import { EvidencePanel } from "../components/EvidencePanel.js";
import { EnhancedDelta } from "../components/EnhancedDelta.js";
import { ScoreSummary } from "../components/ScoreSummary.js";

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
  report: ReportSnapshot;
}

const defaultCopilotApi = createCopilotApi();

export function ReportPage({ copilotApi = defaultCopilotApi, jobId, locale, onEnhanced, report }: ReportPageProps): React.JSX.Element {
  const [shareState, setShareState] = useState<"copied" | "downloading" | "failed" | "idle">("idle");
  const [displayReport, setDisplayReport] = useState(report);
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [copilotState, setCopilotState] = useState<"failed" | "idle" | "running" | "succeeded">(report.copilot === undefined ? "idle" : "succeeded");
  const [enhancedMetadata, setEnhancedMetadata] = useState<EnhancedMetadata | null>(report.copilot ?? null);
  const idempotencyKey = useRef<string | null>(null);
  const terminalStatus = useRef<HTMLDivElement>(null);
  const enhancementAbort = useRef<AbortController | null>(null);
  const enhancementGeneration = useRef(0);
  const route = freshScanPath(locale, displayReport.repository.fullName);

  useEffect(() => {
    enhancementGeneration.current += 1;
    enhancementAbort.current?.abort();
    enhancementAbort.current = null;
    setDisplayReport(report);
    if (report.copilot !== undefined) {
      setEnhancedMetadata(report.copilot);
      setCopilotState("succeeded");
    } else {
      setEnhancedMetadata(null);
      setCopilotState("idle");
      idempotencyKey.current = null;
    }
  }, [jobId, locale, report]);
  useEffect(() => () => { enhancementAbort.current?.abort(); }, []);
  useEffect(() => {
    if (copilotState === "failed" || copilotState === "succeeded") terminalStatus.current?.focus();
  }, [copilotState]);
  useEffect(() => {
    if (jobId === undefined) return;
    const controller = new AbortController();
    void copilotApi.getSession(controller.signal).then((value) => {
      if (!controller.signal.aborted) {
        setSession(value);
        setSessionChecked(true);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setSessionChecked(true);
    });
    return () => { controller.abort(); };
  }, [copilotApi, jobId]);

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
    if (jobId === undefined || session === null || copilotState === "running") return;
    const key = idempotencyKey.current ?? globalThis.crypto.randomUUID();
    idempotencyKey.current = key;
    enhancementAbort.current?.abort();
    const controller = new AbortController();
    enhancementAbort.current = controller;
    const generation = enhancementGeneration.current + 1;
    enhancementGeneration.current = generation;
    setCopilotState("running");
    try {
      const result = await copilotApi.enhance(jobId, { consent: true, csrfToken: session.csrfToken, idempotencyKey: key }, controller.signal);
      if (controller.signal.aborted || generation !== enhancementGeneration.current) return;
      if (result.enhancedReport === null || result.metadata === undefined) {
        setDisplayReport(result.baseReport);
        if (result.errorCode === "copilot_revoked") setSession(null);
        setCopilotState("failed");
        return;
      }
      setDisplayReport(result.enhancedReport);
      setEnhancedMetadata(result.metadata);
      setCopilotState("succeeded");
      onEnhanced?.(result.enhancedReport);
    } catch (reason) {
      if (controller.signal.aborted || generation !== enhancementGeneration.current) return;
      if (reason instanceof CopilotApiError && reason.code === "copilot_revoked") setSession(null);
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

  const feedback = `/feedback?${new URLSearchParams({
    commit: displayReport.sourceCommit,
    evidence: displayReport.evidence.map((item) => item.id).join(","),
    repository: displayReport.repository.fullName,
    rules: displayReport.rulesVersion,
  }).toString()}`;

  return (
    <main className="report-main">
      <div className="report-layout">
        <aside className="report-summary-column">
          <ScoreSummary description={repositoryDescription(displayReport)} locale={locale} report={displayReport} />
        </aside>
        <div className="report-detail-column">
          <div className="section-heading report-context-heading"><span>01</span><h2>{t(locale, "report.score")}</h2></div>
          <Disclaimer locale={locale} />
          <div className="share-actions">
            <div>
              <button disabled={shareState === "downloading"} onClick={() => { void downloadCard(); }} type="button">
                <span aria-hidden="true" className="download-icon" />
                {t(locale, shareState === "downloading" ? "report.share.downloading" : "report.share.download")}
              </button>
              <button className="secondary-action" onClick={() => { void copyFreshScanLink(); }} type="button">
                <span aria-hidden="true" className="link-icon" />
                {t(locale, "report.share.copy")}
              </button>
            </div>
            <p>{t(locale, "report.share.freshScan")}</p>
            <p aria-live="polite" className="share-status">
              {shareState === "copied" ? t(locale, "report.share.copied") : shareState === "failed" ? t(locale, "report.share.failed") : ""}
            </p>
          </div>
          {jobId !== undefined && sessionChecked && copilotState !== "succeeded" ? (
            <CopilotConsent
              authenticated={session !== null}
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
            <div className="copilot-success-status" ref={terminalStatus} tabIndex={-1}><EnhancedDelta enhancedScore={displayReport.score} locale={locale} metadata={enhancedMetadata} rulesScore={displayReport.baseScore} /></div>
          )}
          <BalancedFindings locale={locale} report={displayReport} />
          <DimensionList locale={locale} report={displayReport} />
          <DataCoverage locale={locale} report={displayReport} />
          <EvidencePanel locale={locale} report={displayReport} />
          <nav aria-label={t(locale, "report.back")} className="report-links">
            <a href={`/${locale}`}>{t(locale, "report.back")}</a>
            <a href={feedback}>{t(locale, "report.feedback")}</a>
          </nav>
        </div>
      </div>
    </main>
  );
}
