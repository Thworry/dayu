# DAYU Evidence Experience Implementation Plan

**Goal:** improve observable scoring correctness and make DAYU reports easier to read, inspect, and share.

**Architecture:** keep the existing package boundaries; harden taxonomy/scoring and API enhancement confidence, add a localized evidence presenter/explorer, and reuse the React UI for a Vite-built static preview with a pinned local sample. All work is reviewed on a `codex/` branch and merged through required CI.

**Tech Stack:** TypeScript, React, Fastify, pnpm, Vitest, Playwright, GitHub Actions/Pages.

## Global constraints

Public repositories only; five weights 25/25/20/15/15; 70% rules + up to 30% optional user Copilot; below 60% deterministic coverage no overall number; no accusations; no calibration or entitlement claims without evidence; no new chart/animation libraries. The web package explicitly declares the already-used Zod version for review-state validation.

## Task 1: Scoring correctness

Files: `packages/repository-taxonomy/src/classify.ts`, `packages/scoring-core/src/rules/claims.ts`, `packages/scoring-core/src/score.ts`, `apps/api/src/jobs/enhance-runner.ts`, their existing tests.

- [x] Add regression cases for confidence <0.60, missing releases, and all-N/A Copilot.
- [x] Return facts-only for ambiguous taxonomy; exclude unknown release data from absence inference; count only applicable valid AI judgments.
- [x] Run focused taxonomy/scoring/API checks and inspect report schema compatibility.

## Task 2: Evidence explorer

Files: `apps/web/src/components/EvidencePanel.tsx`, a focused evidence-presentation helper, `DataCoverage.tsx`, related styles and tests.

- [x] Present localizable evidence kinds, known metrics and limitation labels with raw source text retained in expandable details.
- [x] Add labeled search/status controls, result count, no-results reset, and hash-target reveal so findings remain navigable after filtering.
- [x] Visualize actual evidence status counts without presenting them as scoring confidence.
- [x] Test filtering, malicious text, partial status, hash target reveal, and both locales.

## Task 3: Report and sample presentation

Files: `ReportPage.tsx`, `ScoreSummary.tsx`, `DimensionList.tsx`, `HomePage.tsx`, report/scan styles, a snapshot module and sample route, `vite.config.ts`.

- [x] Put an overview and dimension comparison before findings and secondary actions; label experimental signal direction and missing values.
- [x] Add pinned public repository metrics, JSON export, and a functional dispute link.
- [x] Build a shared static-preview mode using a fixed current public self-snapshot with an unscored total and no live API calls.
- [x] Add discoverable sample entry, polished homepage typography, and concise local-run guidance.
- [x] Verify 390/768/1440 layouts, light/dark themes, keyboard and reduced motion with the real browser.

## Task 4: Delivery

Files: `.github/workflows/pages.yml`, README files, `docs/assets`, this plan.

- [x] Build Pages from the same React code; update README and inspected screenshots.
- [x] Run full repository checks and E2E once integrated; rerun only failures or affected checks after fixes.
- [ ] Commit using GitHub noreply, push a PR, wait for required checks, merge, sync local main, verify live Pages and clean worktree.
- [x] Record genuine remaining calibration blockers and the review findings resolved in this phase.
