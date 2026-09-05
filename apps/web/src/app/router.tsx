import type { Locale } from "@dayu/report-i18n";
import { createBrowserRouter, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { preferredLocale } from "../i18n/locale.js";
import { parseNoChangeReview } from "../api/copilot.js";
import { isReportSnapshot, type PublicErrorCode } from "../api/scans.js";
import { HomePage } from "../routes/HomePage.js";
import { ScanPage } from "../routes/ScanPage.js";

function LocalizedHome({ locale }: { locale: Locale }): React.JSX.Element {
  const navigate = useNavigate();
  return <HomePage locale={locale} onReportRoute={(path, report, errorCode, jobId) => { void navigate(path, { state: { report, ...(errorCode === undefined ? {} : { errorCode }), ...(jobId === undefined ? {} : { jobId }) } }); }} />;
}

export function RepositoryRoute(): React.JSX.Element {
  const { locale, owner, repo } = useParams();
  const location = useLocation();
  if ((locale !== "zh" && locale !== "en") || owner === undefined || repo === undefined) {
    return <Navigate replace to={`/${preferredLocale()}`} />;
  }
  const candidate = location.state !== null && typeof location.state === "object" && "report" in location.state
    ? (location.state as { report: unknown }).report
    : undefined;
  const candidateError = location.state !== null && typeof location.state === "object" && "errorCode" in location.state
    ? (location.state as { errorCode: unknown }).errorCode
    : undefined;
  const candidateJobId = location.state !== null && typeof location.state === "object" && "jobId" in location.state
    ? (location.state as { jobId: unknown }).jobId
    : undefined;
  const candidateReview = location.state !== null && typeof location.state === "object" && "review" in location.state
    ? (location.state as { review: unknown }).review
    : undefined;
  const publicErrors: readonly PublicErrorCode[] = ["github_rate_limited", "insufficient_evidence", "internal_failure", "invalid_repository", "private_or_unavailable", "request_rate_limited", "scan_not_found", "scan_not_ready"];
  const initialErrorCode = typeof candidateError === "string" && publicErrors.includes(candidateError as PublicErrorCode)
    ? candidateError as PublicErrorCode
    : undefined;
  const report = isReportSnapshot(candidate) && candidate.repository.fullName.toLowerCase() === `${owner}/${repo}`.toLowerCase() ? candidate : undefined;
  const review = report === undefined ? undefined : parseNoChangeReview(candidateReview, report);
  return <ScanPage key={`${locale}/${owner}/${repo}:${report?.sourceCommit ?? "pending"}:${report?.createdAt ?? ""}`} {...(report === undefined ? {} : { initialReport: report, ...(initialErrorCode === undefined ? {} : { initialErrorCode }), ...(typeof candidateJobId === "string" ? { initialJobId: candidateJobId } : {}), ...(review === undefined ? {} : { initialReview: review }) })} locale={locale} owner={owner} repo={repo} />;
}

export const router = createBrowserRouter([
  { element: <Navigate replace to={`/${preferredLocale()}`} />, path: "/" },
  { element: <LocalizedHome locale="zh" />, path: "/zh" },
  { element: <LocalizedHome locale="en" />, path: "/en" },
  { path: "/zh/sample", lazy: async () => {
    const { SamplePage } = await import("../routes/SamplePage.js");
    return { Component: () => <SamplePage locale="zh" /> };
  } },
  { path: "/en/sample", lazy: async () => {
    const { SamplePage } = await import("../routes/SamplePage.js");
    return { Component: () => <SamplePage locale="en" /> };
  } },
  { element: <RepositoryRoute />, path: "/:locale/r/:owner/:repo" },
  { element: <Navigate replace to={`/${preferredLocale()}`} />, path: "*" },
]);
