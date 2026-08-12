# ADR 0001: Track 03, and the thesis Lacuna is betting on

- Status: accepted
- Date: 2026-08-12
- Decider: Vaibhav Lalwani (solo entry)

## Context

Hack Hydra offers three tracks. Track 01 is enterprise ontology over roughly
half a million noisy documents. Track 02 is dependency and code graphs. Track 03
is agent memory across 30 to 40 chat sessions with 115,000 tokens per question.

Track 01 is the largest and the most data-engineering heavy. With nine days,
solo, and no cloud budget, half a million documents is a data pipeline project
where the graph reasoning gets whatever time is left. Track 02 is a good fit for
graphs but the interesting version needs a real npm or PyPI mirror, which is
again mostly ingestion.

Track 03 is the one where the graph model is the product rather than the plumbing,
and it is the one with a stated failure mode nobody has solved: abstention.

## Decision

Enter Track 03 with **Lacuna**, a temporal, provenance-first memory layer.

The thesis, in one line: **the useful thing about memory is not what it recalls,
it is what it knows changed and what it never knew.**

Three claims follow from that, in the order they have to be defended:

1. **Correct before clever.** A memory layer that returns a stale fact
   confidently is worse than one that returns nothing. So the first commitment
   is that superseded facts are never silently returned as current.
2. **The advantage has to be HydraDB's, not a wrapper's.** Anything achievable
   with a vector index and a date filter is not worth building here. The claim
   is specifically that bounded multi-hop traversal over an evidence graph
   answers questions similarity search cannot express, and that has to survive
   an ablation, not just a demo.
3. **A judge has to be able to reproduce it.** Numbers that only exist in a
   README are not numbers.

## Why abstention is the wedge

The track text says long-context models "mostly fail at abstention: knowing when
the answer simply is not in the history and saying so instead of inventing one."

Every retrieval system can return "no results". That is not abstention, that is
an empty list. Abstention is telling the caller *why* the answer is not
available, in a form a program can act on. There is a real difference between:

- the history never contained this fact,
- it contained it and it was later overwritten and no current value exists,
- two sources contradict each other and nothing resolves the conflict,
- the fact exists but the relation needed to connect it to the question does not,
- the question is out of scope for this memory.

A similarity-based memory layer collapses all five into "low score". A graph
that stores evidence and revision edges can distinguish them, because the
distinction is structural. That is the part that is hard to do without a graph,
which is exactly what the Best Use of HydraDB award asks for.

## Consequences

- The evaluation must measure abstention as a first-class outcome (precision,
  recall, F1, and false-answer rate), not just answer accuracy. A system that
  answers everything can score well on accuracy while being useless.
- Baselines must include at least one lexical and one vector retriever, or the
  comparison proves nothing.
- The demo has to show a superseded fact and a structured abstention, because
  those are the two claims. A pretty graph that does neither is a screensaver.
- The product surface has to be a developer product. The rules say
  "working, thoughtful products, not just benchmark scores", twice.

## Alternatives considered

**Track 01 with an ontology aligner.** Rejected on scope. Entity resolution over
nine noisy sources is a good problem and a bad nine-day solo project, and the
graph work would arrive last.

**Track 03 as a straight mem0 clone with better chunking.** Rejected because it
does not need a graph. If the project would work roughly as well on Postgres and
pgvector, it fails judging criterion 02 regardless of how good the numbers are.

**Track 03 scoring benchmarks only.** Rejected on the published criteria. Four
of the five criteria are not benchmark scores.
