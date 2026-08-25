# Self-hosting DAYU

DAYU is a 0.x research preview, not a turnkey hosted service. The repository supplies the API, web application, contracts, tests, and security primitives; operators must compose the production entry point, credential providers, and durable infrastructure described here.

## Runtime baseline

- Node.js 24 or newer.
- pnpm 10 through Corepack (the repository pins the intended pnpm release in `packageManager`).
- A TLS-terminating reverse proxy or platform load balancer.
- A Redis-compatible store for production token records and distributed rate limits.
- A platform KMS or Secret Manager for encryption and HMAC key material.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
pnpm build
pnpm e2e
pnpm --filter @dayu/calibration evaluate
```

Do not deploy while the final command reports `pre_beta_not_ready` if your product description promises a Beta-calibrated service.

The public Beta release workflow also needs three protected, empty-scope OAuth tokens named `DAYU_COPILOT_FREE_TOKEN`, `DAYU_COPILOT_PRO_TOKEN`, and `DAYU_COPILOT_ORG_TOKEN`. It additionally requires `DAYU_COPILOT_IDENTITY_SALT` (at least 32 random characters) and a protected `DAYU_COPILOT_ACCOUNT_CLASS_MANIFEST` JSON value. The manifest is an immutable, separately reviewed registry shaped like `{"schemaVersion":"1","immutable":true,"auditSource":"github_protected_environment_registry","accounts":[{"account":"free","userId":123},{"account":"pro","userId":456},{"account":"organization_managed","userId":789}]}` with exactly one distinct numeric GitHub user ID per class. Treat the registry as sensitive even though release artifacts contain only salted identity digests. Review environment-secret changes and require release-environment approval.

The live runner rejects non-`gho_` credentials and any reported OAuth scope, reads `/user` to match the three tokens against that registry, uses no tools or repository content, and writes no login, numeric user ID, token, or model output. Keep all five values in the protected `public-beta-release` environment; never pass them as workflow inputs. The runtime composer writes to `$RUNNER_TEMP`, binds Copilot, scoring, label-review, and structured security evidence to `GITHUB_SHA` and `GITHUB_RUN_ID`, and the evaluator accepts that path through `--release-evidence`.

The same protected environment must contain `DAYU_MANUAL_SECURITY_REVIEW_SOURCE`. This JSON source has `schemaVersion`, `immutable`, `generatedAt`, `expiresAt`, `reviewedCommitSha`, `findings`, `review`, and `sourceDigest`. Each finding contains only `id`, `severity`, `count`, and `status` (`resolved` or `unresolved`); `review` contains only `reviewerCount` and a `scopeDigest`. Do not put vulnerability descriptions, affected private locations, reviewer names, emails, or account identifiers in it. Compute `sourceDigest` with the exported canonical `protectedManualReviewSourceDigest` helper, store the complete JSON only as a protected environment secret, and require a fresh review when the commit or expiration changes.

The release workflow validates that source, creates a mode-0600 runtime manifest in `$RUNNER_TEMP` bound to the current SHA and run ID, and passes its path to the evidence composer. Missing, expired, future-dated, commit-mismatched, or digest-mismatched review data fails closed. Dependency-audit findings and manual findings are merged; any unresolved high or critical item blocks the release, while resolved findings remain visible in the machine-readable evidence.

## Basic scans and GitHub API access

Rules-only scanning uses public GitHub endpoints and must remain usable without sign-in. Configure an operator-side public API token only if your rate-limit strategy requires one; never expose it to the browser or reuse it for Copilot. Respect GitHub 403/429 responses and `Retry-After`, cap pagination and response bytes, and keep partial-data limitations in the report.

The API supports `API_HOST`, `API_PORT`, `API_JOB_TTL_MINUTES`, and `API_TRUSTED_PROXIES`. Set trusted proxies to explicit IP addresses or CIDRs; never trust arbitrary forwarding headers. In-memory scan jobs suit single-process development. A horizontally scaled service needs a bounded shared job store with the same ownership and TTL semantics.

## Optional OAuth and Copilot

Copilot enhancement must remain disabled unless every required OAuth and vault component is configured successfully. The reference server registers unavailable auth routes when no auth dependency is supplied; do not replace this fail-closed behavior with partial environment detection.

Recommended operator configuration names are shown below as placeholders, not working credentials:

```text
DAYU_PUBLIC_ORIGIN=https://dayu.example
GITHUB_OAUTH_CLIENT_ID=<client-id>
GITHUB_OAUTH_CLIENT_SECRET=<secret-manager-reference>
GITHUB_OAUTH_CALLBACK_URL=https://dayu.example/api/auth/github/callback
DAYU_TOKEN_ENCRYPTION_KEY=<kms-key-reference>
DAYU_SESSION_HMAC_KEY=<secret-manager-reference>
DAYU_REDIS_URL=<tls-redis-url>
```

Load secrets directly from a KMS/Secret Manager integration where possible. Never commit `.env` files, print derived keys, put credentials in query strings, or use one key for encryption and HMAC. Rotate keys with a documented migration plan. Production token records must use the Redis-compatible `TokenVault` adapter or an equivalent store with atomic TTLs; the memory vault is for local, single-process development only.

Use a GitHub App user authorization token with zero repository permission if your live entitlement test confirms it works. If that exact protected test fails, use an empty-scope OAuth App. Do not request `repo`, repository write, organization, email, or private-repository permissions. DAYU has not yet completed the required live Copilot Free, Pro, and organization-managed account matrix, so treat compatibility as unverified.

The OAuth callback registered at GitHub must exactly match the public HTTPS callback. The public origin must be a single canonical origin with no path, credentials, wildcard, or trailing alternative host. Cookies must be Secure, HttpOnly, SameSite=Lax, and use the `__Host-` prefix in production. Keep PKCE, state, browser transaction binding, exact `Origin`, and CSRF checks enabled behind the proxy.

## Browser and response security

At the edge and application, verify these headers on HTML, API success, and API error responses:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

Do not add inline scripts, `unsafe-eval`, third-party analytics, or a broad `connect-src` without a threat review. If web and API are served on separate origins, update the CSP to the one explicit API origin and add an exact allowlist; never use `*` with credentials. Confirm repository HTML, SVG, Markdown, branch names, and AI output render as text or schema-bound data rather than executable markup.

## Rate limits and capacity

DAYU applies separate limits to public scans, OAuth starts/callbacks, session operations, and Copilot runs. Preserve the per-IP and per-user dimensions, concurrent-run caps, idempotency keys, bounded caches, response-body deadlines, and job TTLs. For multiple API instances, move counters to a Redis-compatible backend and namespace them by environment. Configure upstream GitHub backoff independently from user-facing abuse limits.

Size capacity for worst-case bounded collection and prompt envelopes, not average README size. Keep request bodies at or below the application limit. Do not retry Copilot on quota or policy failures with a deployer-owned credential.

## Health, logs, and graceful shutdown

Expose liveness and readiness separately at the platform. Readiness should fail until the job store, vault, KMS adapter, and required OAuth configuration are usable. It must not call Copilot or consume user quota. Health responses must not reveal configuration, versions beyond approved public component versions, or secrets.

Send `SIGTERM`, stop accepting new requests, fail readiness, allow bounded in-flight HTTP work to finish, cancel active Copilot runs, close Copilot sessions, close the vault/store, and then exit. Set an outer platform termination deadline longer than the application's cleanup budget. Test shutdown with an active scan and an active enhancement before production.

Use the safe structured logger only. The allowlist is request ID, route template, status, duration, stable error code, collector version, rules version, and SDK version. Redact all headers, cookies, query strings, OAuth codes, Evidence bodies, AI output, and token prefixes in the app, proxy, APM, and crash reporter.

## Preflight checklist

1. `pnpm check`, `pnpm build`, `pnpm e2e`, secret scan, license gate, production dependency audit, and link check pass.
2. HTTPS redirects and the exact OAuth callback work through the real proxy.
3. CSP, HSTS, nosniff, referrer, and permissions headers are present on success and failure paths.
4. Copilot routes are unavailable with OAuth configuration removed.
5. Logout deletes the vault record; disconnect revokes upstream before reporting success.
6. GitHub 403/429, truncated trees, delayed statistics, revoked tokens, Copilot quota exhaustion, malformed output, timeout, and shutdown all preserve the base report.
7. No real token appears in source, CI, fixtures, build output, logs, screenshots, or shell history.

Read [privacy](privacy.md), [methodology](methodology.md), and [security reporting](../SECURITY.md) before opening the service to other users.
