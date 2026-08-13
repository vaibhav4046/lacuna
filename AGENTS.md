# Working in this repository

Conventions for anyone, human or agent, making changes here.

## The one rule that matters

**Nothing in this repository may describe something that does not exist.** No
aspirational README, no placeholder benchmark number, no screenshot of a mockup
presented as a running product. If a thing is not built, it is listed as not
built. [STATE.md](STATE.md) is the current truth.

This is a project about a memory system that refuses to answer when it does not
know. A repository that overstates itself would be an argument against its own
thesis.

## Layout

```
docs/            Design records, source log, threat model, rules matrix
docs/adr/        Architecture decision records, numbered, immutable once accepted
artifacts/       Real captured output: rules text, HydraDB responses, probe runs
scripts/         Operating the local HydraDB node. No HydraDB source, no build
src/hydra/       The HydraDB client. Nothing above it depends on HTTP details
tests/unit/      Injected fake transport. Runs anywhere, no database
tests/contract/  Live node, nothing mocked. Fails when no node answers
```

`scripts/hydra-node.sh` starts, stops and inspects that node. It is upstream's
own launch block with three paths moved out of `/tmp` so the graph survives, and
it builds nothing: the binary comes from upstream's build step or the script
refuses to start. See [D-010](DECISIONS.md).

`src/hydra/` is the only place that knows HydraDB is spoken to over HTTP.
Config and its refusal to send a bearer token in cleartext to a remote host live
in `config.ts`; the identifier allowlist that is the client's injection boundary
lives in `identifiers.ts`; the two value decoders live in `values.ts`; the query
builders live in `queries.ts` and build no query text from data.

The rest of the application, the benchmark harness and the interface land as
they are built. This section gets updated when they do, not before.

## Rules of the build

- **Read before writing.** Never edit a file from memory of what it contains.
- **Verify before claiming.** A command that was not run did not pass. Paste real
  output.
- **Pin external sources.** Upstream HydraDB is read at a fixed commit, recorded
  in [docs/SOURCE_LOG.md](docs/SOURCE_LOG.md). "The docs said" is not a citation.
- **Follow upstream build instructions.** Use the project's own recipes. Do not
  invent build commands. Where the environment forces a deviation, record the
  deviation and the reason.
- **One statement per HydraDB request.** The query API accepts one. Batch writes
  use `UNWIND $rows AS row` with a parameter, through the client transport.
- **Stay inside the supported Cypher subset.** It is documented upstream and
  summarised in [ADR 0002](docs/adr/0002-temporal-evidence-graph.md). Writing a
  query with `IN`, `CONTAINS`, `IS NULL`, `min()` or `max()` wastes a round trip
  finding out it is rejected.

## Secrets

The HydraDB auth token is server-side only. It never reaches the browser bundle,
a log line, a screenshot or a committed file. `.env` is ignored;
`.env.example` carries names and no values.

Before anything is published, the full Git history gets scanned, not just the
working tree.

## Licensing

Lacuna's own code is Apache-2.0. HydraDB is AGPL-3.0 and runs as a separate
service reached over its HTTP API. No HydraDB source is copied, vendored or
linked into this codebase, and that boundary is deliberate. Do not paste HydraDB
source into this repository.

## Commits

Conventional-commit prefixes: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`,
`perf`, `ci`. Subject in the imperative. Body explains why when the why is not
obvious.

Commit history is a record of when work happened and is never rewritten to look
like something else. Dates, order, parentage, messages and content stay as they
were recorded. This repository has had exactly one rewrite, which changed the
author's email address and nothing else, and it is written up with its before and
after verification in D-050 of [DECISIONS.md](DECISIONS.md).

Commits are authored as `115102797+vaibhav4046@users.noreply.github.com`. GitHub
rejects a push carrying an address the account keeps private, and the
repository-local `user.email` is set to the noreply one so that a machine with a
different global config does not quietly reintroduce the problem one commit at a
time.

## Prose

Plain and concrete. No marketing voice, no hedging, no em-dashes. Say what a
thing does and what it does not do.
