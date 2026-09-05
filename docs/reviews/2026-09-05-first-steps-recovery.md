# First-steps implementation recovery record

## Resolution

The task resumed successfully on September 5, 2026. All missing welcome, navigation, disclosure, styling, test, and screenshot files were completed without resetting or rewriting existing work. The transport error did not recur during the recovered implementation.

Final local verification after recovery: `pnpm check` passed with 441 unit/integration tests, all 32 Playwright tests passed, the local demo smoke check passed, and documentation-link, secret, license, production-build, and production-dependency audit gates passed. The release evaluator still reports `pre_beta_not_ready`, as intended, because genuine calibration, blind review, protected-runtime evidence, and the live Copilot entitlement matrix remain incomplete.

## Verified state

- Current task: `开源——大禹治水`, thread `01a01c45-d5ed-7300-8dfa-474c3618ee7e`.
- Branch: `codex/dayu-first-steps`. Latest local commit: `3cdc4e9`; previous design/plan commit: `66fef8b`. Last merged main: `cb86f1c`.
- Preserve all tracked and untracked work. No reset, history rewrite, task replacement, or model change was performed.
- Three recent main-task turns failed after 745345, 746788, and 745110 ms with `stream disconnected before completion: Transport error: network error: error decoding response body`. Child tasks also reported remote-compaction transport failures. These messages do not identify whether the underlying fault is service-side or in the network path.
- The diagnostic turn successfully read the task, executed shell commands, and retrieved documentation. This confirms current tool communication, not a permanent repair of the transport service.
- `git diff --check` passes. The existing web readiness probe on 127.0.0.1:59142 and API health probe on 127.0.0.1:59143 both respond successfully. They do not prove the incomplete new source builds.

## State at interruption

The accepted design and implementation plan are in `docs/superpowers/specs/2026-09-05-dayu-first-steps-design.md` and `docs/superpowers/plans/2026-09-05-dayu-first-steps.md`.

Local homepage copy and its 11 tests, plus 4 i18n tests, passed before interruption and were already committed. README changes, report disclosures, reading components, and browser regression updates were present but unfinished.

At that point, the web typecheck failed because `preview-navigation.ts` and `PreviewHomePage.tsx` had tests but no implementation. `ReportPage.tsx` also imported the not-yet-created `styles/report-reading.css`. These gaps were completed during recovery.

## Recovery checklist completed

1. Implemented the welcome navigation helper and page, with an explicit saved-sample route, local guide, locale preservation, and legacy report-hash compatibility.
2. Finished report CSS and progressive disclosure while keeping complete exports and evidence mounted. Copilot producer labels, accessible evidence names, and local return paths were verified.
3. Updated focused and browser tests for intentional default collapse, repeated anchors, missing-data caveats, and lazy CSS loading.
4. Inspected both languages at mobile and desktop sizes, regenerated README screenshots, and completed all local gates before the checked PR workflow.

No Beta release or accuracy claim was made: real calibration and entitlement evidence remain incomplete.

Official troubleshooting reference: https://learn.chatgpt.com/docs/reference/troubleshooting
