# Submission — Hack Hydra Track 03

Everything the form asks for, with the state of each item.

| Field | Value | State |
| --- | --- | --- |
| Project | Lacuna | ready |
| Track | 03 — Memory and Context Retrieval | ready |
| Repository | https://github.com/vaibhav4046/lacuna | public, Apache-2.0 for Lacuna code |
| Deployed | https://lacuna-five.vercel.app | live, no account needed, ask it a question on the landing |
| Live demo, no sign-up | https://lacuna-five.vercel.app/judge | six computed on load, plus one the reader types |
| Whole product, read only | https://lacuna-five.vercel.app/explore/dash | public seeded workspace |
| Video | no accepted final master | older draft and 175.2-second preview exist; final recapture and approval pending |
| Captions | `video/hyperframes/renders/lacuna-demo.srt` | draft sidecar; must be regenerated for the final edit |
| Supademo | no public walkthrough | not assembled |
| YouTube | no URL | owner will upload after final approval |

## What is left, and why it is left

**Finishing the video.** The repository has an older draft MP4 and a checked
175.2-second composition preview. The owner rejected that visual direction, so
neither is the submission master. The final film needs fresh production
captures, the selected voice, a reviewed preview, a render under three minutes,
and a claim check before the owner uploads it. No
`artifacts/video/final-metadata.json` or accepted master exists yet.

**Security acceptance.** Google sign-in and private MCP are not submission
claims until the new identity/capability wiring is integrated, rebuilt,
deployed, and negatively tested. Password sign-in is the currently proved
production path. Public MCP is the currently proved remote path.

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
> This is one generated corpus and question set, not a public benchmark. Raw
> results in artifacts/bench/results.json.

## How HydraDB is used

Not decoratively, and in two different ways on purpose.

The 72 generated conversations go in as knowledge sources, which is what the
service's vector search and its own graph extraction see. The claim graph
derived from them goes in as 86 entity records plus an index, addressed by ids
derived from the graph, read back with `GET /context/inspect`. Evidence and
claims are stored apart because they are different kinds of thing, and a store
that conflates them cannot tell you what changed.

The deployed product reads those records for every answer.
`artifacts/hydra/cloud-ingest.json` records the write; `artifacts/hydra/cloud-parity.json`
records that a self-hosted node and HydraDB Cloud return identical answers to
all 64 gold questions, compared field by field.

The public graph count of 453 nodes and 682 edges belongs to the seeded demo
workspace measured on the acceptance deployment. It is not a general scale
claim and it is not a count from a private user's memory.

## Claims intentionally excluded from the form

- No ChatGPT or Claude connection has been completed. The existing continuity
  proof is Lacuna web + CLI + MCP.
- No packaged Lacuna SDK is published. The repository uses the official MCP SDK
  internally.
- The CLI and MCP do not expose agent lifecycle commands.
- The product has two built-in agent roles and one proved run, not a marketplace
  or arbitrary bot builder.
- Hosted schedules persist state but have no distributed compare-and-swap, so
  exactly-once execution is not claimed.
- Voice is unavailable in production until server-only ElevenLabs credentials
  and a real audio acceptance run exist.
- Spotify, Slack, Notion, Gmail, Linear and similar names are examples, not
  native connectors.

## Reproducing every number

    npm ci
    npm run ingest:cloud          write the corpus and graph to HydraDB Cloud
    npm run parity:cloud          both stores, 64 questions, field by field
    npm run bench                 the retrieval comparison
    npm run smoke:demo -- https://lacuna-five.vercel.app
