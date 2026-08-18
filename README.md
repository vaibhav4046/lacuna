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

## The deployed copy

<https://lacuna-five.vercel.app> is this repository running as one serverless
function. It answers from a recorded snapshot: every HydraDB reply was produced
by a live node at export time and stored byte for byte in
[artifacts/snapshot](artifacts/snapshot/graph-snapshot.json), then decoded in
production by the same client code the live server uses. The deployment says so
itself on every page that shows an answer. To run the identical thing locally,
with no database and no token:

```bash
npm run serve:snapshot
```

Then open <http://127.0.0.1:3015>. The full stack against a live node is the
next section.

## Running it

Node 20.11 or newer, and a HydraDB node. Steps 1 and 2 need nothing else and are
worth running on their own: they prove the checkout is complete and that the
unit suite passes with nothing installed.

**1. Install.**

```bash
npm ci
```

**2. Test and typecheck.** Neither needs a database.

```bash
npm test && npm run typecheck
```

Seven lines on stderr during the tests are meant to be there: two refused
connections, two ambiguous entity names, and three 403s from a fixture
namespace. They are error-path tests logging the failures they provoked on
purpose. Read the counts underneath: the line that matters says every test
passed and none were skipped. The count itself moves as the suite grows, and the
run it was last measured at is in
[docs/EVIDENCE_INDEX.md](docs/EVIDENCE_INDEX.md).

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

`ingest` writes 72 sessions, 5246 messages and 174 claims. `census` counts what
is actually in the graph and compares it to what the generator planned, so it
tells you the load worked rather than that it finished. It ends
`graph matches the plan exactly`.

With the corpus loaded, `npm run snapshot:verify` replays all sixty-four gold
questions through the stored snapshot and asks the live node the same sixty-four,
then fails on any mismatch between the two. It needs a running node, because
comparing a recording against the real thing is the whole point of it. Two
fields are excluded from the comparison: wall-clock milliseconds and the read
epoch, which measure the run rather than the answer — every write to the node
advances the epoch, so it differs whenever anything has been ingested since the
snapshot was exported.

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

## Demo data

The corpus is generated rather than collected. [`src/corpus`](src/corpus) builds
it from the seed `lacuna-demo-v1` against a fixed epoch, with no clock and no
`Math.random` anywhere in it, so the same seed always yields the same 72
sessions, 5246 messages, 86 entities and 174 claims. A different seed yields a
different corpus of the same shape.

What comes back out is not generated. Traversals, blast radius, revision chains,
contradictions, evidence paths and abstentions are computed against the graph
when the question is asked. The expected answers exist only in the evaluation
harness, and
[tests/unit/ground-truth-isolation.test.ts](tests/unit/ground-truth-isolation.test.ts)
holds that separation structurally: the query path reaches no module that
carries them, and ingestion plans a byte-identical graph when every expected
answer is replaced with rubbish.

```bash
npm run ingest && npm run census
npm run eval
```

## Asking it from somewhere other than a browser

The pages are one adapter over the answer path, not the answer path. The same
question can be asked from a terminal and from an MCP client. Both need a
running node and a loaded corpus, so both come after step 5.

```bash
node bin/lacuna.js ask Bellwether beta_partner
npm run mcp -- --stdio
```

[docs/CLI.md](docs/CLI.md) covers the commands, the flags and the exit codes.
[docs/MCP.md](docs/MCP.md) covers the four tools and both transports.

Both build their result from one shared projection,
[`src/contract/result.ts`](src/contract/result.ts), so agreement between them is
structural rather than maintained by hand. To check it rather than take it on
faith:

```bash
npm run parity
```

That asks two questions with full payloads printed, one answered and one
abstained, then sweeps all sixty-four gold questions from the evaluation through
three surfaces: the MCP server over stdio, the same server over its HTTP
transport with a real SDK client, and the command line in its own process. It
compares every result field by field, ends `SWEEP_IDENTICAL: 64 of 64` and
`ALL_IDENTICAL: True`, and the saved output is
[artifacts/verification/2026-08-18/parity.txt](artifacts/verification/2026-08-18/parity.txt).
The pages are not in that comparison: they share the resolver underneath but
render their own markup rather than the projection.

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
modification of its own: at publication the author's email address was rewritten
on every commit that existed, so that a private address would not be published,
leaving every date, message, parent and file byte identical. The count it
covered and its verification are in D-050 of [DECISIONS.md](DECISIONS.md).
