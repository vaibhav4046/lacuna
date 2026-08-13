# Ingestion

How a corpus becomes a graph, and why each part works the way it does. The
schema itself is [ADR 0002](adr/0002-temporal-evidence-graph.md); this is the
mechanics of getting it into HydraDB.

Run evidence, with real output from real runs, is in
[artifacts/ingest/](../artifacts/ingest/README.md). Nothing here restates a
number that was not measured.

## Two halves

`src/ingest/plan.ts` decides what the graph contains. It touches no network:
corpus in, `IngestPlan` out, a pure function. `src/ingest/run.ts` decides how to
get it there.

The split is not tidiness. It is what makes the interesting invariants testable
without a database. That every claim has a supporting span, that contradiction
detection finds exactly the threads the corpus planted, that a superseded claim
stops contradicting anything: those are properties of the plan, so they are unit
tests over a plan literal rather than integration tests that need a node up. It
also means the plan can be printed and diffed before anything is written, which
is what `npm run ingest -- --dry-run` and the census both rely on.

## Ids and keys

Ids are derived, not assigned:

```
id = first 52 bits of SHA-256("<label>\x1f<canonical-key>")
```

Determinism is what buys idempotence. The same corpus produces the same ids, and
`MERGE` on an id that exists changes nothing. That is why re-ingesting is safe
and why the demo can be rebuilt from scratch in front of a judge.

Truncating to 52 bits makes collisions possible, so every node also stores its
full canonical key as a property and ingestion checks that before it writes. A
node under a planned id holding a different key means the derivation collided, or
something else owns that id. Either way the write would overwrite real data, so
it is refused. `IngestCollisionError` names the id, the stored key, and the
planned one.

## One clock

Every `Claim` carries `valid_from` and `tx_time`, and in this corpus they are the
same value.

That is a property of the corpus, not a shortcut in the ingest. ADR 0002 keeps
two time axes because they come apart in real transcripts: someone says in
September that the launch moved to March, and the system learns in September a
fact that was true in March. The generated corpus contains no statement like
that. Every claim is stated in the present tense at the moment the message is
written, so the moment it became true and the moment the system was told are the
same moment, and `src/corpus/transcript.ts` sets `validFrom` to the message
timestamp.

The alternative was to subtract a synthetic offset and call it valid time. That
would produce two columns that look bitemporal in a screenshot and mean nothing,
and it would break the one rule the whole product rests on: every displayed fact
traces to a span of text that says it. No sentence in the corpus says when the
fact started being true, so nothing in the graph should claim to know.

So the schema supports the divergence and this corpus does not exercise it. That
gap is stated here rather than papered over, and it is the honest answer to a
judge who asks what the second timestamp is doing. The same applies to the
`CONFIRMS` edge in ADR 0002: the type is in the schema and this corpus never
produces one, because nothing in it is an independent restatement.

## Three phases

`runIngest` does verify, then vertices, then edges, in that order.

### verify

Reads back the key already stored on every id the run is about to write. It goes
first because the point is to refuse before touching anything.

The read cannot use `HydraClient.query`, which follows cursors and accumulates
rows capped at 5,000: the corpus has 5,268 messages, so the largest label alone
exceeds the cap. Raising the cap would mean holding every row of every label in
memory in order to test each against a set and then throw it away. The check does
not need rows, it needs a verdict. So it drives `queryPage` directly, one page of
1,000 at a time, under a single query id minted once per label, and accumulates
nothing. See DECISIONS.md D-018.

It also returns how many planned ids were already present, which is what makes a
second ingest visibly a no-op rather than merely a fast one. `already 0` against
an empty graph, `already 5642` against a full one.

### vertices

Batched `UNWIND` upserts, serial. 15 requests for the demo corpus.

Batches are capped at 500 rows or 262,144 bytes, whichever binds first. The byte
cap is the one that actually binds, because a `Message` row carries a whole
message body. `maxParameterBytes` on the client is 1 MiB, so the cap sits well
under the limit on purpose: a batch rejected for size costs a whole round trip
and tells you nothing you could not have computed locally. A single row larger
than the cap is a plan-time error rather than a request that will fail.

Serial because there are 15 of them and each is large. Concurrency there would
buy a couple of seconds and complicate the bookmark handling that the edge phase
depends on.

### edges

One request per edge. Not a choice: the engine refuses batched edge writes.
`UNWIND` over edges is rejected with "UNWIND vertex upsert requires MERGE by id
followed by SET", and a multi-hop pattern with "only one-hop edge patterns are
executable in Query engine MERGE". See DECISIONS.md D-011.

5,705 round trips is the bulk of every run, so the phase runs a bounded pool with
8 in flight. Duplicate edges are dropped at plan time rather than sent twice,
since `MERGE` would make the second write a no-op anyway and a redundant round
trip is the expensive part here.

## Bookmarks

HydraDB reads are pinned with a bookmark, and the client remembers the one its
last write returned. That is exactly right when writes are serial and exactly
wrong when they are not: under concurrency the remembered field holds whichever
write returned most recently, which is not necessarily the latest.

Every edge `MERGE` has to observe both of its endpoints, which the vertex phase
wrote. So the edge phase captures the bookmark the vertex phase ended on and
sends that same pinned selector on all 5,705 writes. A pinned selector does not
care who won the race.

The cost is that the pool drains without a bookmark known to be after everything,
which is what a verification read needs. One more write fixes it: re-`MERGE` the
last edge, serially, after the pool is empty. It is the only request in flight, so
what it returns is unambiguously after every write above, and it changes no state
because a repeated `MERGE` on the same edge is the idempotence this design rests
on. One round trip, and the alternative was parsing an opaque bookmark string to
compare two of them. See DECISIONS.md D-019.

## Timeouts

The default is 30 seconds per request, which is also the highest the server will
accept. Both ends of that were measured against the live node on 2026-08-13:

```
over the cap: HydraDB returned 429: client_query_runtime_ms rejected by admission control: actual 120000 exceeds limit 30000
5s on CONTAINS: HydraDB returned 408: client_query_runtime exceeded query timeout after 5000 ms; limit is 5000 ms
30s on CONTAINS: ok [[5268]]
```

So a request asking for more than 30,000 ms is refused by admission control
before it runs, and the client's own 5,000 ms default is not enough to count
5,268 `CONTAINS` edges. 30,000 is the only setting that works for both the ingest
and the census, and it is what both scripts use.

## Idempotence, and what merging cannot do

Every write is a `MERGE` on a deterministic id, so a second run over the same
corpus writes the same things to the same places and changes nothing. That is
proven rather than asserted: `tests/contract/ingest.contract.test.ts` ingests a
fixture corpus twice against the running node and diffs the counts, and the full
corpus has been run twice end to end with the graph counted afterwards both
times.

The other half of that property is the limitation. `MERGE` adds; it never
reconciles. Ingestion cannot remove a node that should not be there, so a node
left over from a probe, or from a corpus built under a different seed, survives
every re-ingest and shows up in retrieval as a record with nothing to cite. That
is not hypothetical: eleven such nodes were in the graph until the census counted
them, and the transcript is in
[artifacts/ingest/](../artifacts/ingest/README.md#the-eleven-extra-nodes).

Hence two more scripts. `npm run reset -- --yes` deletes every vertex carrying one
of Lacuna's labels, with `DETACH` so incident edges go too, which is the only way
back to a known state. `npm run census` counts what is in the graph, diffs it
against the plan, reads every stored key back, and exits non-zero on any
disagreement, so it works as a gate and not only as something to read.

The census is the stronger claim of the two reports. The ingest report says what
it wrote. The census says what survived.

## Running it

```
npm run ingest -- --dry-run    build the plan, write nothing, no node needed
npm run reset -- --yes         empty the graph
npm run ingest                 write the corpus
npm run census                 count what is there and diff it against the plan
```

`--seed` takes a corpus other than `lacuna-demo-v1`; the census takes the same
seed as its first positional argument. `--concurrency` overrides the edge pool
width. `--skip-verify` drops the collision read, which is only sensible against a
graph you just created.

## Measured cost

From [artifacts/ingest/](../artifacts/ingest/README.md), on the WSL2 loopback
node, 5,642 vertices and 5,705 edges:

| phase | into an empty graph | into a full one |
| --- | --- | --- |
| verify | 183.1ms | 7.9s |
| vertices | 2.2s | 5.2s |
| edges | 86.6s | 67.3s |
| total | 89.0s | 80.3s |

Verify costs nothing on an empty graph because there is nothing to read back, and
7.9s on a full one because there are 5,642 rows to page through. Edges dominate
both, and move around between runs (86.6s and 67.3s here, 62.2s and 47.7s on two
earlier runs against the same node), because 5,705 separate round trips through a
bounded pool measures the machine as much as the engine.

None of this is a benchmark. It is the cost of setting the demo up. The benchmark
harness is separate work and is not built yet.
