# How Lacuna uses HydraDB

## Production path: HydraDB Cloud

Production reads HydraDB Cloud. A live `GET /api/health` on 2026-08-21 returned
four passing checks and named database `lacuna`, collection `backend`. A graph
page read in the same pass returned 453 total Lacuna projection nodes and 682
edges with zero orphan edges.

The cloud adapter in [`src/hydra/cloud.ts`](../src/hydra/cloud.ts) uses HydraDB
as an active context store:

1. `/context/ingest` receives collection-scoped documents or `app_knowledge`
   records. App records use stable ids, upsert semantics and explicit relation
   ids when the graph already knows the edge.
2. `/context/status` is polled with both database and collection until each
   ingest reaches a terminal indexing state.
3. `/context/inspect` reads a deterministic record id for the answer path. This
   avoids turning temporal truth into a different top-k result on each call.
4. `/query` requests `graph_context: true` when semantic retrieval and the
   store's graph/temporal context are the intended product surface.
5. `/context/relations` supplies HydraDB's own extracted relation graph for the
   HydraDB comparison screen.

[`src/hydra/cloud-source.ts`](../src/hydra/cloud-source.ts) projects those cloud
records through the same `HydraSource` interface as the node adapter. Above
that seam, Lacuna applies its temporal policy: current versus superseded,
contradicted, retracted, never stated and out of scope. HydraDB stores and
retrieves the evidence and relation context; Lacuna decides whether that
evidence is allowed to answer.

The public graph API is not an image baked into the site. It pages the current
projection, signs the cursor server-side and offers separate `overview` and
`proof` modes.

## Self-hosted proof path

This is the document for the question "did the graph database actually do
anything, or is it a place where results were put." Every query shape below is
in the shipped answer path, every restriction quoted is one the engine handed
back, and every number is from a run committed under [artifacts/](../artifacts).

Lacuna also talks to a self-hosted HydraDB node as a separate service over its
HTTP query API. No HydraDB source is vendored or linked. Version pin, build path
and provenance are in [SOURCE_LOG.md](SOURCE_LOG.md); the node used for every
number in the self-hosted sections below is
`v0.1.1` at commit `02a40025d2d57e97ab2754c8256219cdbfeab379`, built from source
under WSL2 Ubuntu 24.04, HTTP on loopback `:18443`.

## The short version

An answer is a traversal. Not a ranked list that a traversal was used to
decorate: four read shapes in [`src/retrieval/queries.ts`](../src/retrieval/queries.ts)
are the whole retrieval system, and the resolver downstream of them is a pure
function over what they returned. The only embeddings in this repository are in
`src/bench/`, where they exist to give the baselines a fair run. There is no
similarity score anywhere on the answer path.

The properties that make that work are graph properties:

- A correction is an edge (`SUPERSEDES`), so "what is true now" is "the claim
  with no inbound supersession" and "what it replaced" is the same walk
  continued. Neither is a query against a version column, and the old claim is
  never mutated.
- Provenance is a path. `(Session)-[:CONTAINS]->(Message)-[:HAS_SPAN]->(Span)-[:SUPPORTS]->(Claim)`
  is four hops, fetched in one request, and it is the same object the UI shows
  as the proof. The citation is not assembled next to the answer, it *is* the
  subgraph the answer came from.
- "Known but disputed" is structural too, and cheaper than it sounds: two claims
  about the same predicate, neither with anything superseding it, disagreeing on
  text. No confidence number, no threshold. The graph shape decides it.
- "Never known" is the absence of a node, which is one query returning zero
  rows, and is therefore cheap and unambiguous rather than a low score to
  interpret.

## The four reads on the answer path

These are the whole of it. [`src/retrieval/fetch.ts`](../src/retrieval/fetch.ts)
issues these and nothing else, and every one is executed against a live engine
by [`tests/contract/retrieval.contract.test.ts`](../tests/contract/retrieval.contract.test.ts).

| Shape | Cypher, abbreviated | What it decides |
|---|---|---|
| `entityByName` | `MATCH (e:Entity {name: $name}) RETURN e.id, e.kind` | Whether the subject exists at all |
| `claimsAbout` | `MATCH (c:Claim)-[:ABOUT]->(e {id: $e}) OPTIONAL MATCH (newer)-[:SUPERSEDES]->(c) RETURN ..., newer.id` | Current value, replaced value, and disagreement |
| `mentionsFrom` | `MATCH (e {id: $e})<-[:ABOUT]-(c)-[:MENTIONS]->(o) RETURN ...` | The hop, for questions that need a bridge entity |
| `evidenceForClaim` | `MATCH (se:Session)-[:CONTAINS]->(m)-[:HAS_SPAN]->(sp)-[:SUPPORTS]->(c {id: $c}) RETURN ...` | The proof under a cited claim |

Two more shapes exist in the same file and are deliberately not on that path:

- `supersededByClaim`, `MATCH (c {id: $c})-[:SUPERSEDES*1..4]->(older)`, walks a
  revision chain from one end. `ask` does not need it, because `claimsAbout`
  already returns the supersession status of every claim about the subject in
  one request, and the chain reassembles from those rows without another round
  trip. It is still run against the live engine by the contract suite, as an
  independent check that the answer's version history matches what the graph
  says.
- `contradictionPartners`, `MATCH (a {id: $c})-[:CONTRADICTS]->(b)`, reads the
  explicit edge. The resolver does not consult it for the reason in the section
  above: disagreement is already visible in the `claimsAbout` rows. The edge is
  in the model and the query is unit-tested; the answer path is cheaper without
  it.

`claimsAbout` is the one worth pausing on. It gets the supersession status of
every claim in the same request that gets the claims, via `OPTIONAL MATCH` on
the reverse direction. That is the stand-in for `IS NULL`, which this Cypher
subset does not support: a claim whose `newer.id` column came back null has
nothing superseding it and is therefore current. Without it, deciding currency
would be one extra round trip per claim, and the two questions a memory system
actually has to answer, what is true now and what did it replace, would be two
separate reads that could disagree.

The `*1..4` in `supersededByClaim` is also not tuning. An unbounded walk over a
graph containing a cycle does not terminate, and nothing in the ingest path can
promise the graph is acyclic forever, so the bound is correctness. Four is the
deepest revision chain the corpus generates, plus room.

## What a question costs

From [`src/retrieval/fetch.ts`](../src/retrieval/fetch.ts), and confirmed by the
per-question query counts in [artifacts/eval/report.txt](../artifacts/eval/report.txt):

| Question shape | Round trips |
|---|---|
| Subject that was never mentioned | 1 |
| Direct question | 3 + 1 per cited claim |
| Question needing one hop | 6 + 1 per cited claim |
| Blast radius | 2 + 1 per node reached, breadth first |

Independent reads are issued together rather than in sequence, so wall clock
tracks the deepest dependency and not the total. Over the 64 evaluation
questions that is 342 queries, minimum 1 and maximum 42, at p50 114.1ms and p95
184.4ms end to end including the HTTP hop.

The 42 is a blast-radius question. That shape has no fixed cost: it walks
`depends_on` outward until nothing new is reached, one read per frontier node,
so what it costs is a property of the dependency graph rather than of the
question. The bound is `MAX_BLAST_DEPTH`, six hops, for the same reason
`supersededByClaim` is bounded.

The 1 is worth its own sentence. An out-of-scope question costs one query
because the first lookup already answers it, and `entityByName` returning zero
rows is a different observable from a match returning nulls. That distinction is
what lets abstention be a fact rather than a threshold.

## What the engine refused, and what changed because of it

These were found by probing a live node, not by reading documentation, and the
refusals are quoted in the source next to the code that works around them. The
raw probe rounds are in [artifacts/cypher-probe/](../artifacts/cypher-probe).

**Vertex upsert cannot carry a label in the `MERGE` pattern.** The working form
is `MERGE (n {id: row.id}) SET n:Label, n.prop = row.prop`, one `SET` label per
statement. So [`src/hydra/queries.ts`](../src/hydra/queries.ts) builds upserts
that way, under `UNWIND $rows AS row`, batched at 500 rows or 256KB whichever
comes first.

**`MERGE` executes only one-hop edge patterns.** There is no batched edge write.
This is the single largest cost in the system and it is visible in the ingest
timing: on the 2026-08-13 run, 5,642 vertices in 15 batched requests took 2.2
seconds; 5,705 edges, one request each, took 86.6 seconds. The design absorbed it rather than working
around it, because ingest is offline and read latency is what a judge measures.

**`RETURN` supports `<binding>.<property>` and `count(*)`, nothing else.** No
`RETURN n`, no expressions, no aggregates beyond the count. Every read above
returns flat scalar columns for that reason, and the decode layer in
`src/retrieval/decode.ts` reassembles objects client-side.

**`DELETE n` fails once a vertex has edges.** Reset uses `DETACH DELETE`.

**A label alone counts as a predicate in `MATCH`.** `MATCH (c:Claim)` is legal
where `MATCH (c)` with no constraint is not.

Designing against the real subset on day two rather than discovering it at
runtime on day five is the reason the query layer never had to be rewritten.

## What is not used

`algo.SPpaths` works. It was probed successfully against the live node in
rounds 1, 2 and 3, returning whole path values, and those transcripts are
committed. It is **not** on the answer path, and no shipped code calls it.

The reason is that shortest-path answers the question "how are these two nodes
connected", and Lacuna never has two known endpoints. A question arrives as a
subject and a predicate. The traversal starts at one node and walks outward to
find what is even relevant. Putting a path procedure on that path would have
been a graph-database feature used because it was available, which is the exact
failure this document exists to disprove.

The Bolt protocol is likewise probed and unused; the client speaks HTTP, which
keeps the token server-side and the wire format inspectable in the proof panel.

## Where the advantage actually is

Read [BENCHMARKS.md](BENCHMARKS.md) for the full run. The honest summary is that
the lead over the best baseline is one question: 64/64 against 63/64, with the
same zero unsupported answers on both. So the claim is not "the graph gets far
more answers right." It is narrower and it survives:

- **Context size.** Lacuna hands the reader 18 tokens. The closest baseline
  hands it 1,843, a 100.9x difference, because a similarity index cannot know
  which of its top-k chunks is the superseded one and has to pass all of them
  along.
- **Construction.** The closest configuration is `hybrid + a second retrieval
  round + a conflict-aware reader`, at a cut-off of 50. Remove the
  conflict-aware reader and it drops to 57/64 with six confidently wrong
  answers. Remove the second round and it drops to 48/64. Remove both, which is
  what an ordinary vector memory is, and it is 42/64 with six wrong. That
  configuration was not found by a baseline author, it was found by tuning
  against the answers, and the two components it needs are hand-built
  approximations of the two things the graph gives structurally: knowing what
  superseded what, and following one hop.
- **Provable abstention.** The baselines can decline. They cannot say which
  message they searched and did not find, because they never had a node to be
  absent.

Latency is 92.2ms for Lacuna against 3.9ms for the baseline, and that is not a
like-for-like comparison: the baselines run in-process over arrays and Lacuna
runs over HTTP to a real database. Reported, not defended.

## Reproducing any of this

A running node, then:

```bash
npm run ingest && npm run census
```

`census` counts what is in the graph and compares it to what the generator
planned, so it reports that the load is correct rather than that it finished.
Contract tests then execute every query builder in this document against that
node:

```bash
npx vitest run tests/contract
```

A missing node fails those tests rather than skipping them. The whole of it,
from a fresh clone, is [artifacts/repro/repro.sh](../artifacts/repro/README.md).
