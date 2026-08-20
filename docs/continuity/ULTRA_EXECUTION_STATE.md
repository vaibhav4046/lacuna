# Execution state

> Historical checkpoint. This file records the V6/V7 run that produced it. Its
> rendered-film, credential, account, client and capability statements do not
> describe the current V8 acceptance state. Use
> `docs/FINAL_EXECUTION_STATE.md` and `docs/EVIDENCE_INDEX.md` for current truth.

Status: `READY_FOR_RELEASE`
Production: https://lacuna-five.vercel.app — Ask is live against HydraDB Cloud
Public live demo: https://lacuna-five.vercel.app/judge — no account needed
Rollback tag: `rollback-pre-v6-react-cutover` at `6c5d9e8`

## What changed this session

The deployed product answers questions now. It previously proved a connection
and nothing else: health was a real round trip to HydraDB Cloud, and every
screen that could show an answer read a node on loopback inside WSL that a
Vercel function cannot dial.

Three things closed that.

1. A source seam under retrieval. `ask()` and `blastRadius()` read through
   `HydraSource`, four methods wide. `NodeSource` holds the previous read path
   unchanged.
2. `CloudSource`, plus the ingest that fills it. The claim graph is written
   into HydraDB Cloud as one record per entity, one per session, and one
   index, addressed by ids derived from the graph rather than assigned by the
   service.
3. `/judge`, a public route that answers six questions live on load, because
   accounts cannot persist on a read-only filesystem and the signed-in product
   was therefore unreachable to anyone who had not run it locally.

## Green, this session

| Gate | Result | Command |
| --- | --- | --- |
| typecheck | exit 0 | `npx tsc --noEmit` |
| unit | 960 of 960, 44 files | `npx vitest run tests/unit` |
| contract | 77 of 77, 4 files | `npx vitest run tests/contract` |
| census | graph matches the plan exactly | `npm run census` |
| parity, 3 surfaces, 64 questions | `ALL_IDENTICAL: True` | `npm run parity` |
| **parity, 2 stores, 64 questions** | **`ALL_IDENTICAL: true`** | `npm run parity:cloud` |
| cloud ingest | 159 of 159 indexed, read back byte identical | `npm run ingest:cloud` |
| web smoke, production | 9 of 9 | `npm run smoke:web -- https://lacuna-five.vercel.app` |
| demo surface, production | 30 of 30 | `npm run smoke:demo -- https://lacuna-five.vercel.app` |
| film | check passed, 131s rendered | `npx hyperframes check` in `video/hyperframes` |
| production browser | 0 console errors, six live rows on /judge | Browser pane |

`npm run parity:cloud` is the new one and the one that matters. It asks every
gold question of the self-hosted node and of HydraDB Cloud and compares every
field but the clock and the read log:

    ALL_IDENTICAL: true
    reads: node 342, cloud 119
    median: node 91ms, cloud 212ms

## What HydraDB Cloud holds

Database `lacuna`, collection `backend`, 159 records:

    86  entity records    claims, mentions, dependents, citations
    72  session records   the conversations themselves, unedited
     1  index record      claim id to entity, entity id to name

Read back after ingest and compared byte for byte against what was written,
for a sampled entity and for the index.

## Measured on production

    GET  /api/health                          ok, api.hydradb.com in 170ms
    POST /api/ask  Meridian/launch_date       ANSWERED   1 source        149ms
    POST /api/ask  Bellwether/beta_partner    ANSWERED   1 source, 2 superseded  120ms
    POST /api/ask  notify-relay/budget_code   CONFLICT   2 sources, 1 conflict   108ms
    POST /api/ask  replay-queue/contact       NO_EVIDENCE never_stated   170ms
    POST /api/ask  Redshank/launch_date       NO_EVIDENCE out_of_scope   132ms
    POST /api/ask  replay-queue/contact via vendor  ANSWERED  Farah Haddad  285ms

`source_state` is `live` on every one.

## Deliberately not done

- The CLI and the MCP server read the node, not the cloud. See DECISIONS.md
  D-119: they are local tools beside a local node, and `parity:cloud` already
  establishes the two stores agree.
- Accounts still cannot persist on Vercel. Only `/tmp` is writable and it does
  not survive an invocation. `/judge` is the path that does not need one;
  durable accounts need Postgres.
- Preview deployments are behind Vercel SSO. Production is public, so
  verification ran there. One toggle in project settings turns it off.

## Since then

- **The whole product runs signed out.** `/demo/:route` renders the same
  eighteen screens against `/api/demo`, which serves the corpus read only and
  refuses writes. Accounts cannot persist on a read-only filesystem, so this is
  the only way the deployed product is reachable at all.
- **Evaluations shows the measured run.** It said "no recorded runs" while
  `artifacts/bench/results.json` held one.
- **13 captures of production** in `artifacts/screens/live/`, each checked for
  ground colour and pixel density on write.
- **The film is rendered.** 131s, 1920x1080, H.264 with ElevenLabs narration
  and a caption track, in `video/hyperframes/renders/`. Every screen in it is a
  capture of production answering. `docs/VIDEO_CLAIM_MAP.md` maps each of its
  twelve claims to the artifact that checks it.

## V7 wave, this session

- **One context, any agent, proven.** `src/hydra/open.ts` decides which store a
  client reads; `LACUNA_PROFILE` names it and a configured cloud wins otherwise.
  `npm run continuity` asks the deployed web, the CLI and an MCP subprocess the
  same six questions against the same cloud workspace:
  `ONE_CONTEXT_IDENTICAL: true`.
- **Accounts are durable.** They live in HydraDB Cloud in their own collection,
  because a Vercel function has no writable filesystem and every signed-in
  screen was therefore unreachable. `npm run smoke:auth` against production:
  12 of 12.
- **A sign-up race is fixed.** `refresh()` was fire-and-forget, so the guard
  read a stale signed-out session and bounced people out of their own sign up.
  Found in a browser, not by a test.
- **The local node's write path broke** and was recovered by rebuilding the
  store from the seed. D-123.
- **The film was rebuilt** with the continuity transcript in it. 148.5s.
- `RELEASE_GATE.md` holds every gate and its output. `JUDGE_SCORECARD.md`
  scores the five published dimensions and names the weakest.

Tag: `v7-freeze`.

## Next, and it needs a browser signed in as the operator

- Upload the video, unlisted, and paste the link into the form.
- Submit the form. Every field it asks for is in `docs/SUBMISSION_FINAL.md`.
- Optional: turn preview protection off so preview links open.

## Commands

    npm run ingest:cloud          write the corpus and the graph to the cloud
    npm run parity:cloud          both stores, 64 questions, field by field
    npm run parity                three surfaces, one store
    npm run smoke:web -- <url>    nine gates against a deployment
