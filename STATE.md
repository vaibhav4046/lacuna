# State

What exists right now. Updated as things change, and never ahead of them.

**Last updated: 2026-08-12**

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
    mocked, and fails rather than skips when no node answers

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

## In progress

- Nothing. The adapter was the open item and it is finished.

## Not built yet

Everything else. Named explicitly so no reader has to guess:

- No application code above the HydraDB adapter
- No ingestion pipeline
- No demo corpus
- No retrieval or abstention logic
- No user interface
- No CI
- No benchmark harness, and therefore no numbers of any kind
- No screenshots
- No deployment
- No demo video

## Known environment deviations

Two, recorded because reproducibility depends on them.

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
rather than remembered. Lacuna's own HydraDB data directory will not live in
`/tmp`, because a demo whose store evaporates between sessions is not a demo.

## Open questions

- ~~Whether the supported Cypher subset expresses every query
  [ADR 0002](docs/adr/0002-temporal-evidence-graph.md) assumes.~~ **Settled
  2026-08-12** by executing all of them. It does, with two changes to how, not
  to what: edges are written one statement each because `UNWIND` upserts
  vertices only, and the "is this claim current" check projects the superseder's
  id instead of counting, because `count(<binding>)` does not parse. Evidence in
  [artifacts/cypher-probe/](artifacts/cypher-probe/README.md).

- Whether one HTTP round trip per edge is fast enough at demo corpus size. It is
  a throughput question with a measurable answer, and it gets measured when the
  ingestion pipeline exists rather than guessed at now. If it is too slow the
  fallback is Bolt, which is already verified working against the same node.

- Whether a paged read is a snapshot. `read_epoch` cannot be pinned by the
  client, so a multi-page read cannot be forced to see one consistent state, and
  whether the server holds one behind the cursor was not established. Untested
  because the test is not deterministic on a graph this small. Lacuna's reads are
  bounded and mostly fit one page, so this is a question to answer before any
  claim about consistency, not a blocker.

## Needs the owner

See [NEEDS_VAIBHAV.md](NEEDS_VAIBHAV.md). Nothing there blocks the build today.
