# Submission — Hack Hydra Track 03

Everything the form asks for, with the state of each item.

| Field | Value | State |
| --- | --- | --- |
| Project | Lacuna | ready |
| Track | 03 — Memory and Context Retrieval | ready |
| Repository | https://github.com/vaibhav4046/lacuna | public, MIT |
| Deployed | https://lacuna-five.vercel.app | live, no account needed |
| Live demo, no sign-up | https://lacuna-five.vercel.app/judge | six questions computed on load |
| Whole product, read only | https://lacuna-five.vercel.app/explore/dash | all eighteen screens |
| Video | `video/hyperframes/renders/lacuna-demo-master.mp4`, 131s | rendered, **not uploaded** |
| Captions | `video/hyperframes/renders/lacuna-demo.srt` | rendered |

## What is left, and why it is left

**Uploading the video.** It needs a signed-in YouTube session. The file, its
captions and its metadata are in the repository; the upload is one action in a
browser that is signed in as you.

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
> Raw results in artifacts/bench/results.json.

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

## Reproducing every number

    npm ci
    npm run ingest:cloud          write the corpus and graph to HydraDB Cloud
    npm run parity:cloud          both stores, 64 questions, field by field
    npm run bench                 the retrieval comparison
    npm run smoke:demo -- https://lacuna-five.vercel.app
