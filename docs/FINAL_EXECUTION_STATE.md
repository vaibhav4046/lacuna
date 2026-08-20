# V8 final execution state

Measured 2026-08-20. This file is the current state; dated V7 audits are history.

## Release identity

- Repository: `vaibhav4046/lacuna`
- Production: <https://lacuna-five.vercel.app>
- V8 product commit: `d1f41e32c5707cfd872f4c2fbe4ea7182ad8788d`
- V8 acceptance-media commit and deployment source: `9aeb4cd`
- V8 production deployment: `dpl_GUni4wA2yEoRMv5z8rTLPqHqtgfw`
- Immutable URL: <https://lacuna-blnqeytdv-vaibhav4046s-projects.vercel.app>
- HydraDB: managed production source, with the self-hosted contract pinned in
  `SOURCE_LOG.md`

## What is live

The browser, REST boundary, CLI, stdio MCP and remote Streamable HTTP MCP all
project the same temporal answer contract. The public graph census is 453 nodes
and 682 edges. Overview and proof are separate projections of that same scoped
dataset; pagination uses an opaque HMAC-signed cursor.

Two built-in agents are persisted per workspace. A production Researcher →
Reviewer run completed through `CREATED`, `QUEUED`, `RUNNING`, `WAITING_TOOL`,
`RUNNING`, `HANDOFF`, `RUNNING`, `COMPLETED`. The reviewer approved the bounded
two-claim/two-evidence pack and no authoritative write occurred.

One daily context-health schedule is persisted. The Vercel cron endpoint uses a
server-only bearer secret and enumerates allowed workspaces server-side. Manual
run-now exists only in an authenticated workspace with CSRF protection.

Voice is implemented but not provider-enabled in production. Single-use Scribe
tokens and TTS stay server-side; exact Origin, CSRF, workspace scope, rate
limits, cancellation, audio backpressure and no-store responses are enforced.
With the current environment the honest production result is
`503 speech_unavailable`, and typed Ask remains available.

## Measured gates

| Gate | Result |
| --- | --- |
| unit suite | 70 files, 1,300 tests, all passed |
| root TypeScript | passed |
| web TypeScript | passed |
| production web build | passed; lazy route chunks; entry 281.92 kB / 92.65 kB gzip |
| npm audit | zero known vulnerabilities at the recorded run |
| public production health | HTTP 200 |
| production web smoke | 9/9 passed against the acceptance deployment |
| production demo smoke | 30/30 passed against the acceptance deployment |
| graph API | 453 nodes, 682 edges; overview and proof |
| agent API | 2 agents, 1 completed run, 8 lifecycle events |
| schedule API | 1 daily schedule |
| landing axe WCAG A/AA | 0 violations |
| landing overflow | 0 px at 390×844 and 1440×900 |
| normal-motion route matrix | 198/198: 22 routes × 9 viewports, clean |
| reduced-motion route matrix | 198/198: 22 routes × 9 viewports, clean |
| graph, proof, agents and voice axe | 0 WCAG A/AA violations |
| video composition | 18 scenes, 175.2 seconds; runtime/layout/motion clean and 16/16 contrast samples AA |

The video preview is built and checked. Final MP4 render, external-client
prompts, Supademo publication and YouTube publication remain at their explicit
human-confirmation boundaries.

## Named limitations

No ElevenLabs server credentials are installed. No Spotify, Slack, Notion,
Gmail or Linear OAuth connector is claimed. ChatGPT Pro is read/fetch only under
its current custom-app contract. External-client prompts and video publication
require human-visible confirmation at the action boundary. The hosted schedule
store is durable and idempotent but cannot claim database-level cross-instance
compare-and-swap over the current managed HydraDB API.
