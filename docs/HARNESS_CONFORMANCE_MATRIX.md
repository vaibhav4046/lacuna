# Harness conformance matrix

The V7.1 directive this project works to specifies an execution harness with ten
capabilities. This is what is actually in the repository, measured against each
one.

The method was to grep the whole tree for the vocabulary each capability would
have to use, then read every file that matched. Where nothing matched, that is
recorded as nothing rather than described as though it were partly there.

Three statuses, and they are used strictly:

- **IMPLEMENTED** means the capability exists and is exercised.
- **PARTIAL** means some named component of it exists and the rest does not.
  Every PARTIAL row says which half.
- **ABSENT** means no code implements it. Not "not finished", not "planned".

Several rows have a real, working thing nearby that is easy to mistake for the
specified capability. Those are credited precisely for what they are, in a
**What exists nearby** note, and they do not raise the status.

---

## Summary

| # | Capability | Status |
| --- | --- | --- |
| H1 | Canonical serializable RunState | **ABSENT** |
| H2 | Run modes NORMAL / READ_ONLY / DRY_RUN / EVAL / JUDGE | **ABSENT** |
| H3 | Capability Manifest resolved before tool or model execution | **ABSENT** |
| H4 | Hard termination across nine budgets | **PARTIAL** |
| H5 | Progressive hydration L0 / L1 / L2 | **ABSENT** |
| H6 | Context trajectory recording | **PARTIAL** |
| H7 | Tool output externalisation with hash, type, size, preview | **ABSENT** |
| H8 | Checkpoints and idempotency keys | **PARTIAL** |
| H9 | Cancellation | **PARTIAL** |
| H10 | Selective writeback | **ABSENT** |

Six ABSENT, four PARTIAL, none IMPLEMENTED. No row in this table is fully met.

Two rows carry sub-items that are individually implemented, and both are inside
H4: graph depth, and wall time. They are credited there.

---

## H1 · Canonical serializable RunState

**Specified.** One serializable object carrying run id, workspace, actor, parent
run, origin client, run mode, query class, context pack id and version, stage,
budgets, trace and timestamps.

**Status: ABSENT.**

There is no type, interface, class or variable named `RunState`, `run_state` or
anything equivalent anywhere in `src`, `scripts`, `api`, `web/src` or `tests`.
There is no object that carries even three of the listed fields together.

Field by field, against the whole tree:

| Field | What exists |
| --- | --- |
| run id | Nothing. See the trace id note below. |
| workspace | `Account.workspace`, a string on the account record in `src/auth/store.ts:31`. It gates one branch in `src/api/router.ts:210` and is not passed to the kernel. The kernel has no workspace parameter: one store holds one corpus and every question reads all of it. |
| actor | Nothing. No field, no parameter, no header read. |
| parent run | Nothing. |
| origin client | Nothing carried in state. `HydraSource.kind` says which *store* answered, not which client asked, and its own comment says it is never used to change a result. |
| run mode | Nothing. See H2. |
| query class | Nothing. `parseVia` and `parseBlast` in `src/retrieval/question.ts` read the sentence to decide the shape of the read, and discard that decision immediately rather than recording it. |
| context pack id | A formatted string, not an identifier of anything. See C4 in [docs/CONTRACT_OWNERSHIP.md](CONTRACT_OWNERSHIP.md). |
| context pack version | Nothing. |
| stage | Nothing in the runtime. `web/src/app/state.tsx` has a `stage` prop that is a loading label, and `src/voice/states.ts` has a `PipelineStage` describing a four-stage speech pipeline of which two stages are not installed. Neither is execution state. |
| budgets | Constants, not carried state. See H4. |
| trace | Real, and it is two things. See H6. |
| timestamps | `Answer.ms` is a measured wall clock duration (`src/retrieval/fetch.ts:103`). Claim records carry `validFrom` and `txTime`, which are corpus facts, not run timestamps. |

**What exists nearby, and what it actually is.** `AnswerEnvelope.trace_id`
(`src/api/workspace.ts:46`) looks like a run id and is not one. It is produced
by `traceId()` at line 52:

```ts
function traceId(): string {
  return '0x' + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
}
```

A fresh random value per HTTP request, never stored, never returned to anything
that could look it up, and never correlated with the query traces in the same
response. Two screens print it (`web/src/app/routes/Ask.tsx:176`,
`web/src/pages/Judge.tsx:146`). It is a display token.

---

## H2 · Run modes NORMAL / READ_ONLY / DRY_RUN / EVAL / JUDGE

**Specified.** A run declares its mode, and the harness enforces what that mode
permits.

**Status: ABSENT.**

No mode enum exists. No branch anywhere reads a mode. The five names appear in
the tree only as unrelated things:

- `READ_ONLY` in `src/mcp/tools.ts:235` is a `Tool['annotations']` constant
  attached to all four MCP tools. It is an advertisement to the client, not a
  mode the server enters.
- `judge` in `src/bench/score.ts:37` is a scoring function that compares an
  expected answer to an actual outcome.
- `/judge` is a public React route (`web/src/pages/Judge.tsx`), the page a
  stranger lands on.
- Nothing matches `DRY_RUN`, `dryRun`, `EVAL` as a mode, or `NORMAL`.

**What exists nearby.** The whole read path is read-only by construction rather
than by mode. `HydraSource` (`src/hydra/source.ts:31`) declares four methods,
all reads, and there is no write method on the interface. The MCP server
exposes no tool that writes, and
`tests/unit/mcp-server.test.ts`, `it('name nothing that could be mistaken for a
write')`, asserts it. Writes go through a separate path entirely, `src/ingest/`,
driven by `npm run ingest`.

That is a stronger guarantee than a READ_ONLY mode for the surfaces it covers,
and it is not a run mode. Nothing can select between behaviours, because there
is only one behaviour.

`LACUNA_PROFILE` (`src/hydra/open.ts:42`) selects between two stores, `cloud`
and `node`. It is a deployment setting, not a run mode.

---

## H3 · Capability Manifest resolved before tool or model execution

**Specified.** A manifest of what this run may do, resolved and checked before
any tool or model call.

**Status: ABSENT.**

Nothing named `CapabilityManifest` or `capability_manifest` exists. No
resolution step runs before a tool call. `callTool` in `src/mcp/server.ts:302`
goes straight from name lookup to argument check to execution.

**What exists nearby, twice, and neither is this.**

`src/model/capability.ts` defines `CapabilityState` and `DataState`, five values
each. That is a documentation vocabulary describing how far a feature got and
where its displayed numbers came from. It is read by the interface pages and by
`docs/CLAIMS.json`. It grants nothing and gates nothing.

`src/cli/manifest.ts` is named for a manifest and reads one, but the manifest is
`package.json`. It exports `readVersion` and `readRequiredNode`, so that
`lacuna --version` and `lacuna doctor` report the version and the supported Node
range without a second copy of either in a source file. Nothing to do with
capabilities.

`checkArguments` in `src/mcp/server.ts:189` does run before execution, and it is
worth crediting for what it is: it reads the allowed argument names off the same
`TOOLS` array the list handler returns and rejects any field the schema does not
name. Its comment says why it was added, that a contract a client is told about
and the server does not apply is worse than no contract. That is schema
enforcement on one call's arguments. It is not a capability manifest, and it
says nothing about what the run may do.

---

## H4 · Hard termination

**Specified.** Bounded tool calls, model calls, retrieval calls, graph depth,
graph nodes, handoff depth, retries, wall time, and context pack size.

**Status: PARTIAL.** Four of the nine bounds exist as real constants that are
enforced. Five do not exist.

| Bound | Status | Evidence |
| --- | --- | --- |
| tool calls | **ABSENT** | Nothing counts tool calls. Each MCP call is independent and there is no run to bound. |
| model calls | **ABSENT** | No model is called on the answer path. `src/provider/registry.ts` probes provider endpoints to report which models are reachable; `MAX_MODELS_PER_PROVIDER = 6` at line 69 caps how many are listed on a screen. That is a display cap. |
| retrieval calls | **PARTIAL** | Not bounded by a count. Bounded in shape: `ask` in `src/retrieval/fetch.ts` issues one subject read, at most one bridge read, and one evidence read per cited claim, and `citedClaims` bounds that list. `HydraLimits.maxPages = 64` (`src/hydra/config.ts:31`) caps cursor follows in one logical read so paging cannot loop forever. |
| graph depth | **IMPLEMENTED** | `MAX_BLAST_DEPTH = 6` (`src/retrieval/blast.ts:27`) bounds both the pure walk at line 104 and the fetching walk at line 230. `MAX_SUPERSESSION_DEPTH = 4` (`src/retrieval/queries.ts:165`) bounds the Cypher variable-length match. Tested: `tests/unit/retrieval-blast.test.ts`, `it('stops at the depth cap rather than walking an unbounded chain')`. |
| graph nodes | **PARTIAL** | Not a node budget. `HydraLimits.maxRowsPerQuery = 5_000` and `maxResponseBytes = 8_388_608` (`src/hydra/config.ts`) cap what one read may return. The walk itself has a `seen` set, so an entity is visited once, but nothing caps how many entities a walk may reach within the depth bound. |
| handoff depth | **ABSENT** | There are no handoffs. The word appears only in landing copy (`web/src/landing/copy.ts:30`, `web/src/landing/Hydra.tsx:24`), describing a capability that is not built. |
| retries | **ABSENT** | Nothing retries. Grepping `src/hydra/client.ts` and `src/hydra/cloud.ts` for `retry`, `attempt` or `backoff` returns one comment about a documentation string and nothing else. A failed read fails. |
| wall time | **IMPLEMENTED** | Four ceilings, each with a written reason. `DEFAULT_QUERY_TIMEOUT_MS = 30_000` (`src/retrieval/fetch.ts:29`, matching the node's own admission control). `TOOL_TIMEOUT_MS = 10_000` (`src/mcp/server.ts:55`), applied by `withDeadline` at line 137 over the whole call rather than per query. `ASK_TIMEOUT_MS = 10_000` (`src/api/router.ts:43`). `HydraLimits.defaultTimeoutMs = 5_000` plus `abortSlackMs = 2_000` (`src/hydra/config.ts:26`), the second being how long the client waits past the server's own deadline before aborting itself. |
| context pack size | **ABSENT** as specified, because there is no context pack. **The equivalent exists**: `MAX_EVIDENCE_ITEMS = 50` (`src/contract/result.ts:41`) caps the quotations in any result, with `evidenceTotal` carrying the real count so the truncation is visible rather than silent. The MCP tool descriptions read the same constant, so the advertised cap cannot drift from the applied one. |

Input bounds also exist and are worth naming, since they are the ones that stop
a paste becoming a payload: `MAX_TERM_CHARS = 200` with a control-character
refusal (`src/retrieval/question.ts`), `MAX_BODY_BYTES = 4_096` on the auth
routes (`src/auth/http.ts:19`), `MAX_BODY_BYTES = 1_048_576` on MCP over HTTP
(`src/mcp/http.ts:39`), `MAX_URL_CHARS = 1_024` (`src/server/server.ts:59`),
`maxQueryChars = 8_192` and `maxParameterBytes = 1_048_576`
(`src/hydra/config.ts`). Rate limiting exists per source address in
`src/server/ratelimit.ts` and is applied to sign-in and sign-up.

**The honest reading of this row.** What is bounded is one read, one question,
one HTTP request. Nothing is bounded at the level of a run, because there is no
run.

---

## H5 · Progressive hydration L0 / L1 / L2

**Specified.** Three levels of context hydration, resolved as the run needs
more.

**Status: ABSENT.**

No hydration levels exist. The tree contains no `L0`, no hydration stage, and
nothing that fetches a summary before fetching detail. The only matches for
`L1` and `L2` are a bezier path parameter in `web/src/canvas/engine.ts:149` and
`L2 normalised` in a comment about vector norms in `src/bench/embed.ts`.

**What exists nearby.** `ask` in `src/retrieval/fetch.ts` fetches in stages, and
the shape of that file is described in its header as the performance argument:
an out-of-scope question costs one read because the first lookup already answers
it; a direct question costs the subject read plus one per cited claim; a two-hop
question costs two subject reads plus citations. The blast walk fetches a whole
frontier at a time (`src/retrieval/blast.ts:231`), so a level costs one round
trip rather than one per node.

That is demand-driven fetching with a good cost profile. It has no levels, no
level names, and no decision anywhere that says "L1 is enough". Each stage is
fetched because the previous stage said which id to read next.

---

## H6 · Context trajectory recording

**Specified.** A record of scope, retrieval requests, graph hops, temporal
decisions, conflicts, evidence selected and evidence rejected, with timing.

**Status: PARTIAL.** Two real trace mechanisms exist and both are genuinely
good. They cover roughly half the specified list, and the halves they miss are
named below.

**What exists, precisely.**

`QueryTrace` (`src/retrieval/types.ts:129`) is one HydraDB round trip, kept
rather than counted. It carries the Cypher as issued (or `null` for the cloud,
which is a REST API and where a field named `cypher` holding an HTTP request
would be, in the comment's words, the kind of small lie this product exists to
refuse), the request string, the bound parameters, the row count, the
milliseconds, and the object store epoch the read observed. `QueryRecorder` in
`src/retrieval/fetch.ts:39` collects them in issue order, and the header states
the reason: the cost of an answer stops being a number the product asserts and
becomes something a reader can run themselves. Traces come back with the values
rather than accumulating inside the source, so two questions asked at once
cannot mix up whose round trips were whose.

`Resolution.trace` (`src/retrieval/types.ts:102`) is the resolver's own ordered
sentences, written as it decides: what it looked for, what it found, how many
claims carried the predicate, how many were superseded, and what stood at the
end. `src/retrieval/resolve.ts` pushes to it at every branch. It is the
resolver's account, not a reconstruction, and `explainResult` in
`src/mcp/result.ts:135` hands it to MCP callers verbatim.

`BlastRadius.trace` (`src/retrieval/blast.ts:53`) does the same for the walk,
one line per depth, plus a count of the superseded or withdrawn dependency
claims the walk refused to follow.

**Against the specified list:**

| Element | Covered |
| --- | --- |
| scope | **No.** Scope is a client concern (`web/src/api/scope.tsx`) and never reaches the kernel, so it cannot be recorded there. |
| retrieval requests | **Yes.** `QueryTrace`, one per round trip, with parameters and row counts. |
| graph hops | **Yes.** `Resolution.hop` carries the relation, the claim followed and the entity landed on. `BlastStep` carries the claim id for every hop of every affected path, so each hop can be cited back to a quotation. |
| temporal decisions | **Yes.** `Resolution.trace` states them in sentences, and `Resolution.considered` carries every claim on the pair, current and superseded alike, deliberately not filtered to the winner. |
| conflicts | **Yes.** A contradiction is an outcome with a reason code and both live claims cited. |
| evidence selected | **Yes.** `citedClaims` (`src/retrieval/resolve.ts:243`) decides which claims deserve a citation, in the order they should be shown, and `Answer.evidence` holds what came back. |
| evidence **rejected** | **No.** Nothing records what was not cited or why. `citedClaims` returns a list of ids; the claims it declined to include leave no record. The one exception is the blast walk, which counts (`ignored`) but does not identify the dependency claims it refused. |
| timing | **Partial.** Per round trip (`QueryTrace.ms`) and end to end (`Answer.ms`, `round`ed to one decimal, which the comment calls the resolution a wall clock reading deserves). No per-stage timing, because there are no stages. |

**The honest reading.** This is a real query trace and a real decision trace, and
they are better than most things that get called a trajectory. They are not a
trajectory, because there is no run for them to belong to: each one is scoped to
a single `Answer` object and is discarded when the response is written. Nothing
persists them, correlates two of them, or attaches them to an id anything can
look up later.

---

## H7 · Tool output externalisation with hash, type, size, preview

**Specified.** Tool output written out of band, referenced by a record carrying
hash, type, size and preview.

**Status: ABSENT.**

Nothing externalises tool output. `toolResult` in `src/mcp/server.ts:278`
returns both forms of the payload inline: a pretty-printed JSON text block and
the same object as `structuredContent`. There is no hash on a result, no size
field, no content type, no preview, and no store to externalise to.

**What exists nearby.** SHA-256 is used in five places, none of them for this:
`deriveId` for node ids (`src/model/ids.ts:71`), `text_hash` on an evidence span
row at ingest (`src/ingest/plan.ts:262`), record ids for the cloud
(`src/hydra/cloud-graph.ts:47`), account ids (`src/auth/accounts.ts:112`), and
session token hashing (`src/auth/store.ts:58`).

The one thing in this family that does exist is truncation with a visible
count: `MAX_EVIDENCE_ITEMS` with `evidenceTotal`, and
`MAX_EVIDENCE_CHARS = 4_096` in `src/report/provenance.ts:92`, which appends a
literal `[truncated at 4096 characters]` marker rather than cutting silently.
That is a cap with an honest label, not externalisation.

---

## H8 · Checkpoints and idempotency keys

**Specified.** Resumable checkpoints, and idempotency keys so a repeated
operation is applied once.

**Status: PARTIAL.** Idempotency exists for writes and is real. Checkpoints do
not exist at all.

**Checkpoints: ABSENT.** No checkpoint type, no resume path, no persisted
partial run. An interrupted `npm run ingest` restarts from the beginning. That
is survivable only because of the next half.

**Idempotency: IMPLEMENTED, for ingestion, and not by a key.** The mechanism is
derivation rather than a supplied key. `src/model/ids.ts` derives every node id
from the first 52 bits of `SHA-256("<label>\x1f<canonical-key>")`, so
re-ingesting the same transcript produces the same ids and the MERGE is a no-op.
The comment at `src/ingest/run.ts:418` calls MERGE on the same edge the
idempotence this whole design rests on. `IdRegistry.intern` throws
`IdCollisionError` rather than overwriting when two canonical keys truncate to
one id, because this is a memory system whose pitch is not lying.

It is checked two ways. `tests/contract/ingest.contract.test.ts` exercises it
against a live node, and `npm run census` reads every vertex back by label and
diffs against `buildPlan`, exiting non-zero on any disagreement, which is what
proves a second ingest did not double anything.

**No idempotency key exists on the read path**, and the read path does not need
one, because nothing on it writes.

---

## H9 · Cancellation

**Status: PARTIAL.** Transport-level abort exists throughout. Run-level
cancellation does not exist, because there is no run.

**What exists.** `AbortSignal` is threaded through the HydraDB clients and the
ingest path: `HydraClient` composes a timeout signal with a caller signal using
`AbortSignal.any` (`src/hydra/client.ts:233`), `HydraCloud` builds a controller
per request (`src/hydra/cloud.ts:116`), `src/ingest/run.ts` accepts an optional
signal and passes it down three levels (lines 68, 201, 238, 277), and
`src/provider/openai.ts:62` uses one for the provider probe. On the browser
side, `web/src/api/client.ts` and `web/src/api/session.tsx` abort in-flight
reads on unmount, and `web/src/pages/Judge.tsx:181` does the same.

**What does not exist.** There is no cancel operation a caller can invoke on
work already accepted. The MCP deadline is explicit about this, and the comment
at `src/mcp/server.ts:129` states the limitation and the reasoning:

> The underlying read is not cancelled, because the client's own per-query
> timeout already bounds each round trip and there is nothing to roll back on a
> read.

`withDeadline` races the work against a timer and rejects. The read continues.
What it guarantees is that the caller gets an answer and that a slow graph shows
up as a timed-out tool rather than a hung connection. For a read-only system
that is a defensible design. It is not cancellation, and the code does not
claim it is.

---

## H10 · Selective writeback

**Specified.** Selecting which parts of a run's output are written back to the
context store.

**Status: ABSENT.**

Nothing matches `writeback` or `write_back` anywhere in the tree. More
fundamentally, there is no path from a query to a write. The four `HydraSource`
methods are all reads. The MCP tools are all read-only and annotated as such.
The demo API is read-only and tested to be
(`tests/unit/demo-api.test.ts`, `it('is read only: a write to it is not a
route')`). The only writes in the product are account and session records
(`src/auth/`) and the ingest path (`src/ingest/`), which loads the whole corpus
from a generated plan and is driven by an operator running `npm run ingest`.

An answer produces no candidate facts, so there is nothing to select from and
nowhere to put it.

---

## What fraction of the specified harness exists

Of the ten specified capabilities, none is fully implemented, four are partial,
and six are absent.

Counting a row as a half because it is partial would flatter this. Weighed by
the sub-items actually present, H4 has four of nine bounds, H6 has five of eight
recorded elements, H8 has one of its two halves, and H9 has transport abort but
no cancel operation. That is under two capabilities' worth across the ten.
Roughly a fifth of the specified harness exists, and no part of it was built as
a harness.

Everything that exists is at the level of a single question. The bounds are
per read and per call. The traces are per `Answer` and are discarded with the
response. The idempotency is a property of how ingest derives ids. The abort
signals belong to HTTP requests.

Nothing exists at the level of a run, because there is no run object. That
absence is what makes H1, H2, H3, H5, H7 and H10 absent rather than partial:
they are not missing features on an existing harness, they are the harness.
This system is a synchronous read path with one decision point, and it is built
and documented as one.

Two things in this list are real, well built, and worth naming without being
counted as a harness:

- **A genuine query trace.** Every HydraDB round trip is kept with its
  statement, its bound parameters, its row count, its latency and the store
  epoch it observed. That is what lets a reader re-run the cost of an answer
  instead of trusting a number.
- **A genuine bounded graph walk.** The blast radius follows exactly the edges
  `liveDependencyEdges` admits, stops at `MAX_BLAST_DEPTH`, visits each entity
  once, cites the claim id behind every hop, and counts the superseded
  dependency edges it refused. Both the fetching walk and the pure walk go
  through the same filter, so they cannot disagree.

Neither of those adds up to the specified harness. The remaining capabilities
are not implemented, and no partial scaffolding for them exists in the tree.

---

## Related

- [docs/ARCHITECTURE_FINAL.md](ARCHITECTURE_FINAL.md), the shape as built.
- [docs/ARCHITECTURE_INVARIANTS.md](ARCHITECTURE_INVARIANTS.md), what holds it
  in place.
- [docs/CONTRACT_OWNERSHIP.md](CONTRACT_OWNERSHIP.md), who owns each contract.
- [RELEASE_GATE.md](../RELEASE_GATE.md), including its own "Not green, and
  named" list, which records other things considered and not started.
