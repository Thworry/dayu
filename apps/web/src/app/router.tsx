import type { Locale } from "@dayu/report-i18n";
import { createBrowserRouter, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { preferredLocale } from "../i18n/locale.js";
import { isReportSnapshot, type PublicErrorCode } from "../api/scans.js";
import { HomePage } from "../routes/HomePage.js";
import { ScanPage } from "../routes/ScanPage.js";

function LocalizedHome({ locale }: { locale: Locale }): React.JSX.Element {
  const navigate = useNavigate();
  return <HomePage locale={locale} onReportRoute={(path, report, errorCode, jobId) => { void navigate(path, { state: { report, ...(errorCode === undefined ? {} : { errorCode }), ...(jobId === undefined ? {} : { jobId }) } }); }} />;
}

function RepositoryRoute(): React.JSX.Element {
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
  const publicErrors: readonly PublicErrorCode[] = ["github_rate_limited", "insufficient_evidence", "internal_failure", "invalid_repository", "private_or_unavailable", "request_rate_limited", "scan_not_found", "scan_not_ready"];
  const initialErrorCode = typeof candidateError === "string" && publicErrors.includes(candidateError as PublicErrorCode)
    ? candidateError as PublicErrorCode
    : undefined;
  return <ScanPage {...(isReportSnapshot(candidate) ? { initialReport: candidate, ...(initialErrorCode === undefined ? {} : { initialErrorCode }), ...(typeof candidateJobId === "string" ? { initialJobId: candidateJobId } : {}) } : {})} locale={locale} owner={owner} repo={repo} />;
}

export const router = createBrowserRouter([
  { element: <Navigate replace to={`/${preferredLocale()}`} />, path: "/" },
  { element: <LocalizedHome locale="zh" />, path: "/zh" },
  { element: <LocalizedHome locale="en" />, path: "/en" },
  { element: <RepositoryRoute />, path: "/:locale/r/:owner/:repo" },
  { element: <Navigate replace to={`/${preferredLocale()}`} />, path: "*" },
]);
