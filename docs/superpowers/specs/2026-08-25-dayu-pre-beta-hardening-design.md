# DAYU Pre-beta Hardening Design

- Status: approved continuation of the DAYU 0.x design
- Date: 2026-08-25
- Scope: verifiable demo, repository governance, and honest release readiness

## Outcome and non-negotiable boundary

This phase makes DAYU easier to verify without overstating what it can prove. DAYU remains a pre-beta research preview until the committed 5,000-repository calibration, 120-report blind review, and GitHub Copilot Free/Pro/organization evidence matrix all pass. A failed or incomplete gate is a published blocker, never a reason to set `beta_ready`, create a tag, or claim production readiness.

DAYU reports public-signal mismatch and uncertainty. It cannot prove bought stars, fake engagement, fraud, or intent. Every public surface—README, preview, screenshots, sample report, UI, release notes, and repository metadata—must preserve that distinction.

## Experience decision

### One-command local demo

`pnpm demo` is the primary verifiable product path. It builds the web client, starts the public-data Fastify API and static web server on loopback, waits for readiness, prints Chinese and English URLs, and shuts down both children cleanly. The demo:

- analyzes public repositories with deterministic rules;
- requires no OAuth, GitHub token, Copilot entitlement, or cloud account;
- never clones, installs, builds, or executes repository content;
- identifies itself as uncalibrated, rules-only pre-beta output;
- explains that public unauthenticated GitHub limits can produce partial data;
- treats unavailable OAuth as a capability state instead of showing a broken sign-in action.

### Public preview

The hosted surface is a static GitHub Pages preview, not a hosted scanner. It uses a fixed DAYU self-report and clearly labels it as an uncalibrated rules-only snapshot. It does not accept arbitrary repository input, call the live API, store OAuth tokens, invoke Copilot, or imply that the snapshot proves manipulation. The preview provides links to the source, methodology, local demo instructions, and limitations.

Screenshots are produced from that same DAYU self-report at a pinned commit. Third-party mock reports and evidence links must not be published. At minimum the repository contains a desktop English screenshot and a mobile Chinese screenshot, each with an adjacent disclaimer in README.

The repository Homepage is set to the Pages URL only after the deployment succeeds.

## Report integrity acceptance

An audited sample must demonstrate all of the following:

- each scored finding cites existing Evidence IDs;
- file evidence is pinned to the analyzed commit;
- confidence is described as coverage and reliability, not probability of truth;
- missing or restricted data reduces coverage and never becomes risk evidence;
- below the 60% evidence threshold, no pseudo-precise total score is shown;
- repository-type adjustments remain visible and deterministic;
- positive and counter-evidence are present where available;
- Chinese and English render the same facts, scores, missing signals, and Evidence IDs;
- prompt-injection-like repository text remains quoted untrusted evidence and cannot alter instructions, tools, scores, or schema;
- Copilot remains optional and cannot silently replace the 70% deterministic result.

## GitHub governance

The repository receives bilingual bug and feature issue forms, an issue chooser, and a PR template that asks for tests, evidence/copy impact, privacy impact, and boundary compliance.

A personal-maintainer-safe ruleset targets `main`. It blocks deletion and non-fast-forward updates and requires the stable CI checks that actually report on pull requests. It does not require an external approving reviewer, signed commits, or another control that would lock out the sole maintainer. An explicit repository-admin bypass remains available for recovery. The configuration is inspected after creation.

Compatible security automation includes Dependabot configuration for pnpm and GitHub Actions, vulnerability alerts, automated security fixes, existing secret scanning/push protection/private reporting, and CodeQL only when it reports reliably without duplicating or breaking the current CI contract.

Future commits use `31728500+Thworry@users.noreply.github.com`. Existing public history is not rewritten for attribution.

## Release environment and decision

Create the `public-beta-release` Environment without deployment reviewers that would self-lock the maintainer. Restrict deployment to the intended protected branch/tag policy where GitHub supports it. Its release workflow continues to require real, environment-scoped evidence secrets:

- Copilot Free, Pro, and organization tokens;
- identity salt and account-class manifest;
- manual security-review evidence.

No placeholder secret is accepted. The release gate is run after the Environment exists. Expected missing credentials, insufficient calibration, or any failed workflow remains a concrete blocker with a reproducible remediation command. Only a genuine all-green beta gate authorizes a version tag and GitHub Release.

## Failure and fallback behavior

- If public GitHub rate limits the demo, show partial/unverifiable data and a retry explanation.
- If OAuth is unconfigured, rules-only scanning stays usable and the sign-in control is replaced by an unavailable-capability notice.
- If Pages cannot deploy, README still ships the verified local path and committed screenshots; Homepage is not pointed at a broken URL.
- If a governance API is unavailable on the repository plan, keep the repository files, report the exact API response, and do not claim the control is active.
- If security automation produces unstable required checks, do not add those check names to the ruleset until a successful pull-request run proves them.

## Verification gates

Local acceptance requires formatting, lint, type checking, all unit/integration tests, E2E tests, secret/license/link checks, demo smoke tests, screenshot inspection, and `git diff --check`. Cloud acceptance requires green CI/Pages runs, verified Homepage, inspected Environment, templates, ruleset, and security settings.

Release acceptance additionally requires the real calibration and Copilot matrix already specified by DAYU. Without it, this phase ends as a polished pre-beta with an explicit release blocker and no tag.

