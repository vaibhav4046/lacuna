# Decisions

Choices made during the build, with the reason and the date. Architectural
decisions large enough to have consequences live in [docs/adr/](docs/adr/) and
are linked from here rather than duplicated.

The point of this file is that a judge, or a future reader, can tell the
difference between a decision and an accident.

---

## 2026-08-12

### D-001: Build in a fresh repository at `D:\project\lacuna`

`D:\` is the owner's whole drive: not a git repository, and holding roughly 38
unrelated projects including `hydrasentry`, which is pre-hackathon work on a
HydraDB-adjacent idea. Building anywhere inside that tree would make "no
participant-authored commits before August 12, 2026" impossible to demonstrate
cleanly, and proximity to a prior HydraDB project is exactly the thing a judge
would look at twice.

Fresh directory, `git init` on 2026-08-12, nothing copied in.

### D-002: Enter Track 03 only

See [ADR 0001](docs/adr/0001-track-and-thesis.md).

### D-003: HydraDB stays a separate service, spoken to over HTTP

HydraDB is AGPL-3.0. Lacuna is Apache-2.0. Keeping HydraDB as a separate process
addressed over its HTTP query API means no HydraDB source is copied, vendored or
linked into this codebase, so the licenses do not have to be reconciled at all.

This is also what the upstream README recommends for applications, and it is the
arrangement the HTTP and Bolt APIs exist to serve.

No HydraDB code appears in this repository. What appears is a client that speaks
its documented wire protocol.

### D-004: Run HydraDB from source inside WSL Ubuntu 24.04

The machine had no Docker, no podman, no WSL distribution and no Rust
toolchain, so neither official path worked as found.

Options were: install Docker Desktop (admin install, large, and Docker Desktop
licensing is a question nobody needs), or install a WSL distribution and follow
the upstream source-build path.

Chose WSL Ubuntu 24.04 because upstream `AGENTS.md` documents the source path
step by step, states it was executed end to end on "a clean Ubuntu 24.04
container", and explicitly needs "no Docker, no S3, no Kubernetes". It is also
reversible in one command.

Verified present after install: `libcypher-parser 0.6.2` and
`libgraphblas.so.7.4.0` from Ubuntu's own repositories, which are exactly the
two native dependencies upstream calls out.

### D-005: Apache-2.0 for Lacuna's own code

The rules require "an appropriate open-source license". Apache-2.0 over MIT for
the explicit patent grant, which matters more for something presented as
infrastructure. Canonical text fetched from `apache.org`, not typed from memory.

### D-006: One vendor-neutral conventions file, named `AGENTS.md`

Repository conventions live in a single `AGENTS.md`: what the layout is, what
must never be claimed without evidence, where the license boundary sits, and
which Cypher constructs are off the table.

Vendor-specific variants of the same file were rejected. One file that any
contributor or tool reads is better than several that drift apart, and `AGENTS.md`
is the filename HydraDB upstream already uses for exactly this purpose.

### D-007: Deterministic ids derived by hash, not assigned by a counter

HydraDB node ids are non-negative integers. A counter would need a coordination
point and would make ingestion non-idempotent. Truncated SHA-256 of a canonical
key gives stable ids across runs, so re-ingesting a transcript is a no-op
instead of a duplicate.

Collision risk is handled explicitly rather than assumed away. See
[ADR 0002](docs/adr/0002-temporal-evidence-graph.md).

### D-008: Track the rules as a matrix, not as prose

[docs/RULES_MATRIX.md](docs/RULES_MATRIX.md) maps every published requirement to
where it is satisfied and its current status. Disqualification is the single
largest risk in a hackathon and it is entirely avoidable by checking a list.
