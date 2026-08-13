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

  **On correctness it is a tie.** Real output, 2026-08-13:

  ```
  system                       correct    rate   false  unsup   abst F1   ctx tok   p50     p95
  lacuna                       60/60  100.0%      0      0   1.000       15   243.4   427.7
  hybrid+2hop@20 +conflict     60/60  100.0%      0      0   1.000      636     3.6     6.9
  lexical@20 +conflict         46/60   76.7%      0      0   0.889      513     1.0     1.3
  hybrid@20 +conflict          46/60   76.7%      0      0   0.889      524     3.5     4.2
  vector@50 +conflict          46/60   76.7%      0      0   0.889     1310     2.6     3.0
  recency@50 +conflict         44/60   73.3%      0      0   0.865     1087     0.2     0.4
  ```

  Same score, same zero unsupported answers, tied on all eight thread kinds. No
  claim of better recall or better abstention survives this run and none is
  made. What separates them is cost and construction: 15 estimated tokens of
  context per question against 636, 42.4 times fewer, and 243.4ms against 3.6ms,
  68.2 times slower. The latency column is not like for like and the report says
  so in its own text. Lacuna queries a HydraDB node over HTTP and pays a round
  trip per hop; every baseline runs in process against arrays already in memory
  and paid nothing for indexing, which happened before the clock started.

  It is also the only noisy column. The harness was run twice and Lacuna's p50
  came out at 188.1ms and then 243.4ms, a 51.0 and a 68.2 times ratio for the
  same code against the same graph. Every correctness column was identical
  between the two runs, down to the mean context tokens on all 51 rows. Treat
  the latency figure as an order of magnitude, not a measurement.

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

  What is not done here: nothing has been deployed. That is listed below.

- **Six captures exist of the running product, and taking them found a bug the
  suite did not.** Chromium under Playwright pointed at `http://127.0.0.1:3014`,
  that server reading the live node over HTTP. Home at 1920x1080 and 3840x2160,
  the revised answer at both extents, the multi-hop answer full page, and the
  never-stated answer. Every file, its URL and its viewport are in
  [artifacts/screens/](artifacts/screens/README.md).

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

  Real output from the committed run, 2026-08-13, against `ffbe274`:

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

## In progress

- Nothing.

## Not built yet

Everything else. Named explicitly so no reader has to guess:

- No CI
- No deployment. HydraDB runs in WSL2 on this machine and is not reachable from
  a hosted frontend, so this is an open question and not a task
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
