# V10 release status

Checked on 2026-08-22. This is the current handoff document. V8 audit files
remain dated evidence; they do not grant a pass to a changed V10 build.

## Product thesis

Lacuna is temporal, provenance-first memory for agents. It stores claims with
their source spans, keeps replaced claims instead of overwriting them, and
resolves each question through bounded relationship reads. An answer carries its proof.
An unsupported, retracted, contradicted or out-of-scope question returns a
machine-readable abstention instead of a plausible guess.

The word *lacuna* means a gap. The product treats a known gap as useful state.

The Track 03 wedge is concrete: temporal change, unresolved contradictions,
exact evidence, structural abstention, and the same result contract across the
deployed web, CLI and MCP read surfaces. The repository's generated 64-question
evaluation tests that contract. It is not official LongMemEval, and Lacuna has
no LongMemEval score.

## HydraDB boundary

HydraDB does real storage and retrieval work in both supported adapters, but the
two paths must not be conflated. Production stores the generated sources and
collection-scoped claim-graph records in HydraDB Cloud. The answer path fetches
deterministic entity records through `GET /context/inspect`; Lacuna then applies
temporal standing, contradiction, abstention and multi-hop resolution in
application code. HydraDB Cloud's query and relations surfaces separately power
semantic search and the live store-comparison view.

The self-hosted adapter is the native graph proof. It stores nodes and edges in
HydraDB v0.1.1 and executes bounded Cypher through `NodeSource`; the repository
also preserves 162 executed compatibility probes. That Cypher path is genuine
and tested, but it is not the deployed Cloud answer path.

## Accepted production evidence

Production: <https://lacuna-five.vercel.app>

| Surface | Evidence accepted for the current production deployment |
| --- | --- |
| HydraDB health | `GET /api/health` returned HTTP 200 on 2026-08-21 with four passing checks: config, token, reachable and round trip. The final stable-domain smoke measured the context store ready in 65 ms. |
| Public graph | `GET /api/explore/graph?mode=overview&limit=1` returned 453 total nodes, 682 total edges, zero orphan edges and a signed next cursor on 2026-08-21. |
| Public MCP | `POST /mcp` with `tools/list` returned seven read-only tools on 2026-08-21: `lacuna_ask`, `lacuna_explain`, `lacuna_timeline`, `lacuna_read_question`, `search`, `fetch`, `lacuna_health`. |
| Official LongMemEval oracle adapter | The published 500-instance oracle was loaded and adapted on 2026-08-22: 0 parse failures, 0 adapter failures, 0 ground-truth leaks, 117 extracted claims across 78/500 instances (15.6%). This is ingestion evidence only; no official answer/judge score is claimed. |
| Web | The current alias passed demo smoke 31/31 (including the public redacted connector catalogue), Google boundary smoke 16/16, and auth boundary smoke 3/3 after the first-run onboarding release. |
| Route/browser matrix | Production passed 198/198 normal-motion and 198/198 reduced-motion checks: 22 routes at nine viewports, zero console errors, exceptions, failed requests or horizontal overflow. |
| Landing motion | The exact release passed eight local viewports, 20/20 distinct desktop stages, 7/7 priority mobile scenes, a 29/29 manifest and reduced motion 6/6. The promoted production landing was then recaptured at desktop and mobile widths. |
| Google auth boundary | The deployed security sweep passed 16/16: Google origin, exact callback, identity-only scopes, request-bound PKCE S256 and state, nonce binding, hardened cookies, no-store redirects, bad-state refusal and Google-only hosted signup. An authorized owner browser also completed the real chooser → callback → `/app/dash` round trip and remained signed in after revisiting `/signin`. |
| Password account | Hosted password creation is deliberately disabled because the HydraDB document boundary cannot atomically enforce a unique email. A historical 12/12 run exists for an existing password identity; it is not the current signup path. |
| Surface continuity | The deployed web endpoint, cloud-pointed Lacuna CLI and a Lacuna MCP process returned identical results for six outcome classes in `artifacts/continuity/one-context.json`. This is the same temporal read contract across those three surfaces, not a ChatGPT or Claude proof. |
| ChatGPT public MCP | The ChatGPT Lacuna app called health, ask, timeline, explain, sentence read, search and fetch on the production endpoint. It resolved a temporal correction, exposed a two-source conflict, abstained on it, and returned a connector artifact. |
| Agent runtime | Two built-in roles and two accepted production runs. The current adversarial run completed eight Researcher → Reviewer events, included both conflicting `runbook_owner` claims and quotations, reported zero unsupported claims, and made no authoritative writeback. |

The full dated artifact ledger remains in [EVIDENCE_INDEX.md](EVIDENCE_INDEX.md).

Those accepted public run records remain readable evidence. The public preview
is strictly read-only in the accepted production deployment:
anonymous `POST /api/explore/agent/run` and `/api/demo/agent/run` return
`403 public_preview_read_only`, while authenticated, CSRF-protected
`POST /api/workspace/agent/run` remains a real persisted run. Both anonymous
route names were probed directly after deployment; invalid JSON on the legacy
alias was still refused before body processing.

## V10 production gate

The current production deployment is product commit `c63032b`
(`fix(connectors): align json csv product copy`) with the production-only
file-preview and webhook signing keys enabled. Root and web typecheck/build
pass; the full unit suite is 2,225/2,225 (111 files), and the stable alias passed demo
smoke 31/31, Google auth smoke 16/16, auth boundary smoke 3/3, and the live
provider voice smoke 7/7. Private agent launch, scheduling, cancel, retry and
dispatch mutations now require the exact current-session binding, with browser
requests sending it. The stable alias points to the immutable deployment
`https://lacuna-le3okh65r-vaibhav4046s-projects.vercel.app` (`dpl_5jVMVKXyLCP9QP8Ni2ZrwUtKLFc3`), aliased to `https://lacuna-five.vercel.app`.

The Google callback now validates the browser-bound OAuth state before honoring
provider cancellation responses, so a forged `error=access_denied` callback
cannot consume an in-flight sign-in attempt. The full unit suite is 2,225/2,225
(111 files), including this regression.

Credential mutations now prime the CSRF cookie with a bounded, read-only
`/api/session` preflight when a clean browser submits before the session
provider's first read completes. The server still fails closed if the token
cannot be established, and a focused regression covers the first-submit path.

The first-run flow now creates a workspace, stores a real private memory through
`POST /api/workspace/ingest`, proves a private answer through
`POST /api/workspace/query`, and only then opens the dashboard. Anonymous
private connector and impact routes correctly return 401; public read-only
explore routes remain available. A media render does not grant a product gate;
the V10 film remains a separate artifact with its own acceptance steps.

## Named boundaries

| Capability | Current boundary |
| --- | --- |
| Packaged SDK | None is shipped. The repository uses the official MCP SDK internally; there is no `@lacuna/sdk` package. |
| ChatGPT | Accepted for the seven-tool public, read-only corpus. Private `remember` is not accepted because the installed version-1 capability now fails closed and must be reminted. |
| Claude / Claude Code | The remote endpoint is protocol-shaped. No accepted Claude-to-Lacuna session exists yet. |
| Public agent preview | Accepted run records are readable. Production refuses anonymous run creation with `403 public_preview_read_only`; signed-in workspace runs remain implemented behind session, CSRF and durable workspace budgets. |
| Private MCP write | Candidate code issues a random digest-only bearer with `createdAt` and `expiresAt`; it fails at the 30-day expiry or on earlier revocation. `Authorization: Bearer` at `/mcp` is preferred because `/mcp/w/<capability>` URLs may be logged. Version-1 capabilities fail closed and must be reminted after rollout. A production issue/use/revoke/expiry proof remains required. |
| Google sign-in | The production boundary is accepted 16/16, and an authorized owner browser completed a fresh Google account chooser and callback. A different identity or account transfer is not claimed. |
| Voice | The deployed provider-backed voice boundary passes 7/7: a real ElevenLabs single-use token and bounded `audio/mpeg` response are returned without exposing secrets. The owner browser round trip reaches authenticated listening, and read-only typed questions remain visible when browser playback cannot be confirmed; navigation/mutation commands remain fail-closed if the optional intent planner is unavailable. |
| Scheduler | Daily definitions are persisted. The hosted adapter does not claim distributed exactly-once execution. |
| Connector catalogue | Private workflows are implemented for one-off file ingestion (TXT/MD/JSON/CSV/PDF/DOCX), public GitHub snapshot import, public HTTPS/API import, and signed bounded at-least-once webhook delivery. Current production catalogue truth reports all seven implemented workflows `available` after fresh server-only signing keys were provisioned. Remaining providers are planned; Spotify is not catalogued or implemented. |
| Exact `package-session` blast request | `NOT_PROVEN`. The subject is absent, the 399-character request exceeds the 300-character sentence contract, and no Web, CLI or MCP blast command exposes the requested semantics. See `artifacts/verification/2026-08-21-v10/package-session-proof-audit.json`. This does not negate the four generated gold blast-radius cases or the fixed `tenant-router` impact proof. |

## Submission media

The earlier 179-second V8 candidate was rejected by the owner and remains
historical. The V10 master at
`video/hyperframes-v10/renders/lacuna-v10-hack-hydra-final.mp4` passed metadata
inspection and a full decode at 178.500 seconds, 1920×1080/30 fps, H.264 + AAC.
Its owner watch, clone-publication confirmation, upload and signed-out playback
remain owner actions.

The owner performs the YouTube upload and hackathon form submission.
