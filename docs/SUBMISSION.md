# Hack Hydra submission draft

This is the current paste-ready copy. The owner submits the form and uploads the
video. Claims still behind an acceptance gate are excluded instead of being
written in future tense as if they had shipped.

## Project name

```
Lacuna
```

## Short description

```
Lacuna is a temporal, provenance-first memory layer for agents, built on
HydraDB. It keeps corrections, contradictions and source quotations as an
evidence graph, answers only from standing claims, and names the reason when the
history does not support an answer.
```

## Problem

```
Long-running agents retrieve old facts as easily as current ones. A transcript
can contain an original value, a later correction, two unresolved reports, and
no answer at all to a nearby question. Similarity search ranks passages, but it
does not encode which claim replaced which or whether a missing fact was never
stated, retracted, contradicted, unconnected or outside the workspace.

That makes confident errors most likely when a history is longest. The memory
needs an explicit temporal and provenance structure before another model sees
it.
```

## What was built

```
Lacuna ingests conversations into immutable evidence spans and claims. A
correction adds a SUPERSEDES edge instead of overwriting the old claim. The
resolver performs a bounded graph traversal and returns the current value,
source quotations, revision timeline, exact proof path and a machine-readable
abstention reason.

The working product includes a no-account public workspace, plain-English Ask,
a searchable memory table, an interactive overview graph, an exact provenance
DAG, authenticated private workspaces, two bounded no-write agent roles, Work
records, a tools registry, daily schedule definitions, a CLI, stdio MCP and
public Streamable HTTP MCP. Voice routes and a state machine exist, but the
production voice provider is not configured and typed Ask remains the honest
fallback.

The public demo corpus is generated from a fixed seed: 72 sessions, 5,246
messages, 174 claims and 86 entities. The seeded public graph measured 453
display nodes and 682 display edges on the accepted V8 deployment. Those are
demo-workspace counts, not a universal scale result.

On this generated 64-question evaluation, Lacuna answered 64/64 with zero
unsupported answers and used 18 mean context tokens. The strongest of 51 tested
flat-retrieval configurations answered 63/64 with 1,843. This is a one-question
lead on one synthetic corpus, not a public benchmark or a general accuracy
claim. The raw results are committed in artifacts/bench/results.json.
```

## Deployed project

```
https://lacuna-five.vercel.app

No-account judge path:
https://lacuna-five.vercel.app/judge
```

The accepted production gate reached web smoke 9/9, demo smoke 30/30 and
password-account smoke 12/12. Google sign-in is not included in the submission
claim until the new provider-bound callback passes its final security and
browser gates.

## How HydraDB is used

```
HydraDB is Lacuna's persistent context substrate, reached as a separate service
over HTTP. The deployed product uses HydraDB Cloud; the repository also keeps a
self-hosted adapter pinned to HydraDB v0.1.1 at commit
02a40025d2d57e97ab2754c8256219cdbfeab379.

Lacuna writes conversations as knowledge sources and writes its temporal claim
records separately. The read path resolves an entity, loads its claims, follows
SUPERSEDES relationships, fetches evidence, and traverses named entity links for
multi-hop questions. The policy layer then decides current, historical,
conflicted, retracted or absent. That decision is deterministic and does not ask
a model to choose among retrieved passages.

HydraDB's own relation extraction and graph-context traversal are also shown in
the product. This keeps the division of labour visible: HydraDB stores and
retrieves the context graph; Lacuna applies the temporal standing and abstention
policy. A committed parity artifact compares the self-hosted and managed stores
over all 64 generated questions.
```

## Tech stack

```
TypeScript and Node 20.11+, HydraDB over HTTP, React 19, React Router and Vite
for the web product, the official Model Context Protocol SDK for MCP, and
hash-wasm for deterministic content hashing. Vitest covers the unit and live
contract suites. HyperFrames is used for the video composition workflow.

Lacuna code is Apache-2.0. HydraDB is AGPL-3.0 and runs as a separate service;
its source is not vendored or linked into this repository.
```

There is no published `@lacuna/sdk` package. The official MCP SDK is an internal
dependency. The CLI and MCP expose the temporal read contract but not agent
lifecycle commands.

## Team

```
Solo entry by Vaibhav Lalwani.
```

## Repository

```
https://github.com/vaibhav4046/lacuna
```

## Three-minute video

```
PENDING OWNER UPLOAD. No YouTube URL exists yet.
```

The repository contains an older draft MP4, a 175.2-second checked preview and a
draft SRT. The owner rejected the preview's visual direction, so it is not the
submission master. The final film must use fresh production captures, the
selected Vaibhav Lalwani professional clone, a reviewed preview and a final
claim check. Videos longer than three minutes are not acceptable.

## Claims deliberately excluded

- Google sign-in until the provider/subject-bound flow is integrated and
  reverified in production.
- Private MCP until capability issue, use and revoke are wired and probed.
- Distributed exactly-once schedules. HydraDB persistence has no CAS or
  transaction seam for an atomic multi-instance claim.
- Working production voice until real STT, selected-clone TTS, playback and
  interruption are accepted.
- ChatGPT or Claude continuity. The existing continuity artifact covers Lacuna
  web, CLI and MCP only.
- Supademo, final MP4 and YouTube until those artifacts exist.
- Spotify, Slack, Notion, Gmail, Linear or any other native connector.
- Arbitrary user-created agents. The proved runtime has two built-in roles and
  one bounded production run.

## Final owner checks

- [ ] Repository and production URL open in a signed-out browser.
- [ ] Current candidate passes unit, typecheck, build, auth, demo, route,
      accessibility, OAuth-negative and MCP-capability gates.
- [ ] Every screenshot cited by the film exists and comes from the final
      deployment.
- [ ] Video is under 3:00, captions are correct, no secret appears, and every
      spoken number is in `VIDEO_CLAIM_MAP.md`.
- [ ] Unlisted YouTube URL plays in a signed-out browser.
- [ ] Owner submits the form. No automation submits it.
