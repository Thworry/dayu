# DAYU Pre-beta Hardening Implementation Plan

**Goal:** make the existing DAYU pre-beta independently testable, visibly honest, and safely governed while preserving the real beta gate.

**Architecture:** keep the TypeScript monorepo and production packages unchanged in responsibility. Add a loopback-only orchestration entry for the existing Fastify API and static React server, plus a separate static Pages preview backed by a pinned DAYU self-report. GitHub configuration is additive and inspected after mutation.

**Tech stack:** Node.js 24, pnpm 10, TypeScript, React, Fastify, Playwright, GitHub Actions, GitHub REST API, GitHub Pages.

## Task 1: Local demo and capability truth

- [ ] Add a Fastify process entry with validated host/port and graceful shutdown.
- [ ] Add a root `pnpm demo` launcher that builds, starts both services, polls readiness, and cleans up.
- [ ] Distinguish signed-out OAuth from unavailable OAuth in the browser contract.
- [ ] Keep rules-only scans usable when OAuth and Copilot are absent.
- [ ] Add unit and live smoke coverage for readiness, scan completion, and the unavailable-Copilot state.

## Task 2: Pinned self-report and public preview

- [ ] Generate a public-data rules-only report for `Thworry/dayu` pinned to a commit.
- [ ] Validate the report schema, Evidence ID references, missing data, and non-accusatory language.
- [ ] Build a static bilingual Pages preview that cannot run arbitrary scans or OAuth.
- [ ] Capture English desktop and Chinese mobile screenshots from the preview.
- [ ] Add a pinned Pages workflow with a narrow permission set.

## Task 3: First-screen documentation

- [ ] Reorder README around status, boundary, preview, `pnpm demo`, screenshot, and method.
- [ ] Add explicit captions that the snapshot is uncalibrated and cannot prove manipulation.
- [ ] Document public rate limits, loopback binding, and the static-only hosted preview.
- [ ] Keep the 5,000/120/Copilot matrix beta gate prominent and executable.

## Task 4: Community and security governance

- [ ] Add bilingual bug/feature issue forms, chooser configuration, and PR template.
- [ ] Add Dependabot updates for pnpm and GitHub Actions.
- [ ] Enable vulnerability alerts and automated security fixes; verify existing secret controls.
- [ ] Create a sole-maintainer-safe `main` ruleset with required proven CI checks, deletion/non-fast-forward protection, and admin recovery bypass.

## Task 5: Release environment and honest gate

- [ ] Create and inspect `public-beta-release` without self-locking reviewers.
- [ ] Confirm required evidence secrets by name without adding placeholders.
- [ ] Dispatch the release gate and record its real result.
- [ ] Create no tag or release unless every calibration, security, runtime, and Copilot matrix gate passes.

## Task 6: Final audit and delivery

- [ ] Sample both locales for equal facts/scores/Evidence IDs and safe wording.
- [ ] Run lint, typecheck, tests, E2E, link/license/secret checks, demo smoke, and diff checks.
- [ ] Verify the commit author uses the GitHub noreply address.
- [ ] Commit in reviewable phases, push `main`, wait for remote workflows, and inspect the final remote/worktree state.
- [ ] Report Beijing timestamps, links, gate results, and remaining external-evidence blockers.

