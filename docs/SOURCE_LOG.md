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
| Tagged releases | none at time of access |
| Accessed | 2026-08-12 |

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
  shard API. Source: `cypher-compat.md`.
- A vertex upsert must be `MERGE` on id followed by `SET`. Folding extra
  properties into the `MERGE` pattern is rejected. Source: `cypher-compat.md`.
- Local dev node listens on Bolt 17687, HTTP 18443, admin 19091 under the
  AGENTS.md recipe (the README recipe uses 7687/8443/9090). Source: `AGENTS.md`.
- `RUST_MIN_STACK=33554432` is required on every platform or the node aborts on
  the first query. Source: `AGENTS.md`, `README.md`.
- Auth token must be at least 32 characters. `GRAPH_ALLOW_PLAINTEXT=true` is
  local-development only. Source: `AGENTS.md`.
- Read consistency is `causal` (default) or `strong`, set per request. Source:
  `README.md`.

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
