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
`40b6da5`, which says "5,642 vertices in 15 batches and 5,693 edges" and stays
wrong, because rewriting history to correct it would be worse than the error.
This record is the correction.

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
