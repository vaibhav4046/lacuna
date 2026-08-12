# Source log

Every external source this project relied on, with the exact version and the
date it was read. Anything not on this list did not inform the build.

Timezone for all timestamps: Europe/London.

## HydraDB

Pinned for the whole build. All upstream documentation was read at this commit,
not at whatever `main` happens to be later.

| Field | Value |
|---|---|
| Repository | https://github.com/hydra-db/hydradb |
| Default branch | `main` |
| Pinned commit | `02a40025d2d57e97ab2754c8256219cdbfeab379` |
| Commit date | 2026-08-12T17:48:57Z |
| Commit subject | Merge pull request #59 from hydra-db/ci/multiarch-container-image |
| License | AGPL-3.0 |
| Repo created | 2026-07-03T05:34:15Z |
| Tag at this commit | `v0.1.1` (`git describe --tags --exact-match` on the clone) |
| All tags in repo | `v0.1.0`, `v0.1.1` |
| Accessed | 2026-08-12 |

An earlier version of this file said there were no tagged releases. That was
wrong, and the correction is left visible rather than quietly edited out: the
GitHub API endpoint consulted lists published *Releases*, and this repository has
tags without Releases attached. The clone settled it. Lacuna is built against
HydraDB `v0.1.1`.

Files read at that pin, fetched via
`https://raw.githubusercontent.com/hydra-db/hydradb/02a40025d2d57e97ab2754c8256219cdbfeab379/<path>`:

| File | Bytes | What it settled |
|---|---|---|
| `README.md` | 20038 | Endpoints, HTTP query envelope, run modes, read consistency |
| `AGENTS.md` | 19232 | The exact local-run sequence, ports, env vars, failure modes |
| Upstream agent pointer file at repo root | 2547 | Points contributors at `AGENTS.md`; no build facts of its own |
| `architecture.md` | 25043 | Storage model, snapshots, index lifecycle |
| `cypher-compat.md` | 10783 | The supported OpenCypher subset. This is load-bearing |
| `DEVELOPMENT.md` | 6290 | Recipe and harness surface |
| `justfile` | 14921 | Official build commands |
| `Dockerfile` | 3949 | Container build path |
| `mise.toml` | 47 | Toolchain pin |
| `rust-toolchain.toml` | 31 | `channel = "stable"`, Rust 1.91+ |

Facts taken from those files that the build depends on:

- HydraDB accepts a deliberate OpenCypher subset. Not supported and relevant to
  us: `RETURN *`, `IN`, `CONTAINS`, `ENDS WITH`, `IS NULL`, unbounded `*`
  traversal, `min`/`max` aggregates, `ON CREATE`/`ON MATCH`, undirected
  patterns, multi-type relationship patterns, more than one statement per
  request. Source: `cypher-compat.md`.
- Variable-length paths require an explicit maximum (`*1..3`, never `*1..`).
  Source: `cypher-compat.md`.
- Whole paths come back only from `algo.SPpaths` / `algo.SSpaths` /
  `algo.MSpaths`, not from plain `MATCH`. Source: `cypher-compat.md`, `README.md`.
- Batch writes use `UNWIND $rows AS row` with a parameter holding a list of
  maps, and only through the client transport (Bolt/HTTP), not the in-process
  shard API. Source: `cypher-compat.md`. **Incomplete as stated: see
  [Corrected by execution](#corrected-by-execution) below. `UNWIND` writes
  vertices and refuses edges.**
- A vertex upsert must be `MERGE` on id followed by `SET`. Folding extra
  properties into the `MERGE` pattern is rejected. Source: `cypher-compat.md`.
  **Incomplete as stated: that form only parses inside `UNWIND`. See
  [Corrected by execution](#corrected-by-execution).**
- Local dev node listens on Bolt 17687, HTTP 18443, admin 19091 under the
  AGENTS.md recipe (the README recipe uses 7687/8443/9090). Source: `AGENTS.md`.
- `RUST_MIN_STACK=33554432` is required on every platform or the node aborts on
  the first query. Source: `AGENTS.md`, `README.md`.
- Auth token must be at least 32 characters. `GRAPH_ALLOW_PLAINTEXT=true` is
  local-development only. Source: `AGENTS.md`.
- Read consistency is `causal` (default) or `strong`, set per request. Source:
  `README.md`.

### Read from the HydraDB source, not the prose

The documentation gives a two-field `curl` example and does not spell out the
rest of the HTTP request body. Rather than guess at field names and discover them
through 400s, the wire contract was read directly from the pinned source:
`src/client/http.rs` (the `HttpQueryRequestBody` and `HttpQueryResponseBody`
structs, around line 283) and `src/client/http/tests.rs` (requests and assertions
against a live server).

Reading is all that happened. No HydraDB source is copied into this repository,
so the AGPL boundary described in [../THIRD_PARTY.md](../THIRD_PARTY.md) is
untouched. What was learned is an interface, and the client that speaks it is
written from scratch.

Request body accepts: `cell_id` and `query` (both required), then optional
`query_id`, `parameters`, `bookmark`, `read_epoch`, `timeout_ms`, `page_size`,
`cursor`, `consistency`.

Response body returns: `query_id`, `columns`, `rows`, `read_epoch`,
`next_cursor`, `bookmark`. Row values are tagged objects, `{"type": ...,
"value": ...}`, with the type name in snake case.

Two consequences for the build:

- `timeout_ms` is a per-request server-side timeout that already exists in the
  protocol. The query-timeout mitigation in
  [THREAT_MODEL.md](THREAT_MODEL.md) T4 is therefore a matter of setting it, not
  of building anything.
- `read_epoch` and `bookmark` come back on every read. They are the engine's own
  statement of which snapshot answered, which makes them the honest content of
  the HydraDB Proof screen.

### Corrected by execution

The source above is upstream's own documentation, and it is accurate about what
the engine refuses. It is incomplete about what the engine accepts, in ways that
only showed up when the queries were run. 119 probes across three rounds, all
recorded in [../artifacts/cypher-probe/](../artifacts/cypher-probe/README.md),
on 2026-08-12 against the running node.

| What the documentation implied | What the engine did |
|---|---|
| `UNWIND $rows AS row` is the batch write form | It is the batch **vertex upsert** form. Six attempts to batch edges with it were rejected: `UNWIND vertex upsert requires MERGE by id followed by SET`. Edges are one statement each. |
| Vertex upsert is `MERGE` on id then `SET` | Only inside `UNWIND`. A bare `MERGE (c {id: X}) SET c:Claim` is rejected twice: `MERGE with following clauses is not executable in Query engine`, then `only one-hop edge patterns are executable in Query engine MERGE`. |
| Aggregates include `count` | `count(*)` only. `count(<binding>)` is rejected: `RETURN currently supports <binding>.<property> or count(*)`. |
| Not documented at all | `WITH` must pass through every in-scope binding. Dropping one is rejected. |
| Not documented at all | A node-only `MATCH` needs an id, a label, or a property predicate. Bare `MATCH (c)` is rejected. |

Confirmed by execution exactly as documented, so the documentation earned its
place: `IN`, `CONTAINS`, `ENDS WITH`, `IS NULL`, `RETURN *`, unbounded `*`,
undirected patterns, multi-type relationship patterns, and more than one
statement per request are all rejected, each with a specific message.

One encoding detail that appears in no document and matters for the client.
Top-level row values are tagged `{"type": "string", "value": "March"}`, snake
case, with `value` absent when the type is `null`. Node properties **inside** an
`algo.*` path value use a different tagging: `{"String": "March"}`,
`{"Integer": 20250210}`, capitalised. The adapter needs both decoders. Captured
in [`path-value-shape.json`](../artifacts/cypher-probe/path-value-shape.json).

## Hack Hydra 2026 rules

| Field | Value |
|---|---|
| Source | https://hackhydra.hydradb.com |
| Accessed | 2026-08-12 |
| Retrieved | HTTP 200, 18802 characters of page text |

Captured verbatim into [RULES_MATRIX.md](RULES_MATRIX.md).

## Benchmarks

To be filled in when each dataset is actually fetched and its license read.
Nothing is listed here before it has been downloaded and inspected.

| Dataset | Source | License | Accessed |
|---|---|---|---|
| LongMemEval | pending | pending | pending |
| LongMemEval-V2 | pending | pending | pending |
| BEAM | pending | pending | pending |
