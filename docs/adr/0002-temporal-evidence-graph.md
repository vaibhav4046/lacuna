# ADR 0002: The temporal evidence graph

- Status: accepted
- Date: 2026-08-12
- Decider: Vaibhav Lalwani (solo entry)
- Supersedes: nothing
- Depends on: [ADR 0001](0001-track-and-thesis.md)

## Context

ADR 0001 commits to a memory layer that can say what changed and what was never
known. That is a data model decision before it is anything else. It also has to
be a data model HydraDB will actually execute, and HydraDB implements a
deliberate OpenCypher subset, not the whole language.

The constraints that shaped this model, all from `cypher-compat.md` at the
pinned commit (see [SOURCE_LOG.md](../SOURCE_LOG.md)):

- Node ids are non-negative integers. Patterns match on `id`.
- A relationship pattern carries exactly one type and a direction. Undirected
  patterns are rejected.
- Variable-length paths need an explicit maximum. `*1..3` is fine, `*1..` is not.
- `WHERE` supports `=`, `<>`, `<`, `>`, `<=`, `>=` and `STARTS WITH`. There is no
  `IN`, no `CONTAINS`, no `ENDS WITH`, no `IS NULL`.
- Aggregates are `count`, `sum`, `avg` and `collect`. No `min`, no `max`.
- Whole paths come back only from `algo.SPpaths` / `algo.SSpaths` /
  `algo.MSpaths`. A plain `MATCH` projects endpoints.
- One statement per request. Batch writes are `UNWIND $rows AS row` with a
  parameter holding a list of maps, through the client transport.
- Vertex upsert is `MERGE` on id followed by `SET`. Folding properties into the
  `MERGE` pattern is rejected.

Designing around these up front is cheaper than discovering them at parse time
on day six.

## Decision

Store memory as an **append-only bitemporal evidence graph**. Nothing is ever
updated in place except a claim's derived status, and even that is derived from
edges rather than being the source of truth.

### Node labels

| Label | Meaning | Key properties |
|---|---|---|
| `Session` | One conversation session | `session_key`, `started_at`, `seq` |
| `Message` | One message inside a session | `session_id`, `role`, `ts`, `seq` |
| `EvidenceSpan` | An immutable quoted range of a message | `message_id`, `start`, `end`, `text_hash` |
| `Claim` | One normalized assertion | `subject_id`, `predicate`, `object_text`, `valid_from`, `tx_time`, `polarity` |
| `Entity` | A thing claims are about | `name`, `kind` |

### Relationship types

| Pattern | Meaning |
|---|---|
| `(Session)-[:CONTAINS]->(Message)` | Structural containment |
| `(Message)-[:HAS_SPAN]->(EvidenceSpan)` | Where a span physically came from |
| `(EvidenceSpan)-[:SUPPORTS]->(Claim)` | Provenance. A claim with no inbound `SUPPORTS` is invalid by construction |
| `(Claim)-[:ABOUT]->(Entity)` | Subject binding |
| `(Claim)-[:MENTIONS]->(Entity)` | Object or referenced entity, which is what makes multi-hop possible |
| `(Claim)-[:SUPERSEDES]->(Claim)` | Newer corrects older. The old claim stays |
| `(Claim)-[:CONTRADICTS]->(Claim)` | Mutually exclusive, and nothing resolves which wins |
| `(Claim)-[:CONFIRMS]->(Claim)` | Independent restatement, raises confidence |

Every type is directed and single-typed, so every pattern is legal in the
subset. `SUPERSEDES` points from newer to older, which makes "is this claim
current" a check for zero inbound `SUPERSEDES` edges rather than a scan.

### Two time axes

Every `Claim` carries both:

- **valid time** (`valid_from`): when the fact became true in the world.
- **transaction time** (`tx_time`): when the system was told.

These come apart constantly and that is the whole point. "The launch moved to
March" learned in session 7 is a correction with a later `tx_time` than the
claim it supersedes, but it may carry an *earlier* `valid_from` if the user is
recalling something. Systems that keep one timestamp cannot represent that, so
they get "what did we believe at the time" questions wrong.

### Deterministic integer ids

HydraDB node ids are non-negative integers, so ids are derived, not assigned:

```
id = first 52 bits of SHA-256("<label>\x1f<canonical-key>")
```

52 bits keeps ids inside the JavaScript safe-integer range. Determinism buys
idempotent ingestion for free: re-ingesting the same transcript produces the same
ids, and `MERGE` on those ids is a no-op. The rules note that "a `MERGE` that
changes nothing still commits", so a retry is safe and costs the same.

Truncation means collisions are possible. Every node therefore also stores its
full canonical key as a property, and ingestion verifies that an existing node
with the same id has the same key. A mismatch is a hard ingest error, not a
silent overwrite. At the scale this project targets the probability is
negligible, but "negligible" is not "checked", and this is a memory system whose
entire pitch is not lying.

### Working around the missing operators

| Wanted | Not available | Used instead |
|---|---|---|
| "claims with no superseding edge" | `IS NULL` | `OPTIONAL MATCH` for the inbound `SUPERSEDES` plus `count()`, which is 0 when absent |
| "claim id in this set" | `IN` | `UNWIND $rows` batch form, or `algo.MSpaths` with `sourceValues` |
| "latest claim" | `max()` | `ORDER BY ... DESC LIMIT 1` |
| "text search" | `CONTAINS` | Lexical candidate selection happens outside HydraDB; the graph resolves structure, not substrings |

That last row is deliberate and worth stating plainly: HydraDB is not being asked
to be a search engine. It is being asked to be the thing a search engine cannot
be, which is a store of relationships between evidence.

## Consequences

- Storage grows monotonically. Nothing is deleted, so a long history costs more
  disk. Acceptable: object storage is the cheap axis, and HydraDB is built for
  object storage.
- "Current value of X" is a traversal, not a lookup. Slightly more expensive per
  query, and the reason a correct answer is possible at all.
- Contradiction detection is a first-class ingest step rather than a query-time
  heuristic, which means ingest is slower and retrieval is honest.
- The proof path returned to the caller is literally the traversal HydraDB
  walked, so the UI is not a reconstruction of what happened. It is what
  happened.

## Alternatives considered

**Mutable claims with a `version` column.** Simpler, and it throws away the
history that ADR 0001 is built on. Rejected.

**Event log plus periodic materialized snapshot.** Correct, and it puts the
interesting logic in a batch job rather than in the graph. It would also make
HydraDB a place to put results rather than the thing computing them, which fails
judging criterion 02. Rejected.

**One node per (claim, version) with a `PREVIOUS` chain.** Nearly the same as
what was chosen. `SUPERSEDES` was preferred because a correction is not always a
linear chain: two sessions can independently correct the same claim, and a chain
forces a false ordering on them where a DAG does not.
