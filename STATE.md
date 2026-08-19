# State

What exists right now. Updated as things change, and never ahead of them.

**Last updated: 2026-08-19**

## Baseline reverified this run

Every gate below was rerun in this session at `v7-1-convergence`, working tree
clean. No count in this file is carried forward from an earlier run.

| Gate | Result |
| --- | --- |
| typecheck | exit 0 |
| unit | 1,189 of 1,189, 58 files |
| contract, live node | 77 of 77 |
| three surfaces, one store, 64 questions | `ALL_IDENTICAL: True` |
| two stores, 64 questions | `ALL_IDENTICAL: true` |
| census | graph matches the plan exactly |
| production web, demo, auth | 9 of 9, 30 of 30, 12 of 12 |
| three clients, one cloud workspace | `ONE_CONTEXT_IDENTICAL: true` |
| copy lint | 49 files, 0 findings |
| HydraDB Cloud health | ok |
| the store's own relations | 47 returned in 59ms |
| the store's own graph, walked for one subject | 21 edges, 6 current, 2 historical, 3 contradicted, 10 unstated |
| history 17k to 117k tokens | context handed to the answering step grew 1.00x, 64/64 at every size |
| 500 published LongMemEval instances | 0 parse failures, 0 ground truth leaks |
| Google sign in | redirect live, `openid email profile` |
| secrets in tracked files and in history | 0 and 0 |

**Claim extraction from raw prose was the largest disclosed weakness, and it now
exists.** `src/extract` turns a transcript into subjects, predicates, objects and
the quotation each came from, classifies every sentence as a statement, plan,
question or reported change, and files anything that is not a statement onto a
slot the resolver structurally cannot answer from. It runs live on
`/demo/memory`, where a reader can paste their own text, and it is what the
LongMemEval adapter ingests with.

The weakness that replaces it is narrower and is stated everywhere the old one
was. The extractor reads **eleven sentence frames covering seven properties, not
English**, so prose about anything else yields nothing rather than a guess, and
every response names what it can read so an empty result is a limit rather than
a mystery. And every measured number in this repository is still over a graph
built from annotations rather than from the extractor: the extraction path is
exercised end to end only by the LongMemEval integration, which
`docs/BENCHMARK_LONGMEMEVAL.md` bounds exactly.


## Built and verified

- **The terminal on the landing page is a recording, not a drawing.** It used
  to be a hand written block: a workspace called acme, a model called qwen2.5,
  a green CONNECTED dot, a trace id, and a list of thirteen commands of which
  six existed. `npm run capture:cli` runs the CLI against HydraDB Cloud and
  keeps every byte in
  [artifacts/cli/session.txt](artifacts/cli/session.txt); the page renders that
  file. Recording it found a real bug, below.
- **`lacuna status` reports the store the answers come from.** It used to load
  the node configuration directly rather than going through `openSource`, so on
  a machine with `LACUNA_PROFILE=cloud` it printed the loopback node's counts
  while every question in the same shell was answered by HydraDB Cloud. Fixed
  at the seam, with a regression test that needs no network.
- **The CLI prints the Lacuna mark.** Sampled from the same three arcs the SVG
  path holds, five rows interactive and nine when there is height for it.
  Suppressed when stdout is not a terminal, under `--json`, and when the
  terminal is too narrow. Snapshots at 40, 60, 80, 120 and 160 columns.
- **A phone can reach the navigation.** The five section links were
  `display:none` below 940px with nothing in their place. They are in a
  disclosure sheet now, no script, all targets 44px or taller, and the page
  carries no horizontal overflow at 360px where it used to carry nine pixels.
- **Every route was opened in a real browser and the console kept.**
  `npm run audit:routes` walks all 23 routes at a laptop and a phone viewport
  and records console errors, exceptions, failed requests, sideways scroll and
  whether anything was drawn. Its first run failed 18 of 23: every signed-in
  route scrolled sideways on a 375px screen. Fixed, and 46 of 46 now, against
  production. Evidence in
  [artifacts/route-audit/routes.json](artifacts/route-audit/routes.json).
- **It holds up under load.** 400 requests at concurrency 12 against the
  deployed endpoint: 26.3 a second, p95 805ms, zero failures, and every answer
  identical to the same question asked alone, so a run cannot get fast by
  returning something stale. Evidence in
  [artifacts/soak/soak.json](artifacts/soak/soak.json).
- **The boundaries are a test, not a habit.** `tests/unit/architecture.test.ts`
  fails if the web imports the resolver, if a surface opens its own store
  outside the seam, if a client re-decides which claim is current, or if any
  route names a gold answer. Both new guards were checked by breaking them.
- **The two hard questions are recorded.** `npm run proof` walks the graph for
  what a package change reaches, and asks an unsupported premise beside a real
  revision through three clients. 13 services at depth 3, both stores agreeing,
  one superseded dependency edge refused, three clients identical, two of three
  questions refused rather than guessed.
  Evidence in [artifacts/proof/proofs.json](artifacts/proof/proofs.json).
- **The deployed product answers questions.** HydraDB Cloud holds the corpus
  and the claim graph as 159 records; `ask()` reads them through a source seam
  that also serves the self-hosted node. `npm run parity:cloud` asks all 64
  gold questions of both stores and compares field by field:
  `ALL_IDENTICAL: true`, node 342 reads, cloud 119. Evidence in
  [artifacts/hydra/cloud-parity.json](artifacts/hydra/cloud-parity.json) and
  [artifacts/hydra/cloud-ingest.json](artifacts/hydra/cloud-ingest.json).
- **A stranger can watch it work.** https://lacuna-five.vercel.app/judge asks
  six questions on load and reaches six different outcomes, with no account,
  nothing recorded, and no branch keyed on the question. Measured on
  production at 108ms to 283ms a row.

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
  precision, recall and F1 all 1.000, at p50 191.2ms and p95 356ms across 276
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

- **The benchmark has been run, and it does not say what it was expected to
  say.** `src/bench/` builds four flat retrievers over the same corpus: recency,
  Okapi BM25 written out by hand, dense vectors from `Xenova/all-MiniLM-L6-v2`
  run locally through ONNX with no API key anywhere, and the two fused by
  reciprocal rank. A fifth configuration gives the hybrid retriever a second
  round through a named relation. Each runs at cut offs 3, 5, 10, 20 and 50, in
  both reader modes, for 51 configurations scored through the same
  `src/bench/score.ts` the evaluator uses. Whole run in
  [artifacts/bench/report.txt](artifacts/bench/report.txt), per question rows in
  `results.json`.

  **On correctness it is a tie.** Real output, 2026-08-15:

  ```
  system                       correct    rate   false  unsup   abst F1   ctx tok   p50     p95
  lacuna                       60/60  100.0%      0      0   1.000       15    80.3   160.4
  hybrid+2hop@20 +conflict     60/60  100.0%      0      0   1.000      636     3.7     7.1
  lexical@20 +conflict         46/60   76.7%      0      0   0.889      513     1.0     1.3
  hybrid@20 +conflict          46/60   76.7%      0      0   0.889      524     3.6     4.2
  vector@50 +conflict          46/60   76.7%      0      0   0.889     1310     2.8     3.6
  recency@50 +conflict         44/60   73.3%      0      0   0.865     1087     0.2     0.5
  ```

  Same score, same zero unsupported answers, tied on all eight thread kinds. No
  claim of better recall or better abstention survives this run and none is
  made. What separates them is cost and construction: 15 estimated tokens of
  context per question against 636, 42.2 times fewer, and 80.3ms against 3.7ms,
  21.8 times slower. The latency column is not like for like and the report says
  so in its own text. Lacuna queries a HydraDB node over HTTP and pays a round
  trip per hop; every baseline runs in process against arrays already in memory
  and paid nothing for indexing, which happened before the clock started.

  It is also the only noisy column. The harness has been run three times and
  Lacuna's p50 came out at 188.1ms, then 243.4ms, then 80.3ms for the same code
  against the same graph, a three-fold spread; the third run came after the WSL
  network relay carrying loopback traffic to the node had been restarted, which
  is the suspected but unproven reason it is the fastest. Every correctness
  column was identical across all three runs, down to the mean context tokens
  on all 51 rows. Treat the latency figure as an order of magnitude, not a
  measurement.

  The tying baseline is four hand built parts, and removing any one of them
  breaks it:

  ```
  without the conflict aware reader  hybrid+2hop@20           54/60, 6 false answers
  without the second retrieval round hybrid@20 +conflict      46/60
  without both                       hybrid@20                40/60, 6 false answers
  ```

  No single round configuration of any retriever gets past 46/60. The three
  rules that reader applies are the three distinctions the graph holds
  structurally: a correction supersedes, a withdrawal removes, and a hop landing
  on a silent entity is a gap rather than an absence. That is the defensible
  claim, and it is narrower than the one the first sweep appeared to support.

  It appeared to support 60 against 54. Every one of those six was `unconnected`,
  and every one was the baseline abstaining with `never_stated` rather than
  answering wrongly. The baseline had reached that subject by following a
  relation itself, so it held the same hop signal Lacuna tests, and was simply
  never given the branch to say so. It was given the branch, the run was
  repeated, and the gap closed to nothing. Both runs, the diagnosis and the
  surviving claims are in [D-039](DECISIONS.md).

- **The benchmark harness now has unit tests, which it did not when the numbers
  above were published.** `src/bench/` was the last source directory without
  them. It was exercised end to end by its own run and by the evaluator sharing
  its scorer, and that is not the same thing: a harness that is wrong in a quiet
  way still prints a table. 129 cases across seven files, plus shared fixtures.

  The ones that carry weight are the ones the published tie depends on.
  `bench-score` pins which failures are counted separately and what abstention
  precision and recall are measured over, including the deliberate choice to
  count an abstention with the wrong reason as a true positive. `bench-systems`
  asserts the second retrieval round is a real one and that context is charged
  for both rounds deduped, because leaving either out would hand the comparison
  to Lacuna by construction. `bench-embed` covers what has to miss in the vector
  cache, including the `\0` separator that stops two different text lists
  hashing to the same key. The rest cover the index, BM25, the reader and the
  four retrievers.

  Two things changed in source rather than in tests. `percentile` computed rank
  zero at p0 and read position -1, handing back `undefined` typed as a number;
  it is clamped at both ends now, and since the harness only ever asks for p50
  and p95 no reported figure moves. And the contract suite's hook timeout went
  to 60s, measured rather than guessed: the setup and teardown delete their
  fixture one vertex at a time over HTTP, which is quick against the empty graph
  a judge would clone into and takes 52.79s against this machine's graph holding
  the full corpus. The same file at `--hookTimeout=120000` passed 7 of 7 before
  the config was touched, which is what established it was slow and not hung.

  Real output, 2026-08-13, node up:

  ```
  > tsc --noEmit
  TYPECHECK_EXIT=0

  > vitest run tests/unit/bench
   Test Files  7 passed (7)
        Tests  129 passed (129)
     Duration  2.38s
  BENCH_UNIT_EXIT=0

  > vitest run
   Test Files  24 passed (24)
        Tests  411 passed (411)
     Duration  49.10s
  TESTALL_EXIT=0
  ```

  `lacunaSystem` is the one thing in that directory the unit suite does not
  cover. It needs a live HydraDB connection, so it is exercised by the contract
  tests and by the harness run itself, and the file says so where a reader will
  find it rather than only here.

- **The four screens exist and are served.** `src/view/` is eleven files and
  `src/server/` is three, 2,362 lines between them: the home page with the
  corpus counts and one link per question kind, the answer page carrying the
  conclusion, and the three panels under it, Timeline, Graph and Proof. Eight
  fixed notice pages cover every way a request can fail. `npm run serve` starts
  it.

  **The build ships no JavaScript at all.** No bundle, no tag, no inline
  handler, and a `script-src 'none'` in the header saying so. The question form
  is a GET form and the panels are anchors, so there is nothing to hydrate and
  nothing to go wrong between the graph and the screen. The full policy is
  `default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self';
  form-action 'self'; base-uri 'none'; frame-ancestors 'none'`. See
  [D-041](DECISIONS.md).

  Every panel is rendered from one read. `Answer` extends `SubgraphView`, so the
  timeline, the hop and the conclusion all come out of the same fetch and cannot
  disagree with each other, which a second request from the page would have
  allowed. See [D-043](DECISIONS.md).

  The HTTP surface is deliberately small: GET and HEAD only with a 405 and an
  `Allow` header for anything else, `127.0.0.1` by default, a 1,024-character
  URL cap, a 200-character cap per term, a 10s query timeout, and 120 requests
  per minute per source address applied before routing so the stylesheet counts
  too. The access log prints method, path, status and duration and stops at the
  `?`, because the query string is what the visitor typed and the console is
  going to be on screen. No notice page repeats a submitted value back.
  [D-044](DECISIONS.md) and [D-045](DECISIONS.md).

  `tests/unit/server-routes.test.ts` drives the whole surface over a real
  loopback socket with only the transport faked, so the real client, the real
  decoders and the real error hierarchy all run: 16 cases covering the two
  static assets, the four input rejections, a real out-of-scope answer in
  exactly one query, the log line, the rate limit, and the 502 and 500 paths.
  The two error lines the run prints are that last pair working. It asserts the
  bearer token and the node's base URL appear on no page, and that the namespace
  does.

  Real output, 2026-08-13:

  ```
  > tsc --noEmit
  TYPECHECK_EXIT=0

  > vitest run tests/unit
   Test Files  26 passed (26)
        Tests  437 passed (437)
     Duration  9.43s
  UNIT_EXIT=0
  ```

  What was not done in this era: nothing had been deployed. That changed on
  2026-08-14, when a recorded-snapshot copy went public; it has its own entry
  further down. The page set has since grown past these four: the three
  evidence pages, the nav and the voice surface each have their own entry
  further down, and the dark theme described in this era became the only theme
  when the frozen design was adopted.

- **Twelve captures exist of the running product, taken and checked by one
  command, and taking them found a bug the suite did not.** `npm run screens`
  drives headless Chrome over the DevTools Protocol against
  `http://127.0.0.1:3014`, that server reading the live node over HTTP. Home at
  1920x1080, 3840x2160, 375x812 and in the dark theme, the benchmark page at
  both extents, the database and interface pages full page, and three answers:
  revised at both extents, multi-hop full page, never-stated. Each PNG is read
  back off disk afterwards and checked for exact size, correct theme and enough
  compressed density to rule out a blank rectangle, so the run fails rather than
  quietly writing a wrong image. Every file, its URL, its viewport and its theme
  are in [artifacts/screens/](artifacts/screens/README.md). See
  [D-052](DECISIONS.md).

  The multi-hop proof panel printed `448.4000000000003 ms inside the client`.
  Eight reads, each already rounded to a tenth of a millisecond by the retrieval
  layer, summed into a float and printed sixteen significant figures on the one
  panel whose argument is that its figures are measurements. Rounding moved to
  `ms()` in `src/view/format.ts`, the overlap comparison moved with it, and
  `tests/unit/view-format.test.ts` now sums eight readings copied off a live
  page. See [D-047](DECISIONS.md).

  The same pass cleared the console error every page load was printing,
  `Content Security Policy directive 'frame-ancestors' is ignored when delivered
  via a <meta> element`. The header and the meta mirror now come from one private
  array, the mirror filters out the one directive it cannot carry, and the test
  asserts the difference between the two rather than their two values. See
  [D-046](DECISIONS.md).

  This set has since been retaken: the design adoption entry below records the
  current thirteen captures, taken on one ground with the voice page among
  them.

  Real output, 2026-08-13, after both fixes:

  ```
  > tsc --noEmit
  TYPECHECK_EXIT=0

  > vitest run tests/unit
   Test Files  26 passed (26)
        Tests  442 passed (442)
   TESTALL_EXIT=0
  ```

- **The README carries the six commands it was claiming to, and
  [SECURITY.md](SECURITY.md) carries results instead of placeholders.** The
  README said "if a claim here is not backed by a command you can run, it is a
  bug in the README" while containing no commands, which made that sentence the
  first thing a judge could disprove. It now has a quickstart from a clean
  machine, and it flags the error lines in the test run as error-path tests
  rather than leaving a reader to wonder.

  The history scan ran rather than being promised: every blob reachable from
  every ref, 26 commits and 229 blobs, on 2026-08-13. No `.env`, `.env.*` or
  `auth-token` file was ever added on any ref. Zero hits for seven vendor key
  shapes. Zero hex runs 44 to 63 characters long, which is the band the node's
  48-character token would land in. The blob list is sanity-checked against a
  known object before anything is scanned, because the first attempt enumerated
  nothing and reported zero hits, and a scan that saw no blobs is
  indistinguishable from a clean one.

  Paths were checked separately, since a home directory in a committed
  transcript leaks a username even when it leaks no secret. No tracked file
  holds one. The absolute paths that do appear are `/opt/hydradb` and
  `/var/lib/lacuna/hydradb`, both from `scripts/hydra-node.sh`.

  `npm audit` is recorded both ways, because the two numbers differ:

  ```
  npm audit --omit=dev   exit 0   found 0 vulnerabilities
  npm audit              exit 1   4 high severity vulnerabilities
  ```

  The four are `adm-zip` and `sharp`, both **No fix available**, both reached
  only through the devDependency `@huggingface/transformers` behind one dynamic
  `import()` in `src/bench/embed.ts`, which is baseline code the benchmark
  measures against. `npm ci --omit=dev` does not install them and the server
  never imports them. Reported rather than buried: they are real advisories, and
  what makes them tolerable is where they sit, not how severe they are.

- **Two threats are now exercised by suites rather than described.** T1,
  prompt injection through stored content, and T4, namespace isolation.

  `tests/unit/security-injection.test.ts` runs 8 payloads against 12 resolver
  scenarios, 96 cases. Two payloads are written against this system's own
  vocabulary, naming `SUPERSEDES` and the abstention reasons, because generic
  "ignore previous instructions" text is a weak test against code that was never
  listening. Each case asserts three things: that the payload actually reached
  the output, that the decision is identical to its uninjected twin, and that
  stripping the payload makes the two results equal. A 97th test asserts the 12
  scenarios reach all five abstention reasons and three answers, so a fixture
  that quietly took a different branch cannot leave the suite claiming coverage
  it does not have. 16 more render each payload through the real page, once as a
  stored claim and once as the question itself, and assert `<script`, `</script`,
  `onmouseover="` and `<!--` never appear. 113 tests in that file.

  `tests/unit/security-namespace.test.ts` sends 10 hostile headers, including
  both casings of `X-Graph-Namespace`, a chosen `Authorization` and a cookie, on
  8 question shapes that try to carry a foreign tenant in a field that is read: a
  subject shaped like a graph scope, a predicate shaped like a header, path
  traversal, a `namespace=` parameter, a repeated parameter in case the last one
  wins somewhere. Every outgoing request still carries the configured namespace
  and the configured URL. One test asserts the header set is closed rather than
  merely free of the hostile names, since a header this server does not send
  today cannot be enumerated by a test written today. One asserts the namespace
  is absent from the request body. Three cover a 403 from the node being
  surfaced as a failure rather than rendered as an answer, with neither
  namespace, the engine message, nor the token reaching the page. 13 tests.

  Real output, 2026-08-13:

  ```
  > vitest run tests/unit/security-injection.test.ts tests/unit/security-namespace.test.ts

  request failed: HydraQueryError: HydraDB returned 403: principal bearer principal is not authorized to read graph scope tenant-b/graphs/default
  request failed: HydraQueryError: HydraDB returned 403: principal bearer principal is not authorized to read graph scope tenant-b/graphs/default
  request failed: HydraQueryError: HydraDB returned 403: principal bearer principal is not authorized to read graph scope tenant-b/graphs/default

   Test Files  2 passed (2)
        Tests  126 passed (126)
     Duration  1.60s
  SEC_EXIT=0
  ```

  Those three lines are the refusal tests working. `tenant-b` is a fixture name
  and not a namespace on anybody's node.

- **The whole thing has been reproduced from a clean clone, twice.**
  `artifacts/repro/repro.sh` clones into a temporary directory that has never
  held this project, installs from the lockfile, typechecks, runs the unit
  suite, then starts the server from the clone and asks the live node all four
  demo questions. It refuses to report success for a step it did not run: with
  no `.env.local` it stops after step 4 and says so, rather than printing a pass
  for the HydraDB steps. It also refuses to run against a port it did not open,
  which is [D-048](DECISIONS.md), because a reproduction that quietly answered
  from the development server would prove nothing about the clone.

  The transcript is committed unedited at
  [artifacts/repro/](artifacts/repro/README.md). It was re-run and replaced
  wholesale rather than corrected in place: the first one said 442 tests, and so
  did the README in three places, while the suite had grown to 568 across 28
  files. Editing a recorded transcript would have turned evidence of a run into
  a description of one that never happened.

  Real output from the committed run, 2026-08-13, against `ffbe274`, which is
  `bac9d9d` since the identity rewrite in D-050:

  ```
  === 3. typecheck ===
  TYPECHECK_EXIT=0

  === 4. unit tests ===
   Test Files  28 passed (28)
        Tests  568 passed (568)
  UNIT_EXIT=0

  === 8. server request log ===
  GET / 200 1ms
  GET /ask 200 190ms
  GET /ask 200 227ms
  GET /ask 200 137ms
  GET /ask 200 291ms
  ```

  The step 4 error-line note needed rewriting for a subtler reason than the
  count. It named the two specific lines a reader would see, but a full run now
  prints five and step 4 prints `tail -8`, so which of them land in the window
  depends on the order the test files happened to finish in. Naming two would
  have asserted an ordering nothing guarantees.

  **Re-run against the tip, 2026-08-13, and kept alongside rather than
  replacing.** Eleven commits had landed since `ffbe274`, all documentation, and
  "all documentation" is a claim rather than a check. `4de1a65` clones at 40
  commits and 162 tracked files, installs, typechecks, passes 568 across 28
  files, and answers all four demo questions HTTP 200 against the live node from
  the clone. Source, tests and the lockfile are byte for byte identical between
  the two commits; the one non-markdown difference is an `eval` script alias in
  `package.json` that no step of the run touches. The second transcript is at
  [artifacts/repro/clean-clone-4de1a65.txt](artifacts/repro/clean-clone-4de1a65.txt).
  Both hashes predate the identity rewrite in D-050 and no longer resolve:
  `ffbe274` is now `bac9d9d` and `4de1a65` is now `2954b15`. The transcripts keep
  what they printed.

  The two runs disagree on latency by four to six times, 190ms against 1167ms on
  the same first question, and no cause was established. It is not the code,
  because there is no code difference, and it is not the graph, because both ran
  against the same node. Written down rather than smoothed over, and consistent
  with the benchmark's own two runs at p50 188.1ms and 243.4ms. Every
  correctness figure matched.

- **The three documents a judge actually opens exist, and writing them found six
  claims in this repository that were false.** [JUDGE_SCORECARD.md](JUDGE_SCORECARD.md)
  maps every published criterion to a command,
  [docs/HYDRADB_INTEGRATION.md](docs/HYDRADB_INTEGRATION.md) names the four reads
  on the answer path and what the engine refused, and
  [docs/BENCHMARKS.md](docs/BENCHMARKS.md) opens by saying the headline is a tie.

  The six, found by grepping for the code rather than trusting the prose:
  `algo.SPpaths` is not on the answer path, it was probed and no shipped query
  calls it; the answer path is four graph reads, not six; contradiction is
  derived from two current claims disagreeing, not read off a `CONTRADICTS`
  edge; two baseline configurations tie at 60/60, not one; there is no `CONFIRMS`
  edge and no next-best-action on an abstention, both of which the rules matrix
  claimed; and the unit suite prints five deliberate error lines, not two.

  `docs/BENCHMARKS.md` also told the reader to run `npm run eval`, which was not
  a script. Adding it and running it produced a fresh
  [artifacts/eval/report.txt](artifacts/eval/report.txt): counts unchanged at
  60/60 exact with abstention precision, recall and F1 all 1.000, and latency
  p50 158.7ms against the 191.2ms in the previous committed report. Wall clock
  on a loopback hop moves that much between runs on a laptop. Both documents
  quote the new run rather than the old numbers.

- **The threat model's status markers were checked one at a time against the
  code, and six had drifted.** All six understated: controls that had shipped
  and were under test still said `planned`. One had the file contradicting
  itself, with T1 marking escaped rendering `tested` while T6 called the same
  mitigation `planned`. Two more described controls for surfaces this system does
  not have, an ingest upload endpoint and a path procedure that is deliberately
  off the answer path, and became `not applicable`, which is why that marker now
  exists.

  Exactly one `planned` remains, at the CI dependency audit, and it stays that
  way on purpose. A command run by hand on one machine on one day is not the
  control that runs on every push, and pretending otherwise is the drift this
  document exists to catch. A stale `planned` is a smaller error than a false
  `tested`, but it is the same kind of error, and only one of the two gets caught
  by people looking for overclaiming.

- **Three evidence pages exist, are linked, and cost the node nothing.**
  `/bench`, `/hydradb` and `/interface`, rendered at startup from the committed
  artifacts rather than from anything typed into the views. The benchmark page
  states the tie and wins on context size, and its tests assert the tie is real
  and the "slowest here" caption is earned by the numbers rather than granted by
  the copy. The database page prints its Cypher by calling the same functions
  the retriever calls, so it cannot describe a query the product does not run,
  and it names GraphBLAS only to say that claim is not made. The interface page
  is rendered in tests with limits no server configures, which is the only way
  to tell a printed argument from a printed constant. A nav rendered from one
  list of routes links every page and marks the current one with
  `aria-current`; skip link ahead of it, still no client JavaScript anywhere.
  Reloading any of the three sends the node nothing, so a judge re-reading the
  evidence cannot spend the demo's query budget. See [D-051](DECISIONS.md).

- **The ingest pre-write check was wrong in a way only the live engine could
  show, and is fixed.** The read-back before a write exists to refuse a 52-bit
  id collision before it overwrites someone else's node. It counted rows, and
  on HydraDB the unlabelled id pattern addresses a vertex slot rather than a
  stored node: ask it about an id nothing has ever written and it answers one
  row carrying that id and a null key. So row count on that form never means
  "present", and the check was throwing a collision on the first id of every
  ingest into an empty graph. Both read shapes stay — a labelled scan and an
  indexed id read — and `isPresent` is told which one it is reading rather than
  guessing, because the null means an overwrite candidate in one and an empty
  slot in the other. Ten query forms were measured against the live graph to
  settle the shape and the threshold; the table is in [D-053](DECISIONS.md).

- **The voice surface is an executable state machine, and it holds no
  microphone.** `/voice` renders fourteen states and sixteen events from the
  transition table in `src/voice/states.ts`, with `?state=` selecting which one
  you are looking at and junk falling back to the running state rather than
  404ing. This build runs in `text_only` and all fourteen pages print that, so
  no state can be read as a claim the build reaches it. The pipeline is four
  stages and two are absent: speech to text and text to speech are
  `NOT_STARTED`, their timing column reads `UNAVAILABLE`, and
  `tests/unit/view-voice.test.ts` asserts no number appears anywhere on any of
  the fourteen renders, so the design's 120 ms cannot creep back in through a
  later edit. The named stack is local — Silero VAD, whisper.cpp, Kokoro-82M,
  optionally Qwen through Ollama — and none of it is installed, which the page
  also says; the metered fallbacks are listed as `BLOCKED` or `NOT_STARTED` so
  the absence is on the record. The page ships no script, and walking all
  fourteen states makes zero upstream calls, asserted over the real socket.
  What this is not: a working voice interface. [D-055](DECISIONS.md) and
  [D-056](DECISIONS.md).

- **The frozen design is adopted, and the capture set is thirteen.**
  `src/view/style.ts` now commits to the ground in `design/reference/tokens.css`:
  black paper, charcoal surfaces raised off it, four steps of white so
  hierarchy is carried by weight of ink, borders as white at low alpha, and one
  orange that only ever means something. Geist is named first because the
  design names it, falling through to the system stack, so there is still
  nothing to fetch and no font host in the policy. The page serves one ground:
  the `prefers-color-scheme` block is gone from the served stylesheet, checked
  by grep against what ships, and a capture taken preferring light came back
  byte identical to the one preferring dark, 315,100 bytes each, which is
  positive evidence rather than an assertion that nothing happened. The screens
  set was regrown to thirteen by `npm run screens` against the adopted design,
  the voice page now among them, and every PNG is still read back and checked
  before the run may exit zero. [D-059](DECISIONS.md) reverses
  [D-057](DECISIONS.md) and records what the adoption cost. The screens
  README's proof-panel figures were also corrected to what the committed pixels
  say, 344.9 ms and 417.5 ms, in the same sweep as [D-062](DECISIONS.md).

- **The command line exists, and it is the same answer path.** `bin/lacuna.js`,
  no build step, six commands: `doctor`, `status`, `ask`, `explain`,
  `timeline`, `bench`. `doctor` runs six checks one line each, including a real
  query reported with its latency and read epoch, and exits with the code of
  the first failing check so a script can tell a node that needs starting from
  a token that needs correcting. The token is reported as `set` or `missing`
  and never as its value, in `--json` too. `--json` caps evidence at fifty
  items and carries the true count in `evidenceTotal`, which is what the MCP
  surface already did and is now shared behaviour rather than coincidence.
  [docs/CLI.md](docs/CLI.md).

- **The MCP server exists: four read-only tools over two transports, both
  driven.** `lacuna_ask`, `lacuna_explain`, `lacuna_timeline` and
  `lacuna_health`, with no tool that writes, resets or deletes. stdio is the
  primary transport; Streamable HTTP is mounted at `/mcp`, stateless, loopback,
  port 3015 by default, POST only. Every result comes back as pretty JSON and
  as `structuredContent`, and each tool advertises an `outputSchema` the SDK
  client validates against on every successful call. The envelope is built in
  `src/contract/result.ts`, the one module both non-browser surfaces project
  from, so the MCP result and the CLI's `--json` cannot drift apart without the
  shared file changing. [docs/MCP.md](docs/MCP.md) and [D-060](DECISIONS.md).

- **All three surfaces return the same value, checked by one command.**
  `npm run parity` spawns the MCP server over stdio, connects to the same
  server again over its HTTP transport with the SDK's own client — a real
  listener, a real initialize handshake — and runs the command line in its own
  process, then compares status, answer, reason code, claim id, superseded
  claims, evidence, evidence total, source state and the set of reads with
  their parameters and row counts across all three. What it deliberately does
  not compare is the order of the independent reads, which is the order the
  node finished them in and varies between runs of the same command on one
  surface; the artifact prints the raw orders next to the verdict so the
  exclusion is visible rather than assumed. The two MCP surfaces share one tool
  implementation, so the HTTP leg proves the transport end to end, not the
  substance of the answer twice. [D-060](DECISIONS.md) and
  [D-062](DECISIONS.md).

  Real output, 2026-08-14, node up, excerpted; the full transcripts, exit codes
  and the exact tree they ran against are in
  [artifacts/verification/2026-08-14c/](artifacts/verification/2026-08-14c/README.md):

  ```
  CASE: answered (Bellwether / beta_partner)
    stdio status=answered claimId=797564529472318 reasonCode=null queries=4
    http  status=answered claimId=797564529472318 reasonCode=null queries=4
    cli   status=answered claimId=797564529472318 reasonCode=null queries=4
    IDENTICAL: True
  CASE: abstained (Meridian / migration_window)
    stdio status=abstained claimId=null reasonCode=never_stated queries=3
    http  status=abstained claimId=null reasonCode=never_stated queries=3
    cli   status=abstained claimId=null reasonCode=never_stated queries=3
    IDENTICAL: True
  ALL_IDENTICAL: True
  PARITY_EXIT=0

  > vitest run tests/unit
   Test Files  36 passed (36)
        Tests  807 passed (807)
     Duration  26.06s
  UNIT_EXIT=0
  ```

  The suites behind those totals now cover the surfaces themselves: the CLI,
  the MCP tools, the voice renders and the claims ledger below all sit inside
  the 807.

  The check has since grown past those two questions. The day's fourth run
  sweeps all sixty gold questions from the evaluation through the same three
  surfaces, one stdio session serving every call, and ends
  `SWEEP_IDENTICAL: 60 of 60` before `ALL_IDENTICAL: True`; the excerpt above
  is the third run's, kept because it shows the full per-case shape. The
  sweep's first run ended 45 of 60 and every mismatch was in its own
  comparison, which sorted reads by query text alone and let equal-text reads
  keep timing-dependent arrival order — a latent bug the two-question check
  had been passing on luck. The fix, the audit of all fifteen false flags and
  the full transcript are in
  [artifacts/verification/2026-08-14d/](artifacts/verification/2026-08-14d/README.md),
  and the decision record is [D-063](DECISIONS.md).

  The day's fifth run put a client from outside this repository on the other
  end. The MCP Inspector's CLI, `@modelcontextprotocol/inspector` at `2.2.0`,
  consumed the exact `mcpServers` config block `docs/MCP.md` documents, spawned
  the server through it, listed the tools and called `lacuna_ask` three ways —
  answered, abstained, and multi-hop with `--via` — plus `lacuna_health` over
  stdio, then listed and called again over Streamable HTTP. The two
  `tools/list` responses are byte-identical across transports and the values
  match the sweep's. What that run does not prove, and says so, is an editor
  or agent runtime: the inspector is a client, not a host, and no interactive
  host has held a session with this server. Transcripts, the consumed config
  file and exit codes are in
  [artifacts/verification/2026-08-14e/](artifacts/verification/2026-08-14e/README.md),
  and the decision record is [D-064](DECISIONS.md).

- **Every public claim is in a ledger, and the ledger is tested.**
  [docs/CLAIMS.json](docs/CLAIMS.json) holds 25 claims, each carrying the
  capability state and the data state behind it, the measured figures, the
  evidence paths on disk, the command that reproduces it and the caveat it must
  travel with. The two state vocabularies are defined once in
  `src/model/capability.ts` and are the same ones the voice page renders, so a
  state name cannot mean one thing in the ledger and another on a page.
  `tests/unit/claims.test.ts` checks the schema, the vocabulary, and that every
  cited evidence path exists in the repository; it does not check the values,
  and says so, because a test that read the artifacts back would be a second
  evaluation pretending to be a lint. [docs/EVIDENCE_INDEX.md](docs/EVIDENCE_INDEX.md)
  maps each claim to the artifact and the run that produced it, pinned to the
  commit named in its header, with the one row from a later run annotated as
  such in prose rather than left for a reader to notice.

- **A copy of the product is public at <https://lacuna-five.vercel.app>, and
  it answers from a recorded snapshot rather than pretending to host a node.**
  Every route runs through one serverless function, `api/index.ts`, a thin
  adapter over the same routing the local server uses. The answers are replies
  the live node produced at export time, stored byte for byte by
  `npm run snapshot` into
  [artifacts/snapshot/graph-snapshot.json](artifacts/snapshot/graph-snapshot.json)
  and decoded in production by the same client code the live server uses. The
  home page discloses the replay in a full sentence and every answer page
  marks its reads as replayed, so the caveat travels with the page rather than
  living only here. `npm run serve:snapshot` runs the identical thing locally
  with no database and no token, and `npm run snapshot:verify` replays all
  sixty gold questions against the stored replies: 60 questions, 0 answer
  mismatches, 0 wrong verdicts. Getting the function to boot took rewriting
  483 relative imports across 119 files to carry explicit `.js` extensions,
  chosen over bundling so the deployed source stays inspectable; the trade is
  recorded in [D-065](DECISIONS.md). Measured from outside on 2026-08-14:
  every route 200, unknown paths 404, `POST /ask` 405, the CSP and nosniff
  headers character-identical to the local server's, and one question of each
  kind returning its recorded answer. The unedited transcripts are in
  [artifacts/verification/2026-08-14f/](artifacts/verification/2026-08-14f/README.md).
  What this is not: a live node. No writes happen at the URL and no token is
  present there; the durability limit below is unchanged.
- The 2026-08-16 tokens amendment applied to the served stylesheet on
  2026-08-17 (`ec3602e`): every radius to 0 and motion split into two tiers,
  a decelerate micro curve for colour/border/background and ease-out quint at
  160ms for spatial movement, matching the measurements logged at the foot of
  [design/reference/tokens.css](design/reference/tokens.css). Verified on the
  running server by computed style: all four radius variables resolve to `0`,
  0 of 141 elements carry any border-radius, both curves live. Typecheck
  clean, 816/816 unit tests pass after the change.

- **The approved design is the served one, and the capture harness now refuses
  a dead server.** The 2026-08-16 orange palette was rejected by the owner;
  `src/view/style.ts` now serves the system recorded as the 2026-08-17
  amendment in [design/reference/tokens.css](design/reference/tokens.css):
  pure void ground, four steps of white ink, interaction violet `#8052ff`,
  evidence amber `#ffb829` on the figures arguments turn on, absence in calm
  grey rather than a warning colour, Space Grotesk and JetBrains Mono named
  first with nothing fetched. [D-079](DECISIONS.md). All thirteen captures
  retaken and checked against the running product. Taking them found the
  harness's blind spot: against a dead server, Chrome's own dark
  connection-error page passed twelve of thirteen checks at identical 21,883
  bytes each. `npm run screens` now probes the target before capturing and
  fails with "Start it first" when nothing answers, verified in both
  directions — dead port exit 1, live server thirteen for thirteen.
  [D-080](DECISIONS.md). Full gate on 2026-08-17: typecheck 0, unit 816/816,
  contract 42/42, screens 13/13.

- **The corpus now carries a package topology, and the blast radius is walked
  rather than looked up.** Added 2026-08-18: repositories, services and shared
  packages with transitive dependency edges, a dependency that was revised
  mid-history, and four gold questions that ask what a package change reaches.
  `blastRadius()` answers them by starting at the package, reading its
  dependents from the graph and repeating to a depth cap of six, returning each
  affected service with the path and the claim that carried every hop. Nothing
  about that walk is stored: `tests/unit/ground-truth-isolation.test.ts` proves
  the query path imports no module holding an expected answer, that no
  production source names one, and that ingestion plans a byte-identical graph
  when every expected answer in the corpus is replaced with the string `JUNK`.
  [D-081](DECISIONS.md), and the short version is the README's
  [Demo data](README.md#demo-data) section.

- **The full gate on 2026-08-18, against the corpus that ships.** Typecheck 0.
  Unit 893 of 893 across 39 files, contract 50 of 50 across 3. Ingest and census
  end `graph matches the plan exactly` at 72 sessions, 5,246 messages, 174
  claims, 86 entities. `npm run eval` scores 64 of 64 exact, every thread kind
  at 100%, abstention F1 1.000 with 32 true positives and no false ones, p50
  114.1ms. `npm run bench` puts Lacuna at 64 of 64 on 18 estimated context
  tokens against 63 of 64 on 1,843 for the best of 51 baseline configurations,
  and the one question that separates them is a blast radius. `npm run snapshot`
  recorded 519 replies and `npm run snapshot:verify` replayed all sixty-four
  with 0 answer mismatches and 0 wrong verdicts. `npm run parity` ends
  `SWEEP_IDENTICAL: 64 of 64` and `ALL_IDENTICAL: True` across stdio, HTTP and
  the CLI; transcript in
  [artifacts/verification/2026-08-18/](artifacts/verification/2026-08-18/README.md).
  `npm run screens` took 14 captures, all checked, the new one being the blast
  page at full height so the query trace is in the photograph.

## In progress

- Nothing.

## Not built yet

Everything else. Named explicitly so no reader has to guess:

- No CI. Decided, not skipped: [DECISIONS.md](DECISIONS.md) D-049. GitHub's
  runners have no HydraDB, so a green workflow would cover every test that
  needs no database and exclude the 42 that carry the integration claim, which is
  a badge whose coverage is the opposite of what the README promises
- No hosted live node. The public URL above is a recorded replay; HydraDB
  itself runs in WSL2 on this machine, is not reachable from a hosted
  frontend, and the graph store's write-durability limit makes a long-lived
  hosted node dishonest to offer today
- No demo video recorded. The script is written and checked against the running
  product, at [docs/VIDEO_SCRIPT.md](docs/VIDEO_SCRIPT.md). Recording is the
  owner's, and it is item 3 in [NEEDS_VAIBHAV.md](NEEDS_VAIBHAV.md)
- Nothing submitted. The repository stopped being the blocker on 2026-08-13:
  it is public, it holds the code, and it has been live at
  <https://github.com/vaibhav4046/lacuna> since the day-one tip `033c1a8`;
  every commit since is pushed to the same place. Getting there took two
  attempts.
  `gh repo create` succeeded and `git push` was then rejected with `GH007`,
  because every commit carried an address GitHub is configured to keep private.
  The exit taken was not the account setting. Every other public repository on
  this account already commits under the `users.noreply.github.com` address, so
  publishing the personal one here would have created a new and permanent
  exposure that existed for no reason except this hackathon. The identity was
  rewritten across all 42 commits instead, with the commit count, every author
  and committer date, the messages and the tip's tree hash all verified identical
  on both sides, and the whole operation written up in D-050 of
  [DECISIONS.md](DECISIONS.md). GitHub now reports exactly one author address on
  the repository, the noreply one. What is still missing is the form and the
  video. The form answers are drafted at
  [docs/SUBMISSION.md](docs/SUBMISSION.md), and with the repository live the
  video link is the last blank field

## Known environment deviations

Five, recorded because reproducibility depends on them.

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
followed the store to its new path unchanged. When this was first recorded,
writes, reads, restart and the contract suite were all unaffected. That
sentence stopped being true on 2026-08-14: the wedged-store entry below is the
same refused operation surfacing on the write path instead of in the
collector's log.

**The store can wedge: writes start answering 500 while reads keep working,
and the only recovery found is a fresh store.** It has happened three times:
twice on 2026-08-14, once on 2026-08-17. The symptom from the client is
`500: internal query execution error` on every write, with reads still
answering correctly, which makes it easy to misread as a bug in whatever
write you happened to be running — the first diagnosis here blamed bookmark
chaining and was wrong, recorded as such in [D-054](DECISIONS.md). The
engine's own log has the cause, at `WARN` level:

```
HTTP suppressed internal graph error
```

with the underlying error naming the same unimplemented operation as the
collector noise above: `` object store error: Operation `put_opts` with mode
`PutMode::Update` not yet implemented by
LocalFileSystem(file:///var/lib/lacuna/hydradb/store). `` No write-side fix
exists in this project, and `npm run reset` cannot clear it either — the
third occurrence proved deletes 500 the same way, because a delete is a
write. The remedy is: stop the node, move the store directory aside, start
against the fresh path, `npm run ingest`. About a minute of wall clock (the
third re-ingest wrote 5,642 vertices and 5,705 edges in 60.0s), after which
the contract suite passed in full, 42 tests across 3 files. All three failed
stores are kept beside the live one as `store.wedged-20260814`,
`store.wedged-20260814b` and `store.wedged-20260817` so the failure is
inspectable rather than only described. [D-058](DECISIONS.md). This is the one
known way the demo can die mid-run, which is why it is also an operational
item in [NEEDS_VAIBHAV.md](NEEDS_VAIBHAV.md): check writes before recording,
not during.

**Restarting WSL can leave the Windows-side port relay half-alive: TCP
connects, query traffic hangs.** After a WSL restart the relay on `18443` will
accept a connection and then say nothing, so a liveness check that only
connects reports a healthy node that cannot answer. Readiness is therefore
only meaningful as `curl http://127.0.0.1:19091/readyz` — the admin port —
because `18443` answers 404 for that path even when healthy. Recovery order
matters: stop the node inside WSL first, then `wsl --shutdown`, then start the
node again. Shutting WSL down around a running node is how the relay gets into
this state. [D-061](DECISIONS.md).

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
  demo. It says nothing about query latency, which the benchmark has since
  measured separately at 188.1ms and then 243.4ms p50 per question over HTTP,
  hops included. Bolt remains the fallback if a later phase needs edge writes
  to be faster, and it is already verified working against the same node.

- Whether a paged read is a snapshot. `read_epoch` cannot be pinned by the
  client, so a multi-page read cannot be forced to see one consistent state, and
  whether the server holds one behind the cursor was not established. Untested
  because the test is not deterministic on a graph this small. Lacuna's reads are
  bounded and mostly fit one page, so this is a question to answer before any
  claim about consistency, not a blocker.

## Needs the owner

See [NEEDS_VAIBHAV.md](NEEDS_VAIBHAV.md). Nothing there blocks the build today.
