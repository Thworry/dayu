import type { Evidence, Finding, ReportSnapshot } from "@dayu/evidence-schema";
import { t, type Locale } from "@dayu/report-i18n";

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

function safeFact(evidence: Evidence): string {
  const raw = typeof evidence.fact.value === "string" ? evidence.fact.value : JSON.stringify(evidence.fact.value);
  let sanitized = "";
  for (const character of raw) {
    const code = character.charCodeAt(0);
    sanitized += code < 32 || code === 127 ? " " : character;
  }
  const compact = sanitized.replace(/\s+/g, " ").trim();
  return compact.length <= 240 ? compact : `${compact.slice(0, 239)}…`;
}

function linkedFindings(report: ReportSnapshot, evidenceId: string): { counter: Finding[]; primary: Finding[] } {
  const findings = [...report.positiveSignals, ...report.findings];
  return {
    counter: findings.filter((finding) => finding.counterEvidenceIds.includes(evidenceId)),
    primary: findings.filter((finding) => finding.evidenceIds.includes(evidenceId)),
  };
}

export function EvidencePanel({ locale, report }: { locale: Locale; report: ReportSnapshot }): React.JSX.Element {
  return (
    <section aria-labelledby="evidence-heading" className="evidence-section" id="evidence">
      <div className="section-heading"><span>05</span><div><h2 id="evidence-heading">{t(locale, "report.evidenceHeading")}</h2><p>{t(locale, "report.evidenceIntro")}</p></div></div>
      <ol className="evidence-list">
        {report.evidence.map((evidence) => {
          const references = linkedFindings(report, evidence.id);
          const allReferences = [...references.primary, ...references.counter];
          const source = sourceDetails(report, evidence, locale);
          return (
            <li className="evidence-row" id={`evidence-${evidence.id}`} key={evidence.id}>
              <header>
                <a href={source.href} rel="noreferrer" target="_blank">{evidence.id}</a>
                <span>{evidence.kind}</span>
              </header>
              <div className="evidence-fact">
                <span>{t(locale, "report.sourceFact")}</span>
                <strong>{evidence.summary}</strong>
                <code>{evidence.fact.metric} = {safeFact(evidence)}</code>
              </div>
              <dl className="evidence-meta">
                <div>
                  <dt>{t(locale, "report.dimensionRisk")}</dt>
                  <dd>{references.primary.length === 0
                    ? t(locale, references.counter.length === 0 ? "report.unreferencedEvidence" : "report.noPrimaryEvidenceReference")
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
                  <dd>{allReferences.length === 0 ? t(locale, "report.unreferencedEvidence") : [...new Set(allReferences.map((finding) => t(locale, finding.producer === "copilot" ? "report.producer.copilot" : "report.producer.rule")))].join(" · ")}</dd>
                </div>
                <div>
                  <dt>{t(locale, "report.observedAt")}</dt>
                  <dd><time dateTime={evidence.observedAt}>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(evidence.observedAt))}</time></dd>
                </div>
                <div>
                  <dt>{t(locale, "report.limitations")}</dt>
                  <dd>{evidence.limitations.length === 0 ? t(locale, "report.noLimitations") : evidence.limitations.join(" · ")}</dd>
                </div>
              </dl>
              <div className="source-reference">
                <a aria-label={source.label} className="source-link" href={source.href} rel="noreferrer" target="_blank">
                  {source.label}<span aria-hidden="true">↗</span>
                </a>
                <p>{source.note}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
