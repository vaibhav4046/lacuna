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

## Measured as a curve

`npx tsx scripts/scale-curve.ts`, against the self-hosted node, one size at a
time, written to [artifacts/scale/curve.json](../artifacts/scale/curve.json).

The experiment is controlled on the one thing that matters. The generator takes
a session count and spreads the same threads over however many sessions it is
given, so **every size holds the same 64 gold questions, the same 174 claims and
the same 86 entities.** The only variable is how much unrelated conversation
surrounds them.

| sessions | messages | tokens of history | correct | false answers | mean context tokens | p50 |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 722 | 16,994 | 64/64 | 0 | 18.27 | 249.1ms |
| 20 | 1,470 | 33,589 | 64/64 | 0 | 18.27 | 457.2ms |
| 30 | 2,196 | 49,509 | 64/64 | 0 | 18.27 | 262.3ms |
| 40 | 2,894 | 65,112 | 64/64 | 0 | 18.27 | 218.0ms |
| 72 | 5,246 | 117,041 | 64/64 | 0 | 18.27 | 288.4ms |

**History grew 6.89 times. The context handed to the answering step grew 1.00
times.** Not approximately: the same 18.27 tokens at every size, to the decimal.

### What that does and does not mean

The flatness is not a surprise and it should not be presented as one. The
resolver reads claims, not messages, and this experiment holds the claim set
fixed, so a constant answer is what the design predicts. Stated plainly: **this
measures that transcript volume does not leak into the answer path. It does not
measure what happens as the number of claims grows**, which is the harder
question and is not answered here.

That is still worth running, for two reasons.

The first is that it is a regression test for an entire class of bug. Any
accidental dependency on history size, a scan that widened, a store returning
more mentions as the graph filled, a pack that grew with the session count,
would show up as a rising column. None did.

The second is the column that was **not** guaranteed by the design. Latency has
no trend across a sevenfold growth in history: 249, 457, 262, 218, 288
milliseconds, which is noise rather than a slope. Nothing in the architecture
forces that. A store whose reads got slower as the graph grew would have
produced a curve here, and it did not.

Set against the baselines in [BENCHMARKS.md](BENCHMARKS.md), which spend 1,843
tokens at the largest size to reach 63 of 64, this is the shape of the argument:
a retrieval approach pays more context as history grows because more of it looks
relevant, and resolving to a current claim does not.

## What this does not prove

- **It is not a public benchmark.** The same generator wrote the corpus and the
  questions, so 64 of 64 says the pipeline does what the structure says, not
  that it is right about somebody else's data. The official LongMemEval work is
  tracked in [BENCHMARK_LONGMEMEVAL.md](BENCHMARK_LONGMEMEVAL.md), and no
  official number is claimed anywhere in this repository until one is run.
- **The history is generated from structured annotations.** Until the raw prose
  extraction path lands, this measures the resolver over a well-formed claim
  graph rather than over arbitrary conversation text. That limit is stated in
  the README next to the thesis, and it is the difference between doing well on
  this corpus and doing well on a real one.
