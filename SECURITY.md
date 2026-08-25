# Security Policy

DAYU is a 0.x pre-beta research preview. Security fixes may change interfaces while the project is still stabilizing.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature: open this repository's **Security** tab, choose **Advisories**, then **Report a vulnerability**. If private reporting is unavailable and the owner's profile has no private contact method, open a public issue containing only a request to enable private vulnerability reporting—do not name the affected component, impact, reproduction, or suspected flaw. Wait for a private channel before sharing any details.

Do not open a public issue, discussion, or pull request with an unpatched vulnerability, exploit, OAuth code, cookie, private repository content, access token, key, or provider response. Never send live credentials as a proof of concept. Use a minimal synthetic fixture and redact identifiers.

Include the affected commit or version, impact, prerequisites, a safe reproduction, and any suggested mitigation. We will acknowledge a report when the private channel is monitored, assess severity, coordinate a fix and disclosure window, and credit reporters who want credit. Because this is a volunteer pre-beta project, no response-time SLA is promised.

## Supported versions

Only the current `main` branch is under active security review during pre-beta. There is no supported production release yet. Operators should pin a reviewed commit, run all release gates, and follow [self-hosting guidance](docs/self-hosting.md).

## Security boundaries

DAYU supports public repositories only. Basic scans require no login. Optional Copilot analysis must use short-lived server-side GitHub tokens, minimal OAuth permissions, explicit consent, a bounded tool-free prompt, and prompt-visible Evidence IDs. Reports never prove bought stars or intent. A deployment that adds private repositories, broad GitHub scopes, permanent AI reports, client-side tokens, or deployer-owned AI fallback is outside the reference security model.
