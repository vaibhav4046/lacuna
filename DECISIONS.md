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
