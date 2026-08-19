# End to end matrix

Every product surface, and what was actually run against it.

One row per surface. **What was exercised** is the behaviour, not the intent.
**Result** is the output of the run, or the words `NOT VERIFIED` where no run
produced one. **Evidence** is a path in this repository or a command whose
output is quoted in a path. A row with no evidence path is a row nobody has to
believe.

Two sources of results appear below and they are kept apart on purpose. Rows
citing [RELEASE_GATE.md](../RELEASE_GATE.md) were run at `v7-freeze`, commit
`942de9e`, and the gate file records the command and its output. Rows citing a
dated directory under `artifacts/verification/` were run earlier and are kept
unedited, which means some of their counts are smaller than today's. Where the
two disagree, the gate file is the later number and the artifact is the record
of when it moved.

## Web

| Surface | What was exercised | Command or action | Result | Evidence |
|---|---|---|---|---|
| Landing, production | Root 200 on both spellings of the host, root element present, first paint stylesheet served and black, no-JavaScript recovery state, favicon, deep route survives a refresh, entry module referenced | `npm run smoke:web -- https://lacuna-five.vercel.app` | 9 of 9 | [RELEASE_GATE.md](../RELEASE_GATE.md), [scripts/smoke-web.ts](../scripts/smoke-web.ts), earlier local run at [artifacts/verification/2026-08-18-v6/smoke-web.txt](../artifacts/verification/2026-08-18-v6/smoke-web.txt), capture at [artifacts/screens/live/live-landing-1920x1080.png](../artifacts/screens/live/live-landing-1920x1080.png) |
| `/judge` | Page served, 200, carries the application root | `npm run smoke:demo -- https://lacuna-five.vercel.app` | Part of 30 of 30 | [RELEASE_GATE.md](../RELEASE_GATE.md), [scripts/smoke-demo.ts](../scripts/smoke-demo.ts), captures at [artifacts/screens/live/live-judge-1920x1080.png](../artifacts/screens/live/live-judge-1920x1080.png) and [live-judge-fullpage.png](../artifacts/screens/live/live-judge-fullpage.png) |
| The 18 app routes | The route table itself, and every read the demo screens make: 15 `/api/demo/*` parts answered 200, a write to one returned 404, three deep demo routes plus `/judge` served with the root element | `npm run smoke:demo -- https://lacuna-five.vercel.app` | 30 of 30. Three of the 18 routes were fetched as pages (`/demo/dash`, `/demo/ask`, `/demo/hydra`); the other 15 are the same shell reading the same 15 endpoints, all of which answered | [RELEASE_GATE.md](../RELEASE_GATE.md), [web/src/app/routes.ts](../web/src/app/routes.ts), [scripts/smoke-demo.ts](../scripts/smoke-demo.ts), captures at [artifacts/screens/live/](../artifacts/screens/live/) |
| Browser console, all 18 routes | Console clean on every route | Browser pane, by hand | NOT VERIFIED. [RELEASE_GATE.md](../RELEASE_GATE.md) records no errors across all 18 routes, and no artifact file holds that output. `consoleErrors: 0` in the deployment record covers the run of 2026-08-18, not the 18-route sweep | [artifacts/deployment/production.json](../artifacts/deployment/production.json) |
| Ask | One live question per resolver outcome through `/api/ask`, the endpoint the screens use, each checked for `source_state: live` and a measured `took_ms`; a two hop question answered and cited; at least three distinct outcomes reached | `npm run smoke:demo -- https://lacuna-five.vercel.app` | Part of 30 of 30 | [RELEASE_GATE.md](../RELEASE_GATE.md), [scripts/smoke-demo.ts](../scripts/smoke-demo.ts), [artifacts/continuity/one-context.json](../artifacts/continuity/one-context.json), capture at [artifacts/screens/live/live-ask-1920x1080.png](../artifacts/screens/live/live-ask-1920x1080.png) |
| Workspace, demo | The demo workspace holds the corpus rather than being an empty workspace with a name; it refuses writes | `npm run smoke:demo -- https://lacuna-five.vercel.app` | Part of 30 of 30, memory row total greater than zero, POST returns 404 | [RELEASE_GATE.md](../RELEASE_GATE.md), [scripts/smoke-demo.ts](../scripts/smoke-demo.ts), [src/api/workspace.ts](../src/api/workspace.ts) |
| Timeline | The web Timeline screen reads `changes` and `conflicts`, both answered 200 in the demo sweep. The revision chain itself (`considered`, oldest first, with `validFrom`, `txTime`, `supersededBy`, `current`) is returned by the MCP and CLI timeline paths and is covered by unit tests | `npm run smoke:demo`, `npx vitest run tests/unit` | Screen reads answered, part of 30 of 30. Revision chain covered in `tests/unit/mcp-server.test.ts` and `tests/unit/mcp-tools.test.ts`. No committed transcript of a live `lacuna_timeline` or `lacuna timeline` call exists | [RELEASE_GATE.md](../RELEASE_GATE.md), [src/mcp/result.ts](../src/mcp/result.ts), [web/src/app/routes/context.tsx](../web/src/app/routes/context.tsx), capture at [artifacts/screens/live/live-timeline-1920x1080.png](../artifacts/screens/live/live-timeline-1920x1080.png) |
| Contradiction | A question whose sources disagree returns `CONFLICT` with reason `contradicted`, identically from three clients against one cloud workspace | `npm run continuity` | `q-contradicted-01`, `same: true`, `CONFLICT`, one conflict listed | [artifacts/continuity/one-context.json](../artifacts/continuity/one-context.json), [RELEASE_GATE.md](../RELEASE_GATE.md) |
| Missing evidence | A retracted value and an out-of-scope subject both return `NO_EVIDENCE` with their own reason codes, identically from three clients | `npm run continuity` | `q-retracted-01` reason `retracted`, `q-out_of_scope-01` reason `out_of_scope`, both `same: true` | [artifacts/continuity/one-context.json](../artifacts/continuity/one-context.json) |
| Mobile viewport | Landing and `/judge` captured at 375x812 against production, each checked on write for ground colour and compressed density | `npm run screens` | Two captures exist and passed their checks. No 375-wide capture exists for the other 16 routes | [artifacts/screens/live/live-landing-375x812.png](../artifacts/screens/live/live-landing-375x812.png), [artifacts/screens/live/live-judge-375x812.png](../artifacts/screens/live/live-judge-375x812.png), [scripts/screens.ts](../scripts/screens.ts) |

## Accounts

| Surface | What was exercised | Command or action | Result | Evidence |
|---|---|---|---|---|
| Sign up | A fresh visitor reads as signed out, the session read issues a CSRF cookie, sign up creates an account, a taken address is refused | `npm run smoke:auth -- https://lacuna-five.vercel.app` | Part of 12 of 12 | [RELEASE_GATE.md](../RELEASE_GATE.md), [scripts/smoke-auth.ts](../scripts/smoke-auth.ts) |
| Sign in | Sign in works from a clean cookie jar, a wrong password is refused | same | Part of 12 of 12 | [RELEASE_GATE.md](../RELEASE_GATE.md), [scripts/smoke-auth.ts](../scripts/smoke-auth.ts) |
| Session persistence | The session survives another function invocation, and sign out ends it | same | Part of 12 of 12 | [RELEASE_GATE.md](../RELEASE_GATE.md), [scripts/smoke-auth.ts](../scripts/smoke-auth.ts) |
| Onboarding | Onboarding names a workspace and the name persists to the next read | same, plus a by-hand pass in a browser from a cleared cookie jar | 12 of 12. The by-hand pass reached the dashboard reporting `0 current · 0 historical · 0 conflict`, a real empty workspace | [RELEASE_GATE.md](../RELEASE_GATE.md), [scripts/smoke-auth.ts](../scripts/smoke-auth.ts) |
| Workspace, signed in | A signed-in workspace reads empty unless it is the one named as the demo | covered by the account suite and by `src/api/router.ts` | 12 of 12 for the account flow. The signed-in path to the demo corpus is decided in code and asserted in the unit suite, not in a production transcript | [RELEASE_GATE.md](../RELEASE_GATE.md), [src/api/router.ts](../src/api/router.ts) |

## Clients

| Surface | What was exercised | Command or action | Result | Evidence |
|---|---|---|---|---|
| CLI | Every gold question asked through `lacuna ask` and compared field by field against both MCP transports: status, answer, reason code, claim id, superseded claims, evidence, evidence total, source state, and every graph read with its parameters and row counts | `npm run parity` | `SWEEP_IDENTICAL: 64 of 64`, `ALL_IDENTICAL: True` | [RELEASE_GATE.md](../RELEASE_GATE.md), [artifacts/verification/2026-08-18-gates/parity.txt](../artifacts/verification/2026-08-18-gates/parity.txt), single-question captures at [artifacts/verification/2026-08-14b/cli-ask.json](../artifacts/verification/2026-08-14b/cli-ask.json) and [cli-abstain.json](../artifacts/verification/2026-08-14b/cli-abstain.json) |
| MCP | The same sweep over stdio and HTTP; four tools advertised over stdio; a third-party client consumed the documented config block and drove both transports | `npm run parity`, plus the MCP Inspector CLI | 64 of 64 identical. Four tools listed: `lacuna_ask`, `lacuna_explain`, `lacuna_timeline`, `lacuna_health` | [RELEASE_GATE.md](../RELEASE_GATE.md), [artifacts/verification/2026-08-14b/mcp-stdio.txt](../artifacts/verification/2026-08-14b/mcp-stdio.txt), [artifacts/verification/2026-08-14e/README.md](../artifacts/verification/2026-08-14e/README.md), timings at [artifacts/mcp/stdio-timings.txt](../artifacts/mcp/stdio-timings.txt) |
| Cross-client continuity | The deployed web over HTTPS, the CLI in a local process, and an MCP server started as a subprocess, all reading the same HydraDB Cloud workspace, on six questions covering six outcomes | `npm run continuity` | `ONE_CONTEXT_IDENTICAL: true`, six questions, every row `same: true` | [RELEASE_GATE.md](../RELEASE_GATE.md), [artifacts/continuity/one-context.json](../artifacts/continuity/one-context.json) |

## HydraDB

| Surface | What was exercised | Command or action | Result | Evidence |
|---|---|---|---|---|
| Cloud ingest | The corpus and claim graph written to HydraDB Cloud, indexed, and a sampled entity plus the index read back and compared to what was written | `npm run ingest:cloud` | 159 written, 159 accepted, 159 indexed, 0 refused; sample and index both read back identical; 86 entities, 174 claims, 72 sessions | [artifacts/hydra/cloud-ingest.json](../artifacts/hydra/cloud-ingest.json), [cloud-ingest.log](../artifacts/hydra/cloud-ingest.log) |
| Cloud reads, against the node | All 64 gold questions asked of the node and of the cloud, compared field by field with wall clock and read log excluded | `npm run parity:cloud` | `identical: true`, 64 questions, node 342 reads against cloud 119, median node 108ms against cloud 230ms | [artifacts/hydra/cloud-parity.json](../artifacts/hydra/cloud-parity.json), [RELEASE_GATE.md](../RELEASE_GATE.md) |
| Cloud health, from the deployment | A real round trip from the deployed function to the configured database | `GET /api/health` on production | ok, `api.hydradb.com` answered in 160ms, database `lacuna`, collection `backend` | [RELEASE_GATE.md](../RELEASE_GATE.md), [api/index.ts](../api/index.ts) |
| Local node, contents | Every stored key read back and compared against the ingest plan, so a missing node and a stray node cannot cancel out | `npm run census` | `graph matches the plan exactly` | [RELEASE_GATE.md](../RELEASE_GATE.md), [artifacts/verification/2026-08-18-gates/census.txt](../artifacts/verification/2026-08-18-gates/census.txt) |
| Local node, counts | The loaded graph reported back by the CLI | `npm run status` | Session 72, Message 5246, EvidenceSpan 174, Claim 174, Entity 86 | [RELEASE_GATE.md](../RELEASE_GATE.md) records the ingest as 5752 vertices and 5908 edges; the per-label counts are the output of this session's run |
| Local node, query layer | Every query builder run against a live node, skipping rather than passing when none answers | `npx vitest run tests/contract` | 77 passed, 4 files, none skipped | [RELEASE_GATE.md](../RELEASE_GATE.md), earlier run at [artifacts/verification/2026-08-18-gates/contract.txt](../artifacts/verification/2026-08-18-gates/contract.txt) |

## Checks

| Surface | What was exercised | Command or action | Result | Evidence |
|---|---|---|---|---|
| Typecheck | The whole tree, no emit | `npx tsc --noEmit` | exit 0 | [RELEASE_GATE.md](../RELEASE_GATE.md), earlier run at [artifacts/verification/2026-08-18-gates/typecheck.txt](../artifacts/verification/2026-08-18-gates/typecheck.txt) |
| Unit tests | The suite that needs no database | `npx vitest run tests/unit` | 970 passed, 45 files | [RELEASE_GATE.md](../RELEASE_GATE.md). The committed artifact [unit.txt](../artifacts/verification/2026-08-18-gates/unit.txt) records the earlier count of 921 over 41 files and is kept unedited |
| Contract tests | Query builders against a live node | `npx vitest run tests/contract` | 77 passed, 4 files | [RELEASE_GATE.md](../RELEASE_GATE.md), [artifacts/verification/2026-08-18-gates/contract.txt](../artifacts/verification/2026-08-18-gates/contract.txt) |
| Benchmark | Lacuna against five flat retrieval approaches over the same corpus, 51 configurations, embeddings run locally | `npm run bench` | Lacuna 64/64 with 18 mean context tokens; best baseline `hybrid+2hop@50 +conflict` at 63/64 with 1843. A one question lead, stated as one | [artifacts/bench/report.txt](../artifacts/bench/report.txt), [results.json](../artifacts/bench/results.json), read in full in [docs/BENCHMARKS.md](BENCHMARKS.md) |
| Snapshot replay | All 64 gold questions replayed from the recorded snapshot through the real decoder and resolver | `npm run snapshot:verify` | 64 questions, 0 answer mismatches, 0 wrong verdicts | [artifacts/verification/2026-08-18-gates/snapshot-verify.txt](../artifacts/verification/2026-08-18-gates/snapshot-verify.txt) |

## What this matrix does not cover

Named here rather than left for a reader to notice.

- **No Google sign in.** Email and password only. It would need an OAuth client
  created in a Google Cloud project, and creating accounts or credentials was
  out of scope for this run.
- **No connector syncs.** The Connectors screen lists nothing that pulls. File
  and document ingest through the web is the largest missing piece of product
  completeness, and it was left unstarted rather than half started against a
  frozen release.
- **Voice is unconfigured** in the deployment, and the screen says so.
- **No soak or concurrency evidence.** Every number above is a single sequential
  run. Nothing here says what happens under load or with two writers.
- **The corpus is generated by this project.** The retrieval comparison is fair
  between the systems it compares, because they all read the same corpus, and it
  is not a public benchmark. The same generator wrote the questions, so 64/64
  says the pipeline does what the structure says, not that it is right about the
  world.
- **No per-route mobile capture.** Two surfaces were captured at 375x812. The
  other sixteen routes have no narrow-viewport evidence.
- **No live transcript of the timeline or explain tools.** Both are covered by
  the unit suite and both go through the same shared projection as `ask`, which
  the parity sweep covers on 64 questions. Neither has a committed transcript of
  its own.
- **No editor or agent runtime has held an interactive MCP session.** The
  clients that have connected are a stdio driver from this repository, the SDK's
  own client in the parity run, and the MCP Inspector CLI. A client run from a
  terminal is not a host.
- **[artifacts/deployment/production.json](../artifacts/deployment/production.json)
  is a record of 2026-08-18 and one of its `honestLimits` lines is now stale.**
  It says the answer engine still reads the self-hosted node. The deployment now
  reads HydraDB Cloud, which is what `npm run continuity` and `npm run
  parity:cloud` measure. The file is kept unedited because a transcript edited
  to agree with a later run has stopped being a transcript.

## Related

- [RELEASE_GATE.md](../RELEASE_GATE.md), the gates and their commands.
- [docs/EVIDENCE_INDEX.md](EVIDENCE_INDEX.md), every public number and the file
  it came out of.
- [docs/ARCHITECTURE_FINAL.md](ARCHITECTURE_FINAL.md), the layers these surfaces
  sit on.
