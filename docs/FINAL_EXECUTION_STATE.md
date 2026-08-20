# V8 execution state

Measured 2026-08-20. The accepted production build and the uncommitted security
candidate are kept separate. Dated V7 audits are history.

## Release identity

- Repository: `vaibhav4046/lacuna`
- Production: <https://lacuna-five.vercel.app>
- V8 product commit: `d1f41e32c5707cfd872f4c2fbe4ea7182ad8788d`
- V8 acceptance-media commit and deployment source: `9aeb4cd`
- Documentation acceptance commit: `c6d684e`
- Current production deployment inspected 2026-08-20:
  `dpl_4y81oRF31j1d4iUUKSSY4V7bZWsN`
- Current immutable URL:
  <https://lacuna-htdff1nt5-vaibhav4046s-projects.vercel.app>
- HydraDB: managed production source, with the self-hosted contract pinned in
  `SOURCE_LOG.md`

## What is live

The browser, REST boundary, CLI, stdio MCP and public Streamable HTTP MCP project
the same temporal read contract. The seeded public workspace measured 453 nodes
and 682 edges on the acceptance deployment. Overview and proof are separate
projections of that dataset; pagination uses an opaque HMAC-signed cursor.

Two built-in agents are persisted per workspace. A production Researcher →
Reviewer run completed through `CREATED`, `QUEUED`, `RUNNING`, `WAITING_TOOL`,
`RUNNING`, `HANDOFF`, `RUNNING`, `COMPLETED`. The reviewer approved the bounded
two-claim/two-evidence pack and no authoritative write occurred.

One daily context-health schedule was observed persisted. The Vercel cron
endpoint uses a server-only bearer secret, and the candidate dispatcher
enumerates workspaces server-side. Manual run-now exists only in an
authenticated workspace with CSRF protection. The local file store serializes
claims atomically within one process. HydraDB supplies no compare-and-swap or
transaction for this adapter, so concurrent serverless instances do not have a
distributed exactly-once guarantee.

Voice routes and the browser state machine are implemented but not
provider-enabled in production. Tests cover single-use Scribe token handling,
server-side TTS, exact Origin, CSRF, workspace scope, rate limits,
cancellation, audio backpressure and no-store responses. No end-to-end provider
audio session has been accepted. With the current environment the production
result is `503 speech_unavailable`, and typed Ask remains available.

Google sign-in is held below production release acceptance. The previous
callback matched an existing account by email and could silently merge a Google
identity into a password-created account whose email had not been verified.
The candidate now integrates provider/subject binding, RS256/JWKS verification,
PKCE, nonce, no-store redirects and negative HTTP account-merge tests. A fresh
identity browser pass on the deployed build remains the gate.

Private MCP is also a candidate, not a shipped production claim. The working
tree has signed-in CSRF-protected issue/revoke routes, 256-bit random revocable
capabilities, digest-only persistence, bounded request bodies, cross-workspace
refusal and private rate-limit buckets. Router wiring and HTTP negatives pass;
deployment and an external-client issue/use/revoke probe remain.

## Measured gates

| Gate | Result |
| --- | --- |
| unit suite, current candidate | 79 files, 1,345 tests, all passed |
| root TypeScript | passed |
| web TypeScript | passed |
| production web build | passed; 104 modules; entry 282.06 kB / 92.63 kB gzip |
| npm audit | zero known vulnerabilities at the recorded run |
| public production health | HTTP 200 |
| production web smoke | 9/9 passed against the acceptance deployment |
| production demo smoke | 30/30 passed against the acceptance deployment |
| seeded public graph API | 453 nodes, 682 edges; overview and proof on the accepted deployment |
| agent API | 2 agents, 1 completed run, 8 lifecycle events |
| schedule API | 1 daily definition observed; not distributed exactly-once |
| landing axe WCAG A/AA | 0 violations |
| landing overflow | 0 px at 390×844 and 1440×900 |
| normal-motion route matrix | 198/198: 22 routes × 9 viewports, clean |
| reduced-motion route matrix | 198/198: 22 routes × 9 viewports, clean |
| graph, proof, agents and voice axe | 0 WCAG A/AA violations |
| final-candidate video | 11 scenes, 179.0 seconds, 1920x1080 at 30 fps, audio present; one second under the three-minute limit; HyperFrames artifact validation passed; owner approval pending |

The repository contains a metadata-verified 179-second final candidate with the
verified Vaibhav Lalwani Professional narration and burned-in sentence captions.
There is no owner-approved submission master, Supademo walkthrough, or YouTube
link. ChatGPT and Claude have not been run against Lacuna. The existing
continuity artifact covers Lacuna web, CLI and MCP, not those products.

## Named limitations

No ElevenLabs server credentials are installed. No Spotify, Slack, Notion,
Gmail or Linear OAuth connector is claimed. No packaged Lacuna SDK is shipped.
The CLI and MCP expose the temporal read contract but not agent lifecycle
commands. ChatGPT Pro's provider contract is read/fetch only; there is no Lacuna
client proof yet. The HydraDB schedule adapter persists definitions and claims,
but cannot claim atomic multi-instance idempotency, leases, quotas or exactly
once execution. The ingest quota is process-local and registry discovery is
sequential. External-client prompts and publication remain human actions.
