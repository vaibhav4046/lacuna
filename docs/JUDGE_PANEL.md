# Judge panel

Six read-only judges, run against the repository at `128e1c6` and against
<https://lacuna-five.vercel.app> on 2026-08-19. Each judge scored one axis and
was told to look for reasons this loses rather than reasons it wins.

Every weakness below cites a file, an artifact, or a command whose output is
quoted. Nothing here was inferred from a document that was not also checked
against the thing it describes. Where a judge could not check something, the
judge says so.

This document is for the builder. It is blunt on purpose and it is not the
project's own scorecard; [JUDGE_SCORECARD.md](../JUDGE_SCORECARD.md) is, and two
of its lines are among the findings.

**The working tree moved during this review.** `artifacts/route-audit/routes.json`
was rewritten at 08:41 (23 routes at nine viewports, 207 checks, up from 23 at two
viewports and 46 checks), `routes-reduced-motion.json` appeared at 08:46, and
`docs/END_TO_END_MATRIX.md` gained a row for both. Findings that depend on those
files were re-checked against the newer version and the numbers below are the
newer ones. Everything else is a snapshot of the tree between 08:20 and 08:50 on
2026-08-19, and a finding may already be fixed by the time it is read.

---

## 1. Track 03, memory and context

**Score: 7 of 10.**

### What was verified

The five resolver outcomes were asked of production directly, through the CSRF
handshake in [scripts/proof.ts](../scripts/proof.ts), and all five came back
correct:

```
Foxglove / beta_partner       ANSWERED  "Stonecrop"   1 evidence, 1 superseded
billing-gate / runbook_owner  CONFLICT  contradicted  2 evidence, 1 conflict
Lowbank / launch_date         NO_EVIDENCE retracted   2 evidence, 1 superseded
token-forge / depends_on      ANSWERED  "queue-comb, tide-buffer"  2 evidence
Foxglove / pool_size          NO_EVIDENCE never_stated  0 evidence
Redshank / launch_date        NO_EVIDENCE out_of_scope  0 evidence
```

All six carried `source_state: "live"`. The abstention path is structural, not a
confidence threshold: `resolve()` in
[src/retrieval/resolve.ts](../src/retrieval/resolve.ts) returns at the first
arrangement of nodes that settles the question, and no model is consulted at any
point, which `docs/CLAIMS.json` entry `llm-router` states correctly.

Supersession is preserved rather than overwritten. `Foxglove / beta_partner`
returned the current value and a `revisions` array holding the superseded claim
id. `Lowbank / launch_date` returned `NO_EVIDENCE` while still citing the two
sources that were withdrawn, which is the behaviour `citedClaims` is written for.

The blast walk refuses stale edges. `liveDependencyEdges` filters on
`supersededBy.length === 0`, and
[artifacts/proof/proofs.json](../artifacts/proof/proofs.json) records
`"ignored": 1` for `moss-index` in both stores, meaning one superseded dependency
claim was met and not followed. That is the one number in the proof artifact that
separates a temporal traversal from a plain one, and it is present.

`tests/unit/ground-truth-isolation.test.ts` is real and it passed in the run
below. The query path imports no module carrying an expected answer.

**I could not find a question where it answers and should abstain.** That half of
the thesis holds up under the probing I did.

### Why not higher

**The hard half of temporal memory is given to the system, not inferred by it.**
`buildPlan(corpus: Corpus)` in [src/ingest/plan.ts](../src/ingest/plan.ts) reads
`ClaimAnnotation.supersedes` and writes a `SUPERSEDES` edge from it. The comment
at the head of [src/corpus/predicates.ts](../src/corpus/predicates.ts) says the
quiet part out loud: "Extracting that distinction from free text is a separate
research problem and is out of scope here: the corpus is annotated." Grepping for
`SUPERSEDES` across `src/` returns eight files and none of them reads a sentence.
There is no extractor anywhere in this repository. The consequence is not
academic: Lacuna cannot form a claim graph from any text it did not generate
itself, so "memory for agents" is demonstrated only over its own corpus.

**There is no question understanding.** `/api/ask` takes
`{subject, predicate, via}` as three exact strings
([src/api/router.ts](../src/api/router.ts) line 388 onward), and
[src/retrieval/question.ts](../src/retrieval/question.ts) parses only two
patterns out of a sentence, `for the X behind Y` and
`if X changes, which services are affected?`. The Ask screen
([web/src/app/routes/Ask.tsx](../web/src/app/routes/Ask.tsx)) is two free-text
inputs labelled "subject" and "predicate". A judge who types a question gets an
abstention.

**Exact matching produces an abstention with a false reason code.** This is the
concrete defect I was asked to find:

```
{"subject":"foxglove","predicate":"beta_partner"}
  -> NO_EVIDENCE, abstain_reason "out_of_scope"
```

`out_of_scope` means, in this product's own vocabulary, that the subject is not
in the sessions at all. Foxglove is in the sessions; the query differed by one
capital letter. The system asserted something untrue about its own corpus. The
same shape appears on the predicate side: `Beta_Partner` returns `never_stated`
for a predicate that is stated 174 times over. A product whose entire argument is
that a refusal is a finding rather than a shrug has, here, produced a finding that
is wrong.

**The `via` hop is unreachable from the product.** `run()` in `Ask.tsx` posts only
`subject` and `predicate`. Grepping `web/src` for `via` returns hits only in
`web/src/pages/Judge.tsx`, where it is hardcoded to `'vendor'`. The
`/api/demo/hops` endpoint is served and answers, and no screen consumes it. So
the multi-hop capability that carries the benchmark's one-question lead exists on
the judge page and nowhere in the product.

### Weaknesses

| Severity | Finding | Smallest fix |
|---|---|---|
| HIGH | No claim extraction from text anywhere. The graph's temporal structure comes from generator annotations. | Nothing small fixes this. Say it in the README next to the thesis paragraph, in one sentence, rather than leaving a judge to find `src/corpus/predicates.ts`. |
| HIGH | `foxglove` returns `out_of_scope`, which is false about the corpus. | Case-fold the entity lookup, or add a fifth trace line distinguishing "no node with that exact name" from "no node with that name in any casing". A one-line `toLowerCase()` on both sides of `entityByName` is the smaller change. |
| MEDIUM | No natural-language question path. Ask is two exact-match boxes. | Keep the boxes, and make the suggestion chips the primary affordance rather than a row under them. |
| MEDIUM | `via` is not reachable from Ask, so the hop only exists on `/judge`. | Consume `/api/demo/hops`, which already returns a working suggestion, as a fourth chip. |

**Confidence: high** on everything above; every line was executed against
production or read in the file cited. **Not checked:** whether any of the 64 gold
questions is answered from a superseded claim. That would need the eval harness
run against a live node, and the contract and eval suites write to the graph, so
I did not run them.

---

## 2. HydraDB and graph-native use

**Score: 6 of 10.**

### The honest answer on the cloud path

**It is a key-value store with the graph precomputed into the values.**

[src/hydra/cloud-source.ts](../src/hydra/cloud-source.ts) issues exactly one kind
of request: `GET /context/inspect id=lacuna:entity:<sha256 of the name>`. The id
is a hash of the entity name
([src/hydra/cloud-graph.ts](../src/hydra/cloud-graph.ts), `entityRecordId`). What
comes back is a JSON blob holding that entity's claims, mentions, dependents and
evidence, denormalised at ingest time. Traversal is a `for` loop in
[src/retrieval/blast.ts](../src/retrieval/blast.ts) fetching the next blob. The
service performs no graph operation at any point on the answer path.

The file's own header is candid about this and calls the shape "the honest way to
put one product over both", which it is. But the question a judge asks on this
dimension is whether HydraDB is load bearing as a graph, and in production the
answer is that HydraDB is load bearing as a document store.

**Two graph-shaped cloud endpoints are wired and unused.**
[src/hydra/cloud.ts](../src/hydra/cloud.ts) implements `relations(limit)` against
`/context/relations` and `query(text)` against `/query` with
`graph_context: true`, and both decode `graph_context` and `temporal_facts`.
Grepping `src/`, `api/`, `scripts/` and `web/src/` for calls to either returns
only the definitions themselves. The `ingestApp` path even declares
`relations.ids` so the service holds the product's own edges. Nothing reads them
back.

### The node path is genuinely graph-native, and is not what is deployed

[src/hydra/node-source.ts](../src/hydra/node-source.ts) and
`src/retrieval/queries.ts` issue real Cypher over
`/v1/graphs/{graph}/query`, and the local node answered `readyz` 200 while I was
working, so that path is live on this machine. The labelled property graph is
real: `ABOUT`, `MENTIONS`, `SUPERSEDES`, `CONTRADICTS`, `SUPPORTS`, `HAS_SPAN`,
`CONTAINS`, with the census in
[artifacts/verification/2026-08-18-gates/census.txt](../artifacts/verification/2026-08-18-gates/census.txt)
counting 174 SUPPORTS, 174 ABOUT, 106 MENTIONS, 22 SUPERSEDES, 12 CONTRADICTS
and ending `graph matches the plan exactly`.

`npm run parity:cloud` comparing both stores on all 64 questions, and
[artifacts/proof/proofs.json](../artifacts/proof/proofs.json) showing the same 13
services at the same depth from both, is real and it is a genuinely good piece of
engineering. It is also the thing that proves the cloud path does not need a
graph engine to produce the same answer.

Even on the node, the walk is a hand-rolled breadth-first loop issuing one
`dependentsOf` query per frontier node. STATE.md already records that
`algo.SPpaths` was probed and is not on the answer path.

### Weaknesses

| Severity | Finding | Smallest fix |
|---|---|---|
| HIGH | The production store performs no server-side graph operation. Every deployed answer is one or more keyed blob fetches plus a client-side loop. | Cannot be fixed today. What can be: call `cloud.relations()` once on the `/demo/hydra` screen and print what the service itself returns beside the product's traversal, so a judge sees the service's graph and not only the product's. The method already exists and is untested against production. |
| MEDIUM | `/context/relations` and `/query` with `graph_context` are implemented and never called. A reader who greps will find dead capability. | Same fix as above, or a comment in `cloud.ts` naming them as written-and-unused. |
| MEDIUM | The Graph screen shows 6 claims of 174, fixed layout, no traversal. Verified in the browser at `/demo/graph`: "6 shown", "FIXED LAYOUT - NO PHYSICS - SAME GRAPH EVERY TIME". | Render the blast walk's path on that screen instead. It is already computed and already cited per hop. |
| LOW | `src/hydra/cloud.ts` line 16 says the "Context Pack compiler" is untouched by the transport. No such component exists, which `docs/ARCHITECTURE_FINAL.md` already admits. | Delete the clause. |

**Confidence: high.** Both source files were read in full and the greps are
reproducible. **Not checked:** what `/context/relations` actually returns for
this database, because calling it is a network write-adjacent action I chose not
to take against the submission's live account.

---

## 3. Product completeness and usability

**Score: 6 of 10.**

### What works

`/judge` is the best thing in this submission. Opened in a browser against
production, it computes six rows live, reaches six different outcomes, names the
store ("HYDRADB CLOUD, DATABASE LACUNA, COLLECTION BACKEND"), shows per-row
latency between 107ms and 218ms, and needs no account. It includes the two-hop
row that the product itself cannot reach.

The empty states are honest, and that is not a small thing. Read from
`web/src/app/routes/`: "No tools connected. A tool is something an agent may
call. Nothing is connected in this workspace." "Nothing has changed yet. A
revision appears when a newer source replaces something this workspace already
held." Settings prints "API keys: none issued", "Models: not configured",
"Voice: not configured", "Data export: not configured". Nothing draws a
placeholder as if it were a value.

Sign up, onboarding, session persistence and sign out are gated at 12 of 12 and
the account store is durable in production
([src/auth/accounts.ts](../src/auth/accounts.ts), `CloudAccounts`).

### Screens that promise something they do not do

Each of these was opened on production.

**`/demo/sdk`.** Renders a TypeScript block importing `@lacuna/sdk`, a package
that does not exist, calling `lacuna.query("Where does session state live now?")`
and returning `"Postgres"` with evidence `PR #184`, none of which is in this
workspace, and listing a contract of `remember`, `query`, `timeline`, `evidence`,
`contextPack`, `health`, `handoff`. The seven public tools that exist are the
five Lacuna-native reads `lacuna_ask`, `lacuna_explain`, `lacuna_timeline`,
`lacuna_read_question`, `lacuna_health`, plus connector-compatible `search` and
`fetch`. The REST tab shows
`POST /v1/query` with `"mode": "fast"`; no such endpoint exists. The MCP tab
lists `context.pack` and `handoff` and two `context://` resources; the MCP server
exposes no resources. The disclaimer is a 9px caption at the bottom reading
"CONTRACT SHOWN AS DESIGNED - THE IMPLEMENTED API IS THE SOURCE OF TRUTH". Source:
[web/src/landing/copy.ts](../web/src/landing/copy.ts) `DEVCODE`, rendered by both
`web/src/landing/Sdk.tsx` (the public landing page) and
`web/src/app/routes/developers.tsx`.

**The same screen is a dead-end loop.** It prints "LACUNA_API_KEY - NOT ISSUED /
NO ACTIVE KEY - ISSUE ONE FROM SETTINGS". Settings prints "API keys: none
issued" and has no issuer.

**`/demo/conn`.** Sixteen connector rows. Fifteen say PLANNED. One, "Custom
ingestion", says AVAILABLE and does nothing;
[web/src/design/connectors.ts](../web/src/design/connectors.ts) sets the status
as a constant. There is no ingest path through the web at all. This is a roadmap
rendered as a product surface.

**`/demo/agents`, `/demo/tools`, `/demo/work`.** `/api/demo/agents` returns `[]`,
`/api/demo/tools` returns `[]`, `/api/demo/runs` returns `[]`. Three of the
eighteen sidebar entries are permanently empty.

**`/demo/models`.** `/api/demo/models` returns `[]` and `/api/demo/model` returns
`{"label":"NOT CONFIGURED"}`. This directly contradicts
[JUDGE_SCORECARD.md](../JUDGE_SCORECARD.md), which says "the model router has one
real provider configured".

**No 404 anywhere.** [web/src/App.tsx](../web/src/App.tsx) ends
`<Route path="*" element={<Navigate to="/" replace />} />`. `/pricing`, `/docs`
and `/app/dash` while signed out all return HTTP 200 with the 785-byte shell and
then land on the marketing page. A judge who mistypes a URL gets the landing page
with no indication anything went wrong.

**`/forgot` cannot work.** `POST /api/auth/reset` returns 501 with
`{"error":"mail"}` by design ([src/api/router.ts](../src/api/router.ts)). The
route is in the router and linked from sign in.

### Weaknesses

| Severity | Finding | Smallest fix |
|---|---|---|
| HIGH | The SDK screen shows a package, a REST endpoint and seven methods that do not exist, on the public landing page and in the app. | Do not remove the panel on submission day. Promote the caption: make "NOT SHIPPED - DESIGN CONTRACT" a full-size label above the code block rather than a 9px line under it. One string and one style object. |
| HIGH | Connectors lists sixteen integrations, one marked AVAILABLE, none of which does anything. | Change "Custom ingestion" from AVAILABLE to PLANNED in `web/src/design/connectors.ts`. One word, and it removes the only row on that screen that is not already honest. |
| MEDIUM | "ISSUE ONE FROM SETTINGS" points at a screen with no issuer. | Change the string to "NOT ISSUED IN THIS BUILD". |
| MEDIUM | Every unknown path silently becomes the landing page with a 200. | Replace the `*` route with a small notice component. It is one file and no API change. |
| MEDIUM | Agents, Tools, Work and Models are four permanently empty sidebar entries out of eighteen. | Leave them. They are honestly empty and removing them today risks the nav satisfies-clause and the route audit. |
| LOW | `/forgot` leads to a 501. | The screen should say the reset is not configured before the user types an address. |

**Confidence: high.** Every screen named was opened against production in this
session. **Not checked:** the signed-in `/app/*` routes, because reaching them
needs an account and creating one is outside what I am allowed to do. Everything
above was checked on the `/demo/*` shell, which is the same component tree in a
different scope.

---

## 4. Architecture and the V7.1 harness

**Score: 3 of 10.**

This is the largest gap in the submission and it is worth quantifying rather than
describing.

### What the directive asks for, and what exists

Greps across `src`, `api`, `scripts`, `web/src` and `docs`:

| Directive component | Occurrences | What actually exists |
|---|---|---|
| Canonical RunState | `runstate\|run_state`: **0** | Nothing named this. The nearest thing is `QueryTrace[]` on every read plus `resolution.trace`, a per-request read log. It is per-question and discarded after the response. |
| Capability Manifest | `capability.?manifest`: **0** | `src/model/capability.ts` defines `CapabilityState` and `DataState` and `docs/CLAIMS.json` holds 25 entries using them. That is a documentation ledger regenerated by hand, not a runtime manifest. Nothing consults it at request time. |
| Run modes | `runmode\|run_mode\|run mode`: **1**, in `docs/SOURCE_LOG.md`, describing HydraDB's own README | `LACUNA_PROFILE=cloud\|node` in [src/hydra/open.ts](../src/hydra/open.ts) selects a store. That is a deployment switch, not a run mode. |
| Budgets that terminate loops | `budget`: **0** relevant. Hits are `budget_code`, a corpus predicate, and `--virtual-time-budget`, a Chrome flag in `scripts/social-card.ts` | `MAX_BLAST_DEPTH = 6` in `src/retrieval/blast.ts`, a per-call `timeoutMs`, `ASK_TIMEOUT_MS = 10_000`, and `MAX_EVIDENCE_ITEMS = 50`. These are caps. None is accounted against a budget, none is shared across a run, and nothing reports remaining budget. |
| Progressive hydration | `progressive.?hydrat\|hydration`: **0** | The cloud source memoises records per request instance, which is a cache, not hydration. |
| Context trajectory | `trajectory`: **0** | Nothing. The trace array is the closest artifact and it is not persisted, not compared across turns, and has no notion of a turn. |

**One of six components exists in a recognisable form, and none exists under the
directive's name.** The capability vocabulary is the one real partial: it is
defined once, shared between the ledger and the voice page, and tested for
vocabulary drift.

### The architecture that does exist is good, and it is a different architecture

This should not be lost in the number above.

- One resolver. `resolve()` in `src/retrieval/resolve.ts` is the only place an
  answer or an abstention is chosen, and `selectHopTarget` is deliberately shared
  with the fetcher so the two cannot disagree.
  `RetrievalConsistencyError` throws if they do.
- A real seam. `HydraSource` is four methods and nothing above it can tell which
  store answered.
- The boundaries are a test. `tests/unit/architecture.test.ts` fails if the web
  imports the resolver, if a client re-decides supersession, or if a surface
  names a gold answer. Both of the newer guards were checked by breaking them.
- The architecture document itself is unusually honest. `docs/ARCHITECTURE_FINAL.md`
  has a section called "Where the code differs" that names five places, including
  two dead `snapshot()` calls and two clients that bypass `openSource`.

### Weaknesses

| Severity | Finding | Smallest fix |
|---|---|---|
| CRITICAL for the directive, not for the hackathon | Five of the six named harness components do not exist in any form. There is no RunState, no runtime capability manifest, no budget accounting, no progressive hydration, no context trajectory. | None is small. The one with the best ratio is a budget: thread a single `{readsLeft, msLeft}` object through `AskOptions` and decrement it in `QueryRecorder`, which already counts every read. That converts three independent caps into one accounted budget in roughly forty lines. Do not attempt today. |
| MEDIUM | Two clients construct a source directly rather than through `openSource`: `scripts/serve.ts` and `api/index.ts`. The comment in `open.ts` says the decision is made "once, in one place" and it is made in three. | Already disclosed in `ARCHITECTURE_FINAL.md`. Amend the comment in `open.ts` so the source file does not overclaim on its own. |
| MEDIUM | `AnswerStatus` carries `PARTIAL`, which the resolver cannot produce, and `Ask.tsx` has a colour for it. | Leave it. The type comment already says so. |
| LOW | Three separate expressions of "this claim is live" in `resolve.ts`, `blast.ts` and `result.ts`. | Already disclosed. Extract one predicate after the deadline. |

**Confidence: high** on the absence findings; a grep returning zero across five
directories is about as solid as an absence gets. **Not checked:** whether the
V7.1 directive permits any of these under different names. I judged against the
names and the behaviours the brief listed.

---

## 5. Evaluation and reproducibility

**Score: 5 of 10.**

### What I reproduced myself

```
npx tsc --noEmit                 exit 0
npx vitest run tests/unit        Test Files 48 passed (48)
                                 Tests 1001 passed (1001)
npx tsx scripts/copy-lint.ts     47 files scanned, 0 findings.
```

All three match [RELEASE_GATE.md](../RELEASE_GATE.md) exactly. The seven stderr
lines the README predicts appeared and are error-path assertions.

The benchmark artifact is real and it is self-critical in a way that is rare.
[artifacts/bench/report.txt](../artifacts/bench/report.txt) leads with 64/64
against 63/64, states the 41x latency disadvantage in its own text, says the
comparison is not like for like, and describes the winning baseline as "not a
pipeline anyone ships". The ablation table showing what each of the four baseline
parts is worth is in the artifact, not just the prose.

### A number no artifact supports

[JUDGE_SCORECARD.md](../JUDGE_SCORECARD.md), product completeness section:
"Twenty-six routes, all reachable." Nothing produces 26.
[artifacts/route-audit/routes.json](../artifacts/route-audit/routes.json) records
`"routes": 23` both before and after its 08:41 rewrite.
`web/src/app/routes.ts` has 18 titles.
`docs/END_TO_END_MATRIX.md` says "The 18 app routes". No committed artifact
contains the figure 26.

### A documented command that does not exist

`docs/END_TO_END_MATRIX.md`, HydraDB section, "Local node, counts", cites
`npm run status`. `package.json` has no `status` script. Verified with
`grep -n '"status"' package.json`, which returns nothing.

### A wrong commit, and a gate table pinned to the wrong tree

`RELEASE_GATE.md` line 6: "Commit: see `git rev-parse HEAD` at the tag
`v7-freeze`." `docs/END_TO_END_MATRIX.md` line 12: "Rows citing RELEASE_GATE.md
were run at `v7-freeze`, commit `942de9e`."

```
git rev-parse v7-freeze^{commit}   -> e1293e827e041e15f30ed0515e7c85d218c6aadd
git log --oneline v7-freeze..HEAD | wc -l   -> 16
```

The tag is at `e1293e8`, not `942de9e`. HEAD is sixteen commits past it, and
those sixteen include `aba032f` (the soak gate), `064f696` (the sideways-scroll
fix), `da61b40` (the copy lint) and `7b3d77b` (the proof script). The gate table
contains rows for gates that did not exist at the tag it says they were run at.
The gates are real; the pin is wrong.

### A document that contradicts the code it exists to make checkable

[docs/EVIDENCE_INDEX.md](EVIDENCE_INDEX.md), tests section: the contract suite
"**skips rather than fails** when no node answers", in bold, as the reason the
number means something. All four files under `tests/contract/` say the opposite
in their own headers: "A missing node is a failure, not a skip." So do
`RELEASE_GATE.md` ("none skipped") and `STATE.md`. The document is right about
the number and wrong about the property that makes it worth anything.

The same file is two revisions behind: it records 893 unit tests over 39 files
and 50 contract tests, while `RELEASE_GATE.md` says 1001 over 48 and 77, and
`END_TO_END_MATRIX.md` says 970 over 45. Three documents, three unit counts, and
the live number is a fourth reading of the same suite.

### The claims ledger has three entries production disproves

[docs/CLAIMS.json](CLAIMS.json) is described as "Every claim this project makes
about itself" and is guarded by `tests/unit/claims.test.ts`, which STATE.md
correctly says checks that evidence paths exist and not what they contain. Three
entries marked `VERIFIED`:

- `no-client-script`: "No page ships a script. The policy that says so is served
  as a header and repeated in a meta tag." Production serves
  `/assets/index-RTN2P7AB.js` at 406,782 bytes and sends no
  Content-Security-Policy header at all.
- `no-runtime-dependencies`: "The package declares one runtime dependency, the
  official MCP SDK." `package.json` declares two: `@modelcontextprotocol/sdk` and
  `hash-wasm`.
- `deployment`: describes a site answering "from a recorded snapshot" at routes
  `/memory`, `/health`, `/blast`, `/bench`, `/hydradb`, `/interface`,
  `/lacuna.css`. None of those is a route in the deployed application, and the
  deployment answers live from HydraDB Cloud.

`docs/EVIDENCE_INDEX.md` line 263 carries the matching row: "The deployed copy
sends the same CSP and nosniff headers as the local server". It does not.

### The README is wrong about the deployment, in the direction that costs marks

README, "The deployed copy": "It answers from a recorded snapshot: every HydraDB
reply was produced by a live node at export time ... The deployment says so
itself on every page that shows an answer."

Production returns `"source_state":"live"` on every `/api/ask` call I made, and
`/judge` opens with "Six questions, answered live". `docs/ARCHITECTURE_FINAL.md`
states plainly that both `snapshot()` calls in `api/index.ts` are dead on the
deployment. The README understates the single strongest fact about the
submission, in the first section a judge reads.

### Could a stranger reproduce the numbers?

Partly. `npm ci`, `npm test` and `npm run typecheck` work from a clean clone and
are the strongest part of this. Everything else in the gate table needs HydraDB
built from source under WSL2: contract (77), census, ingest (5752 vertices),
parity (64 of 64), eval (64 of 64), bench, snapshot:verify. That is six of the
gate rows unreproducible without a build the README deliberately does not
restate. There is no CI, which D-049 records as a decision rather than an
omission, and the reasoning there is sound. It still means no number in this
repository has ever been produced by a machine that is not this laptop.

The soak artifact is a verdict, not a transcript.
[artifacts/soak/soak.json](../artifacts/soak/soak.json) is seventeen lines and
carries `"answersUnchangedUnderLoad": true` without the per-answer comparison
that produced it. I read `scripts/soak.ts` and the comparison is genuinely done
against a single-request baseline for six questions; the artifact just does not
carry the evidence, only the conclusion. The same is true of
`artifacts/continuity/one-context.json` and `artifacts/proof/proofs.json`, which
record `same: true` rather than the three envelopes that were compared.

### Weaknesses

| Severity | Finding | Smallest fix |
|---|---|---|
| CRITICAL | README describes the deployment as a recorded snapshot. It is live off HydraDB Cloud. | Rewrite that section. Six sentences, no code, no redeploy. |
| HIGH | Three `VERIFIED` entries in `docs/CLAIMS.json` are disproved by curl and by `package.json`. | Edit the three entries. The ledger is the project's honesty mechanism and a judge who tests one entry tests the mechanism. |
| HIGH | `docs/EVIDENCE_INDEX.md` says the contract suite skips when the node is down. The code says it fails. | One word. |
| HIGH | `JUDGE_SCORECARD.md` says there is no soak evidence and that the model router has one provider configured. Both are false as of today. | Two lines. |
| MEDIUM | "Twenty-six routes" has no artifact. | Say 23, and cite `artifacts/route-audit/routes.json`. |
| MEDIUM | `npm run status` does not exist; `v7-freeze` is `e1293e8`, not `942de9e`; three documents give three unit counts. | Fix the command name, fix the hash, and quote the live number in all three. |
| MEDIUM | The route audit counts `/docs` as a passing route. `/docs` is not a route; `<Route path="*">` in `web/src/App.tsx` redirects it to the landing page, which is why its `textLength` is 8263, byte-identical to `/`. The audit cannot tell a route from a fallback, so widening it from 46 checks to 207 widened the same blind spot nine ways. Still true in the 08:41 rewrite of `routes.json`. | Assert a per-route distinguishing string in `scripts/route-audit.ts`, or drop `/docs` from `APP_ROUTES`. |
| LOW | Proof, continuity and soak artifacts record verdicts rather than the compared payloads. | Write the envelopes into the JSON. The scripts already hold them. |

**Confidence: high.** Every claim above was executed or read. **Not checked:**
the contract, eval, bench, census and parity gates, because all of them write to
the graph and I was instructed not to run anything that writes. The local node
answered `readyz` 200 throughout, so they could have been run today; I am
reporting that they were not re-verified by me, not that they are wrong.

---

## 6. Security and tenancy

**Score: 8 of 10.**

This is the strongest dimension and the code is unusually careful.

### What was verified

**No committed credential.** I scanned every tracked file, artifacts included,
for seven credential shapes:

```
git ls-files -z | xargs -0 grep -InE "(sk-[A-Za-z0-9]{16,}|hyd_[...]|Bearer [...]|
  eyJ[...]|AKIA[0-9A-Z]{16}|ghp_[...]|gsk_[...]|[0-9a-f]{44,64})"
```

Two hits, both benign: a SHA-256 of the demo video in
`artifacts/video/final-metadata.json`, and the fixture string
`'Bearer a-token-the-client-chose'` in `tests/unit/security-namespace.test.ts`.
`.env.cloud`, `.env.deploy` and `.env.local` all exist in the working tree and
all three are matched by `.gitignore`; none is tracked. The `claims.json`
`secret-hygiene` entry is one of the entries that holds up.

**Nothing sensitive is reachable over HTTP.** `/.env.deploy` and
`/artifacts/snapshot/graph-snapshot.json` both return 200 at exactly 785 bytes,
which is the SPA shell, because `vercel.json` rewrites every non-API path to
`index.html`. No file leak.

**CSRF is real.** `POST /api/ask` without the header returns
`403 {"error":"csrf"}`. `csrfOk` in [src/auth/http.ts](../src/auth/http.ts)
requires both halves present and equal and treats a missing cookie as a failure
rather than a skip, with a comment saying why. Cookies are `SameSite=Lax; Secure`,
the session cookie is `HttpOnly` and the CSRF cookie deliberately is not.

**No unauthenticated workspace read.** `GET /api/workspace/summary` with no
session returns an empty workspace, not a 500 and not the demo corpus.

**Password handling is correct.** argon2id at the OWASP low-memory profile
(19456 KiB, 2 iterations, 1 lane) via `hash-wasm`, a 12-character minimum, a
256-character maximum to cap the hashing cost, and a real decoy hash computed
from `randomBytes(32)` so sign-in timing does not confirm whether an address has
an account. Sign in is 6 per minute per address, sign up 3.

**Session tokens are stored only as SHA-256.** `endSession` overwrites with an
expiry in the past rather than deleting, and expiry is re-checked on read rather
than trusted from storage.

**Accounts are kept out of the context graph** in their own collection, with
derived ids, so no question a user asks can address an account record.
`/api/health` reports the hostname and a latency and never the token or a URL.

### Findings

**HIGH. Production ships no Content-Security-Policy and no frame protection.**

```
curl -D - https://lacuna-five.vercel.app/
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Access-Control-Allow-Origin: *
  (no Content-Security-Policy, no X-Frame-Options, no X-Content-Type-Options)
```

The API responses do send `X-Content-Type-Options: nosniff` and
`Cache-Control: no-store, private`. The HTML sends neither, and the whole
signed-in application is framable. This matters more than it usually would
because `docs/THREAT_MODEL.md`, `docs/EVIDENCE_INDEX.md` and `docs/CLAIMS.json`
all publish the strict policy (`default-src 'none'; script-src 'none'; ...
frame-ancestors 'none'`) as a shipped control. That policy belongs to the local
HTML server in `src/view/`, which is not what is deployed. The React cutover
dropped it and the claim was never retired.

**MEDIUM. `/api/ask` carries no workspace scope.** Any caller holding a CSRF
cookie reads the single corpus regardless of session or workspace. This is
disclosed in `docs/ARCHITECTURE_FINAL.md` ("The kernel itself has no workspace
parameter. One store holds one corpus, and every question reads all of it") and
it is a defensible design for a one-corpus demo. It does mean
`JUDGE_SCORECARD.md`'s "A cross-tenant read. Tested, and the workspace scope is
server-side" is true of `/api/workspace/*` and not of the answer endpoint.

**MEDIUM. Workspace name is the authorization check.** `#viewFor` in
`src/api/router.ts` grants the demo corpus to any account whose workspace string
equals `DEMO_WORKSPACE`, which is the literal `'acme / backend'`. A signed-up
user who types that at onboarding gets the corpus in their own workspace. The
corpus is synthetic and already public at `/demo`, so the impact is close to
zero, but the pattern is authorization by guessable string.

**MEDIUM. An unhandled rejection path in the deployed function.**
[api/index.ts](../api/index.ts) ends:

```js
void api.handle(request, response, path).then((outcome) => {
  if (!outcome.handled) snapshot(request, response);
});
```

There is no `.catch`. A rejection from `CloudAccounts`, from
`RetrievalDecodeError` in `cloud-source.ts`, or from any transport failure that
escapes leaves the response unwritten and produces an unhandled rejection. I did
not manage to trigger it; `askEnvelope` appears to absorb the retrieval errors it
knows about. The gap is structural rather than observed.

**LOW.** `src/auth/accounts.ts` line 90 says accounts hold "a scrypt hash". The
code uses argon2id. A reader auditing the crypto reads the comment.

**LOW.** Account records are written to HydraDB Cloud with the user's email
address as the document `title` (`#write(this.#accountId(account.email),
account.email, account)`). The hash is fine to store; the address in a title
field of a managed third-party service is more exposure than the record needs.

**LOW.** `csrfOk` compares tokens with `===` rather than a constant-time compare.
Not practically exploitable cross-origin, but it is the one place in this file
where the discipline lapses.

**LOW.** `Access-Control-Allow-Origin: *` on the static HTML. Vercel's default;
the API sets no CORS header, which is the half that matters.

### Weaknesses

| Severity | Finding | Smallest fix |
|---|---|---|
| HIGH | No CSP and no frame protection on production, while three documents publish a strict CSP as shipped. | Two moves, and they are different sizes. Add `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` to a `headers` block in `vercel.json`: near-zero risk. A full CSP for a React SPA needs `style-src 'unsafe-inline'` because the components use inline style objects, and needs testing: do that after the deadline. Retire the CSP claims in `CLAIMS.json` and `EVIDENCE_INDEX.md` today regardless. |
| MEDIUM | `/api/ask` has no workspace scope, contradicting the scorecard. | Change one sentence in `JUDGE_SCORECARD.md`. Do not add scoping today; it would break `/judge`. |
| MEDIUM | Workspace name doubles as the demo authorization check. | Leave it. Note it in `ARCHITECTURE_FINAL.md` beside the paragraph that already describes the mechanism. |
| MEDIUM | No `.catch` on the promise in `api/index.ts`. | One `.catch` writing a 500. Three lines, but it needs a redeploy, which is the actual risk today. |
| LOW | Comment says scrypt, code is argon2id. | One word. |
| LOW | Email stored as the document title in the cloud accounts collection. | Use the account id as the title. Needs a migration for existing records, so not today. |

**Confidence: high** on everything executed. **Not checked:** the signed-in
session flow end to end, because creating an account is outside what I am
permitted to do; I read `smoke-auth.ts` and the router instead. Also not checked:
whether HydraDB Cloud indexes the `accounts` collection for vector retrieval,
which would be the one way an account record could surface through `/query`.
Nothing in this product calls `/query`, so it is not reachable from here.

---

## What would most improve the outcome

Every CRITICAL and HIGH finding across the six judges, deduplicated and ranked by
judge-visible value against the risk of breaking something today. The dividing
line is simple: prose and JSON in this repository need no redeploy and cannot
break the product. Everything else can.

### FIX NOW

**1. The README says the deployment is a recorded snapshot. It is live.**
CRITICAL, Judge 5. This is the first section a judge reads and it gives away the
strongest fact in the submission. Production returns `source_state: "live"`,
`/judge` says "answered live", and `ARCHITECTURE_FINAL.md` already documents that
the snapshot code is dead on the deployment. *Reason: it is six sentences of
prose, it cannot break anything, and it currently costs marks on three of the
five judging dimensions at once.*

**2. `JUDGE_SCORECARD.md` contains two statements that are false as of today.**
HIGH, Judges 3 and 5. It says "No load or soak evidence: nothing here has been
run under concurrency" while `artifacts/soak/soak.json` exists and
`RELEASE_GATE.md` gates it, and it says "the model router has one real provider
configured" while `/api/demo/model` returns `NOT CONFIGURED`. It also says
"Twenty-six routes", which no artifact supports. *Reason: this is the document
whose entire purpose is to be the honest self-assessment, three lines are wrong,
and it is a text edit.*

**3. Three `VERIFIED` entries in `docs/CLAIMS.json` are disproved in one command
each.** HIGH, Judge 5. `no-client-script` against a 406KB bundle,
`no-runtime-dependencies` against a `package.json` with two, and `deployment`
describing routes that no longer exist. `docs/EVIDENCE_INDEX.md` carries the
matching CSP row. *Reason: the ledger is the project's honesty mechanism. A judge
who spot-checks one entry and finds it false discounts the other twenty-two.
Editing JSON carries no risk; `tests/unit/claims.test.ts` only checks that
evidence paths exist.*

**4. `RELEASE_GATE.md`'s "no invented operational strings" row is disproved by
the bundle it names.** HIGH, Judges 3 and 5. The row says the drawn workspace and
the trace id "are gone, checked against the served production bundle". Grepping
the served bundle:

```
@lacuna/sdk        1
acme               6
context.pack       4
handoff            4
trace_id           4
context_pack_id    3
POST /v1/query     1
```

*Reason: it is the one row in that table a judge can disprove with a single curl,
and it sits in a file whose opening line is "A gate with no evidence line is not
a gate". Rescope the sentence to the terminal block, which is what it was
actually about.*

**5. `docs/EVIDENCE_INDEX.md` says the contract suite skips when no node answers.
The code says it fails.** HIGH, Judge 5. All four files under `tests/contract/`
carry the opposite in their headers, and so do `RELEASE_GATE.md` and `STATE.md`.
*Reason: one word, and it is bolded as the reason a number is trustworthy.*

**6. Retire the CSP claims and add the two cheap headers.** HIGH, Judge 6.
Production sends no Content-Security-Policy and no frame protection, while
`THREAT_MODEL.md`, `EVIDENCE_INDEX.md` and `CLAIMS.json` publish a strict policy
as shipped. *Reason: the document half is free and should happen regardless. The
header half splits: `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`
in a `vercel.json` headers block are near-zero risk and worth the redeploy; a
full CSP needs `style-src 'unsafe-inline'` for the inline style objects and
should wait.*

**7. Promote the SDK panel's disclaimer, and change one connector status.**
HIGH, Judge 3. The SDK screen shows `@lacuna/sdk`, `POST /v1/query`,
`context.pack` and `handoff`, none of which exist, under a 9px caption. The
Connectors screen marks "Custom ingestion" AVAILABLE when nothing ingests.
*Reason: two string edits in `web/src/landing/copy.ts` and
`web/src/design/connectors.ts`. It needs a rebuild, which is the risk, but these
are the two most disprovable statements on the product surface and the fix does
not touch behaviour.*

**8. Fix the wrong hash and the command that does not exist.** MEDIUM promoted
because it is free. `docs/END_TO_END_MATRIX.md` cites `npm run status`, which is
not a script, and says `v7-freeze` is `942de9e` when it is `e1293e8` with sixteen
commits since, several of which added gates the table lists. *Reason: prose only,
and a judge who runs one documented command and gets "missing script" stops
trusting the rest of the table.*

### DEFER

**9. `foxglove` returns `out_of_scope`, which is false about the corpus.**
HIGH, Judge 1. Case-folding the entity lookup is genuinely small, but it touches
`entityByName`, the cloud record id derivation (`entityRecordId` hashes the name,
so a case-folded lookup would need the ingest to agree), and would invalidate the
159 records already in HydraDB Cloud. *Reason: the smallest correct fix requires
a re-ingest against the production store on submission day. The failure mode is a
false negative, which is the safe direction, and no gate depends on it.*

**10. No claim extraction from text.** HIGH, Judge 1. The temporal structure comes
from `ClaimAnnotation.supersedes`, not from reading a sentence. *Reason: this is a
research component, not a fix. What should happen today is one sentence in the
README next to the thesis paragraph saying so, which folds into item 1.*

**11. The production store performs no server-side graph operation.** HIGH,
Judge 2. Every deployed answer is keyed blob fetches plus a client-side loop, and
`/context/relations` is implemented and never called. *Reason: printing the
service's own relations on `/demo/hydra` is the smallest improvement and it means
calling an endpoint that has never been exercised against the live account, on
the day the live account has to work. The Cypher path already carries this claim
for anyone who reads the repository.*

**12. Five of the six V7.1 harness components do not exist.** CRITICAL against
the directive, Judge 4. No RunState, no runtime capability manifest, no budget
accounting, no progressive hydration, no context trajectory. *Reason: this is a
rebuild. Starting any of it against a frozen release buys a half-built subsystem
in exchange for the gates that currently pass. The existing architecture is good
on its own terms and should be defended on those terms.*

**13. Every unknown path silently becomes the landing page.** MEDIUM, Judge 3.
No 404 anywhere, and it makes the route audit count `/docs` as a passing route.
*Reason: a new component plus a rebuild, and the audit artifact would need
retaking. Low judge-visible value relative to that.*

**14. No `.catch` on the promise in `api/index.ts`.** MEDIUM, Judge 6. *Reason:
three lines, but it needs a redeploy of the answer path, it has never been
observed to fire, and a redeploy on submission day is a larger risk than the bug.*

---

### The single thing to fix first

Item 1. The README tells judges the deployment is a recording. It is not, and
`/judge` proves it in about two seconds. Fixing the paragraph costs nothing and
recovers the strongest claim in the submission.
