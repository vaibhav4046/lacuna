# Benchmarks

**The headline is a tie.** Two baseline configurations match Lacuna at 60/60 on
correctness with the same zero unsupported answers. No claim of better recall or
better abstention survives that run, and none is made here.

What separates them is cost and construction, and that turns out to be the more
interesting result. This document explains the run. The raw output is
[artifacts/bench/report.txt](../artifacts/bench/report.txt) and
[results.json](../artifacts/bench/results.json), both committed unedited.

## The run

60 questions over the generated demo corpus: 5,268 messages, about 117,395
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
| lacuna | 60/60 | 0 | 1.000 | 15 | 243.4 |
| hybrid+2hop@20 +conflict | 60/60 | 0 | 1.000 | 636 | 3.6 |
| lexical@20 +conflict | 46/60 | 0 | 0.889 | 513 | 1.0 |
| hybrid@20 +conflict | 46/60 | 0 | 0.889 | 524 | 3.5 |
| vector@50 +conflict | 46/60 | 0 | 0.889 | 1310 | 2.6 |
| recency@50 +conflict | 44/60 | 0 | 0.865 | 1087 | 0.2 |

`correct` means exact: the same decision, and either the same value or the same
reason for declining. `false` counts answers given where nothing in the corpus
supports one. `ctx tok` is the mean estimated tokens handed to the answering
step.

The table shows the best configuration of each approach, so it lists one row per
approach. In the full 51-row table there is a second configuration on 60/60:
`hybrid+2hop@50 +conflict`, the same pipeline with a wider cut-off, at 1,603
context tokens. Both ties are the same construction; the wider one costs 107
times Lacuna's context rather than 42.

## The baselines were given every advantage

They read the corpus annotations rather than the prose. Each one is handed a
perfect extractor: it sees every claim in the messages it retrieved, with the
subject, the property, the value, and whether the sentence announced itself as
a correction or a withdrawal. A baseline that loses here lost on retrieval, not
on reading, which is the only way the comparison says anything about the graph.

What they are not handed is which claim supersedes which. That is an edge, and
building it is the thing under test.

## What the tie costs to buy

`hybrid+2hop@20 +conflict` is not a pipeline anyone ships. It is BM25 and local
sentence embeddings fused by reciprocal rank, plus a second retrieval round
routed through a named relation, plus a reader that declines when it sees two
values and no announced correction. Take any part away:

| configuration | correct | false answers |
|---|---|---|
| hybrid+2hop@20 +conflict | 60/60 | 0 |
| without the conflict-aware reader | 54/60 | 6 |
| without the second retrieval round | 46/60 | 0 |
| without both, which is plain hybrid retrieval | 40/60 | 6 |

The three rules that reader applies are the three distinctions the graph holds
structurally: a correction supersedes, a withdrawal removes, and a hop that
lands on a silent entity is a gap rather than an absence. Hand-written into a
reader they cost four components and 42.4 times the context, 636 estimated
tokens per question against 15.

That is the shape of the claim, stated as narrowly as the evidence supports:
not that the graph answers more questions, but that reaching the same answers
without one takes a purpose-built pipeline nobody would arrive at except by
tuning against these answers, and it carries 42.4 times more context to the
model that has to be trusted with the last step.

The configuration was also not found by a baseline author trying their best. It
was found by search across 51 configurations, which means it is the strongest
version of the opposing argument this repository could construct, on purpose.

## What this does not measure

**Latency is not like-for-like.** 243.4ms against 3.6ms, and the comparison is
not a race. Every baseline runs in-process against arrays already in memory.
Lacuna runs queries over HTTP against a HydraDB node and pays a network round
trip per hop. The baselines also pay nothing for indexing, which happened
before the clock started. Read the column as the shape of the query path.

**The corpus is generated.** It is built by committed code to contain revision,
retraction, disagreement, relational questions and questions with no answer, in
known proportions, which is what makes abstention measurable at all. It is not
a sample of real conversations, and nothing here claims how often these
situations arise in practice.

**60 questions is 60 questions.** Every kind is 6 to 12 cases. Both systems get
all of them; a single flipped case would move a per-kind rate by 8 to 17 points.

## The separate evaluation

The benchmark asks whether the graph beats flat retrieval. The evaluation asks
the prior question: does Lacuna do what it says on its own terms. It is a
different harness with different output, in
[artifacts/eval/report.txt](../artifacts/eval/report.txt).

```bash
npm run eval
```

60/60 exact. Abstention precision, recall and F1 all 1.000. Zero unsupported
answers. 276 queries for 60 questions, between 1 and 8 each. p50 158.7ms, p95
274.8ms, max 308.1ms, end to end including HTTP.

Those latencies are from the run committed here, which is not the run the
benchmark used; the same harness on the same corpus reported p50 191.2ms
earlier the same day. Wall clock on a loopback HTTP hop moves by that much
between runs on a laptop. The counts do not move.

That report says of itself that it is not evidence the approach beats anything,
which is why the benchmark exists.
