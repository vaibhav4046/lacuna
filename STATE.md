# Current state

Updated 2026-08-22. This file describes the accepted V10 product tree and its
current production deployment. The current handoff is
[`docs/V10_RELEASE_STATUS.md`](docs/V10_RELEASE_STATUS.md); V8 matrices remain
dated evidence.

The accepted production deployment remains `dpl_6f9rhpqCTsdDcyvoR5VN489nP1vF`.
Candidate commits `b11b471`, `c48d58d`, `1264423`, `356190c`, `5451bf8`,
`dc5c343`, `35c32cd`, `6feb07a`, `c4f13e8`, `e3c24ab`, `9aa5440`,
`bf987e2`, `750a9f5`, `3dafaa9`, `a9542ed`, `292532a` and `894c03d`
add durable-read/session routing fixes, GitLab observation persistence,
LongMemEval evidence alignment, bounded DOCX XML extraction, and idempotent
browser agent retries, duplicate-submit auth and Work guards, and remove the
obsolete DOCX parser dependency. They are
pushed to `v10-zeus-release` but could not be promoted on 2026-08-22 because
Vercel rejected new deployments after the free daily deployment quota was
exhausted.

The latest candidate passes the complete serial unit suite: 117 files and
2,282 tests, with no skips.

## Accepted product gate

- 117 unit test files and 2,271 tests passed with no skips in the latest serial verification.
- Root and web TypeScript checks pass.
- The production web bundle builds from 139 modules. The entry is 306.97 kB,
  100.66 kB gzip.
- Copy lint scans 58 files with zero findings.
- Public and private graph APIs expose an interactive overview and an exact
  provenance table/DAG with signed cursor pagination.
- Two bounded, no-write agents run Researcher to Reviewer handoffs from a
  Context Pack. Memory-derived recommendations state their reason, evidence,
  permissions and budgets before any run or schedule is created.
- The public workspace is read-only in production:
  `POST /api/explore/agent/run` and its legacy `/api/demo` alias return
  `403 public_preview_read_only` before reading a body or calling a provider.
  Existing public run records remain inspectable. Authenticated, CSRF-protected
  `/api/workspace/agent/run` still creates a real workspace-scoped run.
- Daily schedule creation, run-now, retry and cancellation exist. The cron
  dispatcher discovers private workspaces server-side and authenticates before
  reading the registry.
- Google OAuth verifies Google's RS256 signature and claims, uses state, PKCE
  S256 and nonce, and binds an account to the provider's stable subject.
- Password recovery rotates a credential epoch and invalidates every older
  30-day session.
- Workspace/profile updates are isolated from credential records, so an
  in-flight rename cannot restore a pre-recovery password or session epoch.
- Hosted password signup is disabled. HydraDB's current writer cannot provide
  the atomic unique create needed to make same-email password signup safe.
- Private MCP uses a 256-bit random bearer stored digest-only. It expires 30
  days after issue, can be revoked earlier, and issuance returns `createdAt`
  plus `expiresAt`. Capabilities fail at `expiresAt`; version-1 records fail
  closed and must be reminted after rollout. The workspace comes from the
  signed-in account, never from request input. Body, request, tool, write and
  issuance limits are enforced.
- Hydra Cloud configuration accepts only the exact canonical HTTPS origin, so
  a lookalike host cannot receive the bearer through misconfiguration.
- Production answers use HydraDB Cloud as a collection-scoped addressed-record
  store. Lacuna fetches those deterministic entity records and applies temporal
  standing, contradiction, abstention and multi-hop resolution in application
  code. The native Cypher adapter and 162-query compatibility probe target a
  separate self-hosted HydraDB node; they are genuine proof, not the deployed
  answer path.
- One-off file ingestion (TXT/MD/JSON/CSV/PDF/DOCX), public GitHub and GitLab
  snapshot imports, public HTTPS/API import, and signed bounded webhook
  delivery are implemented workflows. The production redacted catalogue
  exposes eight descriptors and marks each available when its server-side
  support is configured. Linear, Jira, Slack, Notion, Gmail, Confluence,
  Database source and Spotify remain planned.
- The exact 399-character `package-session` blast-radius request is
  `NOT_PROVEN`. The subject is absent, the sentence exceeds the 300-character
  sentence API contract, and no Web, CLI or MCP blast-radius command carries
  that full request. The recorded hostile audit is
  `artifacts/verification/2026-08-21-v10/package-session-proof-audit.json`.
- The landing, dashboard, agents, tools, graph and mobile shell have been
  redesigned. Reduced motion disables non-essential movement.
- Voice browser/runtime routes are implemented and fixture-tested. Typed Ask
  remains available when the provider is absent. Candidate browser playback
  and connector response readers now cancel stalled streams instead of leaving
  the UI busy. Candidate Google token/JWKS JSON reads share the provider
  deadline, and landing overlays are shielded from particle labels.
- LongMemEval has a scoped exact-span personal-memory bridge for explicit
  first-person facts. The oracle ingest check reads all 500 records with zero
  adapter failures and zero ground-truth leaks, producing 128 claims across
  84 records (16.8% ingest coverage). No official score is claimed.

## Accepted production

The stable URL is <https://lacuna-five.vercel.app>. It points to immutable
deployment `dpl_6f9rhpqCTsdDcyvoR5VN489nP1vF`, built from release commit
`d5f9d02`. Post-deploy checks passed HydraDB health, Google OAuth start with
PKCE/state/nonce and `Referrer-Policy: no-referrer`, malformed callback
fail-closed handling, and private auth CSRF refusal. Public `main` and the
release branch contain the accepted product source.

The selected narration voice is the verified ElevenLabs **Vaibhav Lalwani
Professional** clone. Raw clone audio stays local and gitignored so a biometric
voice asset is not redistributed. A narration render is not proof of the
product's live voice route; no provider-enabled STT/TTS/interruption session is
accepted in production.

The 179-second V8 MP4 is historical and rejected. The V10 master is machine
accepted at 178.500 seconds, 1920×1080/30 fps with H.264 video, AAC audio and a
full decode pass; its SHA-256 is
`e73e6e0bf1de598b3c1c998a43057ac06e8dcb3b492a19d3ac8623c8d9cb9d96`.
The owner's uninterrupted watch, Supademo, YouTube upload and form submission
remain open. The seven-tool public ChatGPT MCP proof is accepted; Claude remains
untested. A packaged Lacuna SDK and a Spotify connector are not shipped
capabilities. Nothing has been submitted or uploaded.

## Remaining engineering limits

- HydraDB's adapter exposes no CAS or transaction. Cloud scheduler leases,
  agent idempotency, quotas and workspace registry updates are not
  distributed-atomic across serverless instances. Do not claim exactly once.
- Provider work can begin twice during a multi-instance race before a shared
  run record collapses the result.
- API budgets are process-local. They are useful guardrails, not distributed
  billing controls.
- The cron registry scan is sequential and needs sharding or a durable queue at
  large tenant counts.
- CLI and MCP share canonical memory/evidence reads but do not expose agent
  lifecycle controls.
- Existing pre-binding Google records deliberately fail closed until the signed
  in owner completes the verified Settings → Link Google migration flow.
- MCP path-form capabilities may appear in infrastructure logs. Prefer
  `Authorization: Bearer <capability>` at `/mcp`; use
  `/mcp/w/<capability>` only when a client cannot set headers. Revoke the
  credential when finished even though it expires after 30 days.

## Submission boundary

Do not submit the hackathon form and do not upload or publish the final video.
Those are owner actions. Draft answers and an acceptance checklist are in
[`docs/SUBMISSION_FINAL.md`](docs/SUBMISSION_FINAL.md) and
[`docs/SUBMISSION_CHECKLIST.md`](docs/SUBMISSION_CHECKLIST.md).
