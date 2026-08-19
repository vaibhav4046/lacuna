# Track 03 scale, measured

Track 03 describes a specific shape: roughly thirty to forty sessions, around
115,000 tokens of history per question, facts spread across sessions, facts that
change, and questions whose right answer is sometimes that nobody ever said.

This file records what this project actually runs at, and what that does and
does not prove.

## The history is at the track's scale

Measured from the generator, 2026-08-19:

| | |
| --- | --- |
| sessions | 72 |
| messages | 5,246 |
| characters of transcript | 468,164 |
| estimated tokens | 117,041 |

Reproduce with `npm run census`, which also reads every stored key back and
names anything the plan did not write, so the counts are a check rather than a
print.

Seventy-two sessions is above the thirty to forty the track names, and 117,041
estimated tokens is within a rounding error of its 115,000. The history was not
sized to match afterwards; the number is what the seeded generator produces.

## What it does at that scale

All 64 gold questions, over the whole history, from
[artifacts/eval/report.txt](../artifacts/eval/report.txt) via `npm run eval`:

| | |
| --- | --- |
| exact correct | 64 of 64 |
| wrong answer text | 0 |
| **false answers** | **0** |
| missed answers | 0 |
| wrong reason code | 0 |
| abstained correctly | 32 |
| abstained when an answer existed | 0 |
| p50 per question | 114.1ms |
| p95 per question | 184.4ms |

Broken down by the thing the track cares about: stable facts 12 of 12, revised
8 of 8, retracted 6 of 6, contradicted 6 of 6, multi-hop 8 of 8, never stated 8
of 8, out of scope 6 of 6, unconnected 6 of 6, blast radius 4 of 4.

Half of those questions have no answer, and the system is scored on refusing
them for the right stated reason rather than on refusing them at all.

## The number this project is actually about

Answering over 117,041 tokens of history costs a mean of **18 estimated context
tokens** in the pack handed to a worker. The strongest flat baseline over the
same corpus reaches 63 of 64 and spends **1,843**.

From [artifacts/bench/results.json](../artifacts/bench/results.json), read in
full in [BENCHMARKS.md](BENCHMARKS.md).

That ratio is the scale argument. A retrieval approach pays more context as the
history grows, because more of it looks relevant. Resolving to a current claim
and citing the span that established it does not: the pack is the answer and its
evidence, whether the history behind it is ten sessions or seventy.

## What this does not prove

- **It is not a public benchmark.** The same generator wrote the corpus and the
  questions, so 64 of 64 says the pipeline does what the structure says, not
  that it is right about somebody else's data. The official LongMemEval work is
  tracked in [BENCHMARK_LONGMEMEVAL.md](BENCHMARK_LONGMEMEVAL.md), and no
  official number is claimed anywhere in this repository until one is run.
- **It is not a curve.** These are measurements at one scale, the track's scale,
  not a series at 10, 20, 30 and 40 sessions. The claim that context cost stays
  flat as history grows is argued from the design and from the gap against the
  baselines, and it is not yet measured as a curve.
- **The history is generated from structured annotations.** Until the raw prose
  extraction path lands, this measures the resolver over a well-formed claim
  graph rather than over arbitrary conversation text. That limit is stated in
  the README next to the thesis, and it is the difference between doing well on
  this corpus and doing well on a real one.
