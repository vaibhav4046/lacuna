# V8 final capability matrix

> Historical V8 matrix. See [V10_RELEASE_STATUS.md](V10_RELEASE_STATUS.md) for
> the current production/candidate boundary. A V8 `VERIFIED` row does not pass a
> changed V10 implementation without a rerun.

This matrix separates the last accepted production build from the current
working-tree candidate.

- `VERIFIED` means a committed artifact or a repeatable production gate proves
  the behaviour.
- `CANDIDATE` means code and focused tests exist, but the integrated production
  gate has not been rerun.
- `LIMITED` means the capability works within the boundary stated in the final
  column.
- `UNAVAILABLE` means a required credential or proof is absent.
- `PROTOCOL ONLY` means an endpoint contract exists but a named external client
  has not been connected.
- `EXAMPLE` means no native connector exists.

| Capability | State | Proof or boundary |
| --- | --- | --- |
| temporal claims, corrections and retractions | VERIFIED | immutable evidence records and explicit supersession |
| contradiction and missing-evidence abstention | VERIFIED | deterministic resolver and machine-readable reasons |
| plain-English Ask with artifacts | VERIFIED | interpreted subject/predicate, answer, evidence, timeline, Context Pack |
| dense memory table | VERIFIED | live public and session-scoped APIs |
| interactive overview graph | VERIFIED | state-shaped navigation, filters, keyboard list, pan/zoom, cursor pages |
| exact provenance graph | VERIFIED | deterministic source → evidence → claim → entity DAG with rejected edges |
| private graph isolation in the web app | VERIFIED | collection derived from the authenticated account; no caller-supplied workspace id |
| password sign-in and session flow | LIMITED | existing production password accounts pass sign-in/session/recovery tests; hosted password creation is disabled until identity storage has atomic unique create |
| Google sign-in | CANDIDATE | provider/subject binding, RS256/JWKS, PKCE, nonce, no-store redirects and negative HTTP tests pass locally; fresh-identity production browser proof pending |
| Researcher and Reviewer agents | LIMITED | two built-in, no-write roles and one production eight-event run; not arbitrary user-created agents |
| memory-derived agent recommendations | CANDIDATE | deterministic read-only suggestions with evidence and permissions; integrated production gate pending |
| run cancel and retry | VERIFIED | authenticated, CSRF-protected state transitions |
| tools registry | VERIFIED | observed tools and last verification state |
| daily schedules | LIMITED | persistent definitions and process-level leases; no distributed CAS or exactly-once guarantee on HydraDB |
| realtime speech-to-text | CANDIDATE | raw PCM Scribe route and single-use token boundary covered by fixtures; no provider-enabled production session |
| streamed text-to-speech | CANDIDATE | server-side stream, backpressure and cancellation covered by fixtures; no provider-enabled production session |
| production voice provider | UNAVAILABLE | ElevenLabs server credentials intentionally absent |
| CLI | VERIFIED | nine read, diagnostic, interactive and benchmark commands; ingestion is an npm script, not a CLI command; no agent lifecycle commands |
| packaged Lacuna SDK | UNAVAILABLE | the repository uses the official MCP SDK internally but publishes no `@lacuna/sdk` package |
| MCP stdio | VERIFIED | stdout-safe JSON-RPC transport and parity sweep |
| MCP public HTTP | VERIFIED | public seeded workspace over Streamable HTTP; live 2026-08-21 catalog returned seven read-only tools |
| MCP private HTTP | CANDIDATE | authenticated issue/revoke, random digest-only 30-day bearer, exact-expiry refusal, legacy-v1 fail-closed/remint, cross-workspace refusal and bounded HTTP pass locally; deployment/client proof pending |
| ChatGPT custom app | VERIFIED READ ONLY | the ChatGPT Lacuna app called all seven production public tools against HydraDB Cloud; no private write was accepted |
| Claude MCP | PROTOCOL ONLY | provider documents MCP and may permit writes; Lacuna has not completed a Claude proof |
| generic app memory sync | PROTOCOL ONLY | HTTP/MCP contract exists; this does not prove every client can connect |
| Spotify / Slack / Notion / Gmail / Linear | EXAMPLE | no native OAuth or ingestion connector claimed |

## Security invariants

- A request never chooses a private workspace identifier.
- Graph cursors are bounded, opaque and signed.
- Voice API keys never enter Vite variables or browser responses.
- Mutations require CSRF; voice additionally requires exact Origin.
- Public and private rate-limit buckets are separate.
- The cron secret is accepted only as a bearer token at the one dispatcher.
- Agent writeback is explicit and the shipped reviewer path is non-authoritative.

These are design and test invariants, not a claim of formal verification. The
Google and private MCP rows remain `CANDIDATE` until production deployment and
browser/client probes pass. Their router integration, negative tests and clean
candidate build are complete.
