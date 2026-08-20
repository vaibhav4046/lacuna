# V8 final capability matrix

`SHIPPED` means implemented and verified. `GUARDED` means the complete product
path exists but an external credential or permission controls availability.
`EXAMPLE` means the protocol can carry it; no native connector is claimed.

| Capability | State | Proof or boundary |
| --- | --- | --- |
| temporal claims, corrections and retractions | SHIPPED | immutable evidence records and explicit supersession |
| contradiction and missing-evidence abstention | SHIPPED | deterministic resolver and machine-readable reasons |
| plain-English Ask with artifacts | SHIPPED | interpreted subject/predicate, answer, evidence, timeline, Context Pack |
| dense memory table | SHIPPED | live public and session-scoped APIs |
| interactive overview graph | SHIPPED | state-shaped navigation, filters, keyboard list, pan/zoom, cursor pages |
| exact provenance graph | SHIPPED | deterministic source → evidence → claim → entity DAG with rejected edges |
| private graph isolation | SHIPPED | workspace collection derived from authenticated account only |
| Researcher and Reviewer agents | SHIPPED | bounded roles, permissions, budgets, persisted run record |
| run cancel and retry | SHIPPED | authenticated, CSRF-protected state transitions |
| tools registry | SHIPPED | observed tools and last verification state |
| daily schedules | SHIPPED | persisted definition, leases, idempotency and fixed-workspace cron dispatch |
| realtime speech-to-text | GUARDED | raw PCM Scribe WebSocket; single-use token from server |
| streamed text-to-speech | GUARDED | server-side ElevenLabs stream with backpressure and cancellation |
| production voice provider | UNAVAILABLE | ElevenLabs server credentials intentionally absent |
| CLI | SHIPPED | local source and scoped remote source commands |
| MCP stdio | SHIPPED | stdout-safe JSON-RPC transport |
| MCP remote HTTP | SHIPPED | Streamable HTTP at public and workspace-scoped URLs |
| ChatGPT custom app | READ/FETCH | Pro contract; no write claim |
| Claude MCP | READ/WRITE CAPABLE | client permission and user confirmation still apply |
| generic app memory sync | SHIPPED PROTOCOL | any client using the scoped HTTP/MCP contract |
| Spotify / Slack / Notion / Gmail / Linear | EXAMPLE | no native OAuth or ingestion connector claimed |

## Security invariants

- A request never chooses a private workspace identifier.
- Graph cursors are bounded, opaque and signed.
- Voice API keys never enter Vite variables or browser responses.
- Mutations require CSRF; voice additionally requires exact Origin.
- Public and private rate-limit buckets are separate.
- The cron secret is accepted only as a bearer token at the one dispatcher.
- Agent writeback is explicit and the shipped reviewer path is non-authoritative.
