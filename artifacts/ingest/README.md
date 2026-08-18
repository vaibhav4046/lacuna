# Ingest run evidence

Real output from real runs against a real node. Nothing here was typed by hand
or reconstructed from memory: every block below is the unedited stdout of the
command printed above it, captured 2026-08-13 against HydraDB `v0.1.1` (commit
`02a40025d2d57e97ab2754c8256219cdbfeab379`) built from source under WSL2 Ubuntu
24.04, HTTP query API on loopback `:18443`, namespace `local`, graph `default`,
cell `cell-0`.

The corpus has grown since that date. The package topology the blast-radius
questions needed took it to 5,752 vertices and 5,908 edges, counted by
`npm run census` on 2026-08-18 and saved at
[artifacts/verification/2026-08-18/census.txt](../verification/2026-08-18/census.txt).
Nothing below has been restated to match. These are the numbers that run
produced, and a transcript edited to agree with a later run is not a transcript.

What it is here to prove, in the order the claims depend on each other:

1. The demo corpus goes into HydraDB. Not a fixture, not a subset. 5,642
   vertices and 5,705 edges on the day of this run.
2. Running it twice leaves the same graph. `already 5642` on the second run,
   and the counts read back afterwards are identical.
3. What is in the graph is exactly what the plan says should be there, with
   nothing else, which is a stronger claim than the ingest report can make on
   its own.

Reproducing it takes three commands and a running node:

```
npm run reset -- --yes
npm run ingest
npm run census
```

## The plan, without a node

`npm run ingest -- --dry-run` builds everything and writes nothing, so the
counts below can be checked without HydraDB running at all.

```
> lacuna@0.0.0 ingest
> tsx scripts/ingest.ts --dry-run

corpus  seed lacuna-demo-v1, {"sessions":72,"messages":5268,"claims":118,"characters":469578,"estimatedTokens":117395}
plan    built in 40.4ms
vertices
  Session          72
  Message        5268
  EvidenceSpan    118
  Claim           118
  Entity           66
  total          5642 in 15 batches
edges
  CONTAINS       5268
  HAS_SPAN        118
  SUPPORTS        118
  ABOUT           118
  MENTIONS         49
  SUPERSEDES       22
  CONTRADICTS      12
  total          5705
dry run, nothing written
DRYRUN_EXIT=0
```

## Into an empty graph

`npm run reset -- --yes` first, so this starts from nothing. The reset is in the
tree because ingestion merges: it can add to a graph but never subtract from
one, which is right for ingestion and useless for getting back to a known state.

```
> lacuna@0.0.0 reset
> tsx scripts/reset.ts --yes

target  http://127.0.0.1:18443 namespace local graph default cell cell-0
  Session           73 deleted
  Message         5270 deleted
  EvidenceSpan     121 deleted
  Claim            121 deleted
  Entity            68 deleted
deleted 5653 vertices, every label now reads empty
RESET_EXIT=0
```

Those counts are 11 higher than the plan. See "The eleven extra nodes" below.

Then `npm run ingest`, trimmed only where fifteen identical progress lines
appear in sequence:

```
> lacuna@0.0.0 ingest
> tsx scripts/ingest.ts

corpus  seed lacuna-demo-v1, {"sessions":72,"messages":5268,"claims":118,"characters":469578,"estimatedTokens":117395}
plan    built in 30.6ms
vertices
  Session          72
  Message        5268
  EvidenceSpan    118
  Claim           118
  Entity           66
  total          5642 in 15 batches
edges
  CONTAINS       5268
  HAS_SPAN        118
  SUPPORTS        118
  ABOUT           118
  MENTIONS         49
  SUPERSEDES       22
  CONTRADICTS      12
  total          5705
target  http://127.0.0.1:18443 namespace local graph default cell cell-0
  verify 1/5
  verify 2/5
  verify 3/5
  verify 4/5
  verify 5/5
  vertices 1/15
  ...
  vertices 15/15
  edges 600/5705
  edges 1200/5705
  edges 1800/5705
  edges 2400/5705
  edges 3000/5705
  edges 3600/5705
  edges 4200/5705
  edges 4800/5705
  edges 5400/5705
  edges 5705/5705

wrote   5642 vertices in 15 batches, 5705 edges
already 0 planned ids were in the graph before this run
timing  verify 183.1ms, vertices 2.2s, edges 86.6s, total 89.0s
bookmark sgk:1:6c6f63616c:64656661756c74:63656c6c2d30:29447
INGEST_EXIT=0
```

`already 0` is the verify phase reporting that no planned id was in the graph
beforehand, which is what an empty graph should say.

## Then again, unchanged

The same command a second time, tail only:

```
wrote   5642 vertices in 15 batches, 5705 edges
already 5642 planned ids were in the graph before this run
timing  verify 7.9s, vertices 5.2s, edges 67.3s, total 80.3s
bookmark sgk:1:6c6f63616c:64656661756c74:63656c6c2d30:35153
INGEST2_EXIT=0
```

`already 5642` is every planned id found in the graph holding the key this run
derived for it. Had any id held a different key, the run would have refused
before writing anything.

The verify phase goes from 183ms to 7.9s between the two runs because on the
first there is nothing to read back and on the second there are 5,642 rows to
page through. The edge phase is the bulk of both, and it moves around between
runs (86.6s, then 67.3s, and 62.2s and 47.7s on
[two earlier runs](#the-two-earlier-runs) against the same node) because 5,705
separate round trips through a bounded pool is a measurement of the machine as
much as of the engine. Nothing here is a benchmark. The benchmark harness is a
separate piece of work and is not built yet.

## What actually survived

Counts from the graph, not from the writer, diffed against the plan.

```
> lacuna@0.0.0 census
> tsx scripts/census.ts

target  http://127.0.0.1:18443 namespace local graph default cell cell-0
seed    lacuna-demo-v1

label            graph  planned
  Session           72       72
  Message         5268     5268
  EvidenceSpan     118      118
  Claim            118      118
  Entity            66       66

edge             graph  planned
  CONTAINS        5268     5268
  HAS_SPAN         118      118
  SUPPORTS         118      118
  ABOUT            118      118
  MENTIONS          49       49
  SUPERSEDES        22       22
  CONTRADICTS       12       12

graph matches the plan exactly
CENSUS_EXIT=0
```

That output is from after the second ingest. Byte for byte the same output came
back after the first, which is the point: two runs, one graph.

Counting is not enough on its own, because a missing node and a stray node
cancel in a total. So the census also reads every stored key back and names
anything the plan did not write. The line `graph matches the plan exactly` means
both checks passed.

## The eleven extra nodes

Before the reset, the graph held 5,653 vertices where the plan accounts for
5,642. The census named the extras:

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

Round-numbered ids and no key at all. Lacuna derives every id from a canonical
key and stores that key on the node, so nothing it writes can look like this.
These are left over from the hand-run shape probes that produced
[ADR 0002](../../docs/adr/0002-temporal-evidence-graph.md), whose transcript
records the same ids, and from the `restart-1` probe quoted in
[STATE.md](../../STATE.md).

They are worth keeping in this record rather than quietly deleting, because
they are the exact failure the census exists to catch. Eleven nodes with no key
would have reached retrieval as records with nothing to cite, and no amount of
re-ingesting would have removed them: `MERGE` adds, it does not reconcile. They
survived every run until something counted.

They were deleted by `npm run reset -- --yes`, which removes vertices by label
and takes their edges with them. Everything else it removed regenerates exactly:
the corpus is deterministic from its seed.

## The two earlier runs

The pair above is not the first time the corpus went in. It went in twice before
the reset as well, into the graph that still held the eleven strays, which is how
they came to be counted at all. Those two runs are the source of the 62.2s and
47.7s quoted earlier, and their tails are here so that no number in this file is
cited without the output it came from.

```
wrote   5642 vertices in 15 batches, 5705 edges
already 0 planned ids were in the graph before this run
timing  verify 88.5ms, vertices 2.9s, edges 62.2s, total 65.2s
bookmark sgk:1:6c6f63616c:64656661756c74:63656c6c2d30:6647
```

```
wrote   5642 vertices in 15 batches, 5705 edges
already 5642 planned ids were in the graph before this run
timing  verify 2.8s, vertices 2.6s, edges 47.7s, total 53.2s
bookmark sgk:1:6c6f63616c:64656661756c74:63656c6c2d30:12353
```

Same two lines of substance as the pair above, `already 0` then `already 5642`,
against a graph that was not empty to begin with. Verify cost 88.5ms on the first
of these because there were eleven rows in the whole graph to page through, and
`already 0` because none of the eleven was an id this run planned to write. The
arithmetic closes: 5,642 written on top of eleven strays is the 5,653 vertices
the reset later deleted.

The census output of that era is not reproduced here. It was printed by an
earlier version of `scripts/census.ts` whose columns were laid out differently,
and quoting it beside the current format would suggest two runs of the same
program that disagree. What it reported is the eleven-node listing above.
