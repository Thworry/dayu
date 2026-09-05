import type { Evidence, Finding, ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale } from "@dayu/report-i18n";
import { useEffect, useMemo, useState } from "react";

import { evidenceCopy, evidenceCountLabel, evidenceKindLabel, evidenceStatusLabel, evidenceTitle, isLimitedEvidence, observationLabel, sourcePath } from "./evidence-presentation.js";
import "../styles/evidence-explorer.css";
import { revealReportTarget } from "./report-disclosure.js";

function encodedPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function githubFileSource(report: ReportSnapshot, source: Extract<Evidence["source"], { kind: "file" }>): string {
  const [owner = "", repository = ""] = report.repository.fullName.split("/");
  const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  const line = source.lineStart === undefined ? "" : `#L${String(source.lineStart)}`;
  return `${base}/blob/${encodeURIComponent(source.commitSha)}/${encodedPath(source.path)}${line}`;
}

export function githubApiSource(endpoint: string, repositoryFullName: string): string {
  const hasControl = Array.from(endpoint).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  const [owner, repository] = repositoryFullName.split("/");
  const expectedRoot = owner === undefined || repository === undefined ? "" : `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  const repositoryEndpoint = endpoint === expectedRoot || endpoint.startsWith(`${expectedRoot}/`) || endpoint.startsWith(`${expectedRoot}?`);
  if (expectedRoot === "" || !repositoryEndpoint || !endpoint.startsWith("/") || endpoint.startsWith("//") || endpoint.includes("\\") || hasControl) {
    return "https://api.github.com/";
  }
  const url = new URL(`https://api.github.com${endpoint}`);
  if (url.protocol !== "https:" || url.hostname !== "api.github.com" || url.username !== "" || url.password !== "") {
    return "https://api.github.com/";
  }
  return url.href;
}

function sourceDetails(report: ReportSnapshot, evidence: Evidence, locale: Locale): { href: string; label: string; note: string } {
  if (evidence.source.kind === "file") {
    return {
      href: githubFileSource(report, evidence.source),
      label: t(locale, "report.openPinnedFileSource"),
      note: t(locale, "report.fileSourceNote", { sha: evidence.source.commitSha.slice(0, 12) }),
    };
  }
  return {
    href: githubApiSource(evidence.source.endpoint, report.repository.fullName),
    label: t(locale, "report.openApiSource"),
    note: t(locale, "report.apiSourceNote", { observedAt: evidence.observedAt }),
  };
}

function linkedFindings(report: ReportSnapshot, evidenceId: string): { counter: Finding[]; primary: Finding[] } {
  const findings = [...report.positiveSignals, ...report.findings];
  return {
    counter: findings.filter((finding) => finding.counterEvidenceIds.includes(evidenceId)),
    primary: findings.filter((finding) => finding.evidenceIds.includes(evidenceId)),
  };
}

export function EvidencePanel({ locale, report }: { locale: Locale; report: ReportSnapshot }): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "limited" | "referenced">("all");
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const citedIds = useMemo(() => new Set(
    [...report.findings, ...report.positiveSignals, ...(report.copilot?.findings ?? [])]
      .flatMap((finding) => [...finding.evidenceIds, ...finding.counterEvidenceIds]),
  ), [report]);
  const searchableEvidence = useMemo(() => report.evidence.map((evidence) => ({
    evidence,
    text: [JSON.stringify(evidence), evidenceTitle(locale, evidence), evidenceKindLabel(locale, evidence.kind),
      evidenceStatusLabel(locale, evidence.status), ...evidence.limitations.map((value) => observationLabel(locale, value))].join(" ").toLocaleLowerCase(),
  })), [locale, report.evidence]);
  const search = query.trim().toLocaleLowerCase();
  const visibleEvidence = searchableEvidence.filter(({ evidence, text }) =>
    (filter === "all" || (filter === "referenced" ? citedIds.has(evidence.id) : isLimitedEvidence(evidence))) && text.includes(search),
  );
  const filtered = query !== "" || filter !== "all";

  function resetFilters(): void { setQuery(""); setFilter("all"); }

  useEffect(() => {
    function revealHash(hash: string): void {
      if (!hash.startsWith("#evidence-")) return;
      const id = hash.slice("#evidence-".length);
      if (!report.evidence.some((evidence) => evidence.id === id)) return;
      setQuery("");
      setFilter("all");
      setPendingTarget(id);
    }
    const onHashChange = (): void => { revealHash(window.location.hash); };
    const onClick = (event: MouseEvent): void => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      // A repeated click on the current hash does not trigger hashchange.
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = anchor?.getAttribute("href");
      if (href !== null && href !== undefined) revealHash(href);
    };
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick);
    return () => { window.removeEventListener("hashchange", onHashChange); document.removeEventListener("click", onClick); };
  }, [report.evidence]);

  useEffect(() => {
    if (pendingTarget === null) return;
    const row = document.getElementById(`evidence-${pendingTarget}`);
    if (row === null) return;
    const details = row.querySelector("details");
    if (details !== null) details.open = true;
    revealReportTarget(row);
    setPendingTarget(null);
  }, [pendingTarget, query, filter]);

  return (
    <section aria-labelledby="evidence-heading" className="evidence-section evidence-explorer" id="evidence">
      <div className="section-heading"><span>05</span><div><h2 id="evidence-heading">{t(locale, "report.evidenceHeading")}</h2><p>{t(locale, "report.evidenceIntro")}</p></div></div>
      <div className="evidence-toolbar">
        <label htmlFor="evidence-search">{evidenceCopy(locale, "search")}</label>
        <input id="evidence-search" onChange={(event) => { setQuery(event.target.value); }} placeholder={evidenceCopy(locale, "searchHint")} type="search" value={query} />
        <div aria-label={evidenceCopy(locale, "filters")} className="evidence-filters" role="group">
          {(["all", "referenced", "limited"] as const).map((value) => <button aria-pressed={filter === value} key={value} onClick={() => { setFilter(value); }} type="button">{evidenceCopy(locale, value)}</button>)}
        </div>
        <div className="evidence-results"><p aria-live="polite" role="status">{evidenceCountLabel(locale, visibleEvidence.length, report.evidence.length)}</p>{filtered ? <button onClick={resetFilters} type="button">{evidenceCopy(locale, "reset")}</button> : null}</div>
      </div>
      {visibleEvidence.length === 0 ? <p className="evidence-empty">{evidenceCopy(locale, "empty")}</p> : null}
      <ol className="evidence-list">
        {visibleEvidence.map(({ evidence }) => {
          const references = linkedFindings(report, evidence.id);
          const allReferences = [...references.primary, ...references.counter];
          const copilotReferences = (report.copilot?.findings ?? []).filter((finding) => finding.evidenceIds.includes(evidence.id) || finding.counterEvidenceIds.includes(evidence.id));
          const producers = [...new Set([...allReferences.map((finding) => t(locale, finding.producer === "copilot" ? "report.producer.copilot" : "report.producer.rule")), ...(copilotReferences.length > 0 ? [t(locale, "report.producer.copilot")] : [])])];
          const source = sourceDetails(report, evidence, locale);
          return (
            <li className="evidence-row" id={`evidence-${evidence.id}`} key={evidence.id} tabIndex={-1}>
              <header>
                <a href={source.href} rel="noreferrer" target="_blank">{evidence.id}</a>
                <div className="evidence-badges"><span>{evidenceKindLabel(locale, evidence.kind)}</span><span className={`evidence-status is-${evidence.status}`}>{evidenceStatusLabel(locale, evidence.status)}</span></div>
              </header>
              <div className="evidence-fact">
                <h3>{evidenceTitle(locale, evidence)}</h3>
                <p className="evidence-source-path">{sourcePath(evidence)}</p>
              </div>
              <dl className="evidence-meta">
                <div>
                  <dt>{t(locale, "report.dimensionRisk")}</dt>
                  <dd>{references.primary.length === 0
                    ? t(locale, references.counter.length === 0 && copilotReferences.length === 0 ? "report.unreferencedEvidence" : "report.noPrimaryEvidenceReference")
                    : references.primary.map((finding) => `${String(finding.risk)} / 100`).join(" · ")}</dd>
                </div>
                {references.counter.length === 0 ? null : (
                  <div>
                    <dt>{t(locale, "report.counterEvidenceFor")}</dt>
                    <dd>{references.counter.map((finding) => finding.findingId).join(" · ")}</dd>
                  </div>
                )}
                <div>
                  <dt>{t(locale, "report.producer")}</dt>
                  <dd>{producers.length === 0 ? t(locale, "report.unreferencedEvidence") : producers.join(" · ")}</dd>
                </div>
                <div>
                  <dt>{t(locale, "report.observedAt")}</dt>
                  <dd><time dateTime={evidence.observedAt}>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(evidence.observedAt))}</time></dd>
                </div>
                <div>
                  <dt>{t(locale, "report.limitations")}</dt>
                  <dd>{evidence.limitations.length === 0 ? t(locale, "report.noLimitations") : evidence.limitations.map((value) => observationLabel(locale, value)).join(" · ")}</dd>
                </div>
              </dl>
              <div className="source-reference">
                <a aria-label={source.label} className="source-link" href={source.href} rel="noreferrer" target="_blank">
                  {source.label}<span aria-hidden="true">↗</span>
                </a>
                <p>{source.note}</p>
              </div>
              <details className="evidence-original">
                <summary>{evidenceCopy(locale, "details")}</summary>
                <div>
                  <p className="evidence-original-note">{evidenceCopy(locale, "recordNote")}</p>
                  <p>{evidence.summary}</p>
                  <pre aria-label={`${evidenceCopy(locale, "original")} ${evidence.id}`} tabIndex={0}><code>{JSON.stringify(evidence, null, 2)}</code></pre>
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
