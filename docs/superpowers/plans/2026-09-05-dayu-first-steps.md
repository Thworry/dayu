# DAYU first steps implementation plan

> For agentic workers: execute the bounded tasks below with independent implementation and review. The named superpowers execution sub-skills are not available in this session; use the existing collaboration tools and explicit acceptance gates instead.

**Goal:** Explain what DAYU does and where to begin before showing detailed report material.

**Architecture:** A lightweight static welcome route leads to the existing pinned React sample. Local scanning retains its current API path. Mounted report components use accessible disclosures and reveal-on-anchor behavior without changing evidence or scoring.

**Tech Stack:** TypeScript, React, existing CSS tokens, Vitest/Testing Library, existing Playwright suite, Vite static Pages build.

## Global constraints

- Public-only, pre-beta, no accuracy or manipulation-proof claim.
- No new dependencies, backend, OAuth scopes, telemetry, calibration or scoring changes.
- Static root is welcome; sample is `?lang=<locale>&view=sample`; old report hash links remain valid.
- Collapsed state must not truncate JSON/PNG exports, lose evidence navigation, or restart Copilot.
- Keep existing GitHub noreply authorship and pass PR gates before merging; no release tag.

### Task 1: Welcome and navigation

**Files:** Create `apps/web/src/routes/PreviewHomePage.tsx`, `apps/web/src/app/preview-navigation.ts`, related tests and `apps/web/src/styles/preview-home.css`; modify `main.tsx`, `SiteShell.tsx`, `SamplePage.tsx` and their tests.

**Interfaces:** `previewPath(locale: Locale, view: "home" | "sample", hash?: string): string`; `previewView(search: string, hash: string): "home" | "sample"`; `PreviewHomePage({locale}: {locale: Locale})`. Existing `SamplePage({locale})` remains unchanged at its call boundary.

- [ ] Test view selection and URL generation: default root, explicit sample, legacy `#evidence-*` and known section hashes, unrelated home hashes, language view preservation.
- [ ] Implement the route decision before importing sample data:

```ts
const view = previewView(window.location.search, window.location.hash);
if (view === "sample") {
  const { SamplePage } = await import("./routes/SamplePage.js");
  application.render(<SamplePage locale={locale} />);
} else {
  const { PreviewHomePage } = await import("./routes/PreviewHomePage.js");
  application.render(<PreviewHomePage locale={locale} />);
}
```

- [ ] Welcome copy states purpose, fixed-sample boundary, main sample button and local-run guide. Guide commands are `git clone https://github.com/Thworry/dayu.git`, `cd dayu`, `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm demo`; users open the printed URL. Do not put a fixed localhost link on public Pages.
- [ ] Use `previewPath` for shell home/sample/locale navigation; preserve hashes on sample locale changes. Sample notice includes return-home and distinguishes local scan route from hosted setup guide.
- [ ] Run new focused tests, web typecheck and lint; report file ownership and outcomes to integrator.

### Task 2: Readable report and disclosures

**Files:** `ReportPage.tsx`, `ScoreSummary.tsx`, `EvidencePanel.tsx`, optional focused reading/disclosure components and CSS; related unit tests. Do not edit global locale catalogs concurrently; keep new copy in a task-owned typed bilingual module.

**Interfaces:** Existing report/score props remain compatible. A new reading component consumes `ReportSnapshot` and `Locale`, never writes report state. Detail wrappers keep their child components mounted. A shared ancestor reveal helper can accept an `HTMLElement` and set closed parent `HTMLDetailsElement.open = true`.

- [ ] Test initial readable state, visible status/boundaries and bounded positive/caution observations. Assert a raw evidence source starts hidden until the user chooses detail.
- [ ] Make identity/status compact, retain pre-beta and heuristic confidence context, and defer branch/SHA/versions. Render the first positive and first caution with existing `findingMessage`/`caveatMessage`; use neutral existing empty states.
- [ ] Use native disclosures for full analysis/evidence. Test native summary activation, preserved content and independent manual collapse.
- [ ] Reveal ancestors before focus:

```ts
let ancestor = target.parentElement;
while (ancestor !== null) {
  if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
  ancestor = ancestor.parentElement;
}
target.focus({ preventScroll: true });
target.scrollIntoView({ block: "start", behavior: "instant" });
```

- [ ] Cover initial/repeated evidence hashes and existing section hashes. Keep filter reset and open raw record behavior; assert target visibility and focus from closed/filter-empty state.
- [ ] Preserve download/consent/terminal states without adding requests. Assert full JSON equality while details are closed and no-change locale navigation retains one Copilot call.
- [ ] Run focused tests and report actual results; integrator owns final E2E changes and acceptance.

### Task 3: Local homepage, integration and delivery

**Files:** `HomePage.tsx`, home locale keys in `packages/report-i18n/src/messages/{en,zh}.ts`, `README.md`, `README.zh-CN.md`, `tests/e2e/{basic-scan,copilot-flow,sample-preview}.spec.ts`, review record and screenshots.

- [ ] Make local action literal: paste repository, start analysis, read observations, inspect sources. Put optional Copilot information after the basic path and identify this as the running app.
- [ ] Update static browser acceptance to start from welcome, click sample, switch locale while retaining view/hash, return home, and navigate legacy hashes. Assert zero API connections and preserved CSP.
- [ ] Update existing report E2E to open relevant disclosures before inspecting detail; add keyboard/narrow-screen default entry assertions without weakening scoring, privacy or accessibility gates.
- [ ] Run `pnpm check`, `pnpm e2e`, `pnpm demo:smoke`, `pnpm ci:links`, `pnpm ci:secrets`, `pnpm ci:licenses`, production dependency audit and strict release gate (expected honest pre-beta block).
- [ ] Inspect real 390/768/1440px screenshots and 320px overflow, both languages and reduced/dark states. Update README first-screen image to the welcome page and keep separately labeled historical report screenshots.
- [ ] Commit/push checked changes, open PR, wait for required checks, merge normally, verify main CI/CodeQL/Pages and live user flow. Record final links, clean worktree and Beijing time.
