# Official LongMemEval Oracle Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete, auditable, officially judged 500-question LongMemEval oracle result in which HydraDB Cloud is the actual memory/retrieval system and no ground-truth answer fields or encoded labels cross the generation boundary.

**Architecture:** A new cloud-only runner loads an `IngestibleQuestion[]` through a ground-truth-stripping loader, writes each question's dated sessions under opaque deterministic source ids in its own deterministic HydraDB collection, live-verifies idempotent upsert and byte-for-byte readback, requires every exact receipt to reach terminal `completed`, and passes only bounded Hydra-returned chunks plus verbatim benchmark wall-clock dates to a narrow answer input. An exclusive, hash-chained, fsynced checkpoint makes the serial run resumable only when the service proves that contract; otherwise an interrupted or ambiguous run is abandoned and restarted under a fresh run id. Immutable generation and evaluation manifests separately seal the two-key hypotheses and the raw official evaluator evidence without circular digests.

**Tech Stack:** TypeScript, HydraDB Cloud, existing OpenAI-compatible provider adapter, Node filesystem/crypto/process, Python 3.9 official evaluator, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-production-convergence-design.md`

**Pinned primary sources:**

- Evaluator repository: `https://github.com/xiaowu0162/LongMemEval.git` at commit `9e0b455f4ef0e2ab8f2e582289761153549043fc`.
- Cleaned official dataset repository: `https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned` at commit `98d7416c24c778c2fee6e6f3006e7a073259d48f`.
- Dataset file: `longmemeval_oracle.json`, exactly 500 questions.
- Dataset bytes: exactly `15388478`; SHA-256 `821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c`; SHA-256 of the lexically sorted ids joined by `\n` with one final `\n`: `f038965c54b03632f86a59104dd77848b66e3f80c08d5fbabdd3984d16457811`.
- Official judge commands, from cwd `<upstream>/src/evaluation`: `python evaluate_qa.py gpt-4o <hypotheses-or-batch.jsonl> <oracle.json>`, producing `<hypotheses-or-batch.jsonl>.eval-results-gpt-4o`, then `python print_qa_metrics.py <merged-eval-results.jsonl> <oracle.json>`. `print_qa_metrics.py` receives no model argument.
- Evaluator runtime: `uv 0.11.21`, CPython `3.9.25`, and a reviewed hash-locked transitive requirements file derived from the pinned upstream `requirements-lite.txt`. Python 3.9 is end-of-life and is used only inside this isolated evaluator environment because it is the upstream-declared runtime.

## Global Constraints

- The cloud runner never imports or calls `loadDataset()` and never receives a `LongMemEvalRecord`. The answerer receives `AnswerInput`, never `IngestibleQuestion`; `AnswerInput` excludes question id, question type, session ids, collection, and all dataset records.
- `answer`, `answer_session_ids`, `has_answer`, raw `question_id`, raw `haystack_session_ids`, the `_abs` encoded abstention label, and the `answer_` session-id marker are forbidden in indexed document text/title/filename, answer input, provider messages, retrieval/prompt audit, and any consumed graph context. The runner alone retains question id for collection selection, checkpoint association, and hypotheses output.
- LongMemEval dates remain byte-for-byte wall-clock strings such as `2023/05/30 (Tue) 23:40`; no timezone is invented and no ISO conversion occurs. `Chunk.observedAt` is Hydra upload time and is never a benchmark session date. A durable opaque-source-to-verbatim-date sidecar supplies dates even when a returned chunk contains no header.
- Each question uses a deterministic, per-run Hydra collection; collections persist because the current Cloud API exposes no delete.
- Ingestion is serial per question and answer generation is serial across questions. Resume never re-ingests or re-answers a completed checkpoint row. A lost/ambiguous document response is retried only after the live gate proved deterministic source-id upsert and readback; otherwise the run becomes non-resumable and must restart with a fresh run id and collection set.
- Exactly one process owns a run directory. `run.json`, checkpoint rows, audits, hypotheses, manifests, and evaluator batch outputs use atomic rename or append+fsync as specified below; no completed state is inferred from an unsynced file.
- A run with fewer than exactly 500 unique official ids stays under `artifacts/benchmarks/incomplete/` and cannot contain a score.
- The official evaluator runs only after the hypotheses schema, exact sorted-id digest, and immutable generation manifest pass. The final score is publishable only after a separate non-circular evaluation manifest covers every raw evaluator and metric artifact.
- Oracle-tier results are labelled `oracle`; they are never described as LongMemEval-S, LongMemEval-M, or leaderboard-comparable retrieval over distractor history.
- The answer path is described as bounded `HydraDB Cloud returned chunks`. Although `HydraCloud.query()` requests `graph_context: true`, raw `graphContext: unknown` is never put into the prompt. The artifact records that graph context was requested but not consumed and records its canonical digest; no copy calls the chunks graph-enriched. A future normalized graph mode requires its own bounded typed contract and is outside this run.
- Provider and judge calls have explicit call, input, output, wall-clock, and spend ceilings. Exact usage/cost is recorded only when measured; otherwise the artifact records `null` plus a reason. Cloud-provider and judge runs also require an operator-approved external account/project hard spend limit because a client-side estimate is not a hard control.
- Every publishable text or JSON artifact is scanned for the exact configured secret values before the evaluation manifest is written; scans never record secret value, prefix, or length.
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

Require the two exact 40-hex commits above, exact HTTPS primary-source origins, filename `longmemeval_oracle.json`, exactly `15388478` bytes, exact dataset SHA-256 `821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c`, exactly 500 unique question ids, and exact sorted-id digest `f038965c54b03632f86a59104dd77848b66e3f80c08d5fbabdd3984d16457811`. Store both the 500 lexically sorted ids and their digest so that the same order drives checkpoint and hypotheses output. Require evaluator files `src/evaluation/evaluate_qa.py`, `src/evaluation/print_qa_metrics.py`, and `requirements-lite.txt`. Reject a moving `main` reference, wrong remote, missing file, byte/digest mismatch, 499 ids, duplicate ids, or a changed id set even when the count remains 500.

- [ ] **Step 2: Write acquisition command-construction tests**

Inject process/download functions and assert the script uses:

```text
git clone --filter=blob:none --no-checkout https://github.com/xiaowu0162/LongMemEval.git <cache>/upstream
git -C <cache>/upstream checkout --detach 9e0b455f4ef0e2ab8f2e582289761153549043fc
https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_oracle.json
```

Construct the Git subprocess with `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<new empty temp file>`, and `-c core.hooksPath=<new empty temp directory>` for clone, fetch, checkout, and verification. Do not inherit repository/system/global hooks, credential helpers, aliases, or filter commands. The download client sends no cookies, authorization, or caller headers; follows redirects only from `huggingface.co` to the exact documented Hugging Face/Xet content hosts; rejects every non-2xx status; applies connect, inactivity, and total deadlines; and aborts as soon as streamed bytes exceed `15388478`. The script must not place the dataset or Python environment under tracked `data/` or `third_party/` paths.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-provenance.test.ts --maxWorkers=1`

Expected: acquisition and provenance modules are absent.

- [ ] **Step 4: Implement deterministic acquisition**

Download to a temporary sibling, stream while hashing, require the expected byte count and SHA-256 before parsing, validate JSON and the exact sorted-id digest before atomic rename, fsync the file and containing directory, and refuse an existing file whose digest or question set differs. Clone/check out the evaluator under the isolated Git configuration and verify `git rev-parse HEAD`, exact remote URL, required files, and their digests. Write `.cache/longmemeval/provenance.json` atomically with URLs, commits, filenames, expected/observed bytes and SHA-256, acquisition time, 500 sorted ids, sorted-id digest, and evaluator-file digests. Never store credentials, response headers, redirect query strings, or environment values.

Add `"bench:longmemeval:acquire": "tsx scripts/longmemeval-acquire.ts"` to `package.json`.

- [ ] **Step 5: Run focused tests and a real acquisition**

Run: `npx vitest run tests/unit/longmemeval-provenance.test.ts --maxWorkers=1`

Run: `npm run bench:longmemeval:acquire`

Expected: the test passes; the ignored cache contains the pinned evaluator, the exact 15,388,478-byte/500-question oracle file, and a verified provenance manifest whose dataset and sorted-id digests equal the constants above.

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
- Produces: `documentsFor(runId, question): readonly CloudBenchmarkDocument[]`
- Produces: `collectionFor(runId, questionId): string`
- Produces: `AnswerInput` containing only `question`, `questionDate`, and bounded `evidence`
- Produces: `CloudBenchmarkDocument` with opaque `sourceId`, opaque `filename`, verbatim `sessionDate`, canonical `text`, and `sha256`

- [ ] **Step 1: Write loader isolation tests**

Pass a literal official-shaped record and assert `loadIngestible` returns only `question_id`, `question_type`, `question`, `question_date`, and dated/role-labelled session turns. Recursively inspect every returned key; reject `answer`, `answer_session_ids`, and `has_answer`. Include an abstention fixture whose id ends `_abs` and sessions whose ids begin `answer_`. The cloud-run module source must import `loadIngestible`, never `loadDataset` or `stripGroundTruth`, while `CloudAnswerer` must accept only `AnswerInput`, never `IngestibleQuestion`.

- [ ] **Step 2: Write deterministic document tests**

Require one document per haystack session, stable opaque source id/filename/collection for the same run/question, different collection for a different run, only safe lowercase collection/source characters, and canonical text exactly shaped as:

```text
LongMemEval document: <opaque deterministic source id>
Session date (LongMemEval wall clock, verbatim): 2023/05/30 (Tue) 23:40

[user] ...
[assistant] ...
```

Derive the opaque source id from `sha256('longmemeval-document-v1\0' + runId + '\0' + sessionOrdinal + '\0' + verbatimDate + '\0' + canonicalTurns)` and use only that id in the filename/title. Raw question id, question type, raw session id, `_abs`, and `answer_` must not occur in indexed text/title/filename. Assert role/content order is preserved while any source `has_answer` property is absent. Validate the source wall-clock format and calendar/day-of-week consistency without converting it or assigning a timezone. A metamorphic test replaces question id, question type, and raw session ids while preserving question/date/turns and proves that document bodies, answer input, and eventual provider messages are unchanged; collection association may change but remains opaque.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/longmemeval-cloud-documents.test.ts tests/unit/ground-truth-isolation.test.ts --maxWorkers=1`

Expected: cloud loader/document modules are absent.

- [ ] **Step 4: Implement stripped loading and documents**

Parse/validate the official JSON once, call `stripGroundTruth` inside the loader, serialize/reparse the stripped object, then run a recursive forbidden-key assertion before returning. Preserve `question_date` and every `haystack_date` byte-for-byte after strict wall-clock validation. Derive collection names from `sha256('longmemeval-v1\0' + runId + '\0' + questionId).slice(0, 24)` and prefix `lme-`; do not expose raw ids in collection names. Build and later durably checkpoint a sidecar keyed by opaque source id with only session ordinal, verbatim session date, document SHA-256, and opaque filename. Keep raw question/session ids solely in the runner's non-provider association state needed to emit the official `question_id`.

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
- Modify: `src/provider/openai.ts`
- Test: `tests/unit/longmemeval-answerer.test.ts`
- Test: `tests/unit/provider-openai.test.ts`

**Interfaces:**
- Produces: `CloudAnswerer`
- Produces: `OpenAiCompatibleCloudAnswerer`
- Expands: `complete(..., { signal, timeoutMs, maxTokens })` with keyless-local support and strict optional usage
- Consumes: `src/provider/openai.ts#complete`

- [ ] **Step 1: Write prompt-boundary tests**

Construct literal bounded evidence plus an opaque-source/date sidecar and assert the provider receives one system message and one user message containing only the question, verbatim question wall-clock date, evidence text, opaque source id/title, and sidecar session date. Include a headerless chunk and prove it receives the correct date from the sidecar. Recursively audit both prompt keys and serialized values for the forbidden ground-truth fields/encoded labels in Global Constraints; ensure `Chunk.observedAt`, raw question/session ids, `_abs`, and `answer_` never occur. The exact messages written to `prompt-audit.jsonl` must byte-match the messages passed to `complete()` and contain no request headers or provider configuration.

- [ ] **Step 2: Write provider/output tests**

Require an explicit `LONGMEMEVAL_ANSWER_PROVIDER` in `groq|deepseek|ollama|vllm` and explicit model. Reject auto-selection, Anthropic, missing cloud key, missing base URL, blank hypothesis, a response over 4,096 characters, or provider error. Permit a missing key only when `ProviderConfig.where === 'local'`; omit the Authorization header entirely in that case. Strictly decode optional non-negative integer `prompt_tokens`, `completion_tokens`, and `total_tokens`, preserve both requested and provider-reported model identities, and reject malformed usage or a response-model change after the first completed answer. Record usage as measured or `null` with `provider_did_not_report_usage`; cost is measured only from reported usage and explicit versioned input/output prices.

Set immutable run-identity ceilings before the first call: 500 answer calls, 70,000 prompt characters per call, 1,200 output tokens per call, a caller-supplied total answer-token ceiling, a caller-supplied run deadline, and a caller-supplied maximum answer spend. A cloud answer run additionally requires explicit per-million input/output prices and an operator-approved external provider-account hard limit at or below the recorded maximum. Before each request, reserve worst-case spend from the bounded prompt/output; stop under `incomplete` before a call that could exceed a ceiling. Test caller abort, timeout, call/token/spend exhaustion, missing price, exact measured cost, and measured-or-null usage.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-answerer.test.ts tests/unit/provider-openai.test.ts --maxWorkers=1`

Expected: answerer module is absent.

- [ ] **Step 4: Implement the answer-only prompt**

Extend and use the existing `complete(config, model, messages, { maxTokens: 1200, timeoutMs, signal })` seam. The system instruction says answer from retrieved evidence, preserve the supplied verbatim wall-clock dates, and abstain plainly when unsupported; it must not mention reference answers, question ids, question types, abstention labels, collection names, or Hydra upload time. Evidence dates come only from the validated opaque-source sidecar; remove the generated document header from a chunk when present, but do not require a chunk to contain it. Enforce the prompt/output/call/token/spend ceilings before returning the exact audited messages and typed answer metadata.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-answerer.test.ts tests/unit/provider-openai.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit the answerer**

```bash
git add benchmarks/longmemeval/cloud-answerer.ts benchmarks/longmemeval/cloud-types.ts src/provider/openai.ts tests/unit/longmemeval-answerer.test.ts tests/unit/provider-openai.test.ts
git commit -m "feat(benchmark): answer only from retrieved Hydra evidence"
```

---

### Task 4: Durable checkpoint, resume, and canonical hypotheses

**Files:**
- Create: `benchmarks/longmemeval/checkpoint.ts`
- Create: `benchmarks/longmemeval/audit.ts`
- Test: `tests/unit/longmemeval-checkpoint.test.ts`
- Test: `tests/unit/longmemeval-audit.test.ts`

**Interfaces:**
- Produces: `CloudRunCheckpoint.open(path, expectedIds, identity)`
- Produces: `checkpoint.append(event): Promise<void>`
- Produces: `checkpoint.serialiseHypotheses(order): string`
- Produces: `RunLock.acquire(path, identity, { recoverStale }): Promise<RunLock>`
- Produces: fsynced `retrieval-audit.jsonl` and `prompt-audit.jsonl` writers whose row digests are checkpointed

- [ ] **Step 1: Write filesystem-backed checkpoint tests**

Use a temporary directory and assert `run.json` is written to a sibling temporary file, synced, atomically renamed, and followed by a containing-directory sync before any event may append. Each checkpoint line is a versioned frame containing `sequence`, `previousSha256`, canonical `event`, `eventBytes`, and `eventSha256`; append through an open handle, sync, and close before the promise resolves. Validate the complete hash chain and contiguous sequence on open. Cover resume after interruption, lexically sorted official-id order, duplicate/foreign id, modified complete line, missing newline after an otherwise complete line, malformed length/digest, mismatched dataset/provider/model/prices/caps/prompt/retrieval/Hydra/run/code identity, blank hypothesis, and an existing generation/evaluation manifest.

Simulate a crash at every byte boundary of the final frame. Recovery may truncate exactly one unterminated trailing fragment to the last verified newline, only while the exclusive run lock is held, and must append a `checkpoint-recovered` event containing the discarded byte count and prefix digest. A complete newline-terminated but invalid row, corruption before the last row, sequence/hash mismatch, or more than one fragment is fatal and is never auto-repaired.

- [ ] **Step 2: Write no-reingest resume tests**

Acquire the run lock with exclusive-create semantics and record version, random nonce, PID, process start time, hostname, and run identity. A second live owner must fail before reading secrets or making network calls. Stale recovery requires explicit `--recover-stale-lock`, proves the recorded process is absent and identity matches, atomically archives the stale lock record, and writes a recovery event; uncertainty or PID reuse fails closed. Release removes only a lock whose nonce still matches. Test live contention, stale success, stale identity mismatch, nonce mismatch, and abnormal-exit recovery.

Load three ids with two completed hypotheses and assert `pendingIds()` returns only the third. Define append-only phase events for `document-submitted`, `document-completed`, `retrieval-audited`, `prompt-audited`, and `answer-completed`. A completed hypothesis is immutable. Retrying a missing phase is allowed only in `idempotent-upsert` mode; in `fresh-only` mode any interruption, ambiguous response, or missing terminal event marks the run abandoned and requires a new run id.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts --maxWorkers=1`

Expected: checkpoint module is absent.

- [ ] **Step 4: Implement append-only checkpointing**

Acquire `run.lock` before opening any state. Write the atomic/fsynced versioned `run.json` identity before the first frame. Identity includes run/dataset/evaluator commits and digests, sorted-id digest/order, Lacuna commit and dirty-state refusal, Hydra database and collection/source algorithms, capability/resume mode, answer provider/requested model/base-origin digest, provider-reported model rule, prompt/retrieval versions and limits, prices, call/token/spend/deadline ceilings, and operator hard-limit acknowledgement. Append chained phase frames and validate the complete prefix before resume. Persist exact bounded retrieval rows and exact provider message rows to their own append+fsync audits before their checkpoint digest events; neither audit contains headers, credentials, raw dataset ids, or forbidden labels. Record opaque collection/source association, submitted/completed ids, document/readback digests, ordered chunk/audit digests, graph-context requested/consumed flags and digest, answer metadata, measured-or-null usage/cost, and hypothesis. Build `hypotheses.jsonl` only from validated `answer-completed` events in the provenance's sorted-id order; never edit it in place.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit durable resume**

```bash
git add benchmarks/longmemeval/checkpoint.ts benchmarks/longmemeval/audit.ts tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts
git commit -m "feat(benchmark): checkpoint serial LongMemEval runs"
```

---

### Task 5: HydraDB Cloud runner with strict receipt semantics

**Files:**
- Create: `benchmarks/longmemeval/cloud-run.ts`
- Modify: `benchmarks/longmemeval/cloud-types.ts`
- Modify: `src/hydra/cloud.ts`
- Test: `tests/unit/longmemeval-cloud-run.test.ts`
- Modify: `tests/unit/cloud-source.test.ts`

**Interfaces:**
- Produces: `runCloudLongMemEval(options): Promise<CloudRunSummary>`
- Produces: `verifyCloudBenchmarkCapability(options): Promise<CloudCapability>`
- Expands: `HydraCloud.ingestDocument` with deterministic `sourceId`, explicit `upsert`, and caller signal
- Consumes: `HydraCloud.withCollection`, `ingestDocument`, `waitForIndexing`, `inspect`, and `query`

- [ ] **Step 1: Write successful fake-cloud orchestration test**

Assert each question selects `collectionFor(runId, id)`, submits each session under its expected opaque client source id with `upsert: true`, and requires exactly one receipt whose id and filename match that document. Append a `document-submitted` frame immediately after each unambiguous accepted receipt. Poll the exact unique receipt-id set, reject duplicate/foreign/empty/missing statuses, accept only `indexingStatus === 'completed'`, then `inspect()` every source and require the unwrapped stored text SHA-256 to match the generated document before appending `document-completed`.

Call exactly `query(question, { type: 'all', maxResults: 12 })`. Require at most 12 chunks, each with non-empty text no longer than 16,384 characters, a finite-or-null score, and an opaque source id/title that maps to a completed source/date sidecar. Deduplicate exact duplicate chunk identities, preserve Hydra's returned order, and cap combined evidence at 60,000 characters and the final provider prompt at 70,000 characters; reject rather than silently truncate any service response beyond a cap. Store exact bounded chunks in `retrieval-audit.jsonl`, store the exact messages in `prompt-audit.jsonl`, append their digest events, call the answerer once, and append `answer-completed` only after all audits are durable.

- [ ] **Step 2: Write refusal/failure tests**

Cover missing/duplicate/foreign receipt ids, receipt/source-id or filename mismatch, refused receipt, lost response, empty/duplicate/foreign status, timeout, `errored`/`failed` terminal status, missing completed id, failed/mismatched readback, query transport failure, more than 12 chunks, oversized/empty chunk, oversized aggregate/prompt, unknown/null source id, headerless chunk, duplicate chunk, non-finite score, answer failure, audit failure, and checkpoint failure. Zero retrieved chunks must still yield one answerer call with empty evidence so the model can abstain, while the artifact records retrieval failure; it must never inject the reference answer or encoded identifiers.

- [ ] **Step 3: Write resume and serialism tests**

Use deferred fakes to prove no second question begins before the prior `answer-completed` frame is durable. A resumed completed id makes zero Hydra/provider/audit calls. In `idempotent-upsert` mode, simulate “server stored bytes, client lost response”; retry must send the same source id/document digest, receive the same id, inspect one matching stored source, and never change retrieval. In `fresh-only` mode the same ambiguity or any process interruption permanently abandons that run and produces an error requiring a new run id; it may not continue, resume, or claim cleanup/exactly-once semantics.

- [ ] **Step 4: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-cloud-run.test.ts tests/unit/cloud-source.test.ts --maxWorkers=1`

Expected: cloud runner is absent.

- [ ] **Step 5: Implement the cloud loop**

Extend `HydraCloud.ingestDocument` so deterministic mode sends the service's documented client source-id field and `upsert=true`, propagates a caller signal, strictly decodes exactly one receipt, and never invents an id/filename/status. Add a live capability function that writes the first official document twice to its first official collection, requires both receipts to equal the requested source id, polls exact completion, performs exact byte readback, and confirms bounded query scoping. Capability evidence records no token, URL query, or document text. If any deterministic-id/upsert/readback assertion fails, normal/resume execution refuses. An explicitly operator-approved `fresh-only` execution may start under a brand-new run id, but any later ambiguity/interruption abandons it and another new id is required.

The public runner entry point accepts only `readonly IngestibleQuestion[]`, `HydraCloud`, `CloudAnswerer`, checkpoint, audit writers, run id, clock, signal, immutable limits, and verified capability. Do not import the oracle schema. Enforce exact receipt/status/readback rules before query; cap each ingest request at 120 seconds, status wait at 10 minutes per question, query at 30 seconds, answer at its configured deadline, and the full run at its identity-bound deadline. `HydraCloud.query()` already requests `graph_context: true`; record a canonical digest and `requested: true, consumed: false`, but never pass raw `graphContext: unknown` to the answerer and never describe returned chunks as graph-enriched.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-cloud-run.test.ts tests/unit/cloud-source.test.ts tests/unit/ingest-source.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 7: Commit the Hydra runner**

```bash
git add benchmarks/longmemeval/cloud-run.ts benchmarks/longmemeval/cloud-types.ts src/hydra/cloud.ts tests/unit/longmemeval-cloud-run.test.ts tests/unit/cloud-source.test.ts
git commit -m "feat(benchmark): run LongMemEval through HydraDB Cloud"
```

---

### Task 6: Generation artifact, non-circular manifest, and incomplete-run refusal

**Files:**
- Modify: `benchmarks/longmemeval/artifact.ts`
- Create: `benchmarks/longmemeval/verify.ts`
- Create: `benchmarks/longmemeval/manifest.ts`
- Create: `benchmarks/longmemeval/secret-scan.ts`
- Test: `tests/unit/longmemeval-verify.test.ts`
- Test: `tests/unit/longmemeval-manifest.test.ts`
- Test: `tests/unit/longmemeval-secret-scan.test.ts`
- Modify: `tests/unit/longmemeval-adapter.test.ts`

**Interfaces:**
- Produces: `verifyCloudRun(runDir, officialIds): VerifiedCloudRun`
- Produces: `writeGenerationManifest(runDir): Promise<GenerationManifest>`
- Produces: `scanArtifactsForSecrets(paths, secretValues): SecretScanResult`
- Expands: `RunArtifact` to a versioned oracle cloud schema

- [ ] **Step 1: Write exact hypotheses verification tests**

Require exactly 500 newline-delimited objects, exactly two own keys (`question_id`, `hypothesis`) per row, 500 unique expected ids, non-empty bounded hypotheses, lexically sorted provenance order, final newline, exact sorted-id digest `f038965c54b03632f86a59104dd77848b66e3f80c08d5fbabdd3984d16457811`, and SHA-256 equality with the generation manifest. Reject extra metadata keys even if harmless. Recompute hypotheses from the verified checkpoint and require byte equality.

- [ ] **Step 2: Write artifact invariants**

Write an immutable `generation-artifact.json` and require source/dataset commits, exact dataset/ID digests, `tier: 'oracle'`, collection/source algorithms and capability/resume mode, Hydra database but no token or raw dataset identifiers, answer requested/reported identities, prices/caps/hard-limit acknowledgement, timestamps/durations, exact completed/retrieval-failure counts, measured token/cost totals or `null` with a reason, checkpoint/retrieval/prompt-audit digests, graph-context requested/consumed truth, and `officialEvaluator: null`, `metrics: null`. A run under `incomplete` cannot contain either manifest, a final `artifact.json`, evaluator output, or score. The later evaluated `artifact.json` is a new file; Task 8 must not mutate `generation-artifact.json`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-adapter.test.ts --maxWorkers=1`

Expected: verifier and expanded artifact contract are absent.

- [ ] **Step 4: Implement immutable generation evidence**

Rebuild hypotheses from checkpoint, write to a sibling temporary file, fsync, atomically rename, and sync the directory. Re-read and verify `run.json`, chained checkpoint, `retrieval-audit.jsonl`, `prompt-audit.jsonl`, `hypotheses.jsonl`, `generation-artifact.json`, and copied provenance. Scan every file for the exact configured Hydra/provider/judge secret values and reject any match without recording value, prefix, or length. Also reject persisted authorization/cookie header keys. Write `generation-manifest.json` last through temp+fsync+rename; it contains only version, algorithm, creation time, and sorted `{relativePath, bytes, sha256}` entries for those immutable generation files and never contains its own digest. Re-read every entry and verify again. Only then atomically emit the run under `artifacts/benchmarks/longmemeval/<run-id>/`; every failure remains under `artifacts/benchmarks/incomplete/<run-id>/`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-adapter.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit artifact verification**

```bash
git add benchmarks/longmemeval/artifact.ts benchmarks/longmemeval/verify.ts benchmarks/longmemeval/manifest.ts benchmarks/longmemeval/secret-scan.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-adapter.test.ts
git commit -m "feat(benchmark): seal immutable oracle generation evidence"
```

---

### Task 7: Cloud CLI and environment contract

**Files:**
- Create: `scripts/longmemeval-cloud.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Test: `tests/unit/longmemeval-cloud-cli.test.ts`

**Interfaces:**
- Produces: `npm run bench:longmemeval:cloud -- --preflight --run-id <id> --out <dir> --approved-collections 500 --approved-documents 948 --approved-hydra-spend-usd <decimal>`
- Produces: `npm run bench:longmemeval:cloud -- --resume --run-id <id> --out <dir> [--recover-stale-lock]`
- Produces: explicit `--fresh-only` mode that is never resumable and requires a previously unused run id

- [ ] **Step 1: Write CLI parsing/environment tests**

Require `LACUNA_PROFILE=cloud`, the exact allowlisted Hydra Cloud origin/token/database/base collection, pinned cached provenance, safe never-reused run id, output under the permitted artifact roots, and exclusive run-lock acquisition before reading answer/judge secrets. Preflight requires operator acknowledgements covering at least 500 persistent collections, 948 documents, and an explicit Hydra spend limit; records the numbers without credentials; and accepts no answer-provider or judge option. Full/resume requires verified `capability.json`, explicit answer provider/model, prices/call-token-spend/deadline ceilings, external hard-limit acknowledgement, and complete identity equality. Reject node profile, implicit provider, output traversal, reused/abandoned/evaluated run, `--resume` with `fresh-only`, stale recovery without the explicit flag and proof, and any CLI answer/reference/ground-truth field.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-cloud-cli.test.ts --maxWorkers=1`

Expected: cloud CLI is absent.

- [ ] **Step 3: Implement the serial CLI**

Load an env file only when explicitly passed `--env-file`; never print environment values. Preflight loads only Hydra credentials, acquires the run lock, uses the first lexically sorted official id/collection and first official document, writes it twice with the same deterministic source id/upsert, requires identical receipts, exact completed status, exact readback, bounded scoped query, and writes atomic/fsynced `capability.json`. It makes zero answer-provider and zero judge requests. A failed deterministic contract abandons that run id; continuing is allowed only by starting a new id with explicit `--fresh-only`, whose first interruption or ambiguous transport permanently abandons it.

For full/resume, bind `cloudFromEnv`, the explicit answerer, stripped loader, verified capability, run lock, checkpoint, audit writers, and runner. Install SIGINT/SIGTERM before network work, relay abort to ingest/status/query/provider calls, stop before the next irreversible phase, sync/close audits and checkpoint, and release only the owned lock. `idempotent-upsert` mode preserves a resumable incomplete artifact; `fresh-only` records abandonment. Print progress as question ordinal/id digest, phase, elapsed time, measured-or-null usage, and cumulative measured cost only—never collection, source ids, environment values, prompts, or estimated cost.

Add:

```json
"bench:longmemeval:cloud": "tsx scripts/longmemeval-cloud.ts"
```

Document only variable names in `.env.example`: `LONGMEMEVAL_ANSWER_PROVIDER`, `LONGMEMEVAL_ANSWER_MODEL`, `LONGMEMEVAL_ANSWER_INPUT_USD_PER_MILLION`, `LONGMEMEVAL_ANSWER_OUTPUT_USD_PER_MILLION`, `LONGMEMEVAL_MAX_ANSWER_CALLS`, `LONGMEMEVAL_MAX_ANSWER_TOKENS`, `LONGMEMEVAL_MAX_ANSWER_SPEND_USD`, `LONGMEMEVAL_RUN_DEADLINE_MS`, `LONGMEMEVAL_RUN_ID`, `LONGMEMEVAL_UPSTREAM_DIR`, `LONGMEMEVAL_JUDGE_MODEL`, `LONGMEMEVAL_MAX_JUDGE_SPEND_USD`, and `LONGMEMEVAL_JUDGE_BATCH_DEADLINE_MS`. Values remain absent. Do not put evaluator keys or benchmark spend controls into Vercel deployment configuration.

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
- Create: `benchmarks/longmemeval/evaluator-checkpoint.ts`
- Create: `benchmarks/longmemeval/requirements-lite.lock.txt`
- Create: `scripts/longmemeval-evaluate.ts`
- Modify: `package.json`
- Test: `tests/unit/longmemeval-evaluator.test.ts`
- Test: `tests/unit/longmemeval-evaluator-checkpoint.test.ts`
- Modify: `tests/unit/longmemeval-manifest.test.ts`

**Interfaces:**
- Produces: `evaluateOfficial(runDir, provenance, env): Promise<OfficialEvaluation>`
- Produces: `writeEvaluationManifest(runDir): Promise<EvaluationManifest>`
- Produces: `npm run bench:longmemeval:evaluate -- --run-dir <dir>`

- [ ] **Step 1: Write pin/generation-manifest/environment gate tests**

Refuse evaluation unless the generation verifier re-hashes every `generation-manifest.json` entry, hypotheses/checkpoint/audits still pass, upstream HEAD equals the exact pinned commit under the isolated Git configuration, remote URL is official, and dataset bytes/SHA/sorted-id digest match the constants above. Require `uv 0.11.21`; provision CPython exactly `3.9.25` under `.cache/longmemeval/python/`; create `.cache/longmemeval/venv-3.9.25`; install only `benchmarks/longmemeval/requirements-lite.lock.txt` with hash enforcement; verify the lock records the pinned upstream `requirements-lite.txt` digest; import required modules; and record interpreter executable SHA-256, `python --version`, platform, lock digest, and `pip freeze --all`. Refuse any other interpreter or unlocked/mismatched environment.

Require judge alias exactly `gpt-4o`, expected evaluator-reported model exactly `gpt-4o-2024-08-06`, `OPENAI_API_KEY` set, optional organization, positive global/batch deadlines, maximum 500 successful labels, and an operator-approved external OpenAI project hard spend limit at or below `LONGMEMEVAL_MAX_JUDGE_SPEND_USD`. Verify only set/unset and the approved numeric limit; never print or persist key value, prefix, or length.

- [ ] **Step 2: Write subprocess/output parser tests**

Use a fake process runner with literal pinned-script stdout/result fixtures. Split pending ids in lexical official order into immutable batches of 10, each with an exact two-key hypothesis JSONL and the full pinned oracle reference. For each batch invoke, from `<upstream>/src/evaluation`:

```text
<venv-python> evaluate_qa.py gpt-4o <absolute-batch-hypotheses.jsonl> <absolute-oracle.json>
```

Expect `<absolute-batch-hypotheses.jsonl>.eval-results-gpt-4o`; never look for upstream `.log`. Validate every complete row's exact pending id, unique coverage, two input keys plus one `autoeval_label`, boolean label, and model `gpt-4o-2024-08-06`. Preserve a valid completed prefix from a failed batch, fsync its result/checkpoint, and retry only still-pending ids. Test failure on changed/duplicate/foreign ids, malformed/ambiguous final row, changed hypotheses/generation-manifest digest, non-zero exit with no salvageable prefix, deadline kill, hard-limit absence, and a second evaluator process.

After 500 unique labels, merge them in lexical official-id order to atomic/fsynced `official-evaluator.jsonl`, then invoke exactly:

```text
<venv-python> print_qa_metrics.py <absolute-official-evaluator.jsonl> <absolute-oracle.json>
```

Capture exact stdout/stderr and exit codes, validate per-type counts against the pinned dataset join, extract overall, task-averaged, per-question-type, and abstention metrics, and reject partial logs, NaN/out-of-range metrics, model mismatch, changed generation inputs, or non-zero exit. Judge usage/cost is `null` with `official_evaluator_does_not_report_usage` unless an exact dedicated-provider usage record is available; never derive token or cost estimates from text length.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-manifest.test.ts --maxWorkers=1`

Expected: evaluator wrapper is absent.

- [ ] **Step 4: Implement isolated official evaluation**

Generate and review `requirements-lite.lock.txt` once from the pinned upstream top-level requirements using exact CPython 3.9 resolution and hashes for every allowed wheel/sdist; tests reject a dependency line without hashes or an undeclared top-level package. Provision/reuse only the exact verified uv/Python/lock environment above. The child receives an allowlist of required operating-system/TLS/temp variables, `PYTHONHASHSEED=0`, `OPENAI_API_KEY`, optional organization, and controlled absolute paths; it receives no Hydra token, answer-provider key, env-file path, or unrelated environment value.

Run deterministic pending-id batches with a versioned, exclusive, hash-chained `judge-checkpoint.jsonl`; sync after every accepted label. Apply both per-batch and global deadlines, kill the subprocess tree on expiry, salvage only a strictly valid complete prefix, and never exceed 500 successful labels. The upstream backoff loop is unbounded, so the outer deadline and external project hard limit are mandatory rather than advisory. Resume revalidates the generation manifest and every judge frame before making a call.

Write, without modifying any generation file: `official-evaluator.jsonl`, `official-evaluator.stdout.txt`, `official-evaluator.stderr.txt`, `official-evaluator-command.json`, `official-evaluator-environment.json`, `judge-checkpoint.jsonl`, `official-metrics.json`, and final `artifact.json`. Command metadata contains exact argv/cwd/exit/deadline/batch ids by digest, never secrets. Run the exact-secret/header scan over all generation and evaluation files. Write `evaluation-manifest.json` last as sorted `{relativePath, bytes, sha256}` entries covering `generation-manifest.json` plus every evaluation/final artifact and excluding itself. Re-read every digest, verify hypotheses and generation manifest unchanged, and reject extra score-bearing files.

Add `"bench:longmemeval:evaluate": "tsx scripts/longmemeval-evaluate.ts"` to `package.json`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit the official evaluator gate**

```bash
git add benchmarks/longmemeval/evaluator.ts benchmarks/longmemeval/evaluator-checkpoint.ts benchmarks/longmemeval/requirements-lite.lock.txt scripts/longmemeval-evaluate.ts package.json tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-manifest.test.ts
git commit -m "feat(benchmark): run the pinned official LongMemEval judge"
```

---

### Task 9: Real 500-question Hydra run, official score, and truthful product evidence

**Files:**
- Create after successful run: `artifacts/benchmarks/longmemeval/<run-id>/artifact.json`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/generation-artifact.json`
- Create after successful run: `artifacts/benchmarks/longmemeval/<run-id>/hypotheses.jsonl`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/retrieval-audit.jsonl`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/prompt-audit.jsonl`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/generation-manifest.json`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/official-evaluator.jsonl`
- Create after successful run: `artifacts/benchmarks/longmemeval/<run-id>/official-metrics.json`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/evaluation-manifest.json`
- Modify only after verified score: `docs/BENCHMARK_LONGMEMEVAL.md`
- Modify only after verified score: `docs/V10_RELEASE_STATUS.md`
- Modify only after verified score: `web/src/landing/Evals.tsx`
- Modify only after verified score: `web/src/app/routes/evaluations.tsx`

- [ ] **Step 1: Run all benchmark-local gates**

Run: `npm run typecheck`

Run: `npx vitest run tests/unit/longmemeval-adapter.test.ts tests/unit/ground-truth-isolation.test.ts tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-cloud-documents.test.ts tests/unit/longmemeval-answerer.test.ts tests/unit/provider-openai.test.ts tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts tests/unit/longmemeval-cloud-run.test.ts tests/unit/cloud-source.test.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-cloud-cli.test.ts tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts --maxWorkers=1`

Expected: all commands exit zero with no benchmark test skipped.

- [ ] **Step 2: Run the no-paid-call production capability and quota gate**

Before loading answer-provider or judge credentials, obtain operator confirmation that the Hydra account permits at least 500 persistent collections and 948 documents and accepts the recorded maximum Hydra spend/storage cost. Run:

```bash
npm run bench:longmemeval:cloud -- --preflight --run-id oracle-2026-08-21 --out artifacts/benchmarks/incomplete/oracle-2026-08-21 --approved-collections 500 --approved-documents 948 --approved-hydra-spend-usd <approved-limit>
```

Require the first official collection/document to prove same-client-id upsert on two submissions, identical exact receipts, completed readiness, exact byte readback, scoped bounded query, persisted opaque source/date sidecar, and atomic `capability.json`. Require zero answer-provider and zero judge requests. If deterministic source-id/upsert/readback is unsupported, abandon this run id. Only an explicitly approved brand-new `--fresh-only` run may continue without resume; any interruption or ambiguous transport then abandons it and requires another new id.

- [ ] **Step 3: Confirm secret and hard-limit availability without disclosure**

Check only set/unset state for Hydra Cloud credentials, the selected answer-provider credentials/base URL, and official judge credentials. Require answer call/token/deadline/spend ceilings, explicit cloud-provider prices, an external answer-provider hard limit, judge batch/global deadlines, and an external OpenAI project hard limit at or below the recorded maximum. Abort before spending if any required control is absent. Record provider/requested model, expected response-model rule, judge alias/snapshot, limit values, price provenance/version, and operator-approved run id; never record secret length, prefix, or value.

- [ ] **Step 4: Execute or resume the serial cloud run**

Run:

```bash
npm run bench:longmemeval:cloud -- --resume --run-id oracle-2026-08-21 --out artifacts/benchmarks/incomplete/oracle-2026-08-21
```

The capability gate already created the run and first phase, so normal execution resumes it. If interrupted in verified `idempotent-upsert` mode, rerun the same command after the exclusive lock is absent or use explicit `--recover-stale-lock` only after its proof succeeds. Keep concurrency at one. Inspect every non-completed receipt/readback/retrieval/provider/audit failure and fix the root cause before resuming; do not silently skip a question. A `fresh-only` interruption is never resumed.

- [ ] **Step 5: Verify and manifest exactly 500 hypotheses**

Run the verifier independently. Require 500/500 unique ids, exact sorted-id digest, two keys per line, matching provenance/chained-checkpoint/audit digests, every document completed and read back, reconstructable exact retrieval/provider-message evidence, zero forbidden key/value findings, recorded deterministic Hydra collection/source algorithms and proven resume mode, measured-or-null usage/cost truth, no score fields, and an exact-secret scan with zero findings. Write and reverify non-circular `generation-manifest.json`. Only then atomically emit the immutable generation run under `artifacts/benchmarks/longmemeval/oracle-2026-08-21/`.

- [ ] **Step 6: Run the pinned official evaluator**

Run:

```bash
npm run bench:longmemeval:evaluate -- --run-dir artifacts/benchmarks/longmemeval/oracle-2026-08-21
```

Require resumable deterministic batches to yield exactly 500 unique official evaluator JSONL rows with judge snapshot `gpt-4o-2024-08-06`, then run the exact two-argument metrics command. Require validated overall/task-averaged/per-type/abstention metrics, zero secret findings, and a non-circular `evaluation-manifest.json` covering the unchanged generation manifest and all raw/final outputs. Re-run both manifest verifiers and require every generation digest, especially hypotheses, unchanged.

- [ ] **Step 7: Perform an independent artifact review**

Have a fresh review agent compare the official dataset id set/digests, hypotheses, both manifests, chained generation/judge checkpoints, exact readback and retrieval/prompt audits, raw evaluator JSONL/stdout/stderr/command/environment records, parsed metrics, provenance, requested/reported answer and judge identities, measured-or-null usage/cost, limits, retrieval failures, and forbidden-key/value plus exact-secret scans. Any discrepancy keeps all public product copy at `No official score exists`.

- [ ] **Step 8: Update product claims only from the verified artifact**

Show the exact official oracle score, date, 500/500 count, judge snapshot, requested/reported answer model, retrieval failure count, measured cost or `not reported`, and direct evaluation-manifest/artifact paths. Label it `LongMemEval oracle (evidence sessions only; HydraDB Cloud returned chunks)`. Do not say graph-enriched, deterministic output, bit-reproducible, LongMemEval-S/M, or leaderboard-comparable. Preserve the generated 64-question evaluation as a separate internal test and explicitly distinguish it.

- [ ] **Step 9: Run final claim/build gates**

Run: `npm run copy:lint`

Run: `npm --prefix web run typecheck`

Run: `npm --prefix web run build`

Run: `npx vitest run tests/unit --maxWorkers=1`

Expected: all commands pass; no page claims graph-enriched answering, deterministic output, LongMemEval-S/M, leaderboard rank, or an official score/identity/count differing from the evaluation-manifest-covered `official-metrics.json` and `artifact.json`.

- [ ] **Step 10: Commit the verified run and evidence**

```bash
git add artifacts/benchmarks/longmemeval/oracle-2026-08-21 docs/BENCHMARK_LONGMEMEVAL.md docs/V10_RELEASE_STATUS.md web/src/landing/Evals.tsx web/src/app/routes/evaluations.tsx
git commit -m "docs: publish verified official LongMemEval oracle evidence"
```
