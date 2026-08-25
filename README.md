# DAYU — Repo Reality Check

[简体中文](README.zh-CN.md) · **0.x pre-beta / research preview**

DAYU (大禹治水) is an evidence-first reality check for public GitHub repositories. Give it `owner/repo`; it compares visible popularity, repository substance, maintenance, community activity, and public claims, then shows the evidence behind every finding.

It is closer to a weather instrument than a courtroom. DAYU can surface unusual ratios, missing signals, and claim-to-repository mismatches. It **cannot prove that stars, follows, or watches were bought**, identify intent, or label a project or maintainer as fraudulent.

> Release status: this repository is a 0.x pre-beta research preview. The public Beta calibration gates have not been met. The included calibration files are small synthetic examples and support no public accuracy claim. Run `pnpm --filter @dayu/calibration evaluate` for the machine-readable status.

## What it does

- Scans public repositories without requiring GitHub login.
- Produces a bilingual Chinese/English rules report from public GitHub data.
- Separates five dimensions: popularity 25%, substance 25%, maintenance 20%, community 15%, and claims 15%.
- Shows data coverage, repository-type corrections, missing signals, counter-evidence, and stable Evidence IDs.
- Can optionally ask the signed-in user's own GitHub Copilot entitlement to review a bounded evidence packet. The base report works without Copilot.
- Creates a local share-card PNG; shared links trigger a fresh scan instead of publishing a permanent AI report.

GitHub's `watchers_count` is a historical alias for stars. DAYU reads stars from `stargazers_count` and true watches from `subscribers_count`; it never presents `watchers_count` as watchers.

## Current boundaries

DAYU analyzes public repositories only. The first release deliberately excludes private repositories, global rankings, maintainer-follower authenticity scores, permanent hosted AI reports, and claims that a project “bought stars.” Scores are withheld when usable coverage is below 60%; the report becomes facts-only or “insufficient evidence” instead of inventing precision.

The optional enhanced result is 70% deterministic rules and up to 30% user-authorized Copilot analysis. Copilot receives selected, size-bounded evidence with untrusted repository text treated as data, has no tools, and must cite prompt-visible Evidence IDs. It is disabled unless the host configures GitHub OAuth and the user explicitly consents. DAYU does not request repository read/write, organization, email, or private-repository scopes for enhancement.

Read the full [methodology](docs/methodology.md) and [privacy model](docs/privacy.md) before interpreting a result.

## Quick start

Requirements: Node.js 24+, pnpm 10, and Git.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
pnpm e2e
pnpm --filter @dayu/calibration evaluate
```

The API and web app are workspace packages under `apps/`; the E2E harness starts both on isolated local ports. The current repository is implementation-oriented and does not yet ship a one-command production launcher. See [self-hosting](docs/self-hosting.md) for the required production composition, OAuth callback, token vault, headers, rate limits, and shutdown behavior.

## Screenshots

Release screenshots are intentionally not checked in yet. The Playwright visual suite renders the real evidence report at 320, 768, and 1440 pixels during local and CI validation; reviewed, versioned screenshots will be added before public Beta. This avoids presenting an unreviewed pre-beta fixture as a production UI.

## Repository map

```text
apps/api                 Fastify API, scan jobs, OAuth and Copilot orchestration
apps/web                 React bilingual scan and evidence-report experience
packages/github-collector Public GitHub evidence collection
packages/scoring-core     Deterministic rules, coverage and score composition
packages/copilot-adapter  Tool-free, evidence-citing Copilot adapter
packages/calibration      Cohorts, golden-case evaluation and release gate
packages/evidence-schema  Versioned report and Evidence ID contracts
```

## Calibration and release status

Public Beta requires at least 5,000 public repositories spread across declared type/age/star/ecosystem cohorts, 120 qualifying blind-reviewed cases with balanced ordinary/risk and per-type coverage, a false-positive claim supported by a Wilson 95% confidence interval, a manifest-bound production scoring run, no unresolved high-severity release findings, and structured minimal-permission evidence from Copilot Free, Pro, and an organization-managed account. None of those real-world checks is inferred from the sample fixtures.

```bash
pnpm --filter @dayu/calibration evaluate                 # JSON report; exits 0 for inspection
pnpm --filter @dayu/calibration evaluate --require-beta  # exits non-zero until Beta-ready
```

The protected release workflow generates its evidence file during the current run after replaying every golden case through the real taxonomy and scoring packages, verifying a separate immutable reviewed-label manifest, rerunning structured security gates, and completing tool-free Copilot probes with three protected empty-scope OAuth tokens. GitHub `/user` identities must be distinct and match a protected, reviewed Free/Pro/organization account-class registry; only salted identity digests leave memory. Dependency findings and a required protected manual-review manifest are merged, every digest is recomputed, and any unresolved high or critical finding blocks release. Missing, expired, stale, or altered review data fails closed. A checked-in boolean, altered label, duplicated account, or stale SHA cannot satisfy this gate.

Stable v1 raises the calibration floor to 30,000 repositories and 600 double-reviewed cases. Details are in the [methodology](docs/methodology.md).

## Contributing and security

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md). Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md); never put tokens or exploit details in a public issue.

Licensed under the [Apache License 2.0](LICENSE).
