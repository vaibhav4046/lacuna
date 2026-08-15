# Decisions

Choices made during the build, with the reason and the date. Architectural
decisions large enough to have consequences live in [docs/adr/](docs/adr/) and
are linked from here rather than duplicated.

The point of this file is that a judge, or a future reader, can tell the
difference between a decision and an accident.

---

## 2026-08-12

### D-001: Build in a fresh repository at `D:\project\lacuna`

`D:\` is the owner's whole drive: not a git repository, and holding roughly 38
unrelated projects including `hydrasentry`, which is pre-hackathon work on a
HydraDB-adjacent idea. Building anywhere inside that tree would make "no
participant-authored commits before August 12, 2026" impossible to demonstrate
cleanly, and proximity to a prior HydraDB project is exactly the thing a judge
would look at twice.

Fresh directory, `git init` on 2026-08-12, nothing copied in.

### D-002: Enter Track 03 only

See [ADR 0001](docs/adr/0001-track-and-thesis.md).

### D-003: HydraDB stays a separate service, spoken to over HTTP

HydraDB is AGPL-3.0. Lacuna is Apache-2.0. Keeping HydraDB as a separate process
addressed over its HTTP query API means no HydraDB source is copied, vendored or
linked into this codebase, so the licenses do not have to be reconciled at all.

This is also what the upstream README recommends for applications, and it is the
arrangement the HTTP and Bolt APIs exist to serve.

No HydraDB code appears in this repository. What appears is a client that speaks
its documented wire protocol.

### D-004: Run HydraDB from source inside WSL Ubuntu 24.04

The machine had no Docker, no podman, no WSL distribution and no Rust
toolchain, so neither official path worked as found.

Options were: install Docker Desktop (admin install, large, and Docker Desktop
licensing is a question nobody needs), or install a WSL distribution and follow
the upstream source-build path.

Chose WSL Ubuntu 24.04 because upstream `AGENTS.md` documents the source path
step by step, states it was executed end to end on "a clean Ubuntu 24.04
container", and explicitly needs "no Docker, no S3, no Kubernetes". It is also
reversible in one command.

Verified present after install: `libcypher-parser 0.6.2` and
`libgraphblas.so.7.4.0` from Ubuntu's own repositories, which are exactly the
two native dependencies upstream calls out.

### D-005: Apache-2.0 for Lacuna's own code

The rules require "an appropriate open-source license". Apache-2.0 over MIT for
the explicit patent grant, which matters more for something presented as
infrastructure. Canonical text fetched from `apache.org`, not typed from memory.

### D-006: One vendor-neutral conventions file, named `AGENTS.md`

Repository conventions live in a single `AGENTS.md`: what the layout is, what
must never be claimed without evidence, where the license boundary sits, and
which Cypher constructs are off the table.

Vendor-specific variants of the same file were rejected. One file that any
contributor or tool reads is better than several that drift apart, and `AGENTS.md`
is the filename HydraDB upstream already uses for exactly this purpose.

### D-007: Deterministic ids derived by hash, not assigned by a counter

HydraDB node ids are non-negative integers. A counter would need a coordination
point and would make ingestion non-idempotent. Truncated SHA-256 of a canonical
key gives stable ids across runs, so re-ingesting a transcript is a no-op
instead of a duplicate.

Collision risk is handled explicitly rather than assumed away. See
[ADR 0002](docs/adr/0002-temporal-evidence-graph.md).

### D-008: Track the rules as a matrix, not as prose

[docs/RULES_MATRIX.md](docs/RULES_MATRIX.md) maps every published requirement to
where it is satisfied and its current status. Disqualification is the single
largest risk in a hackathon and it is entirely avoidable by checking a list.

### D-009: Keep the name "Lacuna", having checked what it collides with

A lacuna is a gap, and specifically a missing portion of a manuscript. The whole
differentiator here is knowing what is missing, so the name is doing real work
rather than sounding nice.

It is also not remotely unique. Checked on 2026-08-12:

| Where | What is there |
|---|---|
| PyPI `lacuna` | `witlox/lacuna`, 3 releases, latest 2026-01-20. "Privacy-aware query classification and routing for RAG systems" |
| crates.io `lacuna` | v0.0.0 placeholder, 16 downloads, regulatory gap analysis CLI |
| npm `lacuna` | v0.0.0 placeholder, no description |
| GitHub | Lacuna Expanse (a game, several repos), Lacuna Software (a company), Lacuna Fund (an ML dataset funding initiative), `LACUNA-Chain` (offensive security tooling, 183 stars), a teaching annotation tool |

The PyPI one is the uncomfortable one, because it is RAG-adjacent. It is also
three releases old with a different purpose: query routing for privacy, not a
temporal evidence graph.

Kept anyway. A hackathon submission is not a trademark filing, none of the
judging criteria concern the name, and none of these collisions could make a
judge think this project is derived from them. What would be indefensible is
claiming the name is unoccupied, so it is written down here instead. If any part
of this is ever published as a package it gets a namespaced or suffixed name,
not a bare `lacuna`.

Recorded because a check that leaves no trace is indistinguishable from a check
that never happened.

### D-010: HydraDB data lives in a persistent directory, not `/tmp`

The upstream local recipe puts everything under `/tmp/sgk-local`, and says
plainly that those paths are disposable. This machine confirmed it: the step 5
virtualenv and env file were gone fifteen minutes later.

Fine for a smoke test, useless for a demo. The node Lacuna talks to now runs
from `/var/lib/lacuna/hydradb`, driven by
[scripts/hydra-node.sh](scripts/hydra-node.sh).

Nothing in the HydraDB repository is modified. The script is upstream's step 7
block with three environment variables pointed somewhere that lasts, and one
line removed:

| Variable | Upstream | Here |
|---|---|---|
| `LOCAL_PATH` | `/tmp/sgk-local/store` | `/var/lib/lacuna/hydradb/store` |
| `GRAPH_AUTH_TOKEN_FILE` | `/tmp/sgk-local/auth-token` | `/var/lib/lacuna/hydradb/auth-token` |
| `GRAPH_DATA_CACHE_DIR` | `/tmp/sgk-local/cache` | `/var/lib/lacuna/hydradb/cache` |

The removed line is upstream's `rm -rf "$ROOT"`, because resetting the store is
the opposite of what this script is for. There is deliberately no build step in
it either: upstream's step 6 builds `target/debug/graph-node` and knows how, and
inventing a second `cargo` invocation is exactly what `AGENTS.md` forbids. The
script refuses to start if the binary is absent.

The existing store was **moved, not rebuilt**. 116 files copied out of
`/tmp/sgk-local/store`, then compared file by file: 116 files and 87986 bytes on
both sides, and every sha256 identical. The 162 probe rounds are the corpus the
client tests assert against, so re-running them to recreate the graph would have
thrown away the evidence trail for no reason.

The long-lived node also gets a real token. Upstream ships a documented
placeholder for a throwaway loopback node, which is correct for a smoke test and
wrong for something that stays up for a week, so the script mints 48 hex
characters from `/dev/urandom` on first start and writes it `0600` outside the
repository. It is never printed. The old placeholder now answers `401
unauthenticated` against this node, which is how that is known rather than
assumed.

Verified by stopping the node and starting it again, then reading the graph
back: the three `:Claim` vertices from rounds one to three and the
`:PROBE_EDGE` from round six both come back, and `npm run test:contract` passes
13 of 13 against the restarted node. Surviving a process restart is the claim,
so a process restart is the test.

Two operational facts fell out of doing this, both of which cost time and are
written down so they cost it once:

- **`kill -0` answers yes to a zombie.** A node started under `nohup` from a
  shell that is still alive leaves a `Z+` process behind when it exits. Observed
  here: pid 423 reported alive by `kill -0`, state `Z+`, with nothing listening
  on 17687, 18443 or 19091. The script therefore checks `ps -o stat=` as well.
- **Graceful shutdown takes about thirty seconds.** SIGTERM is followed by
  garbage collector shutdown, db close and checkpoint deletion before `graph
  node stopped` reaches the log. A 30 second stop timeout was tight enough to
  fire on a shutdown that was working correctly. It is 120 seconds now.

### D-011: Ingest writes vertices in batches and edges one at a time

Not a preference. The engine rejects every other arrangement, and this was
established by running 119 queries against it rather than by reading further.
Evidence: [artifacts/cypher-probe/](artifacts/cypher-probe/README.md).

`UNWIND $rows AS row MERGE (c {id: row.id}) SET c:Label, ...` is the only vertex
upsert that parses, and it is also the only use of `UNWIND` that parses. Batching
edges through it fails with `UNWIND vertex upsert requires MERGE by id followed
by SET`. Edges go one per request, as
`MERGE (a {id: X})-[:TYPE]->(b {id: Y})`, which is verified working and verified
idempotent.

So ingestion is two phases: all vertices for a transcript in a handful of
batched upserts, then one round trip per edge. For the demo corpus that is a
few hundred round trips over loopback, which is a throughput cost and not a
correctness one. If it becomes the bottleneck the fallback is Bolt on `:17687`,
already verified working against the same node, where round trips are cheaper.

The alternative was to reshape the data model so it needed fewer edges. Rejected
outright: the edges are the product. A memory layer that stores fewer
relationships to make its own ingest faster has optimised away the thing it
exists to do.

### D-012: The client mints its own `query_id` on every request

HydraDB's HTTP request body has a `query_id` field. Sending nothing is legal and
the server assigns one, which is what the first probes did.

Paging does not work that way. `next_cursor` is scoped to the `query_id` and the
query text together, so page two has to arrive carrying both. Verified in round
five: cursor without `query_id` is refused, cursor with the server's own
`query_id` returns the remainder, and a live cursor replayed under a different
`query_id` with identical query text is refused as well.

So Lacuna generates a `query_id` per logical query and sends it on the first
request rather than reading one back and echoing it. Same round trips, and page
two stops depending on having parsed page one's response correctly.

It also gives every request a client-side correlation id for free, which is worth
having in a system whose whole output is "here is why I answered that".

Round six checked the length, because every executed example until then used a
short id such as `"H2"` and this scheme mints 43 characters. `P05` sent
`lacuna-3f2b9c1e-5d47-4a80-9e6c-1b2a7d4e8f01`, got it echoed back unchanged, and
`P06` followed the cursor it issued.

`next_cursor` is treated as opaque. It presents as a small per-node counter, and
in round five six unrelated paged queries were handed 11 through 16 in sequence.
Round six put a number on how little it means: the same query over the same three
vertices was handed 25 on one execution and 32 on the next. Nothing is inferred
from the value and nothing is constructed from it.

Recorded because round four concluded from a single failed request that HydraDB
could not page at all, and that was wrong. The full correction is in
[artifacts/cypher-probe/](artifacts/cypher-probe/README.md).

### D-013: Reads that follow an ingest carry the write's bookmark

Every HydraDB write returns a `bookmark`, a scoped string encoding namespace,
graph, cell and epoch. Passing it on a later read is the engine's own answer to
causal consistency: it said so when a client-supplied `read_epoch` was rejected
with `read_epoch is not a storage snapshot selector; use bookmark for causal
reads`.

Lacuna threads it through: ingest returns the bookmark to the caller, and the
retrieval that follows sends it. The failure this prevents is specific and would
be humiliating in a demo, which is abstaining with `NO_RELEVANT_MEMORY` on a
transcript that was accepted two seconds earlier.

The honest caveat, which is repeated wherever this is claimed: on a single node
answering `consistency: "strong"` the read would probably have seen the write
anyway. Probe `B02` shows the bookmark is accepted and the row comes back. It
does not prove the bookmark caused it, and no test on this deployment can. It is
carried because it is free, correct, and the mechanism the engine names.

### D-014: Every id crosses the wire as a parameter, never as query text

Rounds two and three only ever wrote edges with integer literals, so the only
proven way to create one was to build the statement around the ids. Every
implementation of that is a string being assembled from values, which is the
shape of the oldest injection bug there is, and defending it would have meant an
integer guard in front of the query builder plus a note in
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) explaining why that guard is
sufficient.

Round six asked whether that was necessary. `MERGE (a {id: $src})-[:TYPE]->(b
{id: $dst})` is accepted with both endpoints as parameters, and `P04` reads the
edge back through a separate statement to show it landed rather than being
parsed and dropped.

So `src/hydra/queries.ts` builds no query text from data. Labels and edge types
are still interpolated, because HydraDB does not parameterise them, and those go
through `identifiers.ts`, which accepts an allowlisted character set and refuses
everything else. Ids, properties and values are parameters.

The rule is worth stating as a rule rather than a habit: if a value came from
outside the process it is a parameter, and if it cannot be a parameter it is
validated against an allowlist before it is interpolated.

### D-015: The contract tests fail when HydraDB is absent, and never skip

`tests/contract/hydra.contract.test.ts` runs against a live node with nothing
mocked. If no node answers, `beforeAll` throws and the suite goes red.

The usual convention is the opposite, which is to detect the missing dependency
and skip. That convention is wrong for this project specifically. The one claim
Lacuna has to survive is that HydraDB is doing the work, and a suite that turns
itself off when the database is missing is a suite that reports green while
proving nothing about the database. A judge running `npm run test:contract`
without a node should see a failure that says the node is missing, not thirteen
passes.

The unit tests are separate and run anywhere: `HydraClient` takes its `fetch` as
a constructor option, so they hand it a function that returns canned `Response`
objects and assert on the exact bytes the client tried to send. `npm test` runs
those. `npm run test:contract` is the one that needs the engine.

Both halves of that were executed rather than asserted, by stopping the node and
running each suite against nothing:

```
> vitest run tests/unit            (node stopped, no listener on 18443)
 Test Files  6 passed (6)
      Tests  84 passed (84)
UNIT_NO_DB_EXIT=0

> vitest run tests/contract        (node stopped, no listener on 18443)
Caused by: HydraTransportError: request failed before a response arrived
(http://127.0.0.1:18443/v1/graphs/default/query)
Caused by: Error: connect ECONNREFUSED 127.0.0.1:18443
 Test Files  1 failed (1)
      Tests  13 skipped (13)
CONTRACT_NO_DB_EXIT=1
```

One wrinkle in that output is worth naming before it misleads someone, including
a future reader of this file. Vitest prints `Tests 13 skipped (13)`, because
`beforeAll` threw and the individual cases never got the chance to run. The
suite did not skip. `Test Files 1 failed (1)`, the exit code is 1, and the
reason printed is `ECONNREFUSED 127.0.0.1:18443`. The line to read is the file
line and the exit code, not the case count.

Consequence, which was not free: the contract suite writes to the graph, so it
has to be idempotent against a persistent store. Every id it writes is seeded in
`beforeAll` and every count asserts against that fixed set, so the second run
sees the same graph as the first. Verified by running it twice in a row rather
than by reasoning about it.

---

## 2026-08-13

### D-016: The demo corpus is generated by code, and its abstention cases are structural

The evaluation needs a history that is longer than one model context, that
carries claims corrected over time, and that has a known right answer for every
question including the questions whose right answer is "I do not know, and here
is why". Writing that by hand does not work. The transcript, the gold answers and
the reason each abstention is correct would drift apart on the first edit, and a
later failure could not be attributed to the retriever rather than to the
fixture.

So `src/corpus/` generates it from a seed. `mulberry32`, no `Math.random`, no
`Date.now`, a fixed epoch. Same seed, same bytes, on any machine. The gold
questions are emitted by the same pass that plans the claims, so a gold answer
cannot point at a claim that was never placed, and a placed claim cannot go
unaccounted for.

The part that matters more than determinism is that the five abstention reasons
argued for in [ADR 0001](docs/adr/0001-track-and-thesis.md), and named in
`src/model/abstention.ts`, are encoded in the shape of the data rather than in
the wording of the question:

- `never_stated`: the subject is discussed repeatedly and the predicate is used
  repeatedly, and never together. Filler text names subjects and never states a
  value for one, so a lexical or vector retriever gets a page of high scoring
  text about exactly the right subject and finds no answer in it.
- `retracted`: the last claim on the pair is a retraction with an empty object
  and a `SUPERSEDES` edge back to what it withdraws. The withdrawn value is still
  sitting in the transcript, and is still the best lexical match in it.
- `contradicted`: two live claims on the same subject and predicate, different
  values, neither superseding the other. Nothing in the text says which wins,
  because nothing in the conversation did.
- `unconnected`: the entity is named in the transcript and the hop that would
  reach the answer does not exist.
- `out_of_scope`: the name appears nowhere, which `validateCorpus` enforces by
  refusing to return a corpus in which it does.

`unconnected` and `multi_hop` are deliberately the same question with a different
subject substituted in. A test strips the subject out of both and compares the
remainder, so the pair cannot drift apart later. A system that answers one and
abstains on the other is reading the graph. A system that answers both is
guessing, and a system that abstains on both is useless.

The size was measured, not chosen. The first real generation, at 48 sessions:

```
corpus stats: {"sessions":48,"messages":3496,"claims":118,"characters":312289,"estimatedTokens":78072}
```

Roughly 78k estimated tokens is not enough to stand behind "this does not fit in
one context" against a 128k window, so the session count went to 72 and the run
was repeated rather than the claim being softened:

```
corpus stats: {"sessions":72,"messages":5268,"claims":118,"characters":469578,"estimatedTokens":117395}
```

The claim count did not move, because claims are planned per thread and not per
session. What grew is the distance between them, which is what the retrieval
problem is actually made of.

`validateCorpus` runs on every generation and not only under test. Every evidence
span is found by searching the finished message text, so a test can slice the
text and get the quote back; message keys are unique; no out of scope name
appears anywhere; every claim has a supporting span. Generation throws rather
than returning a corpus that would quietly turn a structural result into a
lexical one.

Executed on 2026-08-13:

```
> tsc --noEmit
TYPECHECK_EXIT=0

> vitest run
 Test Files  9 passed (9)
      Tests  135 passed (135)
 Duration  4.74s
TESTALL_EXIT=0
```

That is 84 adapter unit cases, 27 corpus cases, 11 id cases and the 13 contract
cases against the live node.

One consequence is worth naming rather than leaving for a judge to find. The
corpus ships its claims as annotations, so Lacuna is not extracting claims from
free text. That is deliberate and it is now written into
[PLAN.md](PLAN.md#what-is-deliberately-not-being-built). The thesis is about what
a memory does with claims once it has them, which is where the abstention
question lives. Bolting a fallible extractor onto the front would make every
number in the benchmark a measurement of the extractor instead.

### D-017: The entity roster comes from the claims, not from the name pools

`src/corpus/vocab.ts` holds four pools of names: projects, services, vendors,
people. The obvious way to build `Entity` nodes is to walk those pools. It is
also the way that destroys the distinction D-016 exists to create.

A name from a pool that no claim ever touched would still get a node. Then
`out_of_scope` and `never_stated` become the same shape in the graph: a node with
no claim on the predicate being asked about. The two are supposed to be different
kinds of not-knowing, and a system that cannot tell them apart in the data cannot
be asked to tell them apart in an answer.

So `collectEntities` walks the finished claims instead and keeps only the names
they touch, subject and object alike. `validateCorpus` then enforces both
directions on every generation: every claim subject and object entity must be in
the roster, and no `OUT_OF_SCOPE_SUBJECTS` name may be. What ingestion writes is
66 `Entity` vertices out of a larger pool, and the absence of the rest is load
bearing. In the graph, `out_of_scope` is the absence of a node. `never_stated` is
a node with nothing attached on that predicate.

### D-018: The pre-write read-back streams pages instead of accumulating them

`HydraClient.query` follows cursors and accumulates rows, capped at 5,000 by
`maxRowsPerQuery`. The corpus has 5,268 messages. So the collision check, which
has to read back every node under every label it is about to write, cannot use
it: the largest label alone exceeds the cap.

Raising the cap is the wrong fix. It would mean holding every row of every label
in memory in order to test each one against a set and then discard it. The check
does not need the rows, it needs a verdict. So `verifyLabel` drives `queryPage`
directly, one page at a time, under a single query id minted once for the whole
label. A cursor is scoped to the query id it was issued under, so minting a fresh
one on the second request would be reading something else entirely, which is a
bug the unit test now pins down explicitly. Nothing accumulates, so the corpus
can grow without this turning into a knob someone has to remember to turn.

`MAX_VERIFY_PAGES` is 1,024. A server that hands back a cursor forever is
otherwise an infinite loop, and an ingest that fails loudly is better than one
that hangs.

### D-019: Concurrent edge writes are pinned to one bookmark, and one serial write closes the run

Edges go one statement per request (D-011) and the demo corpus has 5,705 of them.
At the ~12ms steady-state round trip measured in D-010 that is over a minute of
the demo spent watching a progress counter, so the edge phase runs a bounded pool
with 8 in flight.

That collides with D-013. The client remembers the bookmark from its last write
and sends it on the next one, which is exactly right when writes are serial and
exactly wrong when they are not: under concurrency that field holds whichever
write returned most recently, which is not necessarily the latest. Every edge
MERGE needs to observe both of its endpoints, which the vertex phase wrote. So
each edge write sends an explicit bookmark, the one the vertex phase ended on. A
pinned selector does not care who won the race.

The cost of pinning is that the run ends without a bookmark known to be after
everything, which is what verification reads need. One more write fixes it:
re-MERGE the last edge, serially, after the pool has drained. It is the only
request in flight, so what it returns is unambiguously after every write above.
It changes no state, because a repeated MERGE on the same edge is the idempotence
this whole design already rests on. One round trip, and the alternative was
parsing an opaque bookmark string to compare two of them.

### D-020: `DETACH` is required only when a vertex has edges, and deleting nothing succeeds

The contract test wipes its fixture ids before and after it runs, against a graph
that may or may not already hold them. Whether that cleanup needs a guard depends
on two things, and both were measured rather than assumed.

An earlier probe recorded that plain `DELETE` is rejected. That was measured
against an id that was not present, and it is wrong as a general statement:

```
plain DELETE      -> 200 {"query_id":"...","columns":[],"rows":[],...}
DETACH, absent id -> 200 {"query_id":"...","columns":[],"rows":[],...}
```

Neither form matched anything, so neither form had anything to object to. The
real distinction only appears against a vertex that exists and has a
relationship:

```
create nodes      -> 200
create edge       -> 200
plain DELETE      -> 400 {"error":{"code":"invalid_request","message":"Graph query is not supported yet: DELETE vertex 9200000200001 requires DETACH because it has 1 incident edge(s)"}}
still there       -> 200 columns ["id","key"], the vertex still returned
DETACH DELETE     -> 200
left behind       -> 200 rows []
```

So the rejection is about incident edges, not about the keyword. Two consequences
for the cleanup. It must use `DETACH`, because the fixture ids do carry edges and
the vertex is left in place when the engine refuses. And it can run
unconditionally, with no existence check in front of it, because deleting an id
that is not there is a 200 no-op rather than an error.

### D-021: The two ingest test suites are split by what each can prove

`tests/contract/ingest.contract.test.ts` builds a small fixture corpus, puts it
through the real `buildPlan`, ingests it twice against the running node, and
diffs the counts. Idempotence is a claim about what the engine does with a
repeated MERGE, so a fake responder could only ever prove that the fake was
written to say yes twice. It has to be live.

`tests/unit/ingest-run.test.ts` goes the other way: a hand-written `IngestPlan`
literal against an injected fetch. A fourteen-node fixture never pages, never
returns a node whose stored key disagrees with the planned one, never returns a
node carrying no key at all, never returns an id that is not a number, never
hands back a cursor forever, and never fails on the third of three edge writes.
Those are the paths that decide whether ingestion refuses or corrupts, and a fake
responder is the only way to stand them up on demand.

Bookmark pinning is the clearest case for the split. It is invisible from outside
against a real node, because an unpinned run succeeds there too. Only a fake that
hands out a fresh bookmark on every response makes the difference show up, as
`bm-4` repeated across all four writes instead of `bm-5`, `bm-6`, `bm-7`.

Executed on 2026-08-13, against the live node:

```
> tsc --noEmit
TYPECHECK_EXIT=0

> vitest run
 Test Files  12 passed (12)
      Tests  185 passed (185)
   Duration  6.60s
TESTALL_EXIT=0
```

That is the 135 from the corpus and adapter work above, plus 22 plan cases, 17
run cases, 4 for the two new query builders, and 7 contract cases that ingest
into the running node.

### D-022: `tsx` runs the scripts, and the imports stay extensionless

Node v24.12.0 strips types on its own, so a `.ts` file runs without a build step
until it imports something:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\project\lacuna\src\corpus\index' imported from D:\project\lacuna\scripts\census.ts
```

Type stripping is not resolution. ESM wants the specifier to name a real file, and
`../src/corpus/index` names a `.ts` file that will not exist at runtime.

Three ways out. Write `../src/corpus/index.ts` in every import, which is legal
under `allowImportingTsExtensions` but spreads a runtime detail through every
source file and makes the codebase read oddly to anyone who has not hit this.
Add a build step, and then run compiled output, which puts a stale-`dist`
failure mode between every edit and every run for scripts that exist to be run
ad hoc. Or use a runner that resolves the way the type checker already does.

`tsx` is the runner, as a devDependency. It ships nothing into the product: the
web app will be bundled by its own toolchain and the scripts are development
tools. `tsconfig.json` keeps `moduleResolution: bundler`, the imports stay
extensionless, and `tsc --noEmit` remains the thing that decides whether the code
is correct.

### D-023: Ingestion merges, so emptying and counting are separate scripts

`MERGE` adds and never reconciles. That is the right behaviour for ingestion, and
it means ingestion can never be the way back to a known state: a node that should
not be there survives every re-ingest.

That is not hypothetical. The first census of the live graph found 5,653 vertices
where the plan accounts for 5,642, and named the extras:

```
nodes in the graph that this plan did not write:
  Session        5000000000001      null
  Message        4000000000001      null
  Message        4000000000002      null
  EvidenceSpan   3000000000001      null
  EvidenceSpan   3000000000002      null
  EvidenceSpan   3000000000003      null
  Claim          2000000000001      null
  Claim          2000000000002      null
  Claim          2000000000003      null
  Entity         1000000000001      null
  Entity         1000000000002      null
```

Round-numbered ids and no key at all: leftovers from the hand-run shape probes
that produced ADR 0002 and the `restart-1` probe in STATE.md. Lacuna derives every
id from a canonical key and stores that key on the node, so nothing it writes can
look like this. Eleven nodes with nothing to cite would have reached retrieval as
records, and no amount of re-ingesting would have removed them.

So `scripts/reset.ts` deletes every vertex carrying one of the five labels, with
`DETACH` so incident edges go with them (D-020), refuses to run without `--yes`,
and reads every label back afterwards rather than trusting the deletes. It is
safe to run because the corpus is deterministic from its seed: everything it
removes regenerates exactly.

And `scripts/census.ts` counts what is in the graph and diffs it against the
plan, then reads every stored key back, because counts alone cannot tell a
missing node from a stray one. Two errors that cancel still add up. It exits
non-zero on any disagreement, so it is a gate rather than something to read.

The census is the stronger of the two reports the ingest produces. `runIngest`
says what it wrote. The census says what survived.

### D-024: 30 seconds is both the timeout the scripts use and the highest the server allows

Measured against the live node on 2026-08-13:

```
over the cap: HydraDB returned 429: client_query_runtime_ms rejected by admission control: actual 120000 exceeds limit 30000
5s on CONTAINS: HydraDB returned 408: client_query_runtime exceeded query timeout after 5000 ms; limit is 5000 ms
30s on CONTAINS: ok [[5268]]
```

Both ends bind. Admission control refuses a request asking for more than 30,000
ms before it runs, so a generous timeout is not available. And the client's own
5,000 ms default is not enough to count the 5,268 `CONTAINS` edges, so the
default is not enough either.

30,000 it is, in `runIngest`, `scripts/reset.ts` and `scripts/census.ts`. This is
a property of the server, not of the query: nothing in the ingest wants a longer
timeout, and if a future query does, it will have to be paged rather than waited
on.

### D-025: The demo corpus has 5,705 edges, and two earlier records said 5,693

The correct figure is 5,705, checked twice: the dry run prints it, and summing
`plan.counts.edges` per type gives the same number. The earlier 5,693 omitted the
12 `CONTRADICTS` edges.

It appeared in three places. Two were editable and are now right: D-019 above,
and a comment in `src/ingest/run.ts`. The third is the message of commit
`e7df5f2`, written as `40b6da5` before the identity rewrite in D-050, which says
"5,642 vertices in 15 batches and 5,693 edges" and stays wrong, because rewriting
a commit message to correct it would be worse than the error. The identity
rewrite that later changed every hash in this repository did not touch a single
message, so the wrong number is still sitting there. This record is the
correction.

The code was never wrong. `plan.counts` is computed from the edges the plan
actually holds, and the contract test diffs live counts against it. Only the prose
had a stale number in it, which is exactly the kind of thing a project claiming to
be about not lying should write down rather than quietly fix.

### D-026: A question is a structure, and the parser may read nothing but the text

`RetrievalQuestion` is `{ subject, predicate, via }`. `parseVia` pulls the
relation out of a hop question and returns `null` for a direct one, and that is
the entire natural language surface. No synonym table, no embedding, no model.

The reason is not simplicity. It is that the evaluation has to mean something.
Two of the sixty gold questions are these:

```
Who is our contact for the vendor behind replay-queue?
Who is our contact for the vendor behind Meridian?
```

One is answerable and one is not, and nothing in either sentence says which. If
the parser could see the answer, or could be tuned until it saw the answer, the
`multi_hop` and `unconnected` scores would be measuring the parser. Both parse
to the same predicate and the same relation, a unit test asserts that equality
directly, and a contract test asserts it again against the live node before
checking that the graph separates them. The distinction has nowhere to come from
except the edges.

The cost is that the parser is narrow. It handles the shapes the corpus uses and
would need work for anything else. That is the honest trade and it is stated here
rather than hidden behind a demo that only ever types the sentences it likes.

### D-027: The subject is resolved by name through the graph, never derived client side

Ingest assigns vertex ids from a hash, so the client could compute an id for a
name without asking. It does not. `entityByName` runs a parameterised match and
zero rows is the answer `out_of_scope`.

Deriving the id locally would make a question about a name the graph has never
held indistinguishable from a question about a name whose ingest failed. Both
would produce an id, one query, and an empty result that looks like an absence of
claims rather than an absence of the entity. Asking costs one query, which is the
cheapest question in the system, and it is the query that separates "never
mentioned" from "mentioned, nothing said".

It also keeps the id derivation on one side of the wire. If ingest changes how it
hashes, retrieval does not silently start missing.

### D-028: One function chooses the hop target, and disagreeing with it is a crash

`selectHopTarget` is called twice per hop question: once by the fetcher, to know
which entity to load, and once by the resolver, to know which entity it is
answering about. Two call sites, one function, no second implementation.

If the resolver's choice does not match the bridge the view carries, it throws
`RetrievalConsistencyError` rather than answering. That is not defensive noise on
an impossible branch. It is the one failure that would produce a confident answer
citing the wrong node, which is the exact failure this product exists to refuse,
and a crash is the correct response to it.

Four outcomes, all four tested: `none` becomes `never_stated`, `retracted` stays
`retracted`, `ambiguous` becomes `contradicted` before any hop is attempted, and
`one` hops.

### D-029: The decision procedure is ordered, and the order is the product

`resolve` runs a fixed sequence and returns at the first thing that settles it:

1. No entity by that name. `out_of_scope`.
2. Hop requested: no relation stated, withdrawn, or stated two ways. `never_stated`, `retracted`, `contradicted`.
3. No claims on the predicate. `unconnected` if a hop landed, `never_stated` if not.
4. Claims exist: all superseded, or the survivor is a withdrawal. `retracted`.
5. Two current claims with different values. `contradicted`.
6. One value stands. Answer it.

The order matters more than any individual rule. Checking for contradiction
before checking for supersession would report disagreement between a value and
the value that replaced it, which is a revision and not a disagreement at all.
Checking supersession before the hop would answer about the wrong entity. Every
step also appends a line to `trace`, so the screens do not reconstruct the
reasoning afterwards. They print the path that was actually taken.

### D-030: An abstention after a hop still cites the hop

`never_stated` and `out_of_scope` cite nothing, because nothing was found.
`unconnected` cites exactly one claim: the step it took to get there.

This looked wrong enough that a contract test was written asserting all three
absences quote nothing, and it failed against the live node:

```
AssertionError: expected [ { claimId: 4025327511019719, …(9) } ] to deeply equal []
+     "quote": "Meridian is supplied by Millbrace.",
+     "sessionTitle": "Payments operations check-in",
```

The test was wrong and the behaviour is right. "Meridian is supplied by
Millbrace, and nothing states a contact for Millbrace" is a different and far
more useful finding than "no". It tells the reader where to go and ask. The
absence is at the far end of the hop, and the near end is a real fact with a real
quotation behind it, so it gets quoted. Suppressing it would have made the
system less honest, not more.

The test is now split in two and both halves pass.

### D-031: Abstention is the positive class, and the evaluation runs one question at a time

`scripts/evaluate.ts` scores precision, recall and F1 with abstention as the
positive class, not answering. A system that answers everything is the failure
mode being measured, so the metric has to make that failure visible rather than
average it away. The report also prints the four failure shapes separately, and
`false_answer`, an answer given where nothing supports one, is the one that
matters. It is reported on its own line whatever the headline says.

The sixty questions run sequentially. Running them concurrently would finish
sooner and would turn every latency number into a measurement of contention
instead of the query path. Percentiles are nearest-rank with no interpolation, so
every printed latency is an observation that actually happened rather than an
average of two that did.

### D-032: The evaluation prints what it does not prove, in the artifact itself

The full sweep scores 60 of 60, run twice. The first run was p50 197.6ms, p95
318.9ms, max 379.5ms. The second is the one in
[artifacts/eval/report.txt](artifacts/eval/report.txt) and is quoted here so the
record and the artifact cannot drift apart:

```
Questions        60
Exact correct    60  (100.0%)
Unsupported answers  0  (0.0% of all questions)
  p50   145.3ms
  p95   284.9ms
  max   319.7ms
  total 276 queries
```

A bare 100% would read as a product claim it cannot support. The corpus is
generated, and the graph is built from the same annotations the questions are
scored against, so a perfect score says the structure survives the round trip:
revision, retraction and disagreement are still distinguishable after ingestion,
and the resolver reads them the way the corpus wrote them. It is a correctness
check on the pipeline. It is not evidence that the approach beats anything.

That paragraph is printed into `artifacts/eval/report.txt` by the script, not
just written here, so the number cannot travel without its caveat attached. The
comparison against recency, lexical, vector and hybrid retrieval is a separate
harness on the same corpus. That is where an advantage has to be earned.

### D-033: The vector baseline runs a local ONNX encoder, not an API

`Xenova/all-MiniLM-L6-v2` through `@huggingface/transformers`, 384 dimensions,
Apache-2.0, downloaded once and cached under `.cache/`. No key, no account, no
network call at query time.

A hosted embedding endpoint would produce a stronger baseline, and it would also
make the benchmark unreproducible for anyone without that key and unrunnable
offline. A judge who cannot re-run the comparison has to take the numbers on
faith, which is worth less than a slightly weaker baseline that anybody can
reproduce with `npm run bench`. The model name and dimension count are printed
in the report header so the choice travels with the result.

### D-034: The baselines get a perfect extractor, and never the edges

Every flat baseline reads the corpus annotations on the messages it retrieved
rather than parsing the prose. It sees each claim's subject, predicate, value,
and whether the sentence announced itself as a correction or a withdrawal. It
never misreads, never hallucinates a value, never misses a statement in front of
it.

This is deliberately generous, and it is generous in the direction that makes
the result harder to overclaim. If a baseline loses, it lost because the
evidence never reached the reader, not because a language model fumbled the
extraction. That keeps the comparison about retrieval, which is the thing under
test.

What it never sees is which claim supersedes which. That link is an edge,
building it is the entire question, and handing it over would be handing over
the answer. The line is: everything readable in a message, yes; anything that
only exists once messages are related to each other, no.

### D-035: Only the strongest retriever gets the second round

`hybrid+2hop` exists because a question like "who is our contact for the vendor
behind X" is answerable from a flat index in two rounds: retrieve to find the
vendor, then retrieve again on the vendor's name. Leaving that out would let
Lacuna win every multi hop case against a baseline nobody would ship.

It is given to hybrid alone rather than to all five retrievers. Running it on
recency would add rows that lose for reasons already visible in the single round
table, and the point of the steelman is to build the best opponent, not the
largest number of opponents. It is charged for both rounds of retrieved context,
because a second round genuinely costs that.

### D-036: Rankings are not memoized

Caching one deep ranking per query and slicing it for each cut off would cut the
run time noticeably. It would also turn every latency after the first into a
measurement of a map lookup.

The scan over 5,268 messages is cheap enough to pay on every call. A latency
column that needs no footnote about which rows were cached is worth more than
the minute it saves. The `memoized` helper was written, then deleted, and the
reason is recorded in `src/bench/index.ts` so it does not get reintroduced as an
obvious optimization.

### D-037: Query embeddings are keyed by text, never by question id

The two round system builds its follow up by spreading the original question,
which preserves the question's id while changing what is being asked. A vector
retriever keyed by id would therefore have ranked round two by round one's
meaning, and produced a plausible ranking that answers the wrong question. It
would not have thrown, and the scores would have looked fine.

Keying the embedding map by `question.text` makes that class of bug impossible,
and a missing key throws rather than falling back. `followUpText()` is exported
so the driver that pre-embeds every possible query and the system that issues it
share one definition of the string, instead of two spellings that drift apart
the first time either is edited.

Pre-embedding every query the run could ask, before the clock starts, is what
keeps encoder startup out of the timed path. That is 126 texts: 60 questions
plus one follow up per entity.

### D-038: One scorer, used by both the evaluation and the benchmark

`src/bench/score.ts` defines what counts as correct, and both `scripts/evaluate.ts`
and `scripts/benchmark.ts` call it. The evaluation originally carried its own
copy of `judge`, the verdict names, and the precision and recall block, which was
fine until the benchmark needed the same rules and the two could drift.

A headline number and a comparison judged by two slightly different rules are two
numbers nobody should put in the same sentence. Collapsing them means a change to
what "correct" means moves both, or neither.

### D-039: The baseline was handed the rule it was losing on

The first full sweep put Lacuna at 60/60 and the best baseline at 54/60. The
per kind table showed the entire six question gap sitting in one thread kind,
`unconnected`, where the baseline scored 0 of 6, and tied everywhere else.

Reading the failures rather than the headline: the baseline was not answering
wrongly. It abstained on all six, with reason `never_stated` where the corpus
wanted `unconnected`. Both refuse to answer. Only the stated reason differed.

Lacuna's rule for that distinction is that it abstains after following a hop.
The two round baseline also follows a hop, and passes the entity it landed on to
its reader, so it had exactly the same signal and simply was not allowed to say
so: the reader's absence branch only chose between `never_stated` and
`out_of_scope`. That is not a capability gap. It is a rule withheld from the
opponent, and scoring it would have measured the reader rather than the
retrieval.

The reader now returns `unconnected` when it abstains after a hop, matching
Lacuna's test. On the re-run the baseline scores 60/60. Correctness is a tie.

Both runs are real and both are on disk. What survives is narrower and more
defensible than what was there before:

- Correctness ties at 60/60, with zero unsupported answers on both sides.
- Lacuna does it on 15 estimated context tokens per question against 636, 42
  times fewer, and 7,779 times less than the whole transcript.
- Lacuna is slower: 188ms against 3.7ms at p50, roughly 51 times, over HTTP
  against a real node while every baseline runs in process against arrays
  already in memory. That column is not a race and the report says so.
- The baseline that ties is four hand built parts: BM25 and local embeddings
  fused by reciprocal rank, a second retrieval round routed through a named
  relation, a perfect annotation level extractor, and a conflict aware reader.
  Remove the conflict aware reader and it drops to 54/60 with six false
  answers. Remove the second round, 46/60. Remove both, 40/60 with six false
  answers.

The three rules that reader applies are the three distinctions the graph holds
structurally: a correction supersedes, a withdrawal removes, and a hop onto a
silent entity is a gap rather than an absence. The claim this benchmark
supports is that writing them by hand costs four components and 42 times the
context, not that flat retrieval cannot reach the same answers.

That block is printed into `artifacts/bench/report.txt` by the script, ablation
numbers computed from the run rather than typed in, for the same reason D-032
prints its caveat: the finding should not be able to travel without the part
that qualifies it.

### D-040: The latency column is reported as an order of magnitude

The benchmark was run twice against the same graph with the same code, once
before and once after a one byte source fix that could not change behaviour.
Every correctness column came out identical across the two runs, on all 51
rows, down to the mean context tokens. The latency column did not. Lacuna's
p50 read 188.1ms on the first run and 243.4ms on the second, moving the ratio
against the tying baseline from 51.0 to 68.2 times slower.

That spread is larger than most of the differences anyone would want to read
out of the column. It comes from the part of the path that is not deterministic:
Lacuna pays an HTTP round trip per hop to a node sharing a machine with the
harness, while every baseline runs in process against arrays already in memory.

So the column stays, because a query path that talks to a database over a
network should not be able to hide that it does, but nothing is claimed from
it beyond the order of magnitude. `STATE.md` quotes both runs rather than the
flattering one. A judge who reruns the harness will get a third number, and
should: that is what the column is like.

### D-041: The product surface is server rendered HTML from a plain Node server

The four screens need a stack. This repository has no framework, no bundler,
and zero runtime dependencies: it is TypeScript run through `tsx` and a client
that speaks HTTP to HydraDB. Adding React and Vite would make the user
interface the largest dependency in a project whose argument is that you can
read the whole thing.

So the surface is `node:http` serving server rendered HTML. No bundler, no
framework, nothing shipped to the browser but markup and one stylesheet. Three
reasons beyond taste.

The token stays on the server. HydraDB is reached with a bearer token, and the
surest way to keep a secret out of a client bundle is to not have a client
bundle. Nothing the browser receives has been near the token, and that is
checkable by reading the response rather than by trusting a build step.

Reproduction stays one command. `npm run serve` starts it against the same
`.env.local` the CLI already uses, so a judge who cloned the repository and ran
the ingest is one command from the screens, with no install step in between
that could fail differently on their machine.

And there is no client state worth a framework. Every screen renders one
`Answer`, which is already an immutable value produced by one function. The
question form is a GET form and the panels are anchors, so the build ships no
script at all: no bundle, no tag, no inline handler, and a
`script-src 'none'` header saying so. "Works with JavaScript disabled" is the
weaker claim; this one never asks.

The cost is real and worth naming: no component model, no hot reload, and HTML
assembled from template strings, which makes every interpolation an escaping
decision. That last one is handled by having exactly one way to put text into a
page and no other.

### D-042: The answer carries the queries it ran, not a count of them

`ask` reported `timing.queries`, a number. A number is an assertion. The
HydraDB Proof screen exists so the retrieval claim can be checked rather than
believed, and a screen rendering "6 queries" asks to be believed in exactly the
way the rest of this project refuses to.

So `Answer` carries the round trips themselves: the statement, its parameters,
the rows it returned, its wall clock, and the read epoch when the node reports
one. That is everything a reader needs to run the same statement against their
own node and get the same rows back.

The count went away rather than sitting alongside the list. Two fields that
have to agree are a way for them to disagree, and the failure mode here is a
proof screen labelled with one number above a list of a different length.
`answer.queries.length` is the count now, and it cannot be wrong.

Nothing in a parameter is a secret. They are entity names, predicates and
integer ids, the same values the question already contains. The token never
enters a query; it is a header on the transport, which is the reason any of
this is publishable.

### D-043: An answer is the subgraph it was drawn from, not just the conclusion

`Answer` used to hold a resolution, its evidence and its cost. The screens
needed more than that. The Timeline panel prints every claim on the subject
including the superseded ones, and the Graph panel prints the hop a two step
question took, and neither of those is in a resolution: they are in the
`SubgraphView` the resolver read and then discarded.

The obvious fix was a second fetch from the page. That would have made the
screens capable of disagreeing with the answer above them, since two reads of a
live graph are two different moments, and a timeline that contradicts the
conclusion printed over it is worse than no timeline.

So `Answer extends SubgraphView`. One value carries the record and the
conclusion drawn from it, the resolver stays the pure function it was, and every
panel on the page is rendered from the same read. A screen cannot show a claim
the decision did not see, because there is only one set of claims.

### D-044: The server answers GET and HEAD, binds loopback, and logs no question

Three properties of the HTTP surface, decided together because they are the same
decision: this thing reads a graph and should be unable to do anything else.

Only GET and HEAD are routed. Everything else gets a 405 with an `Allow` header.
Asking a question does not write, so nothing here needs a method that implies it
might, and the refusal is at the top of the handler rather than per route.

The default bind is `127.0.0.1`. A demo server holding a bearer token for a
graph should not appear on a LAN because someone ran it on a laptop in a cafe.
Binding wider is possible and deliberate, not the default.

The access log prints method, path, status and duration, and stops there. The
query string is the two fields the visitor typed, and this console is going to
be on screen during a demo. `safePath` cuts at the first `?`, strips anything
outside printable ASCII and caps the result at 120 characters, so a crafted URL
cannot write escape sequences into a terminal either.

Rate limiting is per source address over a fixed window, applied before routing,
which means the stylesheet counts too. That is intentional: the limit protects
the single graph node behind this process, not any particular route.

### D-045: The notices never repeat what was typed at them

Eight fixed pages: not found, method, URL too long, missing terms, unusable
terms, too many requests, upstream failure, internal failure. Every one is
rendered to a `Buffer` once when the handler is built, and none of them
interpolates anything from the request.

The one that had to be argued is `badTerms`. Echoing the offending value is
normal and it is helpful, and it is also how a page that exists to quote a
graph ends up quoting an attacker instead. The escaping here is sound and the
CSP is `default-src 'none'`, so this is belt and braces rather than a fix. It is
still the right default: the page says the rule that was broken, which is the
part the visitor can act on, and says nothing about the value, which is the part
they already have.

Same reasoning at the other end. A failed read prints `HydraTransportError:
connect ECONNREFUSED` to the server console and the page says the graph did not
answer. The detail is where the operator is, not where the internet is.

The 502 and 500 split is carried by the type hierarchy rather than by a string
match: anything under `HydraError` is the graph or the connection to it, a
`RetrievalError` raised by term validation is the request, and anything else is
this server's own fault. All three are exercised over a socket in
`tests/unit/server-routes.test.ts`, including a graph that answers with two
entities under one name, which is a 500 because it is neither the visitor's
fault nor the transport's.

### D-046: The meta copy of the policy drops the one directive it cannot carry

Every page load printed this to the console:

```
Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.
```

The policy is sent twice on purpose. The header is what the browser enforces on
a served page, and the meta element is what survives when someone saves the page
to disk and opens it again, which is a thing that happens to a demo. Two
deliveries of one policy, so the saved copy is as locked down as the served one.

`frame-ancestors` is the one directive that cannot be delivered that way. It was
in both, so it did nothing in the meta element and said so, out loud, on a page
whose entire claim is that it can be trusted about what it is doing. An error in
the console of an evidence page is not cosmetic. It is the first thing a careful
reader opens.

So `DIRECTIVES` is private, `CONTENT_SECURITY_POLICY` joins all of it for the
header, and `META_CONTENT_SECURITY_POLICY` filters that one directive out. Two
exported strings from one array, rather than two literals that would drift the
first time a directive is added. Framing is still refused, by the header and by
`x-frame-options` beside it, and the meta copy never claimed to be the thing
enforcing it.

`tests/unit/view-pages.test.ts` asserts the difference rather than the two
values: the header minus the meta is exactly `frame-ancestors 'none'`, and the
meta minus the header is empty. A new directive that reaches one and not the
other fails that test.

### D-047: A millisecond is printed at the resolution it was measured to

The multi-hop answer page printed this, in the panel that exists to be checked:

```
8 reads, 11 rows, 448.4000000000003 ms inside the client and 341.5 ms end to end
```

Every read was clean. `round` in `src/retrieval/fetch.ts` stores each
measurement at a tenth of a millisecond, and each of the eight printed as a
tenth two inches above. The proof panel adds them together, and a sum of tenths
is not a tenth in binary, so eight good numbers produced sixteen significant
figures of noise.

This is not a display nit. This page argues that its figures are measurements
rather than assertions, and sixteen figures claims a clock that was never read
that finely. A judge who notices it has been given a reason to doubt the numbers
next to it, which are the numbers the whole submission rests on.

Fixed in `ms()` in `src/view/format.ts` rather than at the call site, because
the call site is not the only place a derived figure will ever be printed. The
retrieval layer keeps its own rounding: measurement resolution belongs to the
thing doing the measuring, display resolution to the thing doing the displaying,
and importing a view formatter into retrieval would be the wrong direction.

The comparison behind the overlap sentence moved with it. `overlapped` now
compares the two values at the resolution both are printed to, so a page can
never print two identical figures with a sentence between them explaining that
one is bigger.

Found by taking screenshots, not by a test. The suite had nothing that summed
eight tenths, and now it does: `tests/unit/view-format.test.ts` adds up eight
readings copied off a live answer page, asserts the raw sum is not the number it
looks like, and asserts the printed form is. The literals in it were run through
Node before they were written down rather than reasoned about. See
[artifacts/screens](artifacts/screens/README.md).

### D-048: The reproduction script refuses to run against a port it did not open

`artifacts/repro/repro.sh` clones the repository somewhere clean, installs,
typechecks, tests, serves, and asks the four demo questions. The point of it is
that "a judge can run this" is a claim, and claims here get exercised.

The first version of it passed while proving nothing. It stopped the server with
`kill` on the shell job, but the shell job is npm and npm had spawned node, so
node outlived it and kept the port. The following run started, could not bind,
and had its four questions answered by the orphan from the run before. Exit
codes zero, four HTTP 200s, correct answers on every one, and not a single byte
of it produced by the build under test.

What gave it away was an empty server log in a section that should have printed
a startup banner. The requests had succeeded, so the natural reading was that
the logging was wrong rather than that the whole run was. `netstat` settled it:
the process holding the port had started ninety seconds before the run that
claimed to have launched it.

So the script now does three things it did not. It refuses to start if anything
already answers on the port, instead of allowing a server it did not launch to
take the questions. It greps the log for its own announcement on its own port
before believing any answer. And it stops the server by killing whatever owns
the listening socket rather than the shell job, because the process tree was not
walkable the way the first attempt assumed: msys `ps` has no `-o`, so the winpid
lookup returned nothing and `taskkill` was never reached, silently.

Recorded because the failure is worth more than the fix. A harness that can
report success without running the code under test manufactures evidence, and it
does it most convincingly when everything it prints is true. The guard is cheap.
The class of bug is not.

### D-049: No CI workflow ships with this repository, and the reason is not laziness

There is no `.github/workflows`. That is a choice, and it is the kind of choice
a judge is entitled to read as a gap, so it gets written down rather than left
to inference.

A GitHub Actions workflow on this repository would run `npm ci`, `npm test` and
`npm run typecheck`. All three pass, and all three already run here on every
change. What a workflow adds over that is a green badge, and the badge is the
problem, because of what it cannot cover.

Three test files are contract suites, and they are the only tests in the
repository that prove the Cypher is right. They run every query builder against
a live HydraDB node and fail if the node is absent, which was a deliberate
decision recorded earlier: a contract suite that mocks the database when the
database is missing is a suite that passes hardest exactly when it is least
entitled to. GitHub's runners have no HydraDB. Making the workflow green would
mean running every test that needs no database and skipping the 42 that carry
the actual integration claim.

That produces the worst artifact available: a green check on the front page of
the repository, next to a README that says the product is proven against a live
node, where the check covers everything except that. It is the same failure the
reproduction script had in D-048, promoted to the top of the page and pointed at
judges.

The alternative is a workflow that builds HydraDB from source in CI. Upstream is
Rust with object storage, the build was not quick on this machine, and a
first-attempt CI build of someone else's database, debugged against a runner
rather than a terminal, is a poor use of the days remaining before the deadline.
It also risks the outcome this decision exists to avoid, which is a red X sitting
on the submitted repository because the workflow itself was wrong.

So the reproduction path is a script instead of a badge.
`artifacts/repro/repro.sh` clones the repository into a directory that has never
held it, follows the README exactly, starts a node, ingests, and answers
questions, and its unedited transcript is committed next to it. A judge who
wants proof runs one file and reads real output, rather than trusting a check
whose coverage they would have to go and read the workflow to establish.

Revisit if the node ever ships as a container upstream. At that point the
workflow becomes honest and cheap at the same time, and this entry becomes
wrong, which is the condition for changing it.

### D-050: The author identity was rewritten across all 42 commits, and nothing else was

`git push` came back with `GH007`. GitHub refused to publish commits carrying an
address the account keeps private, which is the correct behaviour and not a bug
to be worked around. Two exits existed. Publish the address, or stop putting it
in the commits.

The deciding fact is not about this repository. Every other public repository on
this account already commits under
`115102797+vaibhav4046@users.noreply.github.com`. The personal address appears in
none of them. Clearing `GH007` by flipping the account setting would therefore
have created a new and permanent exposure that exists for no reason except this
hackathon, in the author field of 42 commits, on a repository built to be cloned.
Turning the setting back afterwards does not retract it.

So the identity moved instead. `git filter-repo --mailmap` mapped both identities
in the history to one:

```
<the personal address, deliberately not reproduced here>
    -> Vaibhav Lalwani <115102797+vaibhav4046@users.noreply.github.com>
root <root@vaibhav.localdomain>
    -> Vaibhav Lalwani <115102797+vaibhav4046@users.noreply.github.com>
```

The address on the left is not written out anywhere in this repository, and that
is not an oversight. Printing it in the document explaining why it was kept out of
the author fields would have republished it in the body of the same repository and
made the whole operation pointless. It is the address `git config user.email`
returns on the machine this was built on, which is enough for anyone who needs to
reproduce the mapping and is nothing to anyone who does not.

**What did not change, each checked rather than assumed:**

- 42 commits before, 42 after.
- All 42 author dates and all 42 committer dates byte identical. The full
  `%ad|%cd|%s` listing was captured before the rewrite and diffed against the
  listing after. The diff is empty.
- The first commit is still `2026-08-12 21:22:04 +0100`, which is the eligibility
  evidence and the one date that would have mattered if it had drifted.
- Commit messages untouched. `--mailmap` rewrites identity headers and nothing
  else.
- The tip's tree is `1e6dd98a3c46d8abed1331b2c735cef9d7cc8bab` on both sides of
  the rewrite. Identical tree means not one byte of file content moved.
- Order and parentage unchanged.

**What it cost:** every hash changed, so any SHA written down before this entry
no longer resolves. The ones cited in this repository:

| Before | After | What cites it |
|---|---|---|
| `8eb5c38` | `d27fb89` | The first commit, the eligibility date |
| `45d3f16` | `1d3a326` | The commit made from a root shell in WSL |
| `ffbe274` | `bac9d9d` | `artifacts/repro/clean-clone-2026-08-13.txt` |
| `4de1a65` | `2954b15` | `artifacts/repro/clean-clone-4de1a65.txt` |
| `40b6da5` | `e7df5f2` | D-025, for the edge count its message gets wrong |
| `ad25911` | `033c1a8` | The tip at the moment of the rewrite |

**The two reproduction transcripts were not edited.** They print `HEAD ffbe274`
and `HEAD 4de1a65` and they still do. They are unedited machine output, and
rewriting recorded output so it agrees with a history that did not exist when the
run happened is the precise act this repository spends its documentation
refusing. The transcripts keep the hashes they recorded, and
[artifacts/repro/README.md](artifacts/repro/README.md) carries the mapping so a
reader who tries `git show ffbe274` and gets nothing has the answer next to the
file rather than three documents away.

**`.mailmap` is retired.** It existed to map `root <root@vaibhav.localdomain>` to
its author without rewriting the commit. That identity no longer occurs, so the
file mapped nothing. Its comment also argued against rewriting history, which
would have left this repository shipping a document contradicting what it did.

**Against the rule in [AGENTS.md](AGENTS.md).** That rule says history is never
rewritten to look like something else, and it still holds. Dates, order,
messages, parentage and content all survive verbatim, and every one of those was
checked. What changed is which address the author is reachable at. That is a
contact detail, not a claim about when work happened or who did it, and the
rewrite is recorded here in full rather than left for a judge to discover.

### D-051: Every page carries the same four links, and marks the one you are on

Before this, the four pages were reachable only from a list in the footer of the
home page. `/bench`, `/hydradb` and `/interface` each had the list too, but a
visitor who landed on an answer page had nothing above the fold telling them the
other three existed, and nothing anywhere telling them which one they were
reading. On a site whose argument is spread across four documents, that is not a
navigation gap, it is an argument that does not get made.

So `page()` in `src/view/layout.ts` now renders a bar above the sheet and the
same links again in the footer, and both are built by one function from one
array. A fifth page cannot appear in the bar and not in the footer, because
there is no second list to forget.

**The marker is `aria-current="page"`, not a class.** A class would have made the
visible marker and the spoken one two separate facts that agree by convention.
The attribute is the announcement a screen reader makes, and
`.tabs a[aria-current="page"]` in the stylesheet is what draws the red rule under
it, so a page that stops marking itself loses both at once rather than silently
losing one.

**A notice marks nothing.** `Route | null`, and the notices pass null. A 404 is
not one of the four pages, and a bar claiming it was `/` would be a wrong answer
to the only question the bar exists to answer. The links are still there, so a
refusal is still a way back in; only the claim about where you are is dropped.

**What holds it.** `tests/support/markup.ts` pulls every marked href out of a
rendered page, and both view suites assert the set is exactly one entry and that
it equals the route the server hands the page out on. A page that marked two, or
marked a route it is not served at, fails. The notice test asserts the empty set
and then asserts all four links are still present, so removing the bar from
refusals entirely would fail as well.

An answer page is served at `/ask` and marks `/`. That is deliberate: an answer
is what the ask page produces, and marking a fifth entry that is not in the bar
would leave the marker pointing at nothing.

### D-052: The screenshot set is taken and verified by one command, not by hand

The first version of this directory was six PNGs taken by hand. They were correct
when taken and wrong three commits later, because the bar in D-051 changed the
top of every page and nothing connected the images to the pages they claimed to
be of. The failure mode of a hand-taken screenshot is not that it is fake, it is
that it silently stops being current while still looking like evidence.

`scripts/screens.ts` takes all twelve, and `npm run screens` retakes the set from
one build in one run.

**Chrome over the DevTools Protocol, not `--screenshot`.** The flag was tried
first, because it costs nothing. It cannot set a colour scheme: launching with
`--blink-settings=preferredColorScheme=1` and `=2` produced byte identical
files, so a dark capture is not reachable from the command line. It also writes
exactly the window height, so a full page capture is not reachable either. The
protocol has `Emulation.setEmulatedMedia` and `captureBeyondViewport`, and Node
24 has a global `WebSocket`, so driving it costs no dependency. Playwright would
have cost a browser download and a devDependency for something the platform
already does.

**Every capture is read back off disk and checked.** Signature, bit depth and
colour type, exact width, exact height or at least the viewport height for a full
page, a top left pixel above 180 on a light capture and below 90 on a dark one,
and at least 0.005 compressed bytes per pixel. The run exits non-zero if any
check fails. The theme check is the cheap one and the one that catches the most:
every PNG row filter subtracts a neighbour that does not exist at row 0 column 0,
so the first three bytes of the inflated stream are the literal top left colour,
with no need to unfilter the image.

That density floor is what separates a page from a blank rectangle. A flat fill
of a solid colour compresses far below it; a real page, even one that is mostly
paper, does not come close to it from below.

**What it does not check.** That the right words are on the page. No pixel test
does. The suite covers the words, this covers whether the page rendered at all
and in the state it was asked for, and looking at the file covers the rest. All
three were used here, and the second one is the only one that runs unattended.

---

## 2026-08-14

### D-053: The pre-write key check reads two different ways, because an id read cannot report absence

The read-back before a write exists to catch a 52-bit id collision before it
overwrites someone else's node. It had one implementation, a scan of every node
carrying the label, and that is the wrong shape for the incremental case: adding
fourteen nodes to a graph holding 5,642 should not cost a walk of the graph.

An id read was added for that case, and probing it turned up a behaviour that
made the first version of the check wrong. Measured against a live node on
2026-08-14, against a graph holding the demo corpus:

| Query form | Time | Result |
|---|---|---|
| `MATCH (n:Entity {id: $id}) RETURN n.id, n.key`, id present | 13 ms | one row |
| `MATCH (n {id: $id}) RETURN n.id, n.key`, id present | 10 ms | one row |
| `MATCH (n {id: $id}) RETURN n.id, n.key`, id never written | 11 ms | **one row, `key` null** |
| `MATCH (n:Claim {id: $id}) RETURN n.id, n.key`, id never written | 11 ms | no rows |
| `MATCH (n) WHERE n.id = $id RETURN n.id, n.key` | 12 ms | 400, `node-only MATCH requires an id, label, or property predicate` |
| `MATCH (n) WHERE n.id IN $ids RETURN n.id` | 3 ms | 400, `composite parameter $ids is only supported as an UNWIND in` |
| `UNWIND $ids AS w MATCH (n {id: w}) RETURN n.id` | 3 ms | 400, `UNWIND batch supports one-hop relationships only` |
| `MATCH (n:Entity) WHERE n.key IS NOT NULL RETURN n.id` | 3 ms | 400, `WHERE currently supports boolean combinations of property comparisons` |
| `MATCH (n:Entity) RETURN n.id, n.key` (66 nodes) | 43 ms | one page |
| `MATCH (n:Message) RETURN n.id, n.key` paged at 1,000 | 2,630 ms | 6 pages, 5,268 rows |

The third row is the load-bearing one. **The unlabelled id pattern addresses a
vertex slot, not a stored node.** Ask it about an id nothing has ever written and
it answers with one row carrying the id it was asked for and a null key. The
same id under a label answers with nothing. So row count on the unlabelled form
never means "present", and the check that read it as present was throwing a
collision on the first id of every ingest into an empty graph. It was not caught
earlier because the unit tests mock the transport and the contract suite was not
running at the time.

**Both reads stay, and the null means different things in each.** A scan returns
nodes that carry the label, so one of them with no canonical key is a real node
this corpus never wrote, sitting on an id we are about to write, which is exactly
the overwrite the check exists to refuse. An id read's null is an empty slot.
`isPresent` takes that as a parameter rather than guessing, and the two unit
tests that pin it say which read they are describing.

**The id read stays unlabelled.** A canonical key begins with its label, so a
planned id found under a different label carries a key that cannot match, which
is a collision worth refusing. Scoping the read to one label would look straight
past it, and per the table the labelled and unlabelled forms cost the same.

**The threshold is 256 planned ids per label.** 256 indexed reads at ~11 ms is
under three seconds serially and well under one at the default concurrency, so
whichever way `auto` goes the cost is bounded. It also sits an order of magnitude
above an incremental ingest of a session or two and an order of magnitude below
a corpus load, which are the only two things anyone runs.

### D-054: The 28-second delete was a wedged store, not a bookmark problem, and the fix was to say so

Recorded because the wrong answer was already written down and acted on.

The contract suite's fixture teardown, fourteen sequential deletes, took 28,498
ms. The theory was bookmark chaining: each delete waits for the read epoch of
the one before it. It was plausible, it fit the shape of the numbers, and a fix
for it was drafted.

Then the node was found dead. Its log ran from `2026-08-12T22:03:34Z` to
`2026-08-13T23:55:34Z` with no `graph node stopped` line, unlike every clean
restart before it, so it was killed rather than shut down. `dmesg` showed no OOM
and memory was healthy. On restart every write returned `500: internal query
execution error` while reads kept working normally, and writes were half
applying: a vertex materialised carrying `id` with `key` null. `RUST_LOG=debug`
produced no additional output, so the engine's own filter kept the cause out of
the log and the 500 stayed undiagnosable from outside.

One experiment settled it. The store was moved aside and the node restarted onto
a fresh one. Every write worked immediately, MERGE in 120 ms and DETACH DELETE
in 11 ms, and the corpus reloaded clean. After that the same fourteen deletes
were part of a contract run whose tests took 6.90 seconds in total.

So the 28 seconds was a store degrading, and the bookmark theory was wrong. No
fix was shipped on it. The bad store is kept at `store.wedged-20260814` rather
than deleted, because a preserved failure is worth more than a tidy directory.

What is **not** established: what wedged it. The slatedb garbage collector has
never worked on this deployment, logging
`error collecting garbage [resource=Compactions|Manifest, error=ObjectStoreError(NotImplemented { operation: "`put_opts` with mode `PutMode::Update`", implementer: "LocalFileSystem(...)" })]`
on a loop, and an unclean kill is the obvious suspect. Suspicion is not a cause,
and it is written here as suspicion.

### D-055: The voice surface is a state machine you can read, and it holds no microphone

The imported design describes a voice interface: an orb that swells while you
speak, a transcript that firms up as it commits, audio that stops within 120 ms
when you interrupt, voice that resumes 24 seconds later. None of that was
measured here, and no part of this environment can record audio.

Three answers were available. Build the thing badly and demo it. Draw a picture
of it and call the picture a screenshot. Or write down the machine, render every
situation it can be in, and say at each one which stages ran and which do not
exist yet.

The third is what `/voice` is. Fourteen states, sixteen events, and two edges
that exist from everywhere: the network can go at any moment, and anyone can
give up on speech at any moment and land on the question form. The transition
table in `src/voice/states.ts` is the whole implementation, and the page is a
rendering of it rather than a description of it. `?state=` selects which of the
fourteen you are looking at.

**This build runs in `text_only`.** That is printed on all fourteen pages, not
just on its own, so no state can be read as a claim that the build reaches it.
The other thirteen carry the line that this build cannot enter them.

**The pipeline is four stages and two of them are absent.** Speech to text and
text to speech are `NOT_STARTED`. HydraDB and the resolver are `VERIFIED`, and
they are verified by the rest of this suite rather than by anything on this page.
The timing column for the two absent stages reads `UNAVAILABLE`. There is no
number anywhere on the page, and `tests/unit/view-voice.test.ts` asserts that as
a regex over all fourteen renders, so the design's 120 ms cannot creep back in
through a later edit.

**The page ships no script and costs the node nothing.** All fourteen buffers are
rendered once at construction and looked up by key, so `?state=` never reaches a
renderer: `readState` returns one of fourteen names or null, and null falls back
to the running state. Junk falls back rather than 404s, because the page is
linked from every other page and a stale bookmark should land somewhere true.
`tests/unit/server-routes.test.ts` asserts that nothing sent in the query string
appears in the response in either raw or escaped form, and that walking all
fourteen states makes zero upstream calls.

What this is not: a working voice interface. It is the design's state machine,
executable and checked, with the audio stages named as missing.

### D-056: The voice stack that is named is local, and none of it is installed

Naming a stack that does not run is only useful if the naming is specific enough
to be wrong. `src/voice/stack.ts` names seven components with their licences and
their capability states, and every one of them is `NOT_STARTED` or `BLOCKED`.

**Local first, for a reason that is not cost.** Silero VAD (MIT), whisper.cpp
with a quantised `small.en` (MIT), Kokoro-82M (Apache 2.0), and optionally Qwen
3.5 4B through Ollama (Apache 2.0). The corpus this product reads is somebody's
stored conversation history. Sending audio of it to a hosted endpoint to get a
transcript back is the failure the whole design is arranged against, and it is
not made acceptable by the endpoint being cheap.

**The optional model is optional in the strong sense.** HydraDB and the resolver
decide the verdict. A model in that path would put a quota between a question
and its evidence, and would make the answer depend on which model answered. The
parity panel on `/voice` says this and points at the question form, which is the
same pipeline with the two audio stages removed.

**The metered fallbacks are named and labelled metered.** AssemblyAI is
`BLOCKED`: no credential for it is configured in this environment, so it has
never been called. ElevenLabs and Groq are `NOT_STARTED`: no code calls either.
They are listed so that the absence is on the record rather than discovered by
someone looking for the integration later.

### D-057: The imported design is kept unmodified and deliberately not adopted

The Claude Design project was imported and its artifacts are stored under
`design/reference/`, unedited: `Lacuna Voice.dc.html`, its `support.js`, and a
`tokens.css` carrying the Hydra palette (black, charcoal, `#ff5719`) and a Geist
font stack. Keeping them verbatim is what makes them citable: the design can be
checked against what shipped.

It is not the product's palette, and that is a choice rather than an oversight.

**The fonts settle it.** `src/view/style.ts` names no web font, which is why the
content security policy never has to name a font host. Adopting Geist means
either shipping a font file and widening `font-src`, or naming a host and
widening it further. A policy that reads `default-src 'none'` with three narrow
exceptions is worth more to this product than a typeface.

**The palette follows from the same place.** The product is warm paper and
archival ink because what it renders is quotations out of a stored history with
their dates attached, and the design's near-black surface reads as a console.
The one thing carried across is the structure: the orb's three variables
(solidity for engagement, a dashed edge for anything provisional, a live ring
for an active stage) are rendered from `STATE_FACTS`, in this product's colours.

### D-058: The wedged store has a name now, and the fix is still only a reset

D-054 recorded a store that stopped accepting writes, the remedy that cleared it,
and one honest gap: what wedged it was unknown. The same failure happened again
on 14 August, and this time the log was read before the store was moved, which
closes part of that gap and leaves the rest open on purpose.

**The symptom.** `npm run test:contract` came back `2 failed | 1 passed`, `22
passed | 20 skipped`, on a fixture teardown rather than on anything interesting:

```
HydraQueryError: HydraDB returned 500: internal query execution error
 at HydraClient.queryPage src/hydra/client.ts:239:13
 at HydraClient.write src/hydra/client.ts:314:18
 at removeFixture tests/contract/ingest.contract.test.ts:207:5
```

**What the node actually said.** `internal query execution error` is what the
engine puts on the wire. It is not what it puts in its log. At the default
`RUST_LOG=info` the same request logged this, as a `WARN` with the message
`HTTP suppressed internal graph error` and `error_type: slatedb_graph_kernel`:

```
object store error: Operation `put_opts` with mode `PutMode::Update` not yet
implemented by LocalFileSystem(file:///var/lib/lacuna/hydradb/store).
```

The error names its own operation and its own implementer, so nothing outside
the log is needed to read it. `/opt/hydradb/Cargo.lock` pins `object_store`
0.14.1 and `slatedb` 0.14.1 from
`git+https://github.com/usecortex/slatedb.git?rev=c501471ea070498931f30611bfd1ad2773c3c367`.
A conditional put is how slatedb makes a manifest update atomic, and the local
filesystem backend does not implement one.

**What this adds to D-054.** D-054 saw that exact `NotImplemented` in the
garbage collector loop, called it the obvious suspect, and refused to call it the
cause. It is now observed on the HTTP write path, in the request that returned
the 500. That is a much stronger link than a coincidence of error text.

**What is still not established.** That the collector never running is what
eventually kills writes. The two share a signature and a backend, and the
ordering fits, but no experiment here separates the two, and the honest word for
that is still suspicion.

**The remedy is unchanged and is not a fix.** Stop, move the store aside, start,
re-ingest:

```
stopped pid 389 after 1s
ready after 1s, pid 1357
```
```
wrote   5642 vertices in 15 batches, 5705 edges
timing  verify 2.2s, vertices 1.0s, edges 60.8s, total 64.0s
bookmark sgk:1:6c6f63616c:64656661756c74:63656c6c2d30:5721
```
```
 Test Files  3 passed (3)
      Tests  42 passed (42)
   Duration  9.07s
```

Moving a store aside is a reset. It does not patch `object_store`, it does not
make the collector run, and the new store is on the same backend as the one that
wedged, so it should be expected to wedge again. That is why this is written into
NEEDS_VAIBHAV.md as an operational blocker rather than closed here: anything that
has to stay up for longer than a demo needs a real object store, not this note.

Both failed stores are kept: `store.wedged-20260814` from D-054 and
`store.wedged-20260814b` from this one. Two preserved failures are worth more
than one, and neither of them costs anything but disk.

### D-059: The frozen design is adopted, which reverses D-057 and costs one assertion

**Supersedes D-057.**

D-057 kept the imported design under `design/reference/` unmodified and did not
adopt it. The reasoning there was that a product with a working evidence surface
should not be restyled on the strength of a token file nobody had read against
the real pages. That reasoning has been used up: the pages were read against it,
and the token file turned out to be a decision rather than a palette.

**What changed.** `src/view/style.ts` now commits to the ground in
`design/reference/tokens.css`: black paper, charcoal surfaces raised off it,
four steps of white so hierarchy is carried by weight of ink, borders as white at
low alpha, and one orange that only ever means something. Geist is named first
because the design names it, and the stack falls through to the system, so there
is still nothing to fetch and no font host to name in the policy.

**What the adoption cost.** The old sheet carried a `prefers-color-scheme` block
and served two grounds. The new one serves one and says so twice: a
`color-scheme: dark` declaration so the browser paints its own furniture to
match, and a `<meta name="color-scheme" content="dark">` in the head so it knows
before the sheet arrives. A reader who prefers light gets the black page. That is
the trade: the design was drawn on one ground, and a product that paints itself
two ways is not wearing the design, it is wearing a compromise with the operating
system.

`grep -c 'prefers-color-scheme'` over the served stylesheet returns 0, which is
the check that this is true of what ships rather than of what was intended.

**What it cost the capture harness.** `scripts/screens.ts` used to assert a floor
of 180 on a capture named light and a ceiling of 90 on one named dark. With one
ground the floor is unreachable and the pair is meaningless, so both were
replaced by a single `GROUND_CEILING = 90`, and the field the shots carry was
renamed from `theme` to `prefers`, because what a shot records is now what the
browser was told the reader wants, not what the page did about it. A capture at
1920x1080 preferring light was kept for exactly that reason: it came back byte
identical to the one preferring dark, 315100 bytes each, which is positive
evidence rather than an assertion that nothing happened.

**The ledger the ultimatum asks for is two new files, not six.** The requested
set was STATE, BLOCKERS, REQUIREMENTS_MATRIX, CLAIMS, EVIDENCE_INDEX and an ADR
directory. Four of those already exist here under other names and would be worse
duplicated than referenced: `STATE.md` is at the root and is the state file,
`docs/RULES_MATRIX.md` is the requirements matrix, `NEEDS_VAIBHAV.md` and the
operational sections of STATE.md are the blocker list, and this file is the ADR
directory with the decisions in one readable sequence instead of one file each.
Only two were genuinely missing and both are now written: `docs/CLAIMS.json`,
which is every public claim with the capability state and data state behind it,
and `docs/EVIDENCE_INDEX.md`, which maps each of them to the artifact on disk.

**Why CLAIMS.json carries `"data": null`.** A capability state and a data state
are not the same axis. `lacuna doctor` reporting a version is VERIFIED and has no
data behind it at all, while a screenshot is a RECORDED RUN of something that was
LIVE when the shutter opened. Forcing a data state onto a claim that has no data
would mean inventing one, so the field is nullable and every null carries a
`why_no_data` beside it saying why. A reader can tell a claim with no data from a
claim whose data nobody recorded, which is the distinction the whole file exists
to keep.

### D-060: One projection for both non-browser surfaces, and the one field it refuses to cover

The MCP server and the command line answered the same question and returned two
results built by two pieces of code. They agreed, because both were written from
the same intention a week apart, which is the kind of agreement that lasts until
someone renames a field on one side.

**What changed.** `src/contract/result.ts` is now the only place an `Answer`
becomes a result. `askCore` and `toRevisionItem` live there, `src/mcp/result.ts`
imports them and adds the tool envelope, `src/cli/json.ts` imports them and adds
what the command line has that a tool call does not: the command that ran, the
question as it was parsed, and the resolver's own trace. Neither file holds a
second copy of the field names, so the two cannot drift apart without the shared
file changing.

**Why `src/contract/` and not `src/model/`.** `src/model/` is a leaf with no
imports of its own, and `src/retrieval/types.ts` imports `../model/abstention`.
A projection of an `Answer` has to know what an `Answer` is, so putting it in
`model` would make the leaf depend on the layer above it and turn a one-way
dependency into a cycle waiting to happen. The layering is
`model -> retrieval -> contract -> {mcp, cli}` and the new directory is what
keeps it readable.

**Two narrowings that were nearly widenings.** `RevisionItem.polarity` was about
to be typed `string` to save an import. It is `Polarity`, which is
`'positive' | 'negative'`, and the local declaration that would have shadowed it
was deleted rather than kept in parallel. Evidence items gained `role`, the role
of the speaker whose message the span came from, because a quotation whose
speaker is unknown is weaker evidence than one whose speaker is named. That
addition invalidated a fixture in `tests/unit/mcp-tools.test.ts`, and the fixture
was corrected rather than the contract reverted.

**One deliberate behaviour change on the command line.** `--json` now caps
evidence at fifty items and reports the true count in `evidenceTotal`, which is
what the MCP surface already did. The cap exists because a result goes into a
context window. A caller reading the array length instead of `evidenceTotal`
would undercount, and that is written into `docs/CLI.md` rather than left for
someone to discover.

**The field the contract refuses to cover, and why.** `npm run parity` compares
status, answer, reason code, claim id, superseded claims, evidence, evidence
total, source state, and the set of reads with their parameters and row counts.
It does not compare the order the reads appear in. The independent reads are
issued together with `Promise.all` and appended to `answer.queries` as they
resolve, so the order is the order the node finished them in. Four consecutive
runs of the same command on the same surface came back in different orders, which
is what settled it: the variation is not between MCP and the command line, it is
between one run and the next. Ordering it inside the contract would have been
inventing a guarantee the system does not make. The parity artifact prints both
raw orders next to the verdict so the exclusion is visible rather than assumed.

**What was run.** `npm run parity` ends `ALL_IDENTICAL: True` over two questions,
one answered and one abstained, against a live node. The unit suite is 807 tests
over 36 files. The saved output is in
`artifacts/verification/2026-08-14b/`, and what produced each file, including one
file produced by a driver that is not in the tree, is written in that directory's
README.

### D-061: The Windows to WSL relay fails without closing the socket, so a probe that connects proves nothing

`npm run test:contract` stopped returning. It did not fail, it hung, and it was
killed at three minutes with exit 143.

**Why the obvious check said the node was fine.** The node runs inside WSL2 and
binds WSL's own loopback. Windows reaches it through the localhost relay, and
after a WSL restart that relay can degrade into a state where TCP still connects
and query traffic never comes back. A connection test therefore passes while
every request hangs. `curl` against `127.0.0.1:18443/readyz` made it worse rather
than better: that port answers 404 with an empty body for that path, which reads
exactly like a dead node and sent an earlier diagnosis in the wrong direction.
Readiness is on the admin port:

```
wsl -e bash -lc 'curl -s -o /dev/null -w "READYZ=%{http_code}\n" --max-time 5 http://127.0.0.1:19091/readyz'
```

`READYZ=200` from that is the only cheap signal that means anything.

**The fix, and the order it has to happen in.** Stop the node from inside WSL
first, then `wsl --shutdown`, wait a few seconds, let WSL start again, then start
the node. The order is a precaution rather than a diagnosis. Two stores have
already wedged on this machine, D-054 and D-058, and the cause of neither is
fully understood, so there is nothing to gain from pulling the floor out from
under a node that is mid-write. Stopping it cleanly costs six seconds.

```
wsl -e bash -lc '/mnt/d/project/lacuna/scripts/hydra-node.sh stop'
wsl --shutdown
wsl -e bash -lc '/mnt/d/project/lacuna/scripts/hydra-node.sh start'
```

The output of `wsl --shutdown` is UTF-16 and arrives with nulls in it, so it
needs `tr -d '\0'` to be readable in a POSIX shell. That is cosmetic, but it is
the kind of thing that makes a working command look broken at three in the
morning.

### D-062: The parity check grows a third surface, and the HTTP transport stops being described from the code

`npm run parity` compared two processes: the MCP server over stdio and the
command line in its own process. The Streamable HTTP transport was implemented,
documented, and never driven end to end, and `docs/MCP.md` said so in its own
gap list. That gap is closed and the list is shorter by one.

**What the third surface is.** The script starts the HTTP listener the way
`docs/MCP.md` says to start one, connects the SDK's own `Client` over
`StreamableHTTPClientTransport`, and asks the same two questions through it. The
client is deliberately not a hand-written POST. The handshake it performs, the
initialize exchange, the POST contract, the response arriving on the JSON body
rather than an event stream, is the one a third-party client would perform,
which is the point of using the SDK end rather than `fetch`.

**What it proves and what it cannot.** The two MCP surfaces share one tool
implementation, so this cannot fail on the substance of an answer; a substantive
failure would already have failed over stdio. What the HTTP case exercises is
the transport: the handshake, the stateless per-request `Server` construction,
and two requests through one listener, since the server builds a fresh transport
per request and closes it when the response ends. Because every tool advertises
an `outputSchema` and the SDK client validates structured output against it, a
successful `callTool` over HTTP is schema conformance rather than reachability.

**What was run.** `npm run parity` ends `ALL_IDENTICAL: True` over two questions
and three surfaces. Typecheck is clean, the unit suite is 807 tests over 36
files, and the saved output is in `artifacts/verification/2026-08-14c/`, whose
README records the tree it measured and the readiness check that preceded it.
The documents that cited the two-surface run, the README, `docs/MCP.md`,
`docs/CLI.md` and `docs/EVIDENCE_INDEX.md`, now cite this one.

**One correction in the same sweep.** `artifacts/screens/README.md` still quoted
the proof-panel figures from the earlier capture set, 244.6 and 971.8 ms, while
the committed PNGs read 344.9 and 417.5. The corrected figures were read back
off the committed pixels rather than re-captured, because the PNG is the record
and a fresh page would print fresh numbers. The epoch of 5844 and the
byte-identical light-preference capture survived the recapture, so those claims
stand unchanged.

### D-063: The parity check sweeps the evaluation's sixty questions, and its first run caught a bug in its own referee

Every description of `npm run parity` carried the same caveat: two questions,
not the eval's sixty. That caveat is closed. The two deep cases still run
first with their full payloads printed, and then all sixty gold questions from
the evaluation sweep through the same three surfaces, one compact line each.

**How the sweep is built.** The questions are constructed exactly the way
`scripts/evaluate.ts` constructs them: the same generated corpus, the same
`parseVia` on the question text, so the fourteen multi-hop questions carry
their `via` relation through all three surfaces — the MCP argument, the CLI's
`--via` flag. One stdio session serves every question, so the stdio side is
also sixty-two tool calls through one process rather than a fresh server per
call. The HTTP side reuses one listener; the CLI runs one process per
question, which is what a script would do.

**The referee bug.** The first sweep run ended `SWEEP_IDENTICAL: 45 of 60`,
exit 1. All fifteen mismatches were in the comparison, not the surfaces. The
comparable form sorted the read set by query text alone; the retracted,
contradicted and multi-hop questions issue the same query text more than once
with different parameters (two evidence-span reads, or one claim scan per
hop), the sort is stable, and equal-text entries keep their arrival order,
which is timing. An audit of all fifteen dumps confirmed every canonical field
identical across the three surfaces and the read sets identical once
equal-text entries were tiebroken by their parameters. The fix is that
tiebreak, in `comparable()` in `scripts/parity.ts`.

**Why this argues for the sweep rather than against it.** The two-question
check had the same latent bug and passed on timing luck: its answered case
also issues two span reads with identical query text. Two is exactly the
coverage at which a timing-dependent referee can look deterministic. The
concrete argument for sweeping sixty was made by the sweep itself, on its
first run.

**What the sweep does not judge.** It does not compare answers against the
gold expectations, because `scripts/evaluate.ts` already does and a second
scorer would be a second definition of correct. Here the sixty are sixty
distinct values three surfaces must agree on, nothing more.

**What was run.** `SWEEP_IDENTICAL: 60 of 60` then `ALL_IDENTICAL: True`,
exit 0, stderr empty; 28 answered, 32 abstained, every abstention a
successful call on all three surfaces. Typecheck clean, 807 unit tests over
36 files. The transcripts, exit codes and the tree they measured are in
`artifacts/verification/2026-08-14d/`, whose README also records the referee
bug in full. The README, `docs/CLI.md`, `docs/MCP.md`,
`docs/EVIDENCE_INDEX.md` and the `cross-surface-contract` claim in
`docs/CLAIMS.json` now cite this run; the 14c citations that remain are dated
records of the HTTP-transport milestone and stay as written.

### D-064: A third-party client connects, through the documented config block, over both transports

Every client that had ever connected to the MCP server was written in this
repository, and `docs/MCP.md` named that plainly: the `mcpServers` config
block it publishes was written from the transport's requirements, not from a
session that used it. That gap is closed. The client is the MCP Inspector's
CLI, `@modelcontextprotocol/inspector` pinned at `2.2.0` via `npx --yes` — a
separate codebase with its own protocol implementation.

**Why the config-file form, and not the direct-command form.** The inspector
accepts a server command inline, but on this setup it parses the server's own
flags (`--import`, `--stdio`) as inspector flags, spawns bare `node`, and the
initialize frame lands in node's REPL as script text: `SyntaxError:
Unexpected token ':'`, then a 15-second connection timeout. The config-file
form sidesteps that and is also the stronger test: the file the inspector
consumed is character-for-character the `mcpServers` block `docs/MCP.md`
documents, with `cwd` filled in. The committed copy in the artifact directory
is that exact file. The documented onboarding path is now the tested path.

**What was run.** Over stdio: `tools/list`, `lacuna_ask` three ways —
answered (Bellwether / beta_partner: `Halverd`, claim `797564529472318`),
abstained (Meridian / migration_window: `never_stated`), and multi-hop with
`via` passed as a plain `--tool-arg` — plus `lacuna_health` (`reachable:
true`, read epoch 6459). Over Streamable HTTP against `--http --port 3015`:
`tools/list` and the answered ask. Every command exited 0. The two
`tools/list` captures hash identical across transports, and every value
matches the fourth run's sweep.

**One protocol observation.** The inspector announces protocol version
`2025-11-25`; this server declares `2025-06-18`. Every call succeeded, which
is the SDK's version negotiation working against a client two revisions
newer. That is recorded as an observation, not a compatibility claim about
either revision's full surface.

**What this run does not prove.** The inspector is a client run from a
terminal, not a host. No editor or agent runtime has held an interactive
session with this server, and `docs/MCP.md` still says so; the residual gap
is narrower, and named. Transcripts, the consumed config file, exit codes and
the tree they ran against are in `artifacts/verification/2026-08-14e/`.
`docs/MCP.md`, `docs/EVIDENCE_INDEX.md` and the `mcp-server` claim in
`docs/CLAIMS.json` now cite this run; the 14b and 14c citations that remain
are dated records and stay as written.

### D-065: The public URL is a recorded replay, deployed by rewriting 483 imports rather than bundling

Nothing was deployed, and the deployment claim in `docs/CLAIMS.json` said so
in as many words. The reason was honest: the graph store wedges under
sustained writes (D-058's durability record), so a long-lived hosted node
would be a demo waiting to fall over. But a public URL matters — a product
nobody can open is a claim, not a product — and there is a shape of
deployment that stays inside what is true: a replay. `npm run snapshot`
exports every reply the live node produces for the whole gold set, byte for
byte, into `artifacts/snapshot/graph-snapshot.json`. Production decodes those
stored replies through the same client code the live server uses; nothing is
re-implemented for the copy. The pages say this about themselves — the home
page carries the disclosure sentence and every answer page marks its reads as
replayed — so a judge who never reads this file still meets the caveat.

**Why one serverless function.** <https://lacuna-five.vercel.app> serves
every route through `api/index.ts` behind a catch-all rewrite, with
`includeFiles` shipping the snapshot into the function bundle. The server is
already a plain request handler with no framework, so the function is a thin
adapter over the same routing the local server uses; a second HTTP stack for
production would have been a second thing to keep honest.

**Why the import sweep, and not a bundler.** The first deploy returned 500 on
every route: `ERR_MODULE_NOT_FOUND: Cannot find module
'/var/task/src/snapshot/serve' imported from /var/task/api/index.js`. The
`@vercel/node` builder compiles TypeScript but keeps import specifiers as
written, and Node's ESM loader requires explicit file extensions. Two fixes
existed: bundle everything with esbuild, or make every relative import carry
its `.js` extension. The sweep won: 483 imports across 119 files rewritten
mechanically, three directory imports hand-fixed to `/index.js` after
typecheck named them. It adds no dependency, the deployed source stays
inspectable file by file, and `tsc` under `moduleResolution: bundler` checks
the rewritten specifiers rather than trusting a bundler's resolution. The
cost is a convention the repository must keep; the typecheck is the fence
that keeps it.

**What was run.** From outside, over the public internet: every route answers
200, an unknown path 404, `POST /ask` 405; the deployed CSP and nosniff
headers are character-identical to the local server's; one question of each
kind returns its recorded answer; the home page carries the disclosure
sentence. Locally, `npm run snapshot:verify` replays all sixty gold questions
against the shipped snapshot: 60 questions, 0 answer mismatches, 0 wrong
verdicts. Transcripts and the tree they measured are in
`artifacts/verification/2026-08-14f/`. The README, `docs/EVIDENCE_INDEX.md`,
`STATE.md` and the `deployment` claim in `docs/CLAIMS.json` now cite this
run.

**What this does not prove.** No live HydraDB node is behind the URL, no
writes happen there, and no token is present there. The durability limit
stands, and the live path remains local, exactly as the ledger records it.

### D-066: A missing .env.local becomes one sentence on stderr instead of a stack trace

**The problem.** Eight scripts — `ask`, `benchmark`, `evaluate`,
`export-snapshot`, `mcp`, `parity`, `serve`, `verify-snapshot` — called
`process.loadEnvFile()` unguarded, so on a checkout without `.env.local` each
of them died with a raw `ENOENT` stack trace. A judge following the README in
printed order hits exactly that state between step 2 and step 4, and a stack
trace at that moment reads as a broken project rather than a missing config
file. `scripts/census.ts` already had a guard; the other eight did not.

**The fix.** Each script now checks `existsSync` on the resolved
`.env.local` path before loading it, and on absence writes one sentence to
stderr — the path, and "Copy .env.example to .env.local and fill it in." —
then exits 1. The guard is inlined per script rather than routed through
`src/cli/env.ts`, because that loader is deliberately tolerant (it returns
false so the snapshot server can run with no env at all) and these eight
scripts need the opposite: a hard, early, explained stop.

**One README sentence moved with it.** The deployed-copy section listed
`npm run snapshot:verify` among the things that need no database. That was
wrong: the verifier asks a live node all sixty gold questions and compares
against the replay, which is its entire point. The sentence now lives in the
Running-it section after the corpus load, saying exactly that.

**What was run.** With `.env.local` moved aside: all eight scripts exit 1
with exactly one line on stderr and no stack trace, and `npm run
serve:snapshot` still boots and serves 200 with no env present at all. With
the file restored: `tsc --noEmit` exits 0 and all 807 unit tests pass.

### D-067: The benchmark report printed a ratio no measurement produced

**The problem.** `scripts/benchmark.ts` rounded each side's mean context
tokens to a whole number first and divided second: 636 / 15 = 42.4. The
measured means are 636.4833 and 15.0917 estimated tokens, and dividing those
gives 42.2. Nothing anywhere measured 42.4; it was an artifact of rounding
order, and it had been copied into four documents as if it were a result.
The wider tie's ratio had the same defect: 1603 / 15 printed as 107 where
the unrounded means give 106.2.

**The fix.** The generator now divides the unrounded means and rounds once
at the end, for the headline ratio and for the ablation sentence both. The
whole benchmark was then re-run rather than the report hand-edited, because
`results.json` does not store the raw per-question arrays a report needs and
because a run artifact that was not produced by a run would violate the rule
that every printed number was measured.

**What the re-run changed and what it could not.** The corpus is generated
from a fixed seed, so every correctness figure and every mean context token
count came back byte-identical across all 51 configurations — 60/60 for
Lacuna and for the tying baseline, 15.0917 and 636.4833 mean tokens, ratio
now printed as 42.2. Latency is the one column a re-run cannot reproduce:
Lacuna's p50 came out at 80.3ms against the previous run's 243.4ms, on the
same code and the same graph, and the documents that quoted 243.4ms now
quote the run that actually sits in `artifacts/bench/report.txt`. The
three-run history (188.1, 243.4, 80.3) is stated in STATE.md rather than
smoothed over; earlier records that name the superseded figures are dated
and stand as written.

**What was run.** `npm run bench` end to end (report and results
regenerated, runAt 2026-08-15T01:46:13Z), `npm test` 807 passed 0 failed 0
skipped against the fresh artifacts, `tsc --noEmit` exit 0, and
`node bin/lacuna.js bench` re-run so the CLI transcript in docs/CLI.md is
real output. A repo-wide sweep for `42.4`, `107 times`, `243.4` and `427.7`
finds them only in dated records and in the code comment explaining the bug.

### D-068: One demo journey, three questions, binding order across surfaces

**The problem.** The landing page, the video script and the submission form
each described the product with whatever examples came to hand when they were
written. Three surfaces, three different walks through the same graph, and a
judge who watched the video would not find its questions on the page.

**The fix.** [docs/DEMO_JOURNEY.md](docs/DEMO_JOURNEY.md) fixes one six-step
path — fact stated, fact corrected twice, ask with the revision chain, a hop
question, a structural abstention, and the three-surface parity check — and
names the three questions that carry it: `Bellwether beta_partner` (revised
twice, chain #2475749815969757 → #2247326196671333 → #797564529472318),
`replay-queue contact --via vendor` (bridge through Northfold), and
`Meridian migration_window` (never_stated). The landing page's example
questions, the video's shots and the form's "what was built" answer follow
this order from now on; a surface that departs from it is wrong, not
different.

**Why these three.** One of each hard kind, and each is a place where
similarity ranking has no mechanism: it cannot know Stonecrop was superseded,
cannot join a hop it retrieved in halves, and cannot refuse for a structural
reason. The counts in the document were measured, not estimated: 48 messages
mention Stonecrop and 36 of them state nothing, which is the decoy pressure
the corpus was built to apply.

**What was run.** All three questions through the CLI against the live node
on 2026-08-15, exit 0 each, outputs quoted verbatim in the document;
`lacuna timeline Bellwether beta_partner` for the chain; a corpus enumeration
confirming all 60 gold questions and their kind counts (12 stable, 8 revised,
6 retracted, 6 contradicted, 8 multi_hop, 6 unconnected, 8 never_stated,
6 out_of_scope).

### D-069: The wide layout now fills its right third

**The problem.** At 1920px the sheet stopped at roughly 1556px and everything
to its right was unpainted ground. A third of every page was dead gutter, and
on answer pages the walk ("How it got there") and the quotations that back it
sat a screenful apart, stacked in a 60rem column that never needed to be that
narrow.

**The fix.** Two changes in the stylesheet and one in the answer view. The
content column widened from `--main-w: 60rem` to `76rem`, which moves the
right edge of the sheet to about 1684px at 1920 and leaves symmetric margins
rather than one dead side. On answer pages the trace and the citations now
share a `.duo` grid: two columns above 68rem so the step that names a claim
and the quotation that backs it sit on the same horizon, one column below it
so the pair stacks back into reading order, which is also the order a screen
reader gets in either case.

**What was run.** `npm run typecheck` exit 0, `npx vitest run tests/unit`
807 passed 0 failed, `npm run screens` 13 captures all checked after
restarting the server (tsx does not hot-reload; the first capture round ran
against stale modules and was discarded). The regenerated
`answer-revised-1920x1080.png` and `home-1920x1080.png` were inspected:
content band ~236..1684, trace and quotations side by side.
