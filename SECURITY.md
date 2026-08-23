# Security policy

## Supported versions

Security fixes are applied to the current `main` branch and the production
release identified in [docs/V10_RELEASE_STATUS.md](docs/V10_RELEASE_STATUS.md).
Older hackathon snapshots and historical release branches are evidence, not
supported deployment targets.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting flow:

<https://github.com/vaibhav4046/lacuna/security/advisories/new>

Do not include a working exploit, credentials, private workspace content or
personal data in a public issue, pull request, discussion or screenshot.

A useful report includes:

- the affected route, client or component;
- exact reproduction steps with secrets removed;
- expected and observed behaviour;
- realistic impact and required preconditions;
- logs or traces with tokens, cookies and personal data redacted;
- a suggested fix when available.

If private vulnerability reporting is unavailable, open a minimal public issue
stating only that a private security contact is required. Do not publish the
technical details there.

## Security-sensitive surfaces

Reports are especially useful for:

- authentication, session, CSRF, OAuth and account-linking boundaries;
- private MCP capability issue, use, expiry and revocation;
- connector imports, signed webhooks and file parsing;
- cross-workspace reads or writes;
- credential storage or accidental logging;
- request cancellation, timeouts and serverless adapter differences;
- content that can become an authoritative claim without valid evidence.

## Public preview boundary

The public `/explore` workspace uses a reproducible synthetic corpus and is
read-only. That does not make authenticated workspaces, credentials or private
MCP capabilities public. Treat any cross-boundary access as a security issue.

## Secret hygiene

- Keep `.env.local` and provider tokens out of Git.
- Send private MCP capabilities in the `Authorization` header where supported;
  URL capability forms can appear in infrastructure logs.
- Redact cookies, bearer tokens, webhook secrets and personal source material
  from reports and recordings.
- Rotate a credential immediately if it is exposed, even if the exposure is
  later removed from the working tree.

The repository's dated security evidence and known limitations are tracked in
[docs/EVIDENCE_INDEX.md](docs/EVIDENCE_INDEX.md) and
[docs/V10_RELEASE_STATUS.md](docs/V10_RELEASE_STATUS.md).
