# Judge scorecard

The published criteria, and where in this repository a judge finds the evidence
for each. Status is what is true today, not what is planned.

Criteria are quoted from the rules page as captured on 2026-08-12 in
[artifacts/rules/](artifacts/rules/hackhydra-rules-2026-08-12.txt).

**Last updated: 2026-08-12.** Every row is currently `pending`, because no
application code exists yet. That is the honest state of a repository on day one.

## "A strong submission has"

| Requirement | Evidence | Status |
|---|---|---|
| A functional product or demo | Ask, Timeline, Evidence Graph and HydraDB Proof screens, run locally | pending |
| Real ingestion and retrieval workflows | Ingestion pipeline and query planner, exercised end to end by tests | pending |
| A clear use case | [README](README.md), [ADR 0001](docs/adr/0001-track-and-thesis.md) | done |
| A thoughtful technical implementation | [ADR 0002](docs/adr/0002-temporal-evidence-graph.md) and the adapter contract tests | in progress |

## "Judges consider"

### 01 Technical execution

- **Evidence:** tests that run against a live HydraDB node rather than a mock;
  ingestion idempotence proved by re-ingesting and diffing; the query planner
  written against the documented Cypher subset instead of discovering its limits
  at runtime.
- **Status:** pending.

### 02 Use of HydraDB and graph-native approaches

This is the criterion the whole design is aimed at, and the one most projects
lose on by using a graph database as a place to put results.

- **Evidence:** the answer path is a traversal. Revision history is
  `SUPERSEDES` edges, not a version column. Multi-hop questions are resolved by
  bounded variable-length patterns and `algo.SPpaths`, and the returned proof is
  the traversal itself. An ablation shows what the same questions do without the
  graph.
- **Status:** pending.

### 03 Product completeness and usability

- **Evidence:** a README a judge can follow on a clean machine; four screens that
  each answer a question a developer would actually ask; a seeded demo state so
  the first run is not empty.
- **Status:** pending.

### 04 Quality of results

- **Evidence:** abstention precision, recall and F1, false-answer rate, p50 and
  p95 latency, context tokens, measured against recency-only, lexical, vector and
  hybrid baselines. Harness in the repository, raw output committed, seeds fixed.
- **Status:** pending. No number will appear anywhere in this repository before
  the run that produced it is committed.

### 05 Originality

- **Evidence:** proof-carrying abstention with structured reason codes. Most
  memory systems return a low similarity score and let the caller guess.
  Distinguishing "never known" from "known and superseded" from "contradicted and
  unresolved" is a structural distinction a similarity index cannot make.
- **Status:** in progress. The idea is recorded in
  [ADR 0001](docs/adr/0001-track-and-thesis.md); the implementation is not built.

## Best Use of HydraDB, judged separately

| What they are looking for | Where it shows up | Status |
|---|---|---|
| A particularly strong graph data model | [ADR 0002](docs/adr/0002-temporal-evidence-graph.md): bitemporal claims, immutable evidence spans, revision as a DAG | in progress |
| A novel retrieval or reasoning approach | Abstention derived from graph structure, with a reason code and a proof | pending |
| An interesting use of relationships, traversal or context | Bounded multi-hop traversal and path procedures on the answer path | pending |
| A use case hard to pull off with vector or relational approaches | The ablation. If a vector baseline matches Lacuna, that gets reported as the result it is | pending |

## The judge's ten minutes

If a judge has ten minutes, this is the intended order:

1. `README.md`, run the quickstart, see it work.
2. The Ask screen: a question whose answer was revised twice. Lacuna returns the
   current value and shows what it replaced.
3. The Ask screen again: a question the history never answered. Lacuna abstains
   with a reason code, and the proof shows what it searched.
4. The HydraDB Proof panel: the actual Cypher, the actual traversal, the read
   epoch and bookmark from the real response.
5. `docs/BENCHMARKS.md` and the committed raw output.

Steps 1 to 5 do not exist yet. When they do, this line goes away.
