# Privacy / 隐私说明

DAYU is designed around public repository evidence and short-lived server-side credentials. This document describes the intended 0.x behavior; a deployment operator is responsible for publishing its own retention policy and provider configuration.

## Without sign-in / 不登录

A basic scan accepts only a public GitHub `owner/repository` reference. DAYU does not need the viewer's GitHub identity for this path. The in-memory scan job and report expire after a short configured TTL (30 minutes by default). Share links request a fresh scan; DAYU does not create a permanent public AI-report page.

Safe operational logs are allowlisted to request ID, route template, status, duration, stable error code, and component versions. Headers, cookies, query strings, OAuth codes, Evidence bodies, AI output, and token prefixes are excluded or redacted. Operators must not add raw request logging around these controls.

## GitHub OAuth and tokens / GitHub 登录与令牌

The optional Copilot path is disabled unless the operator configures OAuth and a secure vault. Authentication uses state, PKCE, a browser-bound transaction cookie, an HttpOnly session cookie, exact-origin checks, and CSRF protection. Access tokens stay on the backend, are encrypted before storage, are looked up through an HMAC-derived key, and expire no later than the configured short maximum (the current implementation caps records at eight hours). Refresh tokens are not stored in the first release.

DAYU needs identity authentication and a user token acceptable to the user's Copilot entitlement. It does **not** request `repo`, repository write, organization, email, or private-repository access for enhancement. Operators must preserve this minimal-permission boundary.

Logout deletes the local token record. “Disconnect GitHub” first asks GitHub to revoke the token and then deletes the local record; if revocation fails, the UI must report failure rather than pretending it succeeded. Expiry and unreadable vault records also trigger deletion. Graceful shutdown cancels active Copilot runs and closes the vault.

## Copilot processing / Copilot 处理

Enhancement consumes the signed-in user's own Copilot allowance or quota. Before sending, DAYU selects a bounded subset of public Evidence, removes likely secret/PII-bearing fields, and wraps repository text as untrusted data. It does not give Copilot tools or ambient repository access. The response is used for the current ephemeral report and is not permanently published by DAYU.

GitHub/Copilot may process and retain prompts, telemetry, and responses under the account's plan, organization policy, product settings, and the provider's then-current terms. DAYU cannot override or promise the provider's retention period. Operators must link their users to the applicable GitHub privacy and Copilot policy before enabling enhancement, and should disable it if those terms do not match their use case.

## Quotas, failures, and deletion / 配额、失败与删除

Quota exhaustion, policy denial, revoked credentials, invalid output, timeouts, and cleanup errors produce stable error codes, not raw provider messages. The base report remains usable. DAYU rate-limits scans, OAuth transactions, and Copilot runs; it does not retry indefinitely or switch to a deployer-owned AI credential.

To remove local data, log out or disconnect, then wait for ephemeral scan jobs to expire. A self-hosting operator must document backups and deletion behavior for its Redis-compatible store, KMS logs, observability system, and infrastructure provider. The reference design does not authorize long-term backups of tokens, prompts, Evidence bodies, or AI output.

## Not collected for scoring / 不参与评分

Private repository data is out of scope. Maintainer follower authenticity is not scored. Actor identities may be needed transiently to distinguish bots from humans in public activity, but calibration snapshots contain aggregates only—no logins, repository names, raw source content, or tokens.
