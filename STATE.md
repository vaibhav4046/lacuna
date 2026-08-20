# Current state

Updated 2026-08-20. This file describes the current V8 candidate, not the
historical V7 release. Detailed claim boundaries live in
[`docs/FINAL_CAPABILITY_MATRIX.md`](docs/FINAL_CAPABILITY_MATRIX.md) and
[`docs/FINAL_EXECUTION_STATE.md`](docs/FINAL_EXECUTION_STATE.md).

## Candidate verified locally

- 79 unit test files and 1,345 tests passed with no skips.
- Root and web TypeScript checks pass.
- The production web bundle builds from 104 modules. The entry is 282.06 kB,
  92.63 kB gzip.
- Copy lint scans 57 files with zero findings.
- Public and private graph APIs expose an interactive overview and an exact
  provenance table/DAG with signed cursor pagination.
- Two bounded, no-write agents run Researcher to Reviewer handoffs from a
  Context Pack. Memory-derived recommendations state their reason, evidence,
  permissions and budgets before any run or schedule is created.
- Daily schedule creation, run-now, retry and cancellation exist. The cron
  dispatcher discovers private workspaces server-side and authenticates before
  reading the registry.
- Google OAuth verifies Google's RS256 signature and claims, uses state, PKCE
  S256 and nonce, and binds an account to the provider's stable subject.
- Password recovery rotates a credential epoch and invalidates every older
  30-day session.
- Hosted password signup is disabled. HydraDB's current writer cannot provide
  the atomic unique create needed to make same-email password signup safe.
- Private MCP uses a 256-bit random revocable bearer stored digest-only. The
  workspace comes from the signed-in account, never from request input. Body,
  request, tool, write and issuance limits are enforced.
- Hydra Cloud configuration accepts only the exact canonical HTTPS origin, so
  a lookalike host cannot receive the bearer through misconfiguration.
- The landing, dashboard, agents, tools, graph and mobile shell have been
  redesigned. Reduced motion disables non-essential movement.
- Voice browser/runtime routes are implemented and fixture-tested. Typed Ask
  remains available when the provider is absent.

## Production acceptance still required

The stable URL is <https://lacuna-five.vercel.app>. It currently represents
the last accepted V8 deployment, not every uncommitted candidate change above.
After deployment, rerun web/demo/auth/graph/agent/schedule/MCP browser gates and
verify OAuth cache headers from the live origin.

The final-candidate narration uses the verified ElevenLabs **Vaibhav Lalwani
Professional** clone, voice id `GAeq3X4y41cIseBkBfsS`, with Eleven Multilingual
v2. The 177.3975-second source MP3 is stored under
`video/hyperframes/assets/narration-vaibhav/`. This proves the film narration,
not the product's live voice route. No provider-enabled STT/TTS/interruption
session is installed or accepted in production.

A metadata-verified 179-second final-candidate MP4 exists at
`video/hyperframes/renders/lacuna-v8-judges-master-vaibhav.mp4`. Owner approval,
Supademo, YouTube, ChatGPT custom-app proof, Claude MCP proof, Spotify, and the
packaged Lacuna SDK remain open. Nothing has been submitted or uploaded.

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
- MCP path-form capabilities may appear in infrastructure logs. Prefer the
  `Authorization: Bearer` header and revoke the credential when finished.

## Submission boundary

Do not submit the hackathon form and do not upload or publish the final video.
Those are owner actions. Draft answers and an acceptance checklist are in
[`docs/SUBMISSION_FINAL.md`](docs/SUBMISSION_FINAL.md) and
[`docs/SUBMISSION_CHECKLIST.md`](docs/SUBMISSION_CHECKLIST.md).
