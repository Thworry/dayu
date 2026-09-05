# DAYU evidence and experience upgrade

Approved scope: continue the user's default-execution authorization to review, improve, verify, and push DAYU. Preserve the pre-beta calibration gate and user-owned Copilot model.

## Product decisions

The most useful upgrade joins scoring correctness with report comprehension. Cosmetic-only polish would leave misleading confidence and missing-data behavior in place; a new scoring model would require real calibration we do not have. This phase fixes demonstrated defects and makes the existing evidence inspectable.

Art direction: a precise, approachable repository field report built around a hydrological observation station, using ink on warm paper, turquoise measured signals, amber review cues, generous headings, and compact evidence rows. Use the existing sans/mono system, 4/8/12/16/24/32/48 spacing, established tokens, crisp rules and restrained radii. No new charting or animation dependency.

## Scoring corrections

- Taxonomy confidence below 0.60 must produce facts-only output, preserving classification evidence and modifiers.
- Unverifiable/not-applicable Copilot judgments cannot add coverage or raise confidence. No score-bearing judgments means no numeric enhancement.
- Missing/restricted release evidence must not count as proof of absent releases in claim mismatch rules.
- Experimental global reference thresholds must not be described as validated cohort comparisons.
- Real calibration, independent blind review, and entitlement checks remain external release blockers.

## Report experience

Lead with repository context, observed public metadata, evidence completeness, and a clear five-dimension comparison. Every bar has an explicit higher-means-more-review direction and a missing-state distinct from zero. Place positive/caution findings before sharing and optional Copilot controls. Show measured evidence coverage separately from the confidence heuristic; neither is an accuracy estimate.

Evidence becomes an explorer: search by source, ID or content; filter complete/limited observations; expand details; keep valid finding-to-evidence navigation. Localize owned metric/limitation labels while preserving original untrusted text as source content. Never render repository text as markup. Provide a complete local JSON download and a working evidence-dispute issue link.

The public static preview reuses the React report UI with a pinned public DAYU snapshot, a visible capture date, local-only interactions, and a link to one-command local scanning. It has no live scanning, OAuth, or Copilot capability. The overall sample number is withheld; any dimension signal remains explicitly experimental. Replace the old hand-maintained HTML page and regenerate screenshots from the shared report experience.

## Acceptance

Meaningful regressions cover the three scoring defects, evidence filtering/deep links, unscored visualization, bilingual copy, JSON export, static-preview network boundary, mobile overflow, keyboard access, and serious/critical accessibility violations. Run existing lint/typecheck/test/build/E2E/security/license/link checks, verify Pages/CI/CodeQL, and merge through the existing protected PR path. No release tag without a real passing beta gate.
