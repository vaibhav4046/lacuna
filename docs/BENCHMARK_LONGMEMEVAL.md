# LongMemEval integration

**No LongMemEval number has been produced by this repository.** Nothing in this
document reports a score. What exists is the integration: the official format
read correctly, an adapter that cannot carry an answer into ingestion, claim
extraction from the raw haystack prose, a deterministic hypothesis runner that
refuses to invent, and an official-compatible paid-judge client. The repository
can now produce hypotheses and, when an owner supplies a judge key and budget,
an auditable evaluation log; it does not claim a score until that run actually
completes.

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
budget. The repository includes the same prompt branches and model mappings in
`benchmarks/longmemeval/judge.ts`, exposed as:

```bash
npm run bench:longmemeval:judge -- \
  --dataset data/longmemeval_oracle.json \
  --hypotheses artifacts/longmemeval/run/hypotheses.jsonl \
  --out artifacts/longmemeval/run/judge.jsonl \
  --model gpt-4o-mini
```

The command fails closed when `OPENAI_API_KEY` is absent, rejects duplicate or
partial hypothesis files on the default path, and enforces a 500-call default
budget. A partial diagnostic run must opt into `--max-calls` explicitly. No such
key is configured in this repository and no such call has been made, so there
is still no official score.

Before treating a downloaded file as the official oracle tier, run the identity
gate:

```bash
npm run bench:longmemeval:verify -- data/longmemeval_oracle.json
```

It requires the pinned filename, 15,388,478 bytes, the recorded SHA-256, exactly
500 unique question ids, and the recorded SHA-256 of the lexically sorted id
stream. The command only verifies acquisition identity; it never calls a judge
and never emits a score.

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
  personal.ts   scoped, exact-span first-person fact extraction for this domain
  coverage.ts   official question-type coverage summary for the published run
  artifact.ts   what a run must record about itself
  run.ts        the deterministic hypothesis runner
  answerer.ts   the bounded planner-backed answerer
  judge.ts      the official prompt-compatible, fail-closed judge client
tests/unit/longmemeval-adapter.test.ts
tests/unit/longmemeval-judge.test.ts
```

```bash
npm run bench:longmemeval -- --dataset data/longmemeval_oracle.json
```

Ground truth isolation is structural rather than conventional. `load.ts`
exports `stripGroundTruth`, which rebuilds each record field by field into an
`IngestibleQuestion`, a type produced by `Omit`ing `answer`,
`answer_session_ids` and the turn-level `has_answer` from the official shape.
The adapter's parameter is that type, so reading a gold answer inside the
adapter does not compile.

The type is not the guarantee, and it is worth being exact about that because
this is the claim a sceptical judge should test hardest. TypeScript rejects
excess properties only on object literals, so handing the adapter a full
record through a variable compiles cleanly. That was checked, and it does.
`Omit` also removes nothing at runtime.

**The guarantee is that the adapter enumerates the fields it copies rather than
spreading the turn.** A message is built from eight named fields and
`has_answer` is not one of them, so ground truth has no path into the output
even when it is sitting on the input. `tests/unit/longmemeval-adapter.test.ts`
hands the adapter the answer bearing record on purpose and asserts the
serialised output contains neither the marker nor the answer string, and that
every message carries exactly those eight keys.

The adapter's return type declares `questions: readonly never[]`, so the value
it hands ingestion cannot be given a question with an expected answer either.

The runner fails loudly when the dataset is absent or malformed. Its default
answerer is `lacuna-deterministic-planner-v1`: it uses the same sentence planner
and evidence resolver as the product and writes an abstention when the bounded
planner cannot read a question. It never writes a hypothesis from the gold
answer, and it never pretends that writing hypotheses is an official score.

## Claims out of the haystack

Lacuna ingests `ClaimAnnotation` and `EvidenceSpan` records, and its own corpus
supplies them because it generated the prose from them. LongMemEval supplies
prose and nothing else, so `src/extract` reads the claims out of it and the
adapter attaches them to the turns that produced them.

The haystack is extracted in **one pass over every session in order**, not
session by session. Extraction carries the state that decides which spelling of
a name was seen first and which value currently stands, and that state is what
makes a later statement supersede an earlier one. Knowledge Updates is a named
ability of this benchmark and the update always crosses a session boundary, so
extracting per session discards exactly the thing being tested. This was found
by running the adapter rather than by reading it: with a pass per session, the
subject interned twice and the change superseded nothing.

What comes out is what the extractor could justify from a sentence and a span,
which is less than a reader would understand from the same text. Recall is not
measured here and no number for it is claimed. The limit is stated in
[README](../README.md) beside the thesis.

## The real dataset, through the real adapter

`longmemeval_oracle.json` was downloaded and all 500 published instances were
pushed through the loader and the adapter. Reproduce with:

```bash
npx tsx scripts/longmemeval-ingest-check.ts
```

Written to [artifacts/longmemeval/ingest-check.json](../artifacts/longmemeval/ingest-check.json).

| | |
| --- | --- |
| instances read | 500 |
| parse failures | **0** |
| adapter failures | **0** |
| ground truth leaks | **0** |
| sessions | 948 |
| messages | 10,960 |
| estimated tokens | 3,303,216 |
| read in | 1.5s |

The same artifact also records coverage by the official question type, so the
16.8% aggregate cannot hide a type-specific gap:

| question type | instances | with a claim | claims | abstentions |
| --- | ---: | ---: | ---: | ---: |
| single-session-user | 70 | 8 | 9 | 6 |
| single-session-assistant | 56 | 6 | 7 | 0 |
| single-session-preference | 30 | 2 | 3 | 0 |
| multi-session | 133 | 25 | 37 | 12 |
| temporal-reasoning | 133 | 25 | 42 | 6 |
| knowledge-update | 78 | 18 | 30 | 6 |

These are extraction/ingestion counts only. They are not per-type accuracy,
retrieval recall or an official LongMemEval score.

The first three rows are the ones worth having. The format reader and the
leakage guarantee were previously tested only against fixtures handwritten from
the README, which proves the code reads the shape it was told about and proves
nothing about the shape that is published. They now hold against the published
file: every record parses, and no serialised haystack contains `has_answer` or
`answer_session_ids`.

## The extractor boundary and the measurement

The production frame table still targets infrastructure prose. The benchmark
adapter now adds a separate, high-precision personal bridge for explicit
first-person degree, occupation, commute-duration and a few other facts; it does
not widen the production extractor or pretend to read arbitrary English.
Across the published oracle tier, **128 claims came out of 3.3 million tokens
and 84/500 instances (16.8%) carried at least one**. This is ingest coverage,
not answer accuracy or an official benchmark score.

The frame table was written for infrastructure conversations: where a service
stores its data, who owns it, what it depends on, what region it runs in.
LongMemEval is a personal assistant benchmark about degrees, hobbies, purchases
and appointments. Run against it, the frames match surface syntax in prose they
have no business reading. Before any guard, 364 claims came out, including:

```
[storage]    to her new apartment, and I used my car = transport some of her furniture
[depends_on] decision                                = your priorities
[policy]     Items                                   = in their original condition
```

None of those are facts about a thing. Every one was produced by a frame doing
exactly what it was written to do.

A precision guard was added in response, on the shape of a phrase rather than on
any frame: a name may not contain a clause boundary, may not be headed by a
preposition, may not be headed by a reader-relative word like "your" or
"several", and may not run past six words. It cut the count from 364 to 116 and
changed nothing on this project's own corpus, where all 1,150 unit tests still
pass. It is a real improvement and it did not fix the problem: sampling the 116
survivors still shows `[storage] aims = protect the state's coral reefs` and
`[policy] ** Surfboards = wrapped`.

Tightening further would be fitting the frames to this dataset, which is a
different thing from reading it, so it was not done.

**No LongMemEval score is claimed.** The deterministic runner is useful for
measuring pipeline behavior and producing inspectable hypotheses, but this
scoped parser remains intentionally sparse and is not an accepted benchmark
result.

## What a real run still needs

Two components remain before an accepted official result.

**Broader domain extraction and question/verbalisation.** The current bridge
handles a small, explicit personal vocabulary and the planner maps those
predicates into questions such as "What degree did I graduate with?". A broader
parser and answer verbaliser are still required before a score would mean what
the benchmark says it means.

Then, to score it: an API key for the judge model, and the budget for 500 calls
per run.

## Cost and prerequisites, in full

| what | detail |
|---|---|
| download | 15.4 MB (oracle), 277 MB (s), 2.74 GB (m). Public, no credential |
| store | a HydraDB node. The runner is pinned to the node profile, as the other benchmarks are |
| isolation | enforced by the runner: a multi-question run refuses unless a per-question source factory supplies isolated writable node graphs. Session ids are drawn from a shared pool and repeat across questions, so two haystacks in one graph would collide on keys |
| missing code | broader personal-domain extraction and question/verbalisation |
| judge | `gpt-4o`, `gpt-4o-mini` or `llama-3.1-70b-instruct`, 500 calls, paid, not configured here |

## Honest status

| step | status |
|---|---|
| official format confirmed | yes, against the repository source and README |
| loader and adapter | written, and run over all 500 published instances with 0 failures |
| ground truth isolation | structural, and verified against the published file rather than fixtures |
| dataset downloaded | yes, the oracle tier |
| claim extraction from haystack prose | scoped personal bridge plus core frames: 128 claims from 3.3M tokens (84/500 instances, 16.8% ingest coverage); no official score inferred |
| ground truth isolation | structural, enforced by types and asserted in tests |
| ingestion of a real haystack | adapted, not written to a store |
| hypotheses produced | deterministic runner implemented; multi-question runs fail closed without explicit per-question graph isolation; no full store-backed run accepted |
| official evaluation run | no |
| score | **none. No LongMemEval number exists for Lacuna** |
