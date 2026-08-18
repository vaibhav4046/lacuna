# Execution state

Status: `ACTIVE`
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

## Next

- Video capture from the tagged release, using `/judge` for the product rows.
- `docs/EVIDENCE_INDEX.md` entries for `artifacts/hydra/cloud-parity.json` and
  `artifacts/hydra/cloud-ingest.json`.

## Commands

    npm run ingest:cloud          write the corpus and the graph to the cloud
    npm run parity:cloud          both stores, 64 questions, field by field
    npm run parity                three surfaces, one store
    npm run smoke:web -- <url>    nine gates against a deployment
