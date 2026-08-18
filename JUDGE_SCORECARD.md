# Judge scorecard

The published criteria, and where in this repository a judge finds the evidence
for each. Status is what is true today, not what is planned.

Criteria are quoted from the rules page as captured on 2026-08-12 in
[artifacts/rules/](artifacts/rules/hackhydra-rules-2026-08-12.txt).

**Last updated: 2026-08-18.** Everything marked `done` below has a command in it
that a judge can run. One thing is not done and is not a row here because it is
submission mechanics rather than a judging criterion: the demo video. The
repository is public at <https://github.com/vaibhav4046/lacuna> and a hosted
copy answers from a recorded snapshot at <https://lacuna-five.vercel.app>; both
are tracked, with the video, in [docs/RULES_MATRIX.md](docs/RULES_MATRIX.md) and
[NEEDS_VAIBHAV.md](NEEDS_VAIBHAV.md).

## "A strong submission has"

| Requirement | Evidence | Status |
|---|---|---|
| A functional product or demo | `npm run serve`, then ask it something. The answer page is four panels: Answer, Timeline, Subgraph, Proof. Screenshots in [artifacts/screens/](artifacts/screens/README.md) | done |
| Real ingestion and retrieval workflows | 5,752 vertices and 5,908 edges written to a live node, idempotent on re-run, verified by `npm run census` against the generator's plan. Transcripts in [artifacts/ingest/](artifacts/ingest/README.md) | done |
| A clear use case | [README](README.md), [ADR 0001](docs/adr/0001-track-and-thesis.md) | done |
| A thoughtful technical implementation | [ADR 0002](docs/adr/0002-temporal-evidence-graph.md), [docs/HYDRADB_INTEGRATION.md](docs/HYDRADB_INTEGRATION.md), 893 unit tests plus 50 contract tests against a live node | done |

## "Judges consider"

### 01 Technical execution

- **Evidence:** three contract suites in [tests/contract/](tests/contract) run
  every query builder against a live HydraDB node, and a missing node fails them
  rather than skipping. 893 unit tests, 39 files, no database needed. The query
  layer was written against the Cypher subset the engine actually implements,
  discovered by probing it on day two; the refusals are quoted in the source
  beside the code that works around them.
- **Status:** done. `npm test` and `npm run test:contract`.

### 02 Use of HydraDB and graph-native approaches

This is the criterion the whole design is aimed at, and the one most projects
lose on by using a graph database as a place to put results.

- **Evidence:** the answer path is four graph reads and nothing else, set out in
  [docs/HYDRADB_INTEGRATION.md](docs/HYDRADB_INTEGRATION.md). Revision history is
  `SUPERSEDES` edges, not a version column, and the current value is the claim
  with nothing pointing at it. Provenance is a four-hop path fetched in one
  request, and that path is what the proof panel renders. A question needing a
  bridge entity is answered by a hop, not by a second search.
- **Status:** done.
- **Correction, recorded rather than quietly dropped:** an earlier version of
  this file claimed `algo.SPpaths` was on the answer path. It is not. The
  procedure works, was probed successfully against a live node, and those
  transcripts are committed, but no shipped query calls it: shortest-path needs
  two known endpoints and a question arrives with one. The traversal that ships
  is `MATCH (e {id: $e})<-[:ABOUT]-(c)-[:MENTIONS]->(o)` for the hop, and a
  bounded `[:SUPERSEDES*1..4]` walk for revision chains.

### 03 Product completeness and usability

- **Evidence:** a quickstart in the README that a judge can follow on a clean
  machine, and [artifacts/repro/repro.sh](artifacts/repro/README.md), which
  clones into a directory that has never held the project and proves the rest.
  Its transcript is committed unedited. The demo corpus is seeded, so the first
  run is not an empty box.
- **Status:** done. A hosted copy is public at
  <https://lacuna-five.vercel.app>; it answers from a recorded snapshot, which
  it states about itself on its own pages, because the live node runs locally.
  The full stack against a live node is the quickstart; the design record for
  the snapshot shape is D-065 in [DECISIONS.md](DECISIONS.md).

### 04 Quality of results

- **Evidence:** [docs/BENCHMARKS.md](docs/BENCHMARKS.md), over
  [artifacts/bench/report.txt](artifacts/bench/report.txt) and
  [artifacts/eval/report.txt](artifacts/eval/report.txt). 51 configurations
  across recency, lexical, vector, hybrid and hybrid-plus-hop retrieval, both
  reader modes, fixed seed, raw output committed.
- **Status:** done, and the lead is one question. Lacuna answers 64 of 64 and
  the best baseline configuration answers 63, both with zero unsupported
  answers. What separates them beyond that one question is 18 context tokens
  against 1,843, and the fact that the configuration coming closest is four
  hand-built components reproducing distinctions the graph holds structurally.
  Reported that way in the benchmark document because that is what the run
  said.

### 05 Originality

- **Evidence:** abstention that carries a reason and a proof. Five codes,
  `never_stated`, `retracted`, `contradicted`, `unconnected` and
  `out_of_scope`, each derived from graph structure rather than from a score
  below a threshold. Distinguishing "never known" from "known and withdrawn"
  from "known and disputed" is a structural distinction a similarity index
  cannot make, and the panel shows which one applied and what was searched.
- **Status:** done. The abstention decision is a pure function over the
  retrieved subgraph, in `src/retrieval/resolve.ts`, unit tested without a
  database.

## Best Use of HydraDB, judged separately

| What they are looking for | Where it shows up | Status |
|---|---|---|
| A particularly strong graph data model | [ADR 0002](docs/adr/0002-temporal-evidence-graph.md): bitemporal claims, immutable evidence spans, revision as a DAG. Loaded and verified by `npm run census` | done |
| A novel retrieval or reasoning approach | Five-code abstention derived from structure, with the traversal attached as proof | done |
| An interesting use of relationships, traversal or context | One hop for bridge questions, a bounded variable-length walk for revision chains, and a four-hop provenance pattern fetched in a single request | done |
| A use case hard to pull off with vector or relational approaches | The ablation in [docs/BENCHMARKS.md](docs/BENCHMARKS.md). A hand-built hybrid pipeline with a hop and a conflict-aware reader came within one question of Lacuna, and that is reported as the result it is, along with what it took to get there | done |

## The judge's ten minutes

1. `npm ci && npm test`. 893 tests at the last measured run, no database
   required. Seven error lines on stderr are error-path tests provoking failures
   on purpose; the counts underneath are the result, and the line that matters
   says every test passed and none were skipped.
2. Start a node, `npm run ingest && npm run census`. It ends
   `graph matches the plan exactly`.
3. `npm run serve`, then the Ask panel on a question whose answer was revised
   twice. Lacuna returns the current value and says what it replaced.
4. The same panel on a question the history never answered. It abstains with a
   reason code, and the proof shows what it searched.
5. The Proof panel: every statement in full, the parameters it was given, its
   row count and timing, and the read epoch the node reported, so a judge can
   run any line of it against their own node.
6. [docs/BENCHMARKS.md](docs/BENCHMARKS.md), which opens by saying the headline
   is a one-question lead.

In one command, against a fresh clone rather than the working copy:

```bash
artifacts/repro/repro.sh
```
