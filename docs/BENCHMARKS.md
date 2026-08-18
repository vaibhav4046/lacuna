# Benchmarks

**The headline is a one-question lead.** Lacuna answers 64 of 64 and no other
configuration in the sweep does; the closest, `hybrid+2hop@50 +conflict`, gets 63
with the same zero unsupported answers. One question is a narrow result and it is
stated narrowly here.

What separates them is cost and construction, and that remains the more
interesting result. This document explains the run. The raw output is
[artifacts/bench/report.txt](../artifacts/bench/report.txt) and
[results.json](../artifacts/bench/results.json), both committed unedited.

## The run

64 questions over the generated demo corpus: 5,246 messages, about 117,041
tokens of transcript, seed `lacuna-demo-v1`. 51 configurations: five baseline
approaches across cut-offs 3, 5, 10, 20 and 50, each with the conflict-aware
reader on and off, which is 50, plus Lacuna. Embeddings are
`Xenova/all-MiniLM-L6-v2`, 384 dimensions, run locally. Same corpus, same
questions, same scorer for every row.

```bash
npm run bench
```

Best configuration of each approach:

| system | correct | false | abst F1 | ctx tok | p50 ms |
|---|---|---|---|---|---|
| lacuna | 64/64 | 0 | 1.000 | 18 | 92.2 |
| hybrid+2hop@50 +conflict | 63/64 | 0 | 1.000 | 1843 | 3.9 |
| lexical@20 +conflict | 48/64 | 0 | 0.889 | 516 | 1.0 |
| hybrid@20 +conflict | 48/64 | 0 | 0.889 | 529 | 3.8 |
| vector@50 +conflict | 47/64 | 0 | 0.889 | 1311 | 2.9 |
| recency@50 +conflict | 46/64 | 0 | 0.877 | 1029 | 0.2 |

`correct` means exact: the same decision, and either the same value or the same
reason for declining. `false` counts answers given where nothing in the corpus
supports one. `ctx tok` is the mean estimated tokens handed to the answering
step.

The table shows the best configuration of each approach, so it lists one row per
approach. The runner-up is the same pipeline at a narrower cut-off:
`hybrid+2hop@20 +conflict` scores 62 on 737 context tokens. Widening the cut-off
from 20 to 50 buys that pipeline one more question and costs it 2.5 times the
context, which is 100.9 times Lacuna's rather than 40.4.

## The baselines were given every advantage

They read the corpus annotations rather than the prose. Each one is handed a
perfect extractor: it sees every claim in the messages it retrieved, with the
subject, the property, the value, and whether the sentence announced itself as
a correction or a withdrawal. A baseline that loses here lost on retrieval, not
on reading, which is the only way the comparison says anything about the graph.

What they are not handed is which claim supersedes which. That is an edge, and
building it is the thing under test.

## What the closest rival costs to buy

`hybrid+2hop@50 +conflict` is not a pipeline anyone ships. It is BM25 and local
sentence embeddings fused by reciprocal rank, plus a second retrieval round
routed through a named relation, plus a reader that declines when it sees two
values and no announced correction. Take any part away:

| configuration | correct | false answers | missed answers |
|---|---|---|---|
| hybrid+2hop@50 +conflict | 63/64 | 0 | 0 |
| without the conflict-aware reader | 57/64 | 6 | 0 |
| without the second retrieval round | 48/64 | 0 | 8 |
| without both, which is plain hybrid retrieval | 42/64 | 6 | 8 |

The three rules that reader applies are the three distinctions the graph holds
structurally: a correction supersedes, a withdrawal removes, and a hop that
lands on a silent entity is a gap rather than an absence. Hand-written into a
reader they cost four components and 100.9 times the context, 1,843 estimated
tokens per question against 18, and they still come one question short.

That is the shape of the claim, stated as narrowly as the evidence supports:
not that the graph answers far more questions, but that coming within one of it
without a graph takes a purpose-built pipeline nobody would arrive at except by
tuning against these answers, and it carries 100.9 times more context to the
model that has to be trusted with the last step.

The configuration was also not found by a baseline author trying their best. It
was found by search across 51 configurations, which means it is the strongest
version of the opposing argument this repository could construct, on purpose.

## What this does not measure

**Latency is not like-for-like.** 92.2ms against 3.9ms, and the comparison is
not a race. Every baseline runs in-process against arrays already in memory.
Lacuna runs queries over HTTP against a HydraDB node and pays a network round
trip per hop. The baselines also pay nothing for indexing, which happened
before the clock started. Read the column as the shape of the query path.

**The corpus is generated.** It is built by committed code to contain revision,
retraction, disagreement, relational questions, dependency chains and questions
with no answer, in known proportions, which is what makes abstention measurable
at all. It is not a sample of real conversations, and nothing here claims how
often these situations arise in practice.

**64 questions is 64 questions.** The nine kinds run from 4 cases to 12. Both
systems get all of them; a single flipped case would move a per-kind rate by 8
to 25 points, and the whole lead is one case.

## The separate evaluation

The benchmark asks whether the graph beats flat retrieval. The evaluation asks
the prior question: does Lacuna do what it says on its own terms. It is a
different harness with different output, in
[artifacts/eval/report.txt](../artifacts/eval/report.txt).

```bash
npm run eval
```

64/64 exact. Abstention precision, recall and F1 all 1.000, on 32 questions the
corpus does not settle. Zero unsupported answers. 342 queries for 64 questions,
between 1 and 42 each; the wide end is a blast radius question walking a
dependency graph rather than resolving one property.

Its latencies are p50 114.1ms, p95 184.4ms, max 1,217.3ms, end to end including
HTTP. Those are from a different harness than the benchmark, which timed the
same system on the same corpus at p50 92.2ms an hour earlier. Wall clock on a
loopback HTTP hop moves by that much between runs on a laptop, and the maximum
is the first question of the run paying for a cold node. The counts do not move.

That report says of itself that it is not evidence the approach beats anything,
which is why the benchmark exists.
