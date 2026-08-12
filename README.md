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
assets, or rewritten history has been imported. Git history is unmodified.
