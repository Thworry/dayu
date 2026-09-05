# DAYU review and evidence experience, 2026-09-05

## Scope and provenance

Reviewed the public `Thworry/dayu` repository from main `9c07a832619d36f763fae6e012fe40a06f66098f`. Work uses the `codex/dayu-evidence-experience` branch and GitHub noreply authorship; no public history was rewritten. The existing ink/paper/river visual language is retained.

The bundled self-check was collected through the local API on 2026-09-05 at 07:36:35 UTC from that exact public main commit, using collector-v1 and rules-v2. Its 20 complete evidence records, 3 positive observations, missing community signal, and source timestamps are preserved in `apps/web/src/data/dayu-sample.json`. Total/base/enriched scores are explicitly withheld for the public sample. Individual dimension signals remain experimental. This sample is not calibration data or an efficacy benchmark.

## Resolved findings

| Finding | Resolution |
| --- | --- |
| Uncertain repository classification could receive numerical scores | Taxonomy confidence below 0.60 now yields facts only; scoring defensively applies the same gate. |
| Non-applicable or unverifiable AI judgments could inflate confidence | These judgments add no score coverage. A wholly non-scorable review preserves the base report and confidence. |
| Missing release data could be interpreted as zero releases | Unknown/restricted release observations are excluded from absence claims and reduce applicable coverage. |
| Calibration could not represent deliberate abstentions | Null scores require explicit score-kind provenance, are verified during replay, and never count toward numeric accuracy, FPR, or the 80/40 scoreable case minima. |
| Successful unchanged AI review vanished during language changes | A separately validated, report-bound review state survives navigation. Local JSON uses a labeled review envelope; the rules report remains unchanged. |
| Dimension bars resembled positive quality ratings | Axis labels and descriptions explain that higher means more to inspect, not better quality; missing values have no numeric meter. |
| Evidence was hard to browse and partly untranslated | Search by ID/source/content, reference/limitation filters, local labels, raw-record disclosures, and hash-target reveal/focus are implemented. |
| Confidence looked like measured accuracy | Both UI and PNG explain heuristic sufficiency; actual record-status counts are displayed separately. |
| Feedback linked to a nonexistent route | The existing GitHub evidence-dispute template receives only bounded repository/commit/Evidence ID metadata. |
| Public preview had a separate, drifting implementation | Pages now builds the same React report with a pinned sample, no scan/session requests, and a restrictive HTML CSP. |

## Verification

Local acceptance: 430 unit/integration tests across packages and 29 Playwright E2E tests passed. [PR #5](https://github.com/Thworry/dayu/pull/5) tracks required CI, merge, and Pages deployment acceptance; the live preview remains a historical self-check, regardless of deployment status.

- Unit and integration coverage includes scoring abstentions, missing releases, unchanged review state, hostile repository text, evidence search/anchors, raw JSON exports, subscriber counts, and English share-card line wrapping.
- Real browser E2E covers anonymous scans, consent, distinct-user isolation, provider failures, language switching without repeat Copilot calls, 320/768/1440 layouts, dark/reduced-motion modes, keyboard operation, and serious/critical accessibility gates.
- Static Pages tests serve emitted files without CSP response headers, verify the embedded policy blocks connections, record zero fetch/XHR requests during ordinary preview use, and validate JSON and PNG downloads.
- Inspected screenshots: English overview at 1440×1280; Chinese overview at 390×844 (scrolled to overview); Chinese evidence at 1440×1000 (scrolled to evidence). The Chinese homepage and generated 1200×630 share card were also inspected.
- `pnpm demo:smoke` passes with loopback-only servers and the expected OAuth-unavailable fallback. License and high-severity production dependency gates pass.

The existing Zod dependency is now declared directly by the web package for review-state validation; there is no version upgrade or additional chart/animation library. Sample data loads only when its route is opened.

## Boundaries that remain

The strict release gate remains `pre_beta_not_ready`: 0/5,000 genuine calibration repositories, 0/120 qualifying blind-reviewed cases, 3/24 sample cohorts. The runtime still uses shared synthetic reference thresholds, not a validated matching-cohort model. No accuracy improvement is claimed from the regression fixes.

The protected `public-beta-release` environment exists with maintainer review and branch policy, but has no configured secrets. Live Copilot Free/Pro/organization evidence and the required protected review manifests remain absent. The main ruleset requires five CI checks and a PR, blocks force push/deletion, and does not require external approval. Secret scanning, push protection, and Dependabot security updates are enabled.

Next scientific work: collect a provenance-bound stratified public corpus; conduct independent blind review including abstentions; fit/evaluate type-aware reference thresholds on held-out data; obtain the three real user-owned Copilot entitlement probes; then rerun the protected release gate. No tag or Beta release is warranted before those requirements pass.
