# Contributing to DAYU

Thanks for helping make repository analysis more careful, explainable, and useful. DAYU is a pre-beta research preview, so contributions should improve evidence quality without turning uncertainty into accusation.

## Before you start

Read the [methodology](docs/methodology.md), [privacy model](docs/privacy.md), and [Code of Conduct](CODE_OF_CONDUCT.md). For a substantial scoring, data, OAuth, or Copilot change, open a focused proposal before investing in a large patch. Security reports belong in the private channel described in [SECURITY.md](SECURITY.md), not in issues or pull requests.

## Development

Use Node.js 24+ and pnpm 10.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm e2e
pnpm --filter @dayu/calibration evaluate
pnpm ci:secrets
pnpm ci:licenses
```

Do not add real access tokens, private repository content, actor lists, or provider responses to fixtures. Tests must be deterministic and network-free unless they are explicitly protected release-environment tests.

## Scoring and calibration changes

Every rule change needs fixture-based tests covering the intended signal, counter-evidence, missing or partial data, applicable repository types, new repositories, and at least one plausible false-positive case. Findings must cite valid Evidence IDs and use non-accusatory bilingual copy.

A pull request that changes a weight, threshold, taxonomy decision, missing-data behavior, confidence formula, normalizer, or golden case must include:

- the old and new version identifiers;
- an impact report from `@dayu/calibration` showing per-type distributions, changed cases, false positives and false negatives at 60 and 80, confidence intervals, and challenge outcomes;
- an explanation of cohort and repository-type effects;
- review provenance for any real golden-case label.

Never edit an immutable calibration snapshot in place. Add a new version. Any expected class, challenge label, reviewer count, blinded flag, review source, or review protocol change requires a new reviewed-label manifest and matching per-case provenance digest. Synthetic/sample data must remain explicitly classified and excluded from public accuracy claims. Do not claim the 5,000/120 Beta or 30,000/600 stable-v1 thresholds until the checked data and provenance satisfy the machine-readable gate.

## Privacy and Copilot changes

Keep public rules scans independent of login. Copilot must remain optional, tool-free, bounded to prompt-visible Evidence IDs, and powered by the consenting user's own entitlement. Changes may not add repository read/write, private-repository, organization, or email scopes. Include tests for injection text, forged Evidence IDs, HTML/SVG payloads, quota exhaustion, revocation, malformed output, timeout, cleanup, and base-report fallback.

## Pull requests

Keep commits focused and explain user-visible trade-offs. Update English and Chinese copy together, but write naturally in each language rather than translating word for word. Include commands run and results. Reviewers may ask for an evidence-boundary, security, accessibility, or calibration review before merge.

By contributing, you agree that your contribution is licensed under Apache License 2.0.
