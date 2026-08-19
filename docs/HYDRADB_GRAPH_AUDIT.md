# Is HydraDB load bearing, or a key-value store with a graph story on it

This is the document for one question a judge will ask: *could this have been
Pinecone with timestamps?* It is written against the deployment, not the local
node, because the deployment is what the URL serves. Every claim below is either
a file and line in this repository or output from a read-only probe of the live
database, pasted as it came.

Read [HYDRADB_INTEGRATION.md](HYDRADB_INTEGRATION.md) first if you want the
self-hosted node. That document is accurate and it describes a path production
does not run. That gap is the first finding here.

## The short version

Three answers, in order of how uncomfortable they are.

1. **On the deployed site, an answer today depends on HydraDB as an addressed
   document store and on nothing graph-shaped in it.** The claim graph is
   flattened into one JSON record per entity at ingest, fetched by a hash of the
   name, and traversed by a loop in this repository. That read shape is
   `GET /context/inspect`, which any key-value store offers.
2. **HydraDB's own graph is real and it is not Lacuna's.** Handed the same
   transcripts, the service extracted its own typed entities and predicates and
   will traverse them for a question. That is a capability a vector store does
   not have, and until this audit the product read it in one place, as a list,
   on one screen.
3. **The two graphs disagree in exactly the way that makes Lacuna's argument.**
   Asked to walk `tenant-router`, the store returns the dependency the
   transcripts corrected and the correction that replaced it, side by side,
   marked identically. Deciding between them is not something the store does.

So the honest answer to the judge is: the store contributes more than a vector
database would, the product was not using that surface, and it is now using the
smallest piece of it that is true.

## Part 1: what an answer depends on today

### The deployed read path

[`api/index.ts`](../api/index.ts) is the whole deployment. It builds one client
from the environment and hands the router a source per request:

```ts
...(cloud === null ? {} : { source: (): CloudSource => new CloudSource(cloud) }),
```

`/api/ask` calls `askEnvelope` with that source
([`src/api/router.ts:436`](../src/api/router.ts)), which calls the resolver, which
reads through the seam in [`src/hydra/source.ts`](../src/hydra/source.ts). Four
reads exist on that seam: `entity`, `subject`, `evidence`, `dependents`.

[`src/hydra/cloud-source.ts`](../src/hydra/cloud-source.ts) implements all four,
and every one of them lands on the same call:

```ts
const source = await this.#cloud.inspect(id, timeoutMs);
```

`inspect` is `GET /context/inspect?database=&collection=&id=&mode=content`
([`src/hydra/cloud.ts:242`](../src/hydra/cloud.ts)). There is no second endpoint
on the answer path. Grep confirms it:

```
$ grep -rn "\.query(\|relations()" src api --include=*.ts
src/api/router.ts:388:          const relations = await this.#relations();
src/hydra/cloud.ts:324:        graph_context: true,
api/index.ts:122:    relations: async (...) => normaliseRelations(await cloud.relations(24)),
```

`cloud.query()` existed, asked for `graph_context: true`, and was called from
nowhere. That was true when this audit started.

### Where the graph work happens

The claim graph is built from the corpus annotations by
[`src/ingest/plan.ts`](../src/ingest/plan.ts), then denormalised into one record
per entity by [`src/hydra/cloud-graph.ts`](../src/hydra/cloud-graph.ts). Each
record carries that entity's claims, the claims naming it, and the citations
behind both. The file says so itself, at the top:

> So one record per entity, holding everything a question about that entity
> reads [...] A question costs one fetch, or two when it hops.

That is a deliberate, defensible design. It is also, precisely, a document store
keyed by a chosen id. `entityRecordId` is `sha256(name)` truncated to 32 hex
characters, so a read is a hash lookup.

Everything downstream is this repository's own code:

| Decision | Where it is made | What HydraDB contributed |
|---|---|---|
| Which claim is current | `src/retrieval/resolve.ts`, over `supersededBy` written at ingest | Storage of the array |
| Whether two claims disagree | `src/retrieval/resolve.ts` | Storage |
| Whether to abstain | `src/model/abstention.ts` | Storage |
| Which quotations to show | `evidence` map inside the record | Storage |
| The blast radius | `src/retrieval/blast.ts`, breadth-first in process | Storage |

### The blast radius, precisely

This is the crux, so it gets its own paragraph rather than a row in a table.

`blastRadius` ([`src/retrieval/blast.ts:206`](../src/retrieval/blast.ts)) walks a
frontier. At each depth it calls `source.dependents(id)` for every entity in the
frontier, filters the returned edges with `liveDependencyEdges`, and pushes the
survivors onto the next frontier. On the cloud source, `dependents` is a lookup
in the `#records` memo or one more `GET /context/inspect`. The edges it filters
are `DependentEdge` values that `buildCloudGraph` wrote into the record at
ingest, from Lacuna's own `MENTIONS` and `SUPERSEDES` planning.

**So the multi-hop answer uses Lacuna's ingested claim graph, traversed
client-side. It does not use a HydraDB-native relation, and it never has.** The
traversal is real and the citations under each hop are real; the graph is this
repository's, held in a store that fetched it back by id.

Two further facts belong here for completeness. The self-hosted node path
([`src/hydra/node-source.ts`](../src/hydra/node-source.ts)) is genuinely
graph-native: the same four reads become Cypher against
`/v1/graphs/{graph}/query`, and `MATCH (c:Claim)-[:ABOUT]->(e)` is a traversal
the engine performs. That path is exercised by the contract suite and is not
what the deployed URL runs. And on the deployment, `blastRadius` is not reachable
at all: the API surface is `/api/ask`, `/api/health`, `/api/session`,
`/api/auth/*`, `/api/demo/*` and `/api/workspace/*`, with no blast route. The
walk runs in the CLI, the local server at `/blast`
([`src/server/server.ts:377`](../src/server/server.ts)), the benchmark, and the
contract tests.

## Part 2: what HydraDB Cloud's graph APIs actually do

Probed read-only against the deployed database (`lacuna`, collection `backend`)
on 19 August 2026, through the existing client in `src/hydra/cloud.ts`. No
ingest, no reset, nothing written.

### `GET /context/relations`

Works. Returns source and target entity objects, each with `name`, `type`,
`namespace` and `entity_id`, and a nested list of relations carrying
`canonical_predicate`, `raw_predicate`, `context`, `confidence`,
`relationship_id` and `chunk_id`. One real entry, verbatim:

```json
{
  "source": { "name": "mobile team", "type": "ORGANIZATION", "namespace": "organizations", "entity_id": "667a5c5c..." },
  "target": { "name": "meridian", "type": "PROJECT", "namespace": "projects", "entity_id": "b2143520..." },
  "relations": [{
    "canonical_predicate": "asked about", "raw_predicate": "asked about",
    "context": "The Mobile team asked about Meridian, but there was nothing to report.",
    "confidence": 0.8, "temporal_details": null,
    "relationship_id": "4c4b9c73549192d788de3f6c1b31e304",
    "chunk_id": "lacuna:session:492233129672866_chunk_0002"
  }]
}
```

Measured: `relations(limit=5)` 489 ms; `relations(24)` 393, 159, 220 ms over
three calls; `relations(50)` 567 ms for 53 entries and 96 rows;
`relations(200)` 696 ms for 211 entries and 374 rows.

The predicate census at limit 200, real counts:

```
is an entity(72), contains claim(70), no movement(34), skipped(28),
waiting on review(26), will be picked up(25), status unchanged(22),
asked about(16), deferred(15), notes match(10), no update(10),
pending pickup(9), depends on(6), reviewed(5), ...
```

Two things follow. The store did extract `depends on`, which is the predicate
the product's hardest question turns on. And the head of that distribution is
standup chatter, because the corpus is mostly standup chatter by design.

Provenance census over the same 374 rows: 232 from session transcripts, 142 from
the Lacuna claim index record. So the store read the conversations, and it also
read the JSON records this product wrote and extracted relations back out of
them. Both are real; only the first is independent.

### `POST /query` with `graph_context: true`

Works, and returns a traversal rather than a list. `data.graph_context` carries
three blocks: `query_paths`, `chunk_relations`, `chunk_id_to_group_ids`. A path
looks like this, verbatim from the run:

```json
{
  "triplets": [{
    "source": { "entity_id": "2fa7d8ac...", "name": "dovetail", "namespace": "concepts", "type": "CONCEPT" },
    "relation": {
      "canonical_predicate": "status is", "raw_predicate": "status is",
      "context": "Dovetail is where it was, with no movement to record.",
      "relationship_id": "0acde68c704d9e95d9b8d7b7a93d2bc4",
      "chunk_id": "lacuna:session:1808120042183873_chunk_0001",
      "source_entity_id": "2fa7d8ac...", "target_entity_id": "44b333d6...",
      "temporal_details": null, "timestamp": 1787096135.23018
    },
    "target": { "entity_id": "44b333d6...", "name": "unchanged", "namespace": "concepts", "type": "CONCEPT" }
  }],
  "relevancy_score": 0.34045838764281433,
  "combined_context": "Dovetail is where it was, with no movement to record.",
  "group_id": "p_0"
}
```

What it can do:

- Return up to 30 paths per question, each with one or more triplets, so a path
  of two triplets is a two-hop walk the service performed.
- Type the entities. `PROJECT`, `PRODUCT`, `PERSON`, `ORGANIZATION`, `CONCEPT`,
  with a namespace beside each.
- Carry a stable `relationship_id` per edge and the `chunk_id` it was read out
  of, so every edge is traceable to a sentence.
- Sometimes carry `temporal_details` as an ISO timestamp. Fourteen of 42
  triplets on one question did; the rest were null.
- Answer nothing for an out of scope name. `nightjar-spindle` returned
  `paths=0, triplets=0` in 4937 ms, which is the right answer.

What it cannot do:

- **No supersession.** This is the important one, and it is shown in Part 3.
- **No confidence on this endpoint.** Zero of 42 triplets carried a numeric
  `confidence` field, against 0.8 on every row from `/context/relations`. Rows
  normalised from a walk therefore have `confidence: null`, and that is the
  service's shape rather than a value this code dropped.
- **No `temporal_facts`.** The client maps `data.temporal_facts`
  ([`src/hydra/cloud.ts:349`](../src/hydra/cloud.ts)) and the field came back
  `undefined` on every question tried, including an explicitly temporal one
  ("When did the launch date for Meridian change?").
- **No query language.** There is no Cypher, no path pattern, no filter by
  predicate. The traversal is driven by the question text, and what comes back
  is what similarity plus expansion reached.
- **Not fast.** Measured `query` with graph context: 4126, 3134, 4609, 4093,
  3993, 3068, 3268, 3080, 4835, 4155, 4000, 4937 ms. The deployed answer path,
  by comparison, returned in 167 ms and 336 ms on the two questions below. A
  graph walk on the answer path would make the product roughly twenty times
  slower.

## Part 3: the two graphs, on the same subject

The corpus revises exactly one dependency
([`src/corpus/threads.ts:73`](../src/corpus/threads.ts)):
`tenant-router` depended on `moss-index`, and a later message corrects it to
`hash-fence`.

Lacuna, live, on the deployed site:

```
$ curl -s -X POST https://lacuna-five.vercel.app/api/ask ... \
    -d '{"subject":"tenant-router","predicate":"depends_on"}'
{"status":"ANSWERED","answer":"hash-fence, token-forge",
 "evidence":[{"source":"Trust vendor review","meta":"USER · 2025-05-24T11:36:00.000Z","standing":"current"},
             {"source":"Data weekly sync","meta":"USER · 2025-05-12T11:12:00.000Z","standing":"current"}],
 "revisions":[3684946327674371],"conflicts":[],"abstain_reason":null,
 "source_state":"live","took_ms":336}
```

HydraDB's own graph, asked to walk the same subject:

```
   -> hash-fence   temporal=null
      chunk=lacuna:session:2805988192216546_chunk_0001
      context=The user corrected the notes for tenant-router, stating it now depends on hash-fence.
   -> moss-index   temporal=null
      chunk=lacuna:session:1808120042183873_chunk_0004
      context=tenant-router was on the list this week and it depends on moss-index.
   -> token-forge  temporal="2025-05-12T11:12:00.000Z"
      chunk=lacuna:entity:2a32f0731c464841ca6e70090ea9b718_chunk_0001
      context=The service tenant-router depends on token-forge.
```

The store reaches the correction and the thing it corrected, gives them the same
predicate, the same shape and no ordering, and hands both back. It even read the
sentence that says "corrected" and stored that word as free text in `context`
rather than as an edge. There is nothing in the response that would let a caller
prefer one.

That is the whole product in one comparison. HydraDB found the edges; Lacuna
knows which one is still true.

The same holds for a contradiction. Walking `tenant-router` returns both "The
on-call length for tenant-router was 14 days as of January 28, 2025" and "The
on-call length for tenant-router was updated to 7 days on January 30, 2025" as
peers.

## Part 4: what was implemented, and what was not

### Implemented

A read-only path where HydraDB's own traversal is what the product shows.

- [`src/hydra/relations.ts`](../src/hydra/relations.ts) grows
  `normaliseGraphContext`, which flattens `data.graph_context.query_paths` into
  the same row type the relations list already uses, keeping the service's
  `relationship_id`, predicate, source, target, confidence and the sentence each
  edge was read out of. Rows are deduplicated by relation id, because one edge is
  reached by many paths and the same id came back nine times in the raw response.
  `ServiceRelation` grows an `id` field, filled from `relationship_id` on both
  endpoints.
- [`src/api/router.ts`](../src/api/router.ts) serves `GET /api/demo/expansion`.
  It picks the subject from the inventory rather than from a constant: the
  subject of a `depends_on` claim the corpus superseded, so a regenerated corpus
  moves it. It calls the injected walk, and sets each returned edge beside the
  state Lacuna's claim graph holds for the same pair: `current`, `historical`,
  `contradicted`, `withdrawn`, or `unstated` where no claim joins them.
- [`api/index.ts`](../api/index.ts) injects the walk as
  `normaliseGraphContext(await cloud.query(subject, { maxResults: 6 }))`, beside
  the existing relations injection and behind the same `cloud === null` guard.
- [`web/src/app/routes/proof.tsx`](../web/src/app/routes/proof.tsx) renders it on
  the HydraDB screen, under the existing list.

Exercised end to end against the live database through the real router:

```
HTTP round trip 3574ms
available=true subject=tenant-router storeMs=3553
edges reached: 21
  [CURRENT]      tenant-router --depends on--> token-forge
  [HISTORICAL]   tenant-router --depends on--> moss-index
  [HISTORICAL]   tenant-router --depends on--> moss-index
  [UNSTATED]     tenant-router --queried by--> trust team
  [CONTRADICTED] tenant-router --has on-call rotation of--> 7 days
  [CURRENT]      tenant-router --depends on--> hash-fence
  [CONTRADICTED] tenant-router --has on-call length--> 14 days
  [CONTRADICTED] tenant-router --has on-call length--> 7 days
  ...
standing counts: current=6 historical=2 unstated=10 contradicted=3
```

Ten `unstated` rows are worth naming: those are relations HydraDB extracted from
prose that Lacuna's annotations never described. The store is not only storing
this product's graph, it is contributing edges the product does not have.

Unit tests are fixtures, no network:
[`tests/unit/relations.test.ts`](../tests/unit/relations.test.ts) pins the walk
shape trimmed from a real answer, including the replaced edge beside the live one;
[`tests/unit/demo-api.test.ts`](../tests/unit/demo-api.test.ts) drives the route
with a stubbed walk and checks the subject is derived, the standings are right,
the route refuses writes, and a store that throws produces `available: false`
with nothing of the error in the body.

### Deliberately not implemented

**HydraDB's graph does not feed retrieval, and should not.** Letting the walk
contribute edges to `blastRadius` would put `moss-index` back into a dependency
answer the corpus corrected, because the store returns it unmarked. It would also
add roughly 3.5 seconds to a 336 ms answer. Neither cost buys correctness. The
seam in `src/hydra/source.ts` is untouched and `src/retrieval/` has no new
imports.

**Nothing was changed to make the store look more graph-native than it is.** The
records are still denormalised at ingest, the answer path is still one
`GET /context/inspect` per entity, and this document says so.

## Part 5: the verdict

**Could this have been Pinecone with timestamps? No, but the reason is narrower
than the pitch implies, and until this audit the product was not showing it.**

Where a vector store would genuinely have failed:

- Addressed reads. The answer path fetches a record by a chosen id and gets the
  same bytes every time. A similarity search returns a ranked list, and a
  temporal resolver over a ranked list is not a resolver. HydraDB Cloud offers
  both and the product uses the right one for each.
- The store's own extraction. Handed raw transcripts, it produced typed
  entities, canonical predicates, per-edge provenance and a traversal API. Pinecone
  stores vectors and metadata; it does not read your prose and hand you
  `tenant-router --depends on--> hash-fence` with the sentence attached.
- The self-hosted node is a graph database and the product speaks Cypher to it.
  That path is real, tested, and is not what the deployment runs.

Where the honest answer is uncomfortable:

- On the deployed site, before this change, every answer used HydraDB as
  a key-value store. `GET /context/inspect` by hash is exactly what a document
  store does. The graph traversal that produced the answer ran in this process,
  over data this repository shaped.
- The claim graph is Lacuna's, built from annotations. HydraDB's extraction is a
  separate graph that was, until now, rendered on one screen as a list of 24
  rows and consulted by nothing.

What is true after this change: one screen shows the store performing a
traversal it was not asked to perform before, and every edge it reaches is set
against what the product's own resolver says about it. That is a small claim, and
it is a checkable one, which is the point.

## Reproducing this

The probes were throwaway scripts using the shipped client, deleted after the
run. To repeat them, build `HydraCloud` from `.env.cloud` and call:

```ts
await cloud.relations(200);
await cloud.query('What does tenant-router depend on?', { maxResults: 6 });
```

The deployed evidence is two commands and needs no credentials:

```bash
curl -s https://lacuna-five.vercel.app/api/health
curl -s https://lacuna-five.vercel.app/api/demo/relations
curl -s https://lacuna-five.vercel.app/api/demo/expansion
```
