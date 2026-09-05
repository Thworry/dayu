# DAYU first steps and readable reports

## User direction

The user could not tell where to start on the hosted preview and explicitly requested a page that explains what it can do and where to click before showing the detailed report. Previous authorization is to execute sensible defaults, verify, and push completed changes without another approval round.

## Decision

Use a welcome page plus progressive report detail. Merely adding instructions above the existing report leaves the entry ambiguity unresolved. A mandatory multi-step wizard adds unnecessary navigation for returning users. The chosen approach gives new visitors two honest routes and keeps existing report anchors usable.

## Visual direction

A calm, approachable GitHub checking tool built around the existing paper, ink, and river-level motif, with readable sans-serif body text, restrained teal actions, and only brief control feedback.

- Preserve existing fonts and color tokens; body text remains comfortably readable in Chinese and English.
- Keep one main action per section and generous spacing, not additional decorative panels.
- Retain existing sharp border language and waterline motif; add no imagery or animation dependencies.
- Verify 390px, 768px, and 1440px, plus a 320px overflow check, keyboard navigation, dark mode, and reduced motion.

## Entry behavior

The static root `?lang=zh` or `?lang=en` opens a welcome page, not the sample. It says DAYU compares public repository signals and provides sources; it cannot prove bought engagement. Its primary action is to view a saved sample. A secondary action explains how to analyze another repository locally. Do not add a misleading scan input or automatically probe localhost.

Static sample URLs use `?lang=zh&view=sample` (English equivalent). Existing report-fragment links still open the sample, including evidence and section anchors. Locale switching preserves the current view and hash. The brand link returns to the welcome page. In the local app, `/zh` and `/en` remain the real scan homepage, with a labeled input, literal scan button, and visible sample route.

The local run guide includes Node.js 24+, pnpm 10, Git, clone/install/demo commands, and explicitly tells users to open the loopback URL printed by the launcher. It never promises a fixed port. No hosted backend or OAuth configuration is added.

## Report behavior

Lead with repository identity, concise status and two bounded observations at most: one positive and one caution from existing findings. Include each selected finding's caveat and a human-readable source action. Show total finding counts and explain that absence of a caution is not proof of quality. A short pre-beta/non-accusation notice and missing-data context remain visible.

Offer a clear next action to open detailed analysis. The full five dimensions, complete findings, coverage, evidence and technical collection metadata remain accessible through native disclosure controls. Do not remove evidence or alter scoring. Confidence, wherever displayed, stays adjacent to its heuristic-not-accuracy explanation. Do not show numeric overall scores for facts-only or insufficient reports.

Keep report components mounted while collapsed. Evidence and section links must open every closed disclosure ancestor before scrolling/focusing; repeated links and initial hashes must work. Filtering must not block a cited evidence target. Preserve language navigation, full JSON/PNG exports, unchanged Copilot review state, explicit consent and single-call/idempotency behavior. Copilot terminal status must not remain hidden in a collapsed region.

## Boundaries

Public repositories only. The static preview makes no scan, session, Copilot, fetch/XHR or WebSocket requests. Preserve its restrictive CSP. No token, report schema, taxonomy, score, calibration dataset, release gate, license or entitlement changes. Existing sample remains pinned to its actual capture date and commit. No Beta tag or accuracy claim.

## Acceptance

New visitors can identify purpose, sample action and local scan path from the welcome screen. Sample entry and return navigation work in both languages without API activity. Report initial view contains a short reading path rather than expanded evidence tables. Evidence anchors and full exports work from collapsed state. Existing functional/security tests pass, new navigation/disclosure regressions pass, and rendered desktop/mobile screenshots are inspected before publishing through a checked PR.
