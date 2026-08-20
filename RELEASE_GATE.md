# Release gate

> **V8 current gate — 2026-08-20.** The material below this block is the dated
> V7 evidence record and remains for audit history. It does not describe the
> current product boundary. V8 is pinned by the final clean commit and
> deployment recorded in `docs/FINAL_EXECUTION_STATE.md`.

| V8 gate | Current evidence |
| --- | --- |
| unit | 1,300 of 1,300; 70 files; no skips |
| TypeScript | root and web typechecks exit 0 |
| production build | split production bundle; entry 281.92 kB / 92.65 kB gzip |
| dependency audit | zero known npm vulnerabilities |
| public graph | 453 nodes, 682 edges; signed cursor pages; overview + exact proof modes |
| agent runtime | 2 persisted roles; one real production run completed through 8 lifecycle events |
| scheduler | one durable daily schedule; bearer-protected fixed-workspace dispatcher |
| voice | 15-state runtime and guarded streaming boundary shipped; production provider credentials absent, so honest 503 fallback |
| landing accessibility | WCAG A/AA automated audit: 0 violations |
| production responsiveness | no horizontal overflow at 390 and 1440 on landing; graph verified at 1440; final route matrix artifact is indexed in `docs/EVIDENCE_INDEX.md` |
| secrets | provider keys remain server-side; client bundle contains no ElevenLabs or Hydra credential |

The V8 acceptance details and limitation language are in
`docs/FINAL_CAPABILITY_MATRIX.md`. A pending video or human-only cross-client
send is never silently converted into a pass.

Every gate below was run in this session, in this order, and the output pasted
is the output it produced. A gate with no evidence line is not a gate.

Commit: the tag `v7-1-convergence`. This line named `v7-freeze` while HEAD was
sixteen commits past it, so the table was pinned to a tree that predated most
of what it records.
Production: https://lacuna-five.vercel.app

## Core

| Gate | Result | Command |
| --- | --- | --- |
| typecheck | exit 0 | `npx tsc --noEmit` |
| unit | 1,208 of 1,208, 59 files | `npx vitest run tests/unit` |
| contract, live node | 77 of 77, 4 files | `npx vitest run tests/contract` |
| census | graph matches the plan exactly | `npm run census` |
| ground-truth isolation | inside the unit suite, fails if the runtime imports it | `npx vitest run tests/unit` |

## The two hard questions

| Gate | Result | Command |
| --- | --- | --- |
| a package changes, and the graph is walked for what it reaches | 13 services at depth 3 for both `pact-check` and `moss-index`, cloud and node returning the same set, and one superseded dependency edge refused | `npm run proof` |
| an unsupported premise, a real revision and an unknown subject, through three clients | `THREE_CLIENTS_IDENTICAL: true`, 1 answered and 2 abstained with different reason codes | `npm run proof` |

Both are recorded to [artifacts/proof/proofs.json](artifacts/proof/proofs.json).
Neither is scored against an expected value and no ground truth is imported.
The proof is the transcript, so a change that broke the resolver would still be
recorded faithfully rather than reported as a pass.

## One core, every client

| Gate | Result | Command |
| --- | --- | --- |
| three surfaces, one store, 64 questions | `ALL_IDENTICAL: True` | `npm run parity` |
| two stores, 64 questions | `ALL_IDENTICAL: true` | `npm run parity:cloud` |
| **three clients, production, one cloud workspace** | **`ONE_CONTEXT_IDENTICAL: true`** | `npm run continuity` |

The third is the one that makes "One context. Any agent." a check rather than
a slogan: the deployed web over HTTPS, the CLI on a laptop, and an MCP server
started as a subprocess, all reading the same HydraDB Cloud workspace.

## Accounts

| Gate | Result | Command |
| --- | --- | --- |
| Google sign in, on production, in a real browser | a new account created from a verified address, landing on onboarding | by hand, recorded in this table |
| the same account signing in again | went straight to the dashboard rather than onboarding, so the account and its workspace survived in HydraDB Cloud and the callback routed on stored state. Settings confirmed the same address. **The workspace name differed from the one entered minutes earlier**, and that is recorded rather than explained away: the browser is the owner's own and was in use, so the change cannot be attributed with certainty and is not claimed as a defect or as a pass | by hand |
| the five onboarding steps | completed end to end for a Google account, HydraDB reporting genuinely connected at step two, and the dashboard opening on a real empty workspace at `0 current · 0 historical · 0 conflict` rather than seeded data | by hand |
| what Lacuna refuses as an identity | 15 of 15, and eleven of them are refusals: an unverified address, a token minted for another application, another issuer, an expired token, no address, a failed exchange, and something that is not a JWT | `npx vitest run tests/unit/google-auth.test.ts` |
| sign up, session survives another invocation, workspace persists, sign out, sign back in from a clean jar, wrong password refused | 12 of 12 | `npm run smoke:auth -- https://lacuna-five.vercel.app` |

Verified again by hand in a browser from a cleared cookie jar: sign up lands on
onboarding, five steps name a workspace, and the dashboard opens reporting
`0 current · 0 historical · 0 conflict` — a real empty workspace.

## Deployment

| Gate | Result | Command |
| --- | --- | --- |
| shell, first paint, deep-route refresh | 9 of 9 | `npm run smoke:web -- https://lacuna-five.vercel.app` |
| every demo read, one live question per outcome, four public pages | 30 of 30 | `npm run smoke:demo -- https://lacuna-five.vercel.app` |
| every route in a real browser, at nine viewports from 360px to 4K | 198 of 198 | `npm run audit:routes` |
| the same sweep with prefers-reduced-motion set | 198 of 198 | `npm run audit:routes -- <url> --reduced-motion` |

The route audit replaces a line that used to read "no console errors across all
18 app routes" with the Browser pane named as its evidence. That was somebody
having looked once, which is the one kind of entry this table is not allowed to
contain. It now opens all 22 routes at nine viewports and keeps what the browser
said: console errors, uncaught exceptions, failed and 400-and-above requests,
whether the document scrolls sideways, and whether anything was drawn at all.
Its first run failed 18 of 23, which is recorded below.

It counted 23 routes until a judge pass noticed that one of them, `/docs`, is
not a route. Nothing defines it and nothing links to it, and the catch all
rewrite handed it to index.html, so it drew the landing page and passed with
more text than most real routes. It is removed, and the audit now fails any
non-root path whose text matches the landing page's, which closes the class
rather than the one instance. Verified by putting `/docs` back: it fails at all
nine viewports.

Evidence in [artifacts/route-audit/routes.json](artifacts/route-audit/routes.json)
and [routes-reduced-motion.json](artifacts/route-audit/routes-reduced-motion.json).

## Secrets

| Gate | Result | How |
| --- | --- | --- |
| no credential value in any tracked file | 0 | the value of each live key searched with `git grep -F` |
| no credential value anywhere in history | 0 commits | `git log --all -S<value>` per key |

Names and availability are inventoried in
[docs/CREDENTIAL_ROTATION_CHECKLIST.md](docs/CREDENTIAL_ROTATION_CHECKLIST.md),
which holds no value, prefix or suffix of any key.

## The harness, stated honestly

The directive this project works to specifies a harness with a canonical
RunState, run modes, a Capability Manifest, budgets that terminate a run,
progressive hydration, a context trajectory, tool output externalisation,
checkpoints, cancellation and selective writeback.

**Roughly a fifth of that exists.** Nothing is IMPLEMENTED end to end, four
items are PARTIAL and six are ABSENT, counted item by item in
[docs/HARNESS_CONFORMANCE_MATRIX.md](docs/HARNESS_CONFORMANCE_MATRIX.md).
Everything present is scoped to a single question rather than to a run, because
there is no run object: the bounds are per read, the trace is per answer and is
discarded with the response, and the abort signal belongs to an HTTP request.

Two pieces are real and are worth naming exactly rather than inflating. The
query trace keeps the statement, the bound parameters, the row count, the
latency and the store epoch for every round trip. The graph walk is bounded by
depth, visits each entity once, cites the claim id at every hop, and counts the
superseded edges it refused to follow.

The landing page does not claim more than this. It says models do the work and
Lacuna keeps the state, which the continuity gate supports.

All three were run against a preview build first and then against production
after promoting it. The preview reports 21 of 30 on the demo gate and says why:
the HydraDB variables are set on the production environment only, so a preview
has no context store. Everything a preview can check, it checks.

## HydraDB's own graph

| Gate | Result |
| --- | --- |
| the store's relation endpoint is called and rendered | 47 relations in about 150ms on the HydraDB screen, with the sentence the store read each one out of |
| a deployment without the endpoint | says unavailable rather than drawing an empty graph, which a preview build demonstrates |

Every other screen shows the graph Lacuna traversed. This one shows the graph
HydraDB built from the same transcripts on its own, which is the part of the
work the store did rather than the product. The two are labelled as different
things on the screen, because Lacuna's claim graph is built from structured
annotations and the store's is extracted from prose.

## The landing page

| Gate | Result |
| --- | --- |
| the terminal block is a recording | rendered from [artifacts/cli/session.txt](artifacts/cli/session.txt), regenerated by `npm run capture:cli` |
| no invented operational strings **in the terminal block** | the drawn workspace, model, trace id, connected dot and nine commands that did not exist are gone from it, checked against the served production bundle |
| invented strings elsewhere on the page | **still there, and labelled rather than removed.** The SDK panel ships `@lacuna/sdk`, `POST /v1/query` and four methods that do not exist. The row above used to read as though the whole page had been cleaned, which was not true. See the SDK note below |
| the command list under it | the six commands `lacuna --help` prints, and no others |
| horizontal overflow at 360px | 0, measured in the browser. It was 9px, from box drawing rules with no spaces to wrap at |
| the five section links on a phone | reachable through a disclosure sheet. They were `display:none` with nothing in their place |
| touch targets in that sheet | 7 of 7 at 44px or taller, measured |
| every signed-in route on a phone | 0 scrolling sideways. All 18 did, by 71px to 246px, from a header cluster wider than the space beside the title and from route content taking the document with it |
| plain English in the public copy | 47 files, 0 findings | `npm run copy:lint` |

## The official benchmark, and what has not been run

| Gate | Result | Command |
| --- | --- | --- |
| the official LongMemEval schema, confirmed against the upstream source | tiers, input shape, hypothesis format, evaluator invocation and the abstention test all read off the repository rather than assumed. Two details could not be confirmed and say so | `docs/BENCHMARK_LONGMEMEVAL.md` |
| ground truth cannot reach ingestion | the adapter copies eight named fields and `has_answer` is not one of them, proved by a test that hands it the answer bearing record on purpose | `npx vitest run tests/unit/longmemeval-adapter.test.ts` |
| the runner without a dataset | fails loudly with the download command, and never invents data | `npm run bench:longmemeval` |

**No LongMemEval number has been produced, and none is claimed anywhere in this
repository.** No dataset was downloaded, no haystack ingested, no hypothesis
written, and the official evaluator was not run. What exists is the integration
and the honest account of what a real run still needs: the dataset, a claim
extractor for raw prose, a question parser, a node to ingest into, and a paid
judge model for 500 calls a run.

The blocker is the claim extractor, which is the same weakness the README
already names. That is not a coincidence: it is the one thing standing between
this project and a real number on the track's own benchmark.

## Under load

| Gate | Result | Command |
| --- | --- | --- |
| 400 requests at concurrency 12 against the deployed ask endpoint | 26.3 a second, p50 387ms, p95 805ms, p99 1423ms, max 1871ms, 0 failures | `npm run soak` |
| the answers under load | every one identical to the same question asked alone | same run |

Evidence in [artifacts/soak/soak.json](artifacts/soak/soak.json). The load is
deliberately modest. The useful question is whether the system degrades or
misbehaves when several agents share a workspace, not how hard a free tier can
be pushed before a quota runs out.

## The boundaries, as a test

| Gate | Result | Command |
| --- | --- | --- |
| the web never imports the server tree or the resolver | asserted structurally | `npx vitest run tests/unit/architecture.test.ts` |
| one seam decides which store a client reads | asserted, with eight surfaces pinned to one store on purpose and listed with the reason | same |
| temporal and contradiction semantics are not re-decided in a client | asserted | same |
| no surface names a gold answer | asserted | same |

Both new guards were checked by breaking them: constructing a source outside the
seam fails, and filtering claims on supersession inside a client fails.

## HydraDB

| Gate | Result | Command |
| --- | --- | --- |
| ingest and index | 159 of 159, read back byte identical | `npm run ingest:cloud` |
| health, from the deployment | ok, api.hydradb.com in ~170ms | `GET /api/health` |
| node ingest | 5752 vertices, 5908 edges | `npm run ingest` |

## Video

| Gate | Result |
| --- | --- |
| duration | 148.5s, under the 3:00 ceiling |
| format | 1920x1080, H.264, AAC 48kHz, faststart |
| captions | 51 cues, in the file and as a sidecar SRT |
| provenance | every screen a capture of production; the continuity scene is recorded output |
| claim map | `docs/VIDEO_CLAIM_MAP.md` |

## Not green, and named

- **Google sign in works and is the newest thing here.** Verified by signing in
  on production: the redirect carries `openid email profile` and nothing more, a
  new account was created from the verified address, and it landed on
  onboarding. The password path is unchanged at 12 of 12. What it does not have
  is a soak, a second verified account, or a test of two people whose Google
  addresses differ only by case.
- **No scheduler, no persisted agents, no multimodal ingest.** All three were
  considered and not started. Each is a new subsystem, and starting one against
  a frozen release buys a half-built surface in exchange for the gates above.
  The honest empty states stay honest.
- **No competitor gap matrix.** It needs public links that are not recoverable
  in this working session, and inventing the comparison would be worse than
  not having one.
- **No connector syncs.** File and document ingest through the web is the
  largest missing piece of product completeness, and it was not started rather
  than half-started against a frozen release.
- **Voice is unconfigured** in the deployment and says so.
- **Four vendor marks are redrawn rather than licensed**, and the HydraDB icon
  is an invented glyph rather than the real logo. Both are recorded in
  [docs/ICON_AUDIT.md](docs/ICON_AUDIT.md) and deliberately not changed today,
  because swapping either on a submission day trades a documented imperfection
  for an undocumented one. The generic icons are also not one family: stroke
  weights split 1.5 against 1.6.
- **The corpus is generated by this project.** The retrieval comparison is fair
  between systems and is not a public benchmark.
- **Preview deployments sit behind Vercel SSO.** Production is public.
- **The local node's write path failed once** and was recovered by rebuilding
  the store from the seed. Recorded as D-123.
