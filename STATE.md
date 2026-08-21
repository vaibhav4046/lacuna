# Current state

Updated 2026-08-21. This file describes the accepted V10 product tree and its
current production deployment. The current handoff is
[`docs/V10_RELEASE_STATUS.md`](docs/V10_RELEASE_STATUS.md); V8 matrices remain
dated evidence.

## Accepted product gate

- 84 unit test files and 1,384 tests passed with no skips.
- Root and web TypeScript checks pass.
- The production web bundle builds from 124 modules. The entry is 286.94 kB,
  94.25 kB gzip.
- Copy lint scans 57 files with zero findings.
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
- Text and Custom ingestion are `AVAILABLE`. GitHub, GitLab, Linear, Jira,
  Slack, Notion, Gmail, Confluence, PDF, Markdown, Documents, API, Webhook and
  Database source are `PLANNED`; none is `CONNECTED` or `SYNCING`. Spotify is
  not in the connector catalogue and is not implemented.
- The exact 399-character `package-session` blast-radius request is
  `NOT_PROVEN`. The subject is absent, the sentence exceeds the 300-character
  sentence API contract, and no Web, CLI or MCP blast-radius command carries
  that full request. The recorded hostile audit is
  `artifacts/verification/2026-08-21-v10/package-session-proof-audit.json`.
- The landing, dashboard, agents, tools, graph and mobile shell have been
  redesigned. Reduced motion disables non-essential movement.
- Voice browser/runtime routes are implemented and fixture-tested. Typed Ask
  remains available when the provider is absent.

## Accepted production

The stable URL is <https://lacuna-five.vercel.app>. It points to immutable
deployment `dpl_AbYNdVMkMSrYefbXy4h1e7v1hdr8`, built from product commit
`38d2672f93f6a54cffa3b5e5973ab312bd525147`. Web passed 9/9, demo/API passed
30/30, Google OAuth's pre-chooser boundary passed 16/16, and both normal and
reduced-motion route sweeps passed 198/198. The anonymous-agent 403 boundary
was also probed directly on that deployment. The public release branch contains
the exact accepted product source; publication to `main` remains a release
action rather than a product gate.

The selected narration voice is the verified ElevenLabs **Vaibhav Lalwani
Professional** clone. Raw clone audio stays local and gitignored so a biometric
voice asset is not redistributed. A narration render is not proof of the
product's live voice route; no provider-enabled STT/TTS/interruption session is
accepted in production.

The metadata-verified 179-second V8 MP4 is historical, was rejected by the
owner, and is not submission media. The V10 cut, Supademo, YouTube and form
submission remain open. The seven-tool public ChatGPT MCP proof is accepted;
Claude remains untested. A packaged Lacuna SDK and a Spotify connector are not
shipped capabilities, not pending claims. Nothing has been submitted or
uploaded.

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
- Existing pre-binding Google records deliberately fail closed until a separate
  verified migration/linking flow exists.
- MCP path-form capabilities may appear in infrastructure logs. Prefer
  `Authorization: Bearer <capability>` at `/mcp`; use
  `/mcp/w/<capability>` only when a client cannot set headers. Revoke the
  credential when finished even though it expires after 30 days.

## Submission boundary

Do not submit the hackathon form and do not upload or publish the final video.
Those are owner actions. Draft answers and an acceptance checklist are in
[`docs/SUBMISSION_FINAL.md`](docs/SUBMISSION_FINAL.md) and
[`docs/SUBMISSION_CHECKLIST.md`](docs/SUBMISSION_CHECKLIST.md).
