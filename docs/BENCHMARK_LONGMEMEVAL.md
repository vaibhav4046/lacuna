# LongMemEval integration

**No LongMemEval number has been produced by this repository.** Nothing in this
document reports a score, and nothing in `benchmarks/longmemeval/` can produce
one yet. What exists is the integration scaffold: the official format read
correctly, an adapter that cannot carry an answer into ingestion, a runner that
refuses rather than invents, and this record of what a real run would still
need. Two components are missing and they are named in
[What a real run still needs](#what-a-real-run-still-needs).

## The benchmark

LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory.
Di Wu, Hongwei Wang, Wenhao Yu, Yuwei Zhang, Kai-Wei Chang, Dong Yu. ICLR 2025.

| what | where |
|---|---|
| repository | <https://github.com/xiaowu0162/LongMemEval> |
| paper | <https://arxiv.org/abs/2410.10813> |
| project page | <https://xiaowu0162.github.io/long-mem-eval/> |
| dataset | <https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned> |
| V2 (not integrated here) | <https://github.com/xiaowu0162/LongMemEval-V2> |

500 questions. The project page states "500 questions of seven types". The six
`question_type` values below are six of those seven; abstention is the seventh
and is carried as a marker on the question id rather than as a type of its own.

## The dataset files

Three tiers, each holding the same 500 evaluation instances and differing only
in how much distractor history surrounds the evidence. Sizes are the file sizes
listed on the Hugging Face repository.

| file | size | what it holds |
|---|---|---|
| `longmemeval_oracle.json` | 15.4 MB | evidence sessions only |
| `longmemeval_s_cleaned.json` | 277 MB | ~115k tokens per instance, 30 to 40 sessions |
| `longmemeval_m_cleaned.json` | 2.74 GB | ~500 sessions per instance, ~1.5M tokens |

Download, as given in the repository README:

```bash
wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json
wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json
wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_m_cleaned.json
```

No credential is needed to download. The Hugging Face repository is public and
the total repository size is listed as 3.03 GB.

**The `_m` tier cannot be read by the loader in this repository.** It is a
single 2.74 GB JSON document and `JSON.parse` needs the whole thing as one
string, which is past V8's maximum string length. Reading it needs a streaming
parser that has not been written. `oracle` and `s` are both under that limit.

## The input schema

One JSON array. Each element is one evaluation instance. Field names are as
given in the repository README and as consumed by
`src/retrieval/run_retrieval.py`.

| field | type | notes |
|---|---|---|
| `question_id` | string | contains `_abs` when the question is an abstention question |
| `question_type` | string | one of the six values below |
| `question` | string | the question as asked |
| `answer` | string | **ground truth.** Never enters this repository's product path |
| `question_date` | string | when the question is asked, e.g. `2023/05/30 (Tue) 23:40` |
| `haystack_session_ids` | string[] | one id per session |
| `haystack_dates` | string[] | one timestamp per session, same order and length |
| `haystack_sessions` | turn[][] | one array of turns per session, same order and length |
| `answer_session_ids` | string[] | **ground truth.** Which sessions hold the evidence |

A turn is `{"role": "user" | "assistant", "content": "..."}`. Turns that carry
evidence additionally have `"has_answer": true`. That field is **ground truth**
at turn granularity and the official retrieval code asserts it is a boolean when
present.

The three haystack arrays are parallel. The official code zips them:

```python
for cur_sess_id, sess_entry, ts in zip(entry['haystack_session_ids'],
                                       entry['haystack_sessions'],
                                       entry['haystack_dates']):
```

Two details worth knowing before writing anything against this format:

- **Session ids leak evidence membership.** The official retrieval code branches
  on `if 'answer' not in sess_id`, so an evidence session id contains the
  substring `answer` (for example `answer_280352e9`). Preserving session ids
  verbatim, which this integration does, therefore carries a weak ground truth
  signal into the store. Lacuna's retrieval never reads a session key to decide
  anything, so it is inert here, but a retriever that scored on session
  identifiers would be cheating and would not know it.
- **`answer` is not consistently typed.** The Hugging Face dataset viewer fails
  on this dataset with a type error reporting that the `answer` column mixes
  string and integer values. The loader here treats the field as `unknown`,
  which costs nothing because nothing reads it.

Timestamps are **not ISO 8601**. `2023/05/30 (Tue) 23:40` is the format seen in
the example record on the project page and in the EvalScope documentation for
this benchmark. This integration stores them verbatim rather than converting,
because a conversion that guesses a timezone is a silent corruption of the one
axis the benchmark tests hardest.

## The output format

From the repository README: save the outputs in a `jsonl` format with each line
containing two fields, `question_id` and `hypothesis`.

```jsonl
{"question_id": "e47becba", "hypothesis": "Business Administration"}
```

## The evaluation script

```bash
cd src/evaluation
python3 evaluate_qa.py gpt-4o your_hypothesis_file ../../data/longmemeval_oracle.json
```

Three positional arguments, in order: `metric_model`, `hyp_file`, `ref_file`.
Accepted metric models are `gpt-4o`, `gpt-4o-mini` and
`llama-3.1-70b-instruct`. The reference file is one of the three dataset files
above and is read for `question_id`, `question`, `answer` and `question_type`.

The script writes `{hyp_file}.eval-results-{metric_model_short}`, which is every
input field plus an `autoeval_label` object holding the judging `model` and a
boolean `label`. `print_qa_metrics.py` reads that log and prints per type
accuracy plus abstention accuracy.

The judge picks a prompt per `question_type`, with two behaviours worth noting:
`temporal-reasoning` allows an off-by-one tolerance on time units, and
`knowledge-update` accepts an answer that mentions the superseded value
alongside the updated one. Abstention questions get a different prompt,
selected by `'_abs' in entry['question_id']`.

**The official evaluation is an LLM judge and it costs money.** Running it means
500 calls to `gpt-4o` (or a hosted Llama 3.1 70B), so it needs an API key and a
budget. No such key is configured in this repository and no such call has been
made.

## The ability taxonomy

Five abilities in the paper: Information Extraction, Multi-Session Reasoning,
Knowledge Updates, Temporal Reasoning, Abstention.

| `question_type` | ability |
|---|---|
| `single-session-user` | Information Extraction |
| `single-session-assistant` | Information Extraction |
| `multi-session` | Multi-Session Reasoning |
| `knowledge-update` | Knowledge Updates |
| `temporal-reasoning` | Temporal Reasoning |
| `single-session-preference` | **NOT CONFIRMED** |

`single-session-preference` is a real `question_type` and appears in
`print_qa_metrics.py`'s type list, but which of the five headline abilities it
rolls up to could not be confirmed from the repository, the project page, or the
paper text retrieved. The paper describes it as testing personalised response
generation and evaluates it against a rubric rather than against a value. This
integration therefore gives it its own bucket, `preference`, rather than
guessing.

Abstention is orthogonal to type, not a seventh value of it. The official code
detects it with `'_abs' in question_id`, a substring test rather than a suffix
test, and this integration matches that exactly.

Per-type question counts were **NOT CONFIRMED**. The project page presents the
distribution as a figure only.

## What this repository added

```
benchmarks/longmemeval/
  schema.ts     official record types, the ability map, the abstention test
  load.ts       reads and validates a dataset file, and strips ground truth
  adapt.ts      one question's haystack into raw sessions for ingestion
  artifact.ts   what a run must record about itself
  run.ts        the runner, and the two places it refuses
tests/unit/longmemeval-adapter.test.ts
```

```bash
npm run bench:longmemeval -- --dataset data/longmemeval_oracle.json
```

Ground truth isolation is structural rather than conventional. `load.ts`
exports `stripGroundTruth`, which rebuilds each record field by field into an
`IngestibleQuestion`, a type produced by `Omit`ing `answer`,
`answer_session_ids` and the turn-level `has_answer` from the official shape.
The adapter's parameter is that type, so reading a gold answer inside the
adapter is a compile error rather than a code review finding. The adapter's
return type declares `questions: readonly never[]`, so the value it hands
ingestion cannot be given a question with an expected answer either.

The runner fails loudly in two places and neither has a fallback: an absent or
malformed dataset file throws with the download command in the message, and a
run with no answerer wired throws naming the two components below. It never
writes a hypothesis it did not get from a system.

## What a real run still needs

Two components, neither of which exists in this repository.

**A claim extractor.** Lacuna ingests `ClaimAnnotation` and `EvidenceSpan`
records, and its synthetic corpus supplies them because it generated the prose
from them. LongMemEval supplies raw conversational prose and nothing else. The
adapter therefore emits sessions with `claims: []` and `entities: []`, which
means the graph it produces holds sessions and messages and no claims, and
`resolve` has nothing to resolve. Until prose can become subject, predicate,
object and a supporting span, Lacuna cannot answer a LongMemEval question at
all. This is the blocking gap, and it is an LLM-shaped one.

**A question parser and a verbaliser.** `ask` takes
`{subject, predicate, via}`, not a sentence. LongMemEval asks "What degree did I
graduate with?". Something has to turn that sentence into a structured question,
and turn the resulting `Outcome` back into the free text string the official
hypothesis file wants.

Then, to score it: an API key for the judge model, and the budget for 500 calls
per run.

## Cost and prerequisites, in full

| what | detail |
|---|---|
| download | 15.4 MB (oracle), 277 MB (s), 2.74 GB (m). Public, no credential |
| store | a HydraDB node. The runner is pinned to the node profile, as the other benchmarks are |
| isolation | one question's haystack per graph. Session ids are drawn from a shared pool and repeat across questions, so two haystacks in one graph collide on keys |
| missing code | a claim extractor and a natural language question parser |
| judge | `gpt-4o`, `gpt-4o-mini` or `llama-3.1-70b-instruct`, 500 calls, paid, not configured here |

## Honest status

| step | status |
|---|---|
| official format confirmed | yes, against the repository source and README |
| loader and adapter | written, unit tested against handwritten fixtures |
| ground truth isolation | structural, enforced by types and asserted in tests |
| dataset downloaded | no |
| ingestion of a real haystack | not run |
| hypotheses produced | none |
| official evaluation run | no |
| score | **none. No LongMemEval number exists for Lacuna** |
