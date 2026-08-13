# Lacuna

**Memory that knows what changed, what remains true, and what was never known.**

Lacuna is a temporal, provenance-first memory layer for agents, built on
[HydraDB](https://github.com/hydra-db/hydradb). Built for Hack Hydra 2026,
Track 03 (Memory and Context Retrieval).

Most agent memory is a pile of embeddings. You ask it a question, it returns the
five chunks that look most like your question, and the agent writes a confident
sentence. It cannot tell you that the fact it just used was overwritten three
sessions ago, it cannot show you which message the fact came from, and when the
answer is simply not in the history it invents one rather than saying so.

Lacuna stores memory as an immutable evidence graph instead. Every claim keeps
the span it came from. Corrections do not overwrite; they attach a `SUPERSEDES`
edge, so the old claim stays queryable and the timeline stays honest. Retrieval
is a bounded graph traversal that returns a proof path, not a similarity score.
And when the evidence does not support an answer, Lacuna abstains with a
machine-readable reason instead of guessing.

The name is the thesis: a lacuna is a gap. Knowing where the gaps are is the
part everyone skips.

## Running it

Node 20.11 or newer, and a HydraDB node. Steps 1 and 2 need nothing else and are
worth running on their own: they prove the checkout is complete and that 568
tests pass.

**1. Install.**

```bash
npm ci
```

**2. Test and typecheck.** Neither needs a database.

```bash
npm test && npm run typecheck
```

Five lines on stderr during the tests are meant to be there: a refused
connection, an ambiguous entity name, and three 403s from a fixture namespace.
They are error-path tests logging the failures they provoked on purpose. Read
the counts underneath, which end `Tests 568 passed (568)`.

**3. Start HydraDB.** Lacuna talks to it as a separate service over its HTTP
API, so it needs a node of its own, built from
[upstream](https://github.com/hydra-db/hydradb) at the commit pinned in
[docs/SOURCE_LOG.md](docs/SOURCE_LOG.md). Build it with upstream's own
instructions; this repository deliberately does not restate them. Once the
binary exists:

```bash
scripts/hydra-node.sh start
```

That serves HTTP on `127.0.0.1:18443` and keeps its data in
`/var/lib/lacuna/hydradb` rather than a temporary directory, so the corpus
survives a restart. On first run it mints an auth token and tells you where it
wrote it. `scripts/hydra-node.sh status` and `stop` do what they say.

**4. Point Lacuna at it.** Copy [`.env.example`](.env.example) to `.env.local`
and fill in the five keys, `HYDRA_TOKEN` being the contents of the token file
from the previous step. `.env.local` is git-ignored and must stay that way.

**5. Load the demo corpus.**

```bash
npm run ingest
npm run census
```

`ingest` writes 72 sessions, 5268 messages and 118 claims. `census` counts what
is actually in the graph and compares it to what the generator planned, so it
tells you the load worked rather than that it finished. It ends
`graph matches the plan exactly`.

**6. Serve.**

```bash
npm run serve
```

Then open <http://127.0.0.1:3014>. `PORT` and `HOST` are honoured; the default
binds loopback only.

To check the whole of that in one go, against a fresh clone rather than this
working copy:

```bash
artifacts/repro/repro.sh
```

That is the script behind [artifacts/repro](artifacts/repro/README.md), which
holds an unedited transcript of a run.

## Status

Work in progress. This repository is being built live during the hackathon
window (August 12-20, 2026). See [STATE.md](STATE.md) for what actually works
right now, and [PLAN.md](PLAN.md) for what is next.

Nothing in this README describes a feature that does not exist. If a claim here
is not backed by a command you can run, it is a bug in the README.

## Provenance and licensing

Lacuna talks to HydraDB as a separate service over its HTTP query API. No
HydraDB source is vendored, copied, or linked into this codebase. HydraDB is
licensed AGPL-3.0; Lacuna's own code is Apache-2.0. See
[THIRD_PARTY.md](THIRD_PARTY.md) and [docs/SOURCE_LOG.md](docs/SOURCE_LOG.md).

All participant-authored work in this repository begins on or after
August 12, 2026, per the Hack Hydra rules. No pre-hackathon application code,
assets, or rewritten history has been imported. The history has had exactly one
modification of its own: the author's email address was changed across all 42
commits so that a private address would not be published, leaving every date,
message, parent and file byte identical. It is recorded with its verification in
D-050 of [DECISIONS.md](DECISIONS.md).
