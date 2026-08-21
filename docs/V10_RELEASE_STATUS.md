# V10 release status

Checked on 2026-08-21. This is the current handoff document. V8 audit files
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
| HydraDB health | `GET /api/health` returned HTTP 200 on 2026-08-21 with four passing checks: config, token, reachable and round trip. The post-promotion demo gate measured the context store ready in 93 ms. |
| Public graph | `GET /api/explore/graph?mode=overview&limit=1` returned 453 total nodes, 682 total edges, zero orphan edges and a signed next cursor on 2026-08-21. |
| Public MCP | `POST /mcp` with `tools/list` returned seven read-only tools on 2026-08-21: `lacuna_ask`, `lacuna_explain`, `lacuna_timeline`, `lacuna_read_question`, `search`, `fetch`, `lacuna_health`. |
| Web | The accepted production sweep passed web smoke 9/9 and demo smoke 30/30. |
| Route/browser matrix | Production passed 198/198 normal-motion and 198/198 reduced-motion checks: 22 routes at nine viewports, zero console errors, exceptions, failed requests or horizontal overflow. |
| Landing motion | The exact release passed eight local viewports, 20/20 distinct desktop stages, 7/7 priority mobile scenes, a 29/29 manifest and reduced motion 6/6. The promoted production landing was then recaptured at desktop and mobile widths. |
| Google auth boundary | The deployed pre-chooser security sweep passed 15/15: Google origin, exact callback, identity-only scopes, PKCE S256, nonce/state binding, hardened cookies, no-store redirects, bad-state refusal and Google-only hosted signup. |
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

Deployment `dpl_5UfvqFgPtHV6G9XcgM5itDTgV7LW` is the accepted production
deployment for product commit `c2012ddca176b8e59370020c1de84caedc442d72`.
Root typecheck, 83 unit files / 1,376 tests, the 124-module production build,
web 9/9, demo/API 30/30, Google boundary 15/15, public-agent 403 probes, and
normal/reduced route sweeps of 198/198 all target this product tree. The stable
alias points to the immutable URL
`https://lacuna-ccl2b6750-vaibhav4046s-projects.vercel.app`. The seven-tool
ChatGPT public connector proof targets the same public contract. A media render
does not grant a product gate; the V10 film remains a separate artifact with its
own acceptance steps.

## Named boundaries

| Capability | Current boundary |
| --- | --- |
| Packaged SDK | None is shipped. The repository uses the official MCP SDK internally; there is no `@lacuna/sdk` package. |
| ChatGPT | Accepted for the seven-tool public, read-only corpus. Private `remember` is not accepted because the installed version-1 capability now fails closed and must be reminted. |
| Claude / Claude Code | The remote endpoint is protocol-shaped. No accepted Claude-to-Lacuna session exists yet. |
| Public agent preview | Accepted run records are readable. Production refuses anonymous run creation with `403 public_preview_read_only`; signed-in workspace runs remain implemented behind session, CSRF and durable workspace budgets. |
| Private MCP write | Candidate code issues a random digest-only bearer with `createdAt` and `expiresAt`; it fails at the 30-day expiry or on earlier revocation. `Authorization: Bearer` at `/mcp` is preferred because `/mcp/w/<capability>` URLs may be logged. Version-1 capabilities fail closed and must be reminted after rollout. A production issue/use/revoke/expiry proof remains required. |
| Google sign-in | The production boundary is accepted 15/15 through the real Google account chooser. Selecting a human identity and accepting a fresh provider callback remain owner actions. |
| Voice | Browser states and provider routes are not an accepted provider-backed production audio session. Typed Ask is the supported fallback. |
| Scheduler | Daily definitions are persisted. The hosted adapter does not claim distributed exactly-once execution. |
| Connector catalogue | `AVAILABLE`: Text and Custom ingestion. `PLANNED`: GitHub, GitLab, Linear, Jira, Slack, Notion, Gmail, Confluence, PDF, Markdown, Documents, API, Webhook and Database source. None is `CONNECTED` or `SYNCING`. Spotify is not catalogued or implemented. |
| Exact `package-session` blast request | `NOT_PROVEN`. The subject is absent, the 399-character request exceeds the 300-character sentence contract, and no Web, CLI or MCP blast command exposes the requested semantics. See `artifacts/verification/2026-08-21-v10/package-session-proof-audit.json`. This does not negate the four generated gold blast-radius cases or the fixed `tenant-router` impact proof. |

## Submission media

The earlier 179-second V8 candidate was rejected by the owner. It is historical
media, not the V10 master, and must not be uploaded or presented as accepted.
The V10 cue sheet is [V10_VIDEO_PITCH.md](V10_VIDEO_PITCH.md). A final master
requires live product motion, a verified duration below 180 seconds, claim-map
review, audio and caption checks, owner approval, upload, and signed-out playback.

The owner performs the YouTube upload and hackathon form submission.
