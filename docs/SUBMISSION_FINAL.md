# V10 submission handoff: Hack Hydra Track 03

Everything the form asks for, with the state of each item.

| Field | Value | State |
| --- | --- | --- |
| Project | Lacuna | ready |
| Track | 03 — Memory and Context Retrieval | ready |
| Repository | https://github.com/vaibhav4046/lacuna | public, Apache-2.0 for Lacuna code |
| Deployed | https://lacuna-five.vercel.app | live, no account needed, ask it a question on the landing |
| Live demo, no sign-up | https://lacuna-five.vercel.app/judge | six computed on load, plus one the reader types |
| Whole product, read only | https://lacuna-five.vercel.app/explore/dash | public seeded workspace; accepted run records are inspectable, anonymous run creation is disabled in production |
| Video | no accepted V10 master yet | the earlier 179-second V8 render is historical and rejected; use `V10_VIDEO_PITCH.md` and replace this row only after final media gates pass |
| Captions | pending V10 master | require burned-in sentence captions plus a matching final SRT |
| Supademo | no public walkthrough | not assembled |
| YouTube | no URL | owner will upload after final approval |

## What is left, and why it is left

**Building, approving and publishing the video.** The 179-second V8 render is
historical, was rejected, and is not submission media or a fallback master. The
V10 master must follow
`V10_VIDEO_PITCH.md`, use real moving product capture and the approved private
Vaibhav Lalwani Professional voice, then pass metadata, caption, secret, claim
map and full-length owner review. The owner uploads it and verifies the link
while signed out.

**Security acceptance.** Google sign-in passed its 15-step production boundary
through the real account chooser; a human identity selection and accepted fresh
callback remain open. Private MCP version 2 is deployed and legacy version 1
fails closed, but signed-in issue/use/revoke still remains open. Public MCP is
the proved remote path, including a seven-tool ChatGPT client run. Hosted signup
is Google-only; new password accounts are deliberately refused.

**Public-agent read-only boundary.** Accepted public run records remain visible
as evidence. Production returns `403 public_preview_read_only` for
anonymous `POST /api/explore/agent/run` and `/api/demo/agent/run`; it does not
persist a visitor's task or spend provider calls. Signed-in,
CSRF-protected `/api/workspace/agent/run` remains a real persisted capability.
Both public route names were probed directly on the accepted deployment.

**Submitting the form.** Same reason. Every field it asks for is in this file.

**Preview protection.** Vercel preview deployments sit behind SSO, so a preview
link 302s for anyone who is not you. Production is public and is what the links
above point at. One toggle at
`vercel.com/vaibhav4046s-projects/lacuna/settings/deployment-protection` turns
it off if you want preview links to open too.

## Suggested video description

> Lacuna is a context layer for long-running agents, built on HydraDB. It reads
> conversations, turns them into claims that carry a time and a source, and
> answers from the claims rather than from the text: what is current, what was
> replaced, what two sources disagree about, and what nobody ever said.
>
> Every screen in this video is a capture of the deployed product answering a
> real question. Try it without an account: https://lacuna-five.vercel.app/judge
>
> Source, evaluation artifacts and the claim-by-claim map behind every number
> here: https://github.com/vaibhav4046/lacuna
>
> Measured against five retrieval baselines over 64 questions: the strongest
> baseline reaches 63 and spends 1843 context tokens; Lacuna answers 64 on 18.
> This is one generated corpus and question set, not official LongMemEval or a
> public benchmark. No LongMemEval score has been produced. Raw results in
> artifacts/bench/results.json.

## How HydraDB is used

Not decoratively, and through two deliberately separate adapters.

The 72 generated conversations go in as knowledge sources, which is what the
service's vector search and its own graph extraction see. The claim graph
derived from them goes in as 86 entity records plus an index, addressed by ids
derived from the graph, read back with `GET /context/inspect`. Evidence and
claims are stored apart because they are different kinds of thing, and a store
that conflates them cannot tell you what changed.

The deployed product reads those addressed records for every answer. Lacuna,
not HydraDB Cloud, applies current/superseded standing, contradiction,
abstention and multi-hop resolution after the fetch. HydraDB Cloud's query and
relations endpoints separately support semantic search and the live
store-comparison screen.
`artifacts/hydra/cloud-ingest.json` records the write; `artifacts/hydra/cloud-parity.json`
records that a self-hosted node and HydraDB Cloud return identical answers to
all 64 gold questions, compared field by field.

The self-hosted adapter is the native graph proof: it stores nodes and edges in
HydraDB v0.1.1 and executes bounded Cypher through `NodeSource`. The 162-query
compatibility record is real, but neither that node nor its Cypher traversal is
the deployed Cloud answer path.

The public graph count of 453 nodes and 682 edges belongs to the seeded demo
workspace measured on the acceptance deployment. It is not a general scale
claim and it is not a count from a private user's memory.

## Claims intentionally excluded from the form

- ChatGPT public read is complete across seven tools. Claude and private
  ChatGPT `remember` are not complete.
- No packaged Lacuna SDK is published. The repository uses the official MCP SDK
  internally.
- The CLI and MCP do not expose agent lifecycle commands.
- The product has two built-in agent roles and two accepted production runs,
  not a marketplace
  or arbitrary bot builder. Public run records are read-only in the current
  candidate; creating a new run requires a signed-in workspace.
- Hosted schedules persist state but have no distributed compare-and-swap, so
  exactly-once execution is not claimed.
- Voice is unavailable in production until server-only ElevenLabs credentials
  and a real audio acceptance run exist.
- Text and Custom ingestion are `AVAILABLE`. GitHub, GitLab, Linear, Jira,
  Slack, Notion, Gmail, Confluence, PDF, Markdown, Documents, API, Webhook and
  Database source are `PLANNED`; none is `CONNECTED` or `SYNCING`. Spotify is
  not catalogued or implemented.
- The exact 399-character `package-session` blast-radius request is
  `NOT_PROVEN`. It is outside the shipped subject and sentence contracts, and
  there is no Web, CLI or MCP blast command exposing that full workflow. This
  is separate from the four generated gold blast-radius cases and the fixed
  `tenant-router` impact proof.

## Reproducing every number

    npm ci
    npm run ingest:cloud          write the corpus and graph to HydraDB Cloud
    npm run parity:cloud          both stores, 64 questions, field by field
    npm run bench                 the retrieval comparison
    npm run smoke:demo -- https://lacuna-five.vercel.app
