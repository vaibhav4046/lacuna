# State

What exists right now. Updated as things change, and never ahead of them.

**Last updated: 2026-08-13**

## Built and verified

- Repository initialised 2026-08-12. No code, assets or history imported from
  anywhere.
- Hackathon rules captured verbatim to
  [artifacts/rules/](artifacts/rules/hackhydra-rules-2026-08-12.txt) and mapped
  requirement by requirement in [docs/RULES_MATRIX.md](docs/RULES_MATRIX.md).
- Upstream HydraDB documentation read at pinned commit
  `02a40025d2d57e97ab2754c8256219cdbfeab379`, with what was read and what it
  settled recorded in [docs/SOURCE_LOG.md](docs/SOURCE_LOG.md).
- Track, thesis and data model decided and written up as ADRs
  [0001](docs/adr/0001-track-and-thesis.md) and
  [0002](docs/adr/0002-temporal-evidence-graph.md).
- Ubuntu 24.04 provisioned under WSL2 with HydraDB's native dependencies.
  Verified present: `libcypher-parser 0.6.2`, `libgraphblas.so.7.4.0`,
  Rust stable, `just 1.58.0`.
- HydraDB cloned at the pinned commit and `just native-check` passes.
- HydraDB built from source and running locally. Upstream `AGENTS.md` steps 3
  through 8 all executed, with the real output committed to
  [artifacts/hydradb/](artifacts/hydradb/README.md):
  - `just smoke` printed `graph object-store smoke passed at epoch 10`
  - `scripts/runtime_smoke.sh` printed `runtime-smoke-ok`
  - the node serves `/readyz` and reports `graph_runtime_ready 1`
  - a write over HTTP came back over HTTP as exactly one row,
    `{"type":"vertex_id","value":2}`, at `read_epoch` 1
  - the same fact read back over Bolt with the Neo4j Python driver 6.2.0,
    printing `{'id': 2}`

  Both transports work against the same node. This is the upstream pass
  condition, not a port check.

- The Cypher subset probed with 162 executed queries across six rounds, with
  every request and response committed to
  [artifacts/cypher-probe/](artifacts/cypher-probe/README.md). Round three ends
  34 of 34 passing, and its reads assert on exact row values rather than on the
  query being accepted. Every construct ADR 0002 depends on either works or has
  a working substitute that was also executed. Three statements in that ADR
  turned out to be wrong about the running engine and are corrected in its
  amendment, with the original text left visible.

- The wire encodings the client has to decode, settled in round four. Top-level
  row values are tagged `{"type": ..., "value": ...}` in snake case; node
  properties inside a `path` value are tagged differently, capitalised, as
  `{"String": ...}` and `{"Integer": ...}`. The adapter needs both decoders, and
  that is now a known requirement rather than a bug waiting to happen.

- Nine access and resource controls executed against the running node rather than
  asserted, listed with their status codes and the engine's own messages in
  [SECURITY.md](SECURITY.md) and mapped to threats T2, T4, T5 and T9 in
  [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). Wrong token 401, absent token
  401, foreign namespace 403, absent namespace header 400, two statements in one
  request refused, `timeout_ms: 1` enforced at 408 in 4.2ms, `page_size` bounding
  the result, cursors refusing to act as capabilities, bookmarks refusing to
  cross a namespace.

- Round four also produced the most useful failure so far. It concluded from one
  refused request that HydraDB could not page. Round five showed the request was
  malformed, not the engine: cursors are scoped to a `query_id` that the client
  has to send. The wrong conclusion never reached the threat model, and both the
  mistake and the correction are kept in the evidence directory rather than
  tidied away.

- Round six settled the last two questions the client's shape depended on, once
  there was a client to shape. A `MERGE` edge pattern takes its endpoints as
  parameters, proven by reading the edge back through a separate statement, so
  no id is ever concatenated into query text. And a 43-character client-minted
  `query_id` is accepted, echoed unchanged, and scopes a followable cursor.

- **The HydraDB client adapter exists and is executed against the real engine.**
  `src/hydra/` holds config loading, an injection boundary for identifiers, a
  statement builder, both value decoders, the typed error hierarchy, the HTTP
  client and the query builders. Two suites:

  - `npm test` runs 84 unit cases across 6 files against an injected fake
    transport, asserting on the exact request bytes and on every decode and
    guard path
  - `npm run test:contract` runs 13 cases against the live node with nothing
    mocked, and fails rather than skips when no node answers. Both halves
    executed with the node stopped: unit 84 passed and exit 0, contract
    `Test Files 1 failed (1)` on `ECONNREFUSED 127.0.0.1:18443` and exit 1.
    Output and one misleading line in it are in [D-015](DECISIONS.md)

  Real output, captured 2026-08-12, contract run twice back to back against the
  same persistent store:

  ```
  > tsc --noEmit
  TYPECHECK_EXIT=0

  > vitest run tests/unit
   Test Files  6 passed (6)
        Tests  84 passed (84)
     Duration  1.71s
  UNIT_EXIT=0

  > vitest run tests/contract
   Test Files  1 passed (1)
        Tests  13 passed (13)
     Start at  22:47:52
     Duration  915ms
  CONTRACT_EXIT=0

  > vitest run tests/contract
   Test Files  1 passed (1)
        Tests  13 passed (13)
     Start at  22:48:03
     Duration  884ms
  CONTRACT_RERUN_EXIT=0
  ```

  The second run is the point of the second run: the suite writes to the graph,
  so it seeds every id it will write up front and asserts counts against that
  fixed set. Idempotence is demonstrated rather than asserted.

- **The node runs from a persistent directory and survives a restart.** It lives
  at `/var/lib/lacuna/hydradb`, started and stopped by
  [scripts/hydra-node.sh](scripts/hydra-node.sh), which is upstream's step 7
  with three paths moved and the `rm -rf` removed. See
  [D-010](DECISIONS.md). The store from the probe rounds was copied out of
  `/tmp/sgk-local` rather than recreated, and checked rather than trusted:

  ```
  src_files=116 dst_files=116
  src_bytes=87986 dst_bytes=87986
  CHECKSUMS=identical (116 files)
  ```

  Then stopped and started again to prove the point of the exercise:

  ```
  stopped pid 1615 after 1s
  --- PORTS AFTER STOP ---
  (no listeners)
  --- START AGAIN ---
  ready after 1s, pid 1711
  ```

  and the graph read back over HTTP on the far side of that restart, the three
  `:Claim` vertices from rounds one to three and the round six edge:

  ```
  200 {"query_id":"restart-1","columns":["id"],"rows":[[{"type":"vertex_id","value":2000000000001}],[{"type":"vertex_id","value":2000000000002}],[{"type":"vertex_id","value":2000000000003}]],"read_epoch":99,...}
  200 {"query_id":"restart-2","columns":["tag"],"rows":[[{"type":"string","value":"b"}]],"read_epoch":99,...}
  ```

  ```
  > vitest run tests/contract
   Test Files  1 passed (1)
        Tests  13 passed (13)
     Start at  22:59:57
     Duration  941ms
  CONTRACT_POST_RESTART_EXIT=0
  ```

  The node's auth token is now 48 random hex characters minted by the script
  into `/var/lib/lacuna/hydradb/auth-token`, not upstream's documented
  placeholder. The placeholder answers `401 unauthenticated` here.

- **The demo corpus exists, is generated from a seed, and has been measured.**
  `src/corpus/` builds the whole history deterministically: `mulberry32`, no
  `Math.random`, no `Date.now`, a fixed epoch. The gold questions come out of the
  same pass that plans the claims. Real output, 2026-08-13:

  ```
  corpus stats: {"sessions":72,"messages":5268,"claims":118,"characters":469578,"estimatedTokens":117395}
  ```

  Roughly 117k estimated tokens across 72 sessions, which is the point: the
  history does not fit in one model context, so a system that answers correctly
  had to retrieve rather than read everything. The first generation came out at
  48 sessions and 78,072 estimated tokens, which was not enough to stand behind
  that claim, so the session count went up and the run was repeated. See
  [D-016](DECISIONS.md).

  All five abstention reasons are carried by the structure of the data rather
  than by the wording of the questions, and the properties the evaluation depends
  on are executed rather than asserted. `unconnected` and `multi_hop` are the
  same question with a different subject substituted in, checked by stripping the
  subject out of both and comparing. The `multi_hop` answer never appears in any
  message that names the service it is reached through. `never_stated` pairs have
  zero claims while both halves are used heavily elsewhere. Out of scope names
  appear in no message at all. Every evidence span slices back to its exact
  quote, and every correction is positioned and timestamped after what it
  corrects.

  ```
  > tsc --noEmit
  TYPECHECK_EXIT=0

  > vitest run
   Test Files  9 passed (9)
        Tests  135 passed (135)
     Duration  4.74s
  TESTALL_EXIT=0
  ```

  135 cases at that point: 84 adapter unit, 27 corpus, 11 id, 13 contract
  against the live node. The ingest layer below has since taken it to 185.

- **The corpus is in HydraDB, and what is in there has been counted.**
  `src/ingest/` splits in two: `plan.ts` turns a corpus into an `IngestPlan` and
  touches no network at all, `run.ts` does verify, then vertices, then edges.
  Ids are the first 52 bits of a SHA-256 over the canonical key, every node
  stores that key as a property, and the run refuses before writing anything if
  a planned id already holds a different one. Three scripts drive it,
  `npm run ingest`, `npm run reset -- --yes` and `npm run census`, and the
  mechanics and the reasons are in [docs/INGEST.md](docs/INGEST.md).

  5,642 vertices in 15 batches and 5,705 edges, written to the running node
  twice over. Every run's unedited output is in
  [artifacts/ingest/](artifacts/ingest/README.md):

  ```
  wrote   5642 vertices in 15 batches, 5705 edges
  already 0 planned ids were in the graph before this run
  timing  verify 183.1ms, vertices 2.2s, edges 86.6s, total 89.0s
  ```

  ```
  wrote   5642 vertices in 15 batches, 5705 edges
  already 5642 planned ids were in the graph before this run
  timing  verify 7.9s, vertices 5.2s, edges 67.3s, total 80.3s
  ```

  `already 5642` on the second run is every planned id found in the graph
  holding the key that run derived for it. Then the census counts the graph
  itself, diffs it against the plan, reads every stored key back and exits
  non-zero on any disagreement. It printed `graph matches the plan exactly`
  after both runs, byte for byte the same output. Two runs, one graph, measured
  from the graph rather than from the writer.

  The census earned its place on first use. It found eleven nodes with
  round-numbered ids and no key at all, left over from the hand-run shape probes
  behind ADR 0002 and from the `restart-1` probe quoted above. `MERGE` adds and
  never reconciles, so no amount of re-ingesting would have removed them, and
  they would have reached retrieval as records with nothing to cite. The
  transcript is in
  [artifacts/ingest/](artifacts/ingest/README.md#the-eleven-extra-nodes).

  Real output, 2026-08-13, with the node up:

  ```
  > tsc --noEmit
  TYPECHECK_EXIT=0

  > vitest run tests/unit
   Test Files  10 passed (10)
        Tests  165 passed (165)
     Duration  4.44s
  UNIT_EXIT=0

  > vitest run tests/contract
   Test Files  2 passed (2)
        Tests  20 passed (20)
     Duration  28.85s
  CONTRACT_EXIT=0

  > vitest run
   Test Files  12 passed (12)
        Tests  185 passed (185)
     Duration  32.82s
  TESTALL_EXIT=0
  ```

  The ingest layer contributes 39 of the unit cases across `ingest-plan` and
  `ingest-run`, and 7 of the contract cases, which ingest a fixture corpus twice
  against the live node and diff the counts rather than trusting the report.

- **Retrieval and abstention exist, and answer the sixty gold questions against
  the live graph.** `src/retrieval/` is eight files: the question structure and
  its parser, the read query builders, the row decoders, the fetcher, the
  decision procedure, the typed errors, the shared types and the entry point.
  `scripts/ask.ts` asks one question and prints the whole path it took.
  `scripts/evaluate.ts` asks all sixty and writes its raw output to
  [artifacts/eval/](artifacts/eval/report.txt).

  The decision procedure is ordered and returns at the first thing that settles
  the question, with every step appended to a trace the screens will print rather
  than reconstruct. The order is in [D-029](DECISIONS.md). The parser reads the
  question text and nothing else, which is what makes the `multi_hop` and
  `unconnected` scores mean anything: both questions parse identically and only
  the graph separates them, asserted in a unit test and again against the live
  node. See [D-026](DECISIONS.md).

  Real output, 2026-08-13, node up, unedited in
  [artifacts/eval/test-run-2026-08-13.txt](artifacts/eval/test-run-2026-08-13.txt):

  ```
  > tsc --noEmit
  TYPECHECK_EXIT=0

  > vitest run tests/unit
   Test Files  14 passed (14)
        Tests  242 passed (242)
     Duration  5.37s
  UNIT_EXIT=0

  > vitest run tests/contract
   Test Files  3 passed (3)
        Tests  40 passed (40)
     Duration  37.20s
  CONTRACT_EXIT=0

  > vitest run
   Test Files  17 passed (17)
        Tests  282 passed (282)
     Duration  44.42s
  TESTALL_EXIT=0
  ```

  Retrieval contributes 77 of the unit cases across four files and 20 of the
  contract cases. The contract suite fails rather than skips when the node is
  empty, because an empty graph returns `out_of_scope` for everything, which
  would turn every abstention case green for the wrong reason.

  The full sweep scores 60 of 60 with zero unsupported answers and abstention
  precision, recall and F1 all 1.000, at p50 145.3ms and p95 284.9ms across 276
  queries. **That number is a correctness check on the pipeline and nothing
  more.** The corpus is generated and the graph is built from the same
  annotations the questions are scored against, so a perfect score says revision,
  retraction and disagreement survive ingestion and are still distinguishable
  afterwards. It is not evidence that this beats anything. The script prints that
  caveat into the report itself so the number cannot travel without it. See
  [D-032](DECISIONS.md).

  One contract assertion was written wrong and failed against the live node: it
  claimed all three absence reasons quote nothing, and `unconnected` quotes the
  hop it took. The behaviour is right and the test was corrected rather than the
  code, with the reasoning in [D-030](DECISIONS.md).

## In progress

- Nothing. Retrieval and abstention were the open item and they are finished.
  The four screens are next, and no line of any of them exists yet.

## Not built yet

Everything else. Named explicitly so no reader has to guess:

- No application code above the adapter, the ingest layer and retrieval
- No user interface
- No CI
- No benchmark harness, and therefore no numbers of any kind
- No screenshots
- No deployment
- No demo video

## Known environment deviations

Three, recorded because reproducibility depends on them.

**`just` shebang recipes fail under WSL2.** `just 1.58.0` writes shebang recipe
scripts into `$XDG_RUNTIME_DIR/just/`, and WSL mounts `/run/user/0` as tmpfs with
`noexec`. Every shebang recipe therefore dies with:

```
error: recipe `native-check` with shebang `#!/usr/bin/env bash` execution error: Permission denied (os error 13)
```

Confirmed with `strace`: the `execve` of `/run/user/0/just/just-*/native-check`
returns `EACCES`. It is neither a HydraDB bug nor a missing dependency. Handled
without modifying any recipe, by unsetting `XDG_RUNTIME_DIR` or passing
`just --tempdir`, both of which were tested.

**`/tmp` is cleaned under this distro.** `/tmp/sgk-venv` and `/tmp/sgk-env.sh`,
created during step 5, were gone by the time step 8 ran roughly fifteen minutes
later. This is not a surprise so much as a confirmation: upstream already says
the `/tmp/sgk-*` paths are disposable and that anything meant to be kept belongs
elsewhere. The consequence for this project is concrete, so it is written down
rather than remembered. Handled: Lacuna's HydraDB data directory is
`/var/lib/lacuna/hydradb`, the store was moved there with checksums rather than
recreated, and the node has since been stopped and restarted with the graph
intact. See [D-010](DECISIONS.md) and the persistent-node entry above.

**SlateDB's garbage collector logs an error every minute against a local object
store, and it is not ours.** Twice per collection cycle, at `ERROR` level, from
`slatedb::garbage_collector` line 399:

```
error collecting garbage [resource=Manifest, error=ObjectStoreError(NotImplemented { operation: "`put_opts` with mode `PutMode::Update`", implementer: "LocalFileSystem(file:///var/lib/lacuna/hydradb/store)" })]
```

`resource=Compactions` produces the same thing. It is SlateDB refusing a
conditional put against the `LocalFileSystem` backend, which is the backend
`CLOUD_PROVIDER=local` selects, so it fires on the upstream recipe as well and
followed the store to its new path unchanged. Writes, reads, restart and the
contract suite are all unaffected. Recorded here so nobody spends an evening
debugging Lacuna over a line HydraDB prints on its own.

## Open questions

- ~~Whether the supported Cypher subset expresses every query
  [ADR 0002](docs/adr/0002-temporal-evidence-graph.md) assumes.~~ **Settled
  2026-08-12** by executing all of them. It does, with two changes to how, not
  to what: edges are written one statement each because `UNWIND` upserts
  vertices only, and the "is this claim current" check projects the superseder's
  id instead of counting, because `count(<binding>)` does not parse. Evidence in
  [artifacts/cypher-probe/](artifacts/cypher-probe/README.md).

- ~~Whether one HTTP round trip per edge is fast enough at demo corpus size.~~
  **Measured 2026-08-13.** 5,705 edges through a pool of 8 took 86.6s into an
  empty graph and 67.3s into a full one, and two earlier runs against the same
  node took 62.2s and 47.7s. That is fine for a one-off setup step and it is the
  reason the whole ingest is one command rather than something done live in a
  demo. It says nothing about query latency, which is what the benchmark will
  measure. Bolt remains the fallback if a later phase needs edge writes to be
  faster, and it is already verified working against the same node.

- Whether a paged read is a snapshot. `read_epoch` cannot be pinned by the
  client, so a multi-page read cannot be forced to see one consistent state, and
  whether the server holds one behind the cursor was not established. Untested
  because the test is not deterministic on a graph this small. Lacuna's reads are
  bounded and mostly fit one page, so this is a question to answer before any
  claim about consistency, not a blocker.

## Needs the owner

See [NEEDS_VAIBHAV.md](NEEDS_VAIBHAV.md). Nothing there blocks the build today.
