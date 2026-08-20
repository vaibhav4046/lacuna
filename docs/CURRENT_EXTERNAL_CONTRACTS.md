# Current external contracts

Checked on 2026-08-20. This file records the provider boundary Lacuna builds
against. Provider documentation is kept separate from Lacuna integration proof.
A documented capability is not marked as a Lacuna success until this release
has probed it.

## Hack Hydra

- The organizer page closes submissions on 2026-08-20 at 11:59 PM PT.
- The submission needs a public repository and a viewable video no longer than
  three minutes.
- The video must cover the problem, the product, a working demo, and how HydraDB
  is used.
- Track 03 tests cross-session agent memory, synthesis, chronology, corrections,
  and abstention over long histories.

Source: <https://hackhydra.hydradb.com/?utm_source=luma#submit>

## HydraDB

The application uses HydraDB as its persistent context store. Production reads
the managed service. The repository also keeps a self-hosted adapter tested
against HydraDB v0.1.1 at commit
`02a40025d2d57e97ab2754c8256219cdbfeab379`. The managed service can return its
own extracted relation graph and subject expansion. Lacuna's claim graph and
temporal policy remain distinct: HydraDB returns candidate state and relations;
Lacuna decides what is current, historical, conflicted, retracted, or absent.

Sources:

- <https://github.com/hydra-db/hydradb>
- <https://github.com/hydra-db/hydradb-mcp>
- <https://docs.hydradb.com/llms.txt>

## Model Context Protocol

Lacuna's remote endpoint follows Streamable HTTP. The current stable transport
uses one endpoint for POST and GET. A server may answer GET with an SSE stream
or with 405 when it does not offer a server-initiated stream. HTTP clients send
the negotiated `MCP-Protocol-Version` on later requests. The stdio server keeps
stdout reserved for JSON-RPC messages.

Sources:

- <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- <https://modelcontextprotocol.io/specification/2025-06-18/basic/index>

## ChatGPT

The account available for a future V8 proof is ChatGPT Pro. OpenAI currently permits
Pro accounts to connect custom MCP apps with read and fetch permissions in
developer mode. Full MCP write and modify actions are currently limited to
Business and Enterprise/Edu. ChatGPT connects to remote MCP servers, not a
loopback-only server.

Lacuna therefore scopes any ChatGPT proof to read and fetch. A write
proof belongs in Claude or another client that exposes the write tool. The
product must not describe a ChatGPT Pro write as available. No ChatGPT client
has connected to Lacuna in the current evidence set.

Source: <https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt>

## Claude

Anthropic documents MCP support in Claude Code, Claude.ai, Claude Desktop, and
the Messages API. Lacuna's public Streamable HTTP endpoint is protocol-shaped
for those clients, but no Claude product has connected in the current evidence
set. The local candidate exposes `remember` only after an authenticated random
capability resolves to the session-owned workspace. Deployment and client
permission proof are still pending. None of that is inferred from Anthropic's
documentation.

Source: <https://docs.anthropic.com/en/docs/mcp>

## ElevenLabs

Realtime speech-to-text uses `scribe_v2_realtime` over WebSocket. Browser code
must receive a single-use token from Lacuna's server; the ElevenLabs API key
must never enter the browser. The token expires after 15 minutes. The client
handles partial and committed transcripts. Microphone input should use voice
activity detection, echo cancellation, and noise suppression.

Text-to-speech streams from the server over the provider's HTTP streaming
endpoint. The product has to keep listening,
thinking, speaking, interrupted, error, and text-fallback states separate. When
the environment has no ElevenLabs key, the UI must say unavailable and retain
the text path.

Sources:

- <https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming>
- <https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime>
- <https://elevenlabs.io/docs/api-reference/text-to-speech/stream>

## Vercel

The live team was read through the Vercel API on 2026-08-20. It is an active
Hobby account. Current Hobby limits allow 100 cron jobs per project, but each
expression may run no more than once per day and the invocation may occur at
any point in the selected hour. Vercel does not retry a failed cron invocation.

Lacuna may persist and display multiple schedules. On this account, hosted cron
execution is daily and imprecise. Shorter intervals are product definitions for
an external worker or a future plan, not a promise made by this deployment.

Sources:

- live team API response, team `team_BkwWvcKFoTbh3XLaBTDT2cSO`
- <https://vercel.com/docs/cron-jobs/usage-and-pricing>
- <https://vercel.com/docs/cron-jobs/manage-cron-jobs>

## Google sign-in branding

Google recommends its rendered button or a pre-approved asset. A custom button
must preserve the standard-color G, approved text, contrast, dimensions, and
padding. The G must not be recoloured or presented as an invented monochrome
mark. Lacuna should use `Continue with Google` or `Sign in with Google` and make
clear that Google authenticates the user into Lacuna.

Source: <https://developers.google.com/identity/branding-guidelines>

## Client and connector claim boundary

Lacuna's remote MCP and HTTP surfaces are client-neutral. That does not make
every named service a connected integration. The verified client set is the
Lacuna web adapter, Lacuna CLI, Lacuna MCP subprocess, the official MCP SDK
client, and MCP Inspector. ChatGPT, Claude, Codex, voice clients and custom
clients may be shown only as protocol targets until a named-client proof exists.
Spotify, Slack, Notion, Gmail, Linear, and similar products are examples of
source data or future connector work until a real authorization and ingestion
path exists. Marketing copy must preserve that distinction.
