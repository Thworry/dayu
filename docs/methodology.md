# DAYU methodology / 评分方法

This document is normative for the 0.x research preview. 中文说明与英文说明共享相同的公式、边界和版本号。

## Interpretation boundary / 如何解读

DAYU measures visible inconsistency risk in a public repository snapshot. It does not measure honesty, intent, legal compliance, code safety, or commercial value. A high signal means “inspect the cited public evidence”; it does not mean “fraud proven.” In particular, public GitHub data cannot establish that stars were purchased. False positives and false negatives remain possible.

DAYU 衡量的是公开仓库快照中的“不协调风险”，不是诚信、动机、合规性、代码安全或商业价值。信号较高只表示“值得检查引用证据”，不等于“已经证明造假”。公开 GitHub 数据尤其无法证明 star 是购买所得，误报和漏报都可能发生。

## Data boundary / 数据边界

Only public repositories are supported. The collector uses public repository metadata, the default-branch commit and tree, bounded file content, languages, community profile, issues, pull requests, releases, contributors, and true subscriber counts where GitHub returns them. Collection is bounded and may be partial because of rate limits, permissions, truncation, delayed statistics, external issue trackers, or deleted data.

GitHub field semantics matter:

- `stargazers_count`: stars.
- `watchers_count`: a legacy alias for stars, not true watches.
- `subscribers_count`: true repository watches/subscriptions.
- “follow” is not assigned a maintainer-authenticity score in v1.

Every collected fact has a stable Evidence ID tied to repository identity, source path or endpoint, and commit where applicable. Findings cite Evidence IDs; counter-evidence uses the same mechanism. A link is supporting context, not proof beyond the observed snapshot.

## Five dimensions and composition / 五维结构

The full enhanced score has exactly these maximum contributions:

| Dimension | Total | Deterministic rules | Optional Copilot |
| --- | ---: | ---: | ---: |
| Popularity / 人气 | 25% | 25% | 0% |
| Substance / 内容实质 | 25% | 15% | 10% |
| Maintenance / 维护状态 | 20% | 15% | 5% |
| Community / 社区 | 15% | 10% | 5% |
| Claims / 公开说法 | 15% | 5% | 10% |
| **Total** | **100%** | **70%** | **30%** |

The rules-only signal normalizes the available deterministic 70% to a 0–100 display scale. It is not silently treated as a completed 100% analysis. If Copilot is used, its contribution is capped at 30% and adjusted for applicable coverage, evidence-scope completeness, and sample adequacy. Copilot cannot alter the collected facts or the deterministic rules result.

Higher values mean greater visible inconsistency risk. DAYU does not call the value a probability of fraud.

## Rules, missing data, and repository type / 规则、缺失数据与类型校正

Rules compare observable ratios and claim-to-artifact relationships. Each rule declares its version, evidence dependencies, limitations, and positive counter-signals. Negative evidence is used only when the relevant collection scope is complete enough to support absence. Tree truncation, bounded activity samples, external trackers, generated or binary-heavy repositories, monorepos, new repositories, and mature stable projects add caveats or alter applicability.

Repositories are classified as software, documentation/content, data/model, template, creative demo, or generic. Fork, mirror, template, archived, generated-heavy, binary/LFS, monorepo, new-repository, and mature-stable modifiers prevent a one-size-fits-all comparison. Taxonomy confidence below 0.60 forces facts-only output: the evidence remains available, while type-dependent findings, dimension scores, and the overall score are withheld.

类型判断置信度低于 0.60 时，只展示公开事实，保留证据，不输出类型相关的风险判断、分项分数或总分。

Available weight is calculated from the dimensions for which required evidence is usable. Below 60% available weight, DAYU withholds the numeric score and returns `insufficient_evidence` or `facts_only`. Missing data never receives a neutral zero merely to make a complete-looking score. Confidence is reported separately from signal strength.

A release claim can only be checked against an observed workflow or a complete, usable release response. An unavailable release endpoint is not evidence of a missing release; that check is omitted and claim coverage falls accordingly.

## Cohorts and normalizers / 同类组与归一化

Calibration cohorts are stratified by repository type, age band, star band, and primary ecosystem. A versioned normalizer stores aggregate percentiles only; it must not contain repository names, actor identities, raw file content, or tokens. Snapshots are schema-validated, marked immutable, versioned, and bound to a collector/taxonomy manifest digest. Release eligibility also requires unique, substantive coverage across repository type, age band, star band, and at least three ecosystems; a single 5,000-row cohort cannot pass. Changing a snapshot creates a new file and version rather than editing history.

The repository currently includes a 12-row **synthetic example** carrying the `normalizer-v1` scoring payload. It exercises the schema and API/reference digest binding, but is excluded from public claims and production calibration by its `synthetic_sample` classification.

The current runtime applies the same experimental reference thresholds to all repositories. It does not select a matched cohort by type, age, stars, or ecosystem, and its values are not measured population percentiles. The stratified cohort requirements above describe the calibration work still needed; they are not a claim that current reports already compare a repository against real peers.

当前运行时使用统一的实验参考阈值，尚未按类型、年龄、Stars 或技术生态匹配真实同类仓库；报告中的信号等级不是实测的总体分位数。

Public Beta requires:

- at least 5,000 stratified public repositories in an aggregate normalizer;
- at least 120 blind-reviewed golden cases with structured review provenance, including at least 80 numerically scored ordinary cases and 40 numerically scored risk cases, plus at least five ordinary and five risk reviews per repository type (including audited facts-only cases);
- scores bound by digests to the current rules, taxonomy, normalizer, and protected production scoring pipeline;
- a threshold claim supported by its two-sided 95% Wilson interval;
- completed security/release gates and live minimal-permission Copilot entitlement checks.

Stable v1 requires at least 30,000 repositories and 600 double-reviewed golden cases. These are gates, not descriptions of work already completed.

## Golden cases and error reporting / 黄金案例与误差报告

The evaluator publishes false positives and false negatives separately at thresholds 60 and 80, two-sided 95% Wilson intervals for false-positive rates, per-type score distributions, changed cases, and challenge-set outcomes. Wilson intervals remain conservative when no false positive is observed; a tiny sample can never report a misleading `[0, 0]`. A claim of “at most 5% false positives at 60” is allowed only when the upper 95% confidence bound is at most 5%. The equivalent claim at 80 requires an upper bound at most 1%.

Facts-only and insufficient-evidence golden cases carry a null score and an explicit score kind, bound to the reviewed label and replayed report. They count as audited cases but never as numeric predictions, true negatives, or members of the 80/40 numeric populations. Evaluations publish abstention counts overall and by type; threshold error rates, confidence intervals, and score distributions exclude abstentions. An all-abstention dataset reports no accuracy and cannot pass the numeric population gates.

The release gate does not accept a caller-supplied evaluation. It selects qualifying, blind-reviewed, successfully replayed cases and recomputes all metrics internally. Copilot account checks and the zero-open-high-severity security review are structured current-workflow evidence, not booleans. The ordinary CI workflow reports pre-beta status for inspection; only the tag/manual release workflow runs the fail-closed `--require-beta` gate.

The checked-in golden cases are two small synthetic schema examples. They are not human-reviewed, do not represent real repositories, and support no accuracy, fairness, or efficacy claim. The release gate reports zero qualifying public/blind-reviewed cases for them.

Every production golden case carries a schema-validated canonical scoring input with its bounded public Evidence. At release time DAYU invokes the current repository taxonomy and `@dayu/scoring-core` itself, recomputes the report, canonical input digest, output digest, repository type, and dataset manifest, then compares them with the reviewed case. A separate reviewed-label manifest binds each exact scoring input and output to its expected class, challenge labels, blinded status, reviewer count, review source, and protocol version; each case's `review.provenance.manifestDigest` and the dataset-level manifest are recomputed. A stored score, review label, version string, or digest is never accepted on declaration alone. The API default and calibration snapshot consume the same exported `REFERENCE_SCORING_NORMALIZER`; a digest regression test prevents the two from drifting.

The protected workflow creates its evidence at runtime. Three separately protected empty-scope OAuth tokens must expose an empty `X-OAuth-Scopes` header and complete a bounded, tool-free synthetic session. The runner reads `id` and `login` from GitHub's `/user` response, proves that all three accounts are distinct in memory, and matches their numeric IDs against a separately reviewed account-class registry stored in the protected release environment. The runtime manifest binds the Free, Pro, and organization-managed classifications to salted identity digests, the current commit, and the current workflow-run ID. Only those digests enter the artifact; token values, model output, login names, and numeric user IDs are never written.

The composer also reruns dependency audit, secret scan, and license policy checks. A fourth, mandatory control consumes a structured manual-security-review source from the protected release environment. That source identifies findings only by non-sensitive ID, severity, count, and resolved/unresolved state; it contains a scope digest and reviewer count, never reviewer identity or vulnerability details. It must name the exact release commit, carry a valid source digest, and remain inside its short review window. The protected workflow turns it into a runtime manifest bound to the current commit and workflow-run ID.

Audit and manual findings are merged before release. The composer records all four control attestations, recomputes the source, runtime, findings, review, and overall report digests, and blocks any unresolved high or critical finding from either source. The evaluator repeats the consolidated integrity checks before accepting the current-run evidence file consumed by `evaluate --release-evidence … --require-beta`. Missing manual review, an expired review window, a mismatched commit, altered findings, missing controls, missing secrets, a mismatched account registry, duplicate accounts, stale artifacts, expanded scopes, Copilot failure, or sample-only calibration data stop the workflow.

## Optional Copilot review / 可选 Copilot 复核

Copilot is optional and user-authorized. The adapter selects a bounded evidence envelope, strips likely secret and personal-data fields, treats repository content as untrusted quoted data, disables tools, and requires citations to Evidence IDs visible in that exact prompt. Output is schema-validated, checked for unsupported citations and accusatory language, and discarded on timeout, quota exhaustion, malformed output, policy denial, or cleanup failure. In every failure case the base rules report remains available.

Only evidence-bound supported, mixed, or contradicted judgments contribute to AI coverage. Not-applicable and unverifiable rubrics do not increase confidence or dimension coverage. When no scoreable judgment survives, DAYU preserves the exact base report and explicitly reports that the analysis added no scoreable judgments. Restricted or unavailable evidence remains in the evidence-completeness denominator.

Copilot 返回“不适用”或“无法验证”不会提高置信度。没有可计分判断时，保留原始规则报告与分数，并明确说明本次分析没有增加可计分判断。

No live claim is currently made about Copilot Free, Pro, or organization-managed account compatibility. Those checks require real accounts in a protected release environment and remain an unmet Beta gate.

## Version changes / 版本变更

Reports pin collector, rule, normalizer, prompt, and rubric versions as applicable; calibration manifests additionally bind taxonomy and scoring-pipeline versions. Current runtime versions are `rules-v2`, `taxonomy-v2`, and `scoring-pipeline-v2`. Any weight, threshold, taxonomy, evidence-coverage, or normalizer change requires fixture tests and an impact report against the qualifying golden set. Historical output must not be silently reinterpreted under new rules; users should rescan for current data. The committed v1 synthetic JSON remains historical and cannot qualify a current release.
