# Official LongMemEval Oracle Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete, reproducible, officially judged 500-question LongMemEval oracle result in which HydraDB Cloud is the actual memory/retrieval system and no ground-truth answer fields cross the generation boundary.

**Architecture:** A new cloud-only runner loads an `IngestibleQuestion[]` through a ground-truth-stripping loader, writes each question's dated sessions into its own deterministic HydraDB collection, requires every receipt to reach terminal `completed`, retrieves graph-enriched chunks, and passes only the question/date/retrieved evidence to an explicit OpenAI-compatible answerer. An append-only fsynced checkpoint makes the serial run resumable. A sealed two-key hypotheses file is evaluated only by a pinned checkout of the official evaluator, and the final artifact records source/dataset commits, digests, model identities, costs, failures, collection algorithm, and raw evaluator evidence.

**Tech Stack:** TypeScript, HydraDB Cloud, existing OpenAI-compatible provider adapter, Node filesystem/crypto/process, Python 3.9 official evaluator, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-production-convergence-design.md`

**Pinned primary sources:**

- Evaluator repository: `https://github.com/xiaowu0162/LongMemEval.git` at commit `9e0b455f4ef0e2ab8f2e582289761153549043fc`.
- Cleaned official dataset repository: `https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned` at commit `98d7416c24c778c2fee6e6f3006e7a073259d48f`.
- Dataset file: `longmemeval_oracle.json`, exactly 500 questions.
- Official judge command: `python src/evaluation/evaluate_qa.py gpt-4o <hypotheses.jsonl> <oracle.json>` followed by `print_qa_metrics.py` from the same pinned checkout.

## Global Constraints

- The cloud runner never imports or calls `loadDataset()` and never receives a `LongMemEvalRecord`.
- `answer`, `answer_session_ids`, and `has_answer` are forbidden at the answerer boundary, checkpoint, hypotheses file, and serialized prompt audit.
- `Chunk.observedAt` is Hydra upload time, not benchmark session time. Session dates come only from machine-readable headers in generated documents.
- Each question uses a deterministic, per-run Hydra collection; collections persist because the current Cloud API exposes no delete.
- Ingestion is serial per question and answer generation is serial across questions. Resume never re-ingests or re-answers a completed checkpoint row.
- A run with fewer than exactly 500 unique official ids stays under `artifacts/benchmarks/incomplete/` and cannot contain a score.
- The official evaluator runs only after the hypotheses schema, id coverage, and SHA-256 seal pass.
- Oracle-tier results are labelled `oracle`; they are never described as LongMemEval-S, LongMemEval-M, or leaderboard-comparable retrieval over distractor history.
- Heavy tests and the real run use one worker/process.

---

### Task 1: Pinned upstream/data acquisition and provenance manifest

**Files:**
- Create: `scripts/longmemeval-acquire.ts`
- Create: `benchmarks/longmemeval/provenance.ts`
- Modify: `package.json`
- Test: `tests/unit/longmemeval-provenance.test.ts`

**Interfaces:**
- Produces: `LongMemEvalProvenance`
- Produces: `npm run bench:longmemeval:acquire`
- Writes ignored inputs under `.cache/longmemeval/`

- [ ] **Step 1: Write manifest validation tests**

Require exact 40-hex commits, HTTPS primary-source URLs, filename `longmemeval_oracle.json`, positive byte length, lowercase SHA-256, exactly 500 question ids, and evaluator files `src/evaluation/evaluate_qa.py` plus `print_qa_metrics.py`. Reject a moving `main` reference, wrong remote, missing file, or dataset with 499/duplicate ids.

- [ ] **Step 2: Write acquisition command-construction tests**

Inject process/download functions and assert the script uses:

```text
git clone --filter=blob:none --no-checkout https://github.com/xiaowu0162/LongMemEval.git <cache>/upstream
git -C <cache>/upstream checkout --detach 9e0b455f4ef0e2ab8f2e582289761153549043fc
https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_oracle.json
```

The script must not run arbitrary data/repository hooks and must not place the dataset or Python environment under tracked `data/` or `third_party/` paths.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-provenance.test.ts --maxWorkers=1`

Expected: acquisition and provenance modules are absent.

- [ ] **Step 4: Implement deterministic acquisition**

Download to a temporary sibling, stream while hashing, validate JSON before atomic rename, and refuse an existing file whose digest or question set differs. Clone/check out the evaluator at the exact commit and verify `git rev-parse HEAD`, remote URL, and required files. Write `.cache/longmemeval/provenance.json` with URLs, commits, filenames, bytes, SHA-256, acquisition time, and 500 sorted ids. Never store credentials or response headers.

Add `"bench:longmemeval:acquire": "tsx scripts/longmemeval-acquire.ts"` to `package.json`.

- [ ] **Step 5: Run focused tests and a real acquisition**

Run: `npx vitest run tests/unit/longmemeval-provenance.test.ts --maxWorkers=1`

Run: `npm run bench:longmemeval:acquire`

Expected: the test passes; the ignored cache contains the pinned evaluator, 500-question oracle file, and verified provenance manifest.

- [ ] **Step 6: Commit the acquisition boundary**

```bash
git add scripts/longmemeval-acquire.ts benchmarks/longmemeval/provenance.ts package.json tests/unit/longmemeval-provenance.test.ts
git commit -m "feat(benchmark): pin official LongMemEval inputs"
```

---

### Task 2: Ground-truth-free cloud documents and collection naming

**Files:**
- Modify: `benchmarks/longmemeval/load.ts`
- Create: `benchmarks/longmemeval/cloud-types.ts`
- Create: `benchmarks/longmemeval/cloud-documents.ts`
- Test: `tests/unit/longmemeval-cloud-documents.test.ts`
- Modify: `tests/unit/ground-truth-isolation.test.ts`

**Interfaces:**
- Produces: `loadIngestible(path): readonly IngestibleQuestion[]`
- Produces: `documentsFor(question): readonly CloudBenchmarkDocument[]`
- Produces: `collectionFor(runId, questionId): string`

- [ ] **Step 1: Write loader isolation tests**

Pass a literal official-shaped record and assert `loadIngestible` returns only `question_id`, `question_type`, `question`, `question_date`, and dated/role-labelled session turns. Recursively inspect every returned key and serialized value; reject `answer`, `answer_session_ids`, and `has_answer`. The cloud-run module source must import `loadIngestible`, never `loadDataset` or `stripGroundTruth`.

- [ ] **Step 2: Write deterministic document tests**

Require one document per haystack session, stable filename/collection for the same run/question, different collection for a different run, only safe lowercase collection characters, and a header exactly shaped as:

```text
LongMemEval session id: <opaque id>
Session date: <ISO timestamp>
Question id: <opaque id>

[user] ...
[assistant] ...
```

Assert role/content order is preserved while any source `has_answer` property is absent.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/longmemeval-cloud-documents.test.ts tests/unit/ground-truth-isolation.test.ts --maxWorkers=1`

Expected: cloud loader/document modules are absent.

- [ ] **Step 4: Implement stripped loading and documents**

Parse/validate the official JSON once, call `stripGroundTruth` inside the loader, serialize/reparse the stripped object, then run a recursive forbidden-key assertion before returning. Derive collection names from `sha256('longmemeval-v1\0' + runId + '\0' + questionId).slice(0, 24)` and prefix `lme-`; do not expose raw ids in collection names.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-adapter.test.ts tests/unit/longmemeval-cloud-documents.test.ts tests/unit/ground-truth-isolation.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit the ground-truth boundary**

```bash
git add benchmarks/longmemeval/load.ts benchmarks/longmemeval/cloud-types.ts benchmarks/longmemeval/cloud-documents.ts tests/unit/longmemeval-cloud-documents.test.ts tests/unit/ground-truth-isolation.test.ts
git commit -m "feat(benchmark): isolate LongMemEval cloud inputs"
```

---

### Task 3: Explicit answer-model adapter and audited prompt

**Files:**
- Create: `benchmarks/longmemeval/cloud-answerer.ts`
- Modify: `benchmarks/longmemeval/cloud-types.ts`
- Test: `tests/unit/longmemeval-answerer.test.ts`

**Interfaces:**
- Produces: `CloudAnswerer`
- Produces: `OpenAiCompatibleCloudAnswerer`
- Consumes: `src/provider/openai.ts#complete`

- [ ] **Step 1: Write prompt-boundary tests**

Construct literal retrieved evidence and assert the provider receives one system message and one user message containing only the question, question date, evidence text, source id/title, and session date parsed from the generated header. Recursively audit the JSON prompt record for forbidden keys and ensure `Chunk.observedAt` is never used as the session date.

- [ ] **Step 2: Write provider/output tests**

Require an explicit `LONGMEMEVAL_ANSWER_PROVIDER` in `groq|deepseek|ollama|vllm` and explicit model. Reject auto-selection, Anthropic, missing key/base URL, blank hypothesis, a response over 4,096 characters, or provider error. Record provider/model, token counts when supplied, elapsed time, and cost only when the adapter has an explicit price—not an estimate.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-answerer.test.ts --maxWorkers=1`

Expected: answerer module is absent.

- [ ] **Step 4: Implement the answer-only prompt**

Use the existing `complete(config, model, messages, { maxTokens })` seam. The system instruction says answer from retrieved evidence, preserve dates, and abstain plainly when unsupported; it must not mention reference answers or question types. Parse `Session date:` only from a validated generated-document header and strip that header from evidence text sent as dialogue.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-answerer.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit the answerer**

```bash
git add benchmarks/longmemeval/cloud-answerer.ts benchmarks/longmemeval/cloud-types.ts tests/unit/longmemeval-answerer.test.ts
git commit -m "feat(benchmark): answer only from retrieved Hydra evidence"
```

---

### Task 4: Durable checkpoint, resume, and canonical hypotheses

**Files:**
- Create: `benchmarks/longmemeval/checkpoint.ts`
- Test: `tests/unit/longmemeval-checkpoint.test.ts`

**Interfaces:**
- Produces: `CloudRunCheckpoint.open(path, expectedIds, identity)`
- Produces: `checkpoint.append(row): Promise<void>`
- Produces: `checkpoint.serialiseHypotheses(order): string`

- [ ] **Step 1: Write filesystem-backed checkpoint tests**

Use a temporary directory and assert every appended JSONL row is written to an open handle, synced, and closed before the promise resolves. Cover resume after interruption, canonical official-id order, duplicate id, foreign id, corrupt/truncated line, mismatched dataset/model/run identity, blank hypothesis, and an existing sealed run.

- [ ] **Step 2: Write no-reingest resume tests**

Load three ids with two completed checkpoint rows and assert `pendingIds()` returns only the third. An incomplete per-question phase record may resume from its earliest safe phase, but a completed hypothesis is immutable and cannot be overwritten.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-checkpoint.test.ts --maxWorkers=1`

Expected: checkpoint module is absent.

- [ ] **Step 4: Implement append-only checkpointing**

Write a versioned `run.json` identity before the first row and an append-only `checkpoint.jsonl`. Validate every existing row before resume. Record per-question collection, submitted ids, completed ids, retrieval chunk digests, prompt-audit digest, answer metadata, and hypothesis. Build `hypotheses.jsonl` only from validated completed rows using existing `serialiseHypotheses()`; never edit it in place.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-checkpoint.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit durable resume**

```bash
git add benchmarks/longmemeval/checkpoint.ts tests/unit/longmemeval-checkpoint.test.ts
git commit -m "feat(benchmark): checkpoint serial LongMemEval runs"
```

---

### Task 5: HydraDB Cloud runner with strict receipt semantics

**Files:**
- Create: `benchmarks/longmemeval/cloud-run.ts`
- Modify: `benchmarks/longmemeval/cloud-types.ts`
- Test: `tests/unit/longmemeval-cloud-run.test.ts`

**Interfaces:**
- Produces: `runCloudLongMemEval(options): Promise<CloudRunSummary>`
- Consumes: `HydraCloud.withCollection`, `ingestDocument`, `waitForIndexing`, and `query`

- [ ] **Step 1: Write successful fake-cloud orchestration test**

Assert each question selects `collectionFor(runId, id)`, ingests all session documents, requires exactly one non-empty unique receipt id per document, waits for all ids, accepts only `indexingStatus === 'completed'`, calls `query(question, { maxResults: 12 })`, converts returned chunks to audited evidence, calls the answerer once, and appends one checkpoint row.

- [ ] **Step 2: Write refusal/failure tests**

Cover missing/duplicate receipt ids, refused receipt, empty status list, timeout, `errored`/`failed` terminal status, missing completed id, query transport failure, zero chunks, answer failure, and checkpoint failure. Zero retrieved chunks must still yield an answerer call with empty evidence so the model can abstain, while the artifact records retrieval failure; it must never inject the reference answer.

- [ ] **Step 3: Write resume and serialism tests**

Use deferred fakes to prove no second question begins before the prior checkpoint is durably appended. A resumed completed id must make zero Hydra and provider calls. A retry after partial ingestion reuses the same deterministic collection/documents, relying on Hydra upsert convergence rather than claiming cleanup or exactly-once semantics.

- [ ] **Step 4: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-cloud-run.test.ts --maxWorkers=1`

Expected: cloud runner is absent.

- [ ] **Step 5: Implement the cloud loop**

The public entry point accepts only `readonly IngestibleQuestion[]`, `HydraCloud`, `CloudAnswerer`, checkpoint, run id, and clock. Do not import the oracle schema. Enforce the exact receipt/status rules before query; cap the status wait at 10 minutes per question; include graph context through the existing query option; hash but do not persist full provider prompts in the public artifact.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-cloud-run.test.ts tests/unit/cloud-source.test.ts tests/unit/ingest-source.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 7: Commit the Hydra runner**

```bash
git add benchmarks/longmemeval/cloud-run.ts benchmarks/longmemeval/cloud-types.ts tests/unit/longmemeval-cloud-run.test.ts
git commit -m "feat(benchmark): run LongMemEval through HydraDB Cloud"
```

---

### Task 6: Artifact schema, seals, and incomplete-run refusal

**Files:**
- Modify: `benchmarks/longmemeval/artifact.ts`
- Create: `benchmarks/longmemeval/verify.ts`
- Test: `tests/unit/longmemeval-verify.test.ts`
- Modify: `tests/unit/longmemeval-adapter.test.ts`

**Interfaces:**
- Produces: `verifyCloudRun(runDir, officialIds): VerifiedCloudRun`
- Produces: `sealCloudRun(runDir): Promise<RunSeal>`
- Expands: `RunArtifact` to a versioned oracle cloud schema

- [ ] **Step 1: Write exact hypotheses verification tests**

Require exactly 500 newline-delimited objects, exactly two own keys (`question_id`, `hypothesis`) per row, 500 unique expected ids, non-empty bounded hypotheses, canonical order, final newline, and SHA-256 equality with the seal. Reject extra metadata keys even if harmless.

- [ ] **Step 2: Write artifact invariants**

Require source/dataset commits and digests, `tier: 'oracle'`, collection algorithm/version, Hydra database but no token/collection list, answer/judge identities, timestamps/durations, exact completed/retrieval-failure counts, token/cost totals, checkpoint and prompt-audit digests, and official metric fields only when status is `evaluated`. An artifact under `incomplete` must have `metrics: null` and `officialEvaluator: null`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-adapter.test.ts --maxWorkers=1`

Expected: verifier and expanded artifact contract are absent.

- [ ] **Step 4: Implement sealing**

Rebuild hypotheses from checkpoint, write to a temporary file, fsync, hash, atomically rename, then write a seal containing hypotheses/checkpoint/artifact digests. Re-read all files after rename and verify again. Move/emit successful runs only under `artifacts/benchmarks/longmemeval/<run-id>/`; every failure path remains under `artifacts/benchmarks/incomplete/<run-id>/`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-adapter.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit artifact verification**

```bash
git add benchmarks/longmemeval/artifact.ts benchmarks/longmemeval/verify.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-adapter.test.ts
git commit -m "feat(benchmark): seal complete oracle hypotheses"
```

---

### Task 7: Cloud CLI and environment contract

**Files:**
- Create: `scripts/longmemeval-cloud.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Test: `tests/unit/longmemeval-cloud-cli.test.ts`

**Interfaces:**
- Produces: `npm run bench:longmemeval:cloud -- [--resume] --run-id <id> --out <dir>`

- [ ] **Step 1: Write CLI parsing/environment tests**

Require `LACUNA_PROFILE=cloud`, Hydra Cloud URL/token/database/base collection, explicit answer provider/model, pinned cached provenance, safe run id, output under the permitted artifact roots, and `--resume` identity equality. Reject node profile, an implicit provider, output traversal, existing evaluated run, and any CLI answer/ground-truth field.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-cloud-cli.test.ts --maxWorkers=1`

Expected: cloud CLI is absent.

- [ ] **Step 3: Implement the serial CLI**

Load `.env.local` only when explicitly passed `--env-file`; never print environment values. Bind `cloudFromEnv`, the explicit answerer, stripped loader, checkpoint, and runner. Handle SIGINT/SIGTERM by stopping before the next question and closing the checkpoint; preserve a resumable incomplete artifact. Print progress as question ordinal/id digest, phase, elapsed time, and cumulative cost only.

Add:

```json
"bench:longmemeval:cloud": "tsx scripts/longmemeval-cloud.ts"
```

Document only variable names in `.env.example`: `LONGMEMEVAL_ANSWER_PROVIDER`, `LONGMEMEVAL_ANSWER_MODEL`, `LONGMEMEVAL_RUN_ID`, `LONGMEMEVAL_UPSTREAM_DIR`, and `LONGMEMEVAL_JUDGE_MODEL`. Do not put evaluator keys into Vercel deployment configuration.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-cloud-cli.test.ts tests/unit/longmemeval-cloud-run.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 5: Commit the controlled runner**

```bash
git add scripts/longmemeval-cloud.ts .env.example package.json tests/unit/longmemeval-cloud-cli.test.ts
git commit -m "feat(benchmark): expose resumable cloud evaluation CLI"
```

---

### Task 8: Pinned official evaluator wrapper and metric parser

**Files:**
- Create: `benchmarks/longmemeval/evaluator.ts`
- Create: `scripts/longmemeval-evaluate.ts`
- Modify: `package.json`
- Test: `tests/unit/longmemeval-evaluator.test.ts`

**Interfaces:**
- Produces: `evaluateOfficial(runDir, provenance, env): Promise<OfficialEvaluation>`
- Produces: `npm run bench:longmemeval:evaluate -- --run-dir <dir>`

- [ ] **Step 1: Write pin/seal gate tests**

Refuse evaluation unless verifier returns a sealed complete run, upstream HEAD equals the pinned commit, remote URL is official, dataset bytes/digest match provenance, Python reports 3.9-compatible runtime, required lite dependencies import, judge model is exactly `gpt-4o`, and `OPENAI_API_KEY` is present without being printed.

- [ ] **Step 2: Write subprocess/output parser tests**

Use a fake process runner with literal official stdout/log fixtures. Assert the wrapper invokes `evaluate_qa.py`, then `print_qa_metrics.py`, captures stdout/stderr/exit codes, validates 500 log rows with `autoeval_label`, extracts overall, per-question-type, and abstention metrics, and rejects partial logs, NaN/out-of-range metrics, changed hypotheses digest, or non-zero exit.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-evaluator.test.ts --maxWorkers=1`

Expected: evaluator wrapper is absent.

- [ ] **Step 4: Implement isolated official evaluation**

Create/reuse `.cache/longmemeval/venv` with Python 3.9 and the pinned `requirements-lite.txt`. Run the official commands with cwd set to the pinned `src/evaluation`; pass only the judge key/organization and controlled paths in the child environment. Copy the raw `.log`, stdout, stderr summary, command metadata, and parsed metrics into the run directory, then update/reseal the artifact without modifying hypotheses.

Add `"bench:longmemeval:evaluate": "tsx scripts/longmemeval-evaluate.ts"` to `package.json`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-verify.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit the official evaluator gate**

```bash
git add benchmarks/longmemeval/evaluator.ts scripts/longmemeval-evaluate.ts package.json tests/unit/longmemeval-evaluator.test.ts
git commit -m "feat(benchmark): run the pinned official LongMemEval judge"
```

---

### Task 9: Real 500-question Hydra run, official score, and truthful product evidence

**Files:**
- Create after successful run: `artifacts/benchmarks/longmemeval/<run-id>/artifact.json`
- Create after successful run: `artifacts/benchmarks/longmemeval/<run-id>/hypotheses.jsonl`
- Create after successful run: `artifacts/benchmarks/longmemeval/<run-id>/seal.json`
- Create after successful run: `artifacts/benchmarks/longmemeval/<run-id>/official-evaluator.log`
- Create after successful run: `artifacts/benchmarks/longmemeval/<run-id>/official-metrics.json`
- Modify only after verified score: `docs/BENCHMARK_LONGMEMEVAL.md`
- Modify only after verified score: `docs/V10_RELEASE_STATUS.md`
- Modify only after verified score: `web/src/landing/Evals.tsx`
- Modify only after verified score: `web/src/app/routes/evaluations.tsx`

- [ ] **Step 1: Run all benchmark-local gates**

Run: `npm run typecheck`

Run: `npx vitest run tests/unit/longmemeval-adapter.test.ts tests/unit/ground-truth-isolation.test.ts tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-cloud-documents.test.ts tests/unit/longmemeval-answerer.test.ts tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-cloud-run.test.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-cloud-cli.test.ts tests/unit/longmemeval-evaluator.test.ts --maxWorkers=1`

Expected: all commands exit zero with no benchmark test skipped.

- [ ] **Step 2: Confirm secret availability without disclosure**

Check only set/unset state for Hydra Cloud credentials, the selected answer-provider credentials/base URL, and official judge credentials. Abort before spending if any required value is absent. Record provider/model/judge identifiers and the operator-approved run id; never record secret length, prefix, or value.

- [ ] **Step 3: Execute the serial cloud run**

Run:

```bash
npm run bench:longmemeval:cloud -- --run-id oracle-2026-08-21 --out artifacts/benchmarks/incomplete/oracle-2026-08-21
```

If interrupted, rerun with `--resume` against the same directory. Keep concurrency at one. Inspect every non-completed receipt/retrieval/provider failure and fix the root cause before resuming; do not silently skip a question.

- [ ] **Step 4: Verify and seal exactly 500 hypotheses**

Run the verifier independently. Require 500/500 unique ids, two keys per line, matching provenance and checkpoint digests, zero forbidden-key findings, recorded deterministic Hydra collection algorithm, and no score fields. Only then move/emit the run under `artifacts/benchmarks/longmemeval/oracle-2026-08-21/`.

- [ ] **Step 5: Run the pinned official evaluator**

Run:

```bash
npm run bench:longmemeval:evaluate -- --run-dir artifacts/benchmarks/longmemeval/oracle-2026-08-21
```

Require 500 official evaluator log rows and validated overall/per-type/abstention metrics. Re-run the verifier after evaluation and require hypotheses digest unchanged.

- [ ] **Step 6: Perform an independent artifact review**

Have a fresh review agent compare the official dataset id set, hypotheses, seal, raw evaluator log, parsed metrics, provenance, model metadata, retrieval failures, and forbidden-key audit. Any discrepancy keeps all public product copy at `No official score exists`.

- [ ] **Step 7: Update product claims only from the verified artifact**

Show the exact official oracle score, date, 500/500 count, judge model, answer model, retrieval failure count, and direct artifact path. Label it `LongMemEval oracle (evidence sessions only)`. Preserve the generated 64-question evaluation as a separate internal test and explicitly distinguish it.

- [ ] **Step 8: Run final claim/build gates**

Run: `npm run copy:lint`

Run: `npm --prefix web run typecheck`

Run: `npm --prefix web run build`

Run: `npx vitest run tests/unit --maxWorkers=1`

Expected: all commands pass; no page claims LongMemEval-S/M, leaderboard rank, or an official score differing from `official-metrics.json`.

- [ ] **Step 9: Commit the verified run and evidence**

```bash
git add artifacts/benchmarks/longmemeval/oracle-2026-08-21 docs/BENCHMARK_LONGMEMEVAL.md docs/V10_RELEASE_STATUS.md web/src/landing/Evals.tsx web/src/app/routes/evaluations.tsx
git commit -m "docs: publish verified official LongMemEval oracle evidence"
```
