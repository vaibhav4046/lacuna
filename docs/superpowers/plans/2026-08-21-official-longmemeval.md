# Official LongMemEval Oracle Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete, auditable, officially judged 500-question LongMemEval oracle result in which HydraDB Cloud is the actual memory/retrieval system and no ground-truth answer fields or encoded labels cross the generation boundary.

**Architecture:** A new cloud-only runner loads an `IngestibleQuestion[]` through a ground-truth-stripping loader, writes each question's dated sessions under opaque deterministic source ids in its own deterministic HydraDB collection, live-verifies stable client ids, byte-for-byte inspect readback, and (for resume only) repeated-upsert convergence, requires every exact receipt to reach terminal `completed`, and passes only strictly decoded, bounded Hydra-returned chunks plus verbatim benchmark wall-clock dates to a narrow answer input. Exclusive run and campaign-budget locks protect framed, hash-chained, fsynced checkpoints, audits, and worst-case pre-call reservations; resume is enabled only by the full live contract, while fresh-only is permitted solely when stable client-id/readback works but repeated-upsert convergence remains unproven. Immutable generation and evaluation manifests separately seal the clean Lacuna harness identity, pinned upstream Git-blob observations, two-key hypotheses, cumulative resource ledger, and raw official evaluator evidence without circular digests.

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
- Ingestion is serial per question and answer generation is serial across questions. Resume never re-ingests or re-answers a completed checkpoint row. `idempotent-upsert` requires all three live facts: the requested deterministic client id is the returned/addressable id, `inspect(id)` returns exact submitted bytes, and a repeated same-id/same-bytes upsert converges to exactly one identical source. `fresh-only` is allowed only when the first two facts are proven but the third remains unproven; every source is then submitted exactly once and any interruption or ambiguous response permanently abandons the run. Failure of client-id stability or exact inspect readback blocks all execution. There is no server-generated-id mode or fallback.
- Exactly one process owns a run directory, and exactly one process appends to the account/project-scoped campaign resource ledger. `run.json`, checkpoint frames, audit frames, resource reservations, hypotheses, manifests, and evaluator attempt outputs use atomic rename or framed append+fsync as specified below; no completed state is inferred from an unsynced file.
- Before the first irreversible action, the runner reserves the full 500-collection/948-document run allocation in a cumulative campaign ledger. Before every answer-provider call and every official-judge batch subprocess, it appends and fsyncs a hash-chained worst-case attempt/input-token/output-token/spend reservation. Reservations and ambiguous outcomes are never refunded, attempt ceilings count all starts rather than successful answers/labels, and abandoned or fresh-only replacement runs remain charged before another allocation can be approved.
- Every run binds the exact clean Lacuna HEAD commit, HEAD tree, and harness-file manifest. Dirty index/tracked/untracked harness state is a hard failure. Immediately before each benchmark child process is spawned, the wrapper revalidates that identity and byte-compares every upstream file that child can consume with its blob at the pinned upstream commit; the expected and observed blob/SHA-256/byte tuples are sealed in evaluator identity and final evidence.
- A run with fewer than exactly 500 unique official ids stays under `artifacts/benchmarks/incomplete/` and cannot contain a score.
- The official evaluator runs only after the hypotheses schema, exact sorted-id digest, and immutable generation manifest pass. The final score is publishable only after a separate non-circular evaluation manifest covers every raw evaluator and metric artifact.
- Oracle-tier results are labelled `oracle`; they are never described as LongMemEval-S, LongMemEval-M, or leaderboard-comparable retrieval over distractor history.
- The answer path is described as bounded `HydraDB Cloud returned chunks`. Every Hydra response is streamed through a byte ceiling and strict UTF-8/bounded JSON decoder before schema decoding. Although `HydraCloud.query()` requests `graph_context: true`, bounded canonical `sources`, `graph_context`, and `temporal_facts` are audited/digested but never put into the prompt. No raw `unknown` value is parsed or digested without structural and canonical-byte caps, and no copy calls the chunks graph-enriched. A future consumed graph mode requires its own bounded typed contract and is outside this run.
- Provider and judge calls have explicit call, input, output, wall-clock, and spend ceilings. Exact usage/cost is recorded only when measured; otherwise the artifact records `null` plus a reason. Cloud-provider and judge runs also require an operator-approved external account/project hard spend limit because a client-side estimate is not a hard control.
- Every publishable text or JSON artifact is scanned for the exact configured secret values before the evaluation manifest is written; scans never record secret value, prefix, or length.
- Heavy tests and the real run use one worker/process.

---

### Task 1: Pinned upstream/data acquisition and provenance manifest

**Files:**
- Create: `scripts/longmemeval-acquire.ts`
- Create: `benchmarks/longmemeval/provenance.ts`
- Create: `benchmarks/longmemeval/execution-identity.ts`
- Modify: `package.json`
- Test: `tests/unit/longmemeval-provenance.test.ts`
- Test: `tests/unit/longmemeval-execution-identity.test.ts`

**Interfaces:**
- Produces: `LongMemEvalProvenance`
- Produces: `captureCleanHarnessIdentity()` and `verifyImmediatelyBeforeSpawn(identity, consumedUpstreamPaths)`
- Produces: `npm run bench:longmemeval:acquire`
- Writes ignored inputs under `.cache/longmemeval/`

- [ ] **Step 1: Write manifest validation tests**

Require the two exact 40-hex commits above, exact HTTPS primary-source origins, filename `longmemeval_oracle.json`, exactly `15388478` bytes, exact dataset SHA-256 `821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c`, exactly 500 unique question ids, and exact sorted-id digest `f038965c54b03632f86a59104dd77848b66e3f80c08d5fbabdd3984d16457811`. Store both the 500 lexically sorted ids and their digest so that the same order drives checkpoint and hypotheses output. Materialize a minimal evaluator bundle solely from regular Git blobs at the pinned commit: every blob recursively under `src/evaluation/` plus `requirements-lite.txt`; reject symlinks, submodules, working-tree-only files, and imports that escape this bundle. For every bundle entry record relative path, pinned Git blob OID, expected blob bytes/SHA-256 obtained from `git cat-file blob <oid>`, and observed materialized bytes/SHA-256. Require `src/evaluation/evaluate_qa.py`, `src/evaluation/print_qa_metrics.py`, and `requirements-lite.txt`. Reject a moving `main` reference, wrong remote, missing/extra bundle file, expected/observed mismatch, 499 ids, duplicate ids, or a changed id set even when the count remains 500.

- [ ] **Step 2: Write acquisition command-construction tests**

Inject process/download functions and assert the script uses:

```text
git clone --filter=blob:none --no-checkout https://github.com/xiaowu0162/LongMemEval.git <cache>/upstream
git -C <cache>/upstream checkout --detach 9e0b455f4ef0e2ab8f2e582289761153549043fc
https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_oracle.json
```

Construct the Git subprocess with `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<new empty temp file>`, `GIT_CONFIG_COUNT=0`, and `-c core.hooksPath=<new empty temp directory>` for clone, fetch, checkout, `ls-tree`, and `cat-file` verification. Do not inherit repository/system/global hooks, credential helpers, aliases, or filter commands. The download client sends no cookies, authorization, or caller headers; follows redirects only from `huggingface.co` to the exact documented Hugging Face/Xet content hosts; rejects every non-2xx status; applies connect, inactivity, and total deadlines; and aborts as soon as streamed bytes exceed `15388478`. The script must not place the dataset or Python environment under tracked `data/` or `third_party/` paths.

Test the common spawn guard separately. It captures Lacuna's exact `HEAD` commit/tree and a sorted byte/SHA-256 manifest of every tracked worktree file, and requires the index and every tracked file to equal HEAD. Non-ignored untracked files are allowed only inside the exact selected benchmark output directory; ignored files are allowed only inside `.cache/longmemeval/`; neither root is executable or importable. Any other untracked file, especially under a code/module-resolution root, is dirty harness state. Immediately before each child spawn the guard synchronously rechecks resolved HEAD/tree, cleanliness, every tracked-file digest, the fixed dataset bytes/digest, and every declared consumed evaluator-bundle entry against both its recorded pinned blob tuple and current materialized bytes. The spawn must not occur after a changed file, swapped same-length file, dirty index, foreign untracked file, missing declaration, or even one verification-to-spawn intervening await/callback. Acquisition Git commands declare no consumed upstream file; every later `uv`, Python, evaluator, and metrics child declares the complete upstream bundle it may read.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts --maxWorkers=1`

Expected: acquisition and provenance modules are absent.

- [ ] **Step 4: Implement deterministic acquisition**

Download to a temporary sibling, stream while hashing, require the expected byte count and SHA-256 before parsing, validate JSON and the exact sorted-id digest before atomic rename, fsync the file and containing directory, and refuse an existing file whose digest or question set differs. Clone/check out the evaluator under the isolated Git configuration; verify `git rev-parse HEAD`, exact remote URL, and the complete tree-derived bundle; then materialize the execution bundle from `git cat-file blob` bytes rather than trusting checkout bytes. Write `.cache/longmemeval/provenance.json` atomically with URLs, commits, filenames, expected/observed dataset bytes and SHA-256, acquisition time, 500 sorted ids, sorted-id digest, and the sorted per-upstream-file `{path, blobOid, expectedBytes, expectedSha256, observedBytes, observedSha256}` tuples. Write `execution-identity.json` only after the clean Lacuna harness check. Never store credentials, response headers, redirect query strings, or environment values.

Add `"bench:longmemeval:acquire": "tsx scripts/longmemeval-acquire.ts"` to `package.json`.

- [ ] **Step 5: Run focused tests and a real acquisition**

Run: `npx vitest run tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts --maxWorkers=1`

Run: `npm run bench:longmemeval:acquire`

Expected: the test passes; the ignored cache contains the pinned evaluator, the exact 15,388,478-byte/500-question oracle file, and a verified provenance manifest whose dataset and sorted-id digests equal the constants above.

- [ ] **Step 6: Commit the acquisition boundary**

```bash
git add scripts/longmemeval-acquire.ts benchmarks/longmemeval/provenance.ts benchmarks/longmemeval/execution-identity.ts package.json tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts
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
- Produces: `prepareAnswer(input): PreparedAnswerCall` and `executePreparedAnswer(prepared, reservation, signal)`; preparation performs no network I/O
- Expands: `complete(..., { signal, timeoutMs, maxTokens })` with keyless-local support and strict optional usage
- Consumes: `src/provider/openai.ts#complete`

- [ ] **Step 1: Write prompt-boundary tests**

Construct literal bounded evidence plus an opaque-source/date sidecar and assert the provider receives one system message and one user message containing only the question, verbatim question wall-clock date, evidence text, opaque source id/title, and sidecar session date. Include a headerless chunk and prove it receives the correct date from the sidecar. Recursively audit both prompt keys and serialized values for the forbidden ground-truth fields/encoded labels in Global Constraints; ensure `Chunk.observedAt`, raw question/session ids, `_abs`, and `answer_` never occur. The exact messages written to `prompt-audit.jsonl` must byte-match the messages passed to `complete()` and contain no request headers or provider configuration.

- [ ] **Step 2: Write provider/output tests**

Require an explicit `LONGMEMEVAL_ANSWER_PROVIDER` in `groq|deepseek|ollama|vllm` and explicit model. Reject auto-selection, Anthropic, missing cloud key, missing base URL, blank hypothesis, a response over 4,096 characters, or provider error. Permit a missing key only when `ProviderConfig.where === 'local'`; omit the Authorization header entirely in that case. Strictly decode optional non-negative integer `prompt_tokens`, `completion_tokens`, and `total_tokens`, preserve both requested and provider-reported model identities, and reject malformed usage or a response-model change after the first completed answer. Record usage as measured or `null` with `provider_did_not_report_usage`; cost is measured only from reported usage and explicit versioned input/output prices.

Set immutable run-identity ceilings before the first call: exactly 500 successful hypotheses, an explicit maximum over **all** answer attempts (including timeouts/ambiguous failures), 70,000 prompt characters per attempt, 1,200 output tokens per attempt, caller-supplied cumulative input-token/output-token ceilings, a caller-supplied run deadline, and a caller-supplied maximum answer spend. A cloud answer run additionally requires explicit versioned per-million input/output prices and an operator-approved external provider-account hard limit at or below the recorded maximum. `prepareAnswer` emits the exact messages/digest and no network I/O; its conservative reservation uses `utf8ByteLength(canonicalMessages) + 4096` input tokens, exactly 1,200 output tokens, and decimal spend rounded upward at the configured prices. `executePreparedAnswer` accepts only a durable campaign-ledger reservation bound to that digest/provider/model/attempt ordinal and rejects a missing, reused, mismatched, or unsynced reservation. Test caller abort, timeout, total-attempt/token/spend exhaustion, ambiguous attempts remaining consumed, missing price, exact measured cost, and measured-or-null usage.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-answerer.test.ts tests/unit/provider-openai.test.ts --maxWorkers=1`

Expected: answerer module is absent.

- [ ] **Step 4: Implement the answer-only prompt**

Extend and use the existing `complete(config, model, messages, { maxTokens: 1200, timeoutMs, signal })` seam. The system instruction says answer from retrieved evidence, preserve the supplied verbatim wall-clock dates, and abstain plainly when unsupported; it must not mention reference answers, question ids, question types, abstention labels, collection names, or Hydra upload time. Evidence dates come only from the validated opaque-source sidecar; remove the generated document header from a chunk when present, but do not require a chunk to contain it. Split preparation from execution: canonicalize/audit the exact messages and compute conservative token/spend maxima first; only the execution method holding the matching fsynced reservation may invoke `complete`. Enforce prompt/output/total-attempt/token/spend ceilings before returning typed answer metadata.

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
- Create: `benchmarks/longmemeval/resource-ledger.ts`
- Test: `tests/unit/longmemeval-checkpoint.test.ts`
- Test: `tests/unit/longmemeval-audit.test.ts`
- Test: `tests/unit/longmemeval-resource-ledger.test.ts`

**Interfaces:**
- Produces: `CloudRunCheckpoint.open(path, expectedIds, identity)`
- Produces: `checkpoint.append(event): Promise<void>`
- Produces: `checkpoint.serialiseHypotheses(order): string`
- Produces: `RunLock.acquire(path, identity, { recoverStale }): Promise<RunLock>`
- Produces: framed/hash-chained/fsynced `retrieval-audit.jsonl` and `prompt-audit.jsonl` writers whose stream heads are checkpointed
- Produces: `CampaignResourceLedger.open(budgetIdentity, approvedTotals)` and durable `reserveRun`, `reserveAnswerAttempt`, and `reserveJudgeBatch` operations

- [ ] **Step 1: Write filesystem-backed checkpoint tests**

Use a temporary directory and assert `run.json` is written to a sibling temporary file, synced, atomically renamed, and followed by a containing-directory sync before any event may append. Each checkpoint or audit line is a versioned frame containing `stream`, `sequence`, `previousSha256`, canonical `event`, `eventBytes`, and `eventSha256`; append through an open handle, sync, and close before the promise resolves. Validate every complete hash chain and contiguous sequence on open. Bind exact Lacuna HEAD/tree/harness-manifest digest and the full upstream expected/observed file-tuple digest. Cover resume after interruption, lexically sorted official-id order, duplicate/foreign id, modified complete line, missing newline after an otherwise complete line, malformed length/digest, mismatched dataset/provider/model/prices/caps/prompt/retrieval/Hydra/run/code/budget identity, dirty or changed harness, blank hypothesis, and an existing generation/evaluation manifest.

Simulate a crash at every byte boundary of the final frame in each stream. Recovery may truncate exactly one unterminated trailing fragment to the last verified newline, only while the exclusive run lock is held, and must append a recovery frame containing the stream, discarded byte count, discarded-byte digest, and prior verified head. A complete newline-terminated but invalid row, corruption before the last row, sequence/hash mismatch, or more than one fragment is fatal and is never auto-repaired. Reconcile audit/checkpoint heads exactly under the same lock: an audit may have at most one complete fsynced orphan frame beyond the checkpointed head, and it is adopted only if its stream, next phase, question ordinal digest, payload bytes/digest, and prior head are the single deterministic event currently expected; append/fsync `audit-orphan-adopted` before proceeding. An audit behind its checkpoint, two or foreign orphan frames, a changed payload, or any ambiguity fails closed; no complete orphan is silently truncated or replayed.

- [ ] **Step 2: Write no-reingest resume tests**

Acquire the run lock with exclusive-create semantics and record version, random nonce, PID, process start time, hostname, and run identity. A second live owner must fail before reading secrets or making network calls. Stale recovery requires explicit `--recover-stale-lock`, proves the recorded process is absent and identity matches, atomically archives the stale lock record, and writes a recovery event; uncertainty or PID reuse fails closed. Release removes only a lock whose nonce still matches. Test live contention, stale success, stale identity mismatch, nonce mismatch, and abnormal-exit recovery.

Load three ids with two completed hypotheses and assert `pendingIds()` returns only the third. Define append-only phase events for `document-submitted`, `document-completed`, `retrieval-audited`, `prompt-audited`, `answer-attempt-reserved`, and `answer-completed`. A completed hypothesis is immutable. Retrying a missing phase is allowed only in `idempotent-upsert` mode; in `fresh-only` mode any interruption, ambiguous response, or missing terminal event marks the run abandoned and requires a new run id.

Create a campaign resource ledger at a non-overridable deterministic path derived from the non-secret Hydra origin/account/database scope, outside any run directory; a scope registry rejects a second ledger/budget id for that tuple and later refuses to bind an answer/judge project scope already bound to another ledger. Its immutable genesis frame records the budget id and Hydra scope digest; later binding/price-version frames are append-only. Before each phase, append/fsync an `operator-approval` frame with monotonically non-decreasing cumulative maxima for persistent collections, documents, Hydra spend, answer attempts/input tokens/output tokens/spend, and judge batch attempts/API-call allowance/input tokens/output tokens/spend; it never rewrites genesis or prior approvals. Acquire its own exclusive nonce lock for every validation/append. Before a run's first Hydra request, append+fsync one worst-case `run-allocation-reserved` frame for all 500 collections, 948 documents, and Hydra spend. Before each answer call or judge batch, append+fsync a digest-bound reservation frame with next total attempt ordinal and worst-case tokens/spend. Test concurrent writers, attempted scope/ledger reset, reduced or missing approval, truncated-tail recovery, corrupt chains, ceiling equality/exhaustion, abandoned/fallback run accumulation, and ambiguity/timeout/no-result outcomes: no reservation is ever removed, reused, decremented, or refunded, and success count never substitutes for total attempts.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts tests/unit/longmemeval-resource-ledger.test.ts --maxWorkers=1`

Expected: checkpoint module is absent.

- [ ] **Step 4: Implement append-only checkpointing**

Acquire the campaign-ledger lock and then `run.lock`, always in that order, before opening mutable state. Write the atomic/fsynced versioned `run.json` identity before the first frame. Identity includes run/dataset/evaluator commits and complete expected/observed upstream file tuples, sorted-id digest/order, exact clean Lacuna HEAD/tree/harness-manifest digest, Hydra database and collection/source algorithms, capability/resume mode, budget-ledger genesis/head and cumulative approvals, answer provider/requested model/base-origin digest, provider-reported model rule, prompt/retrieval versions and limits, prices, total-attempt/token/spend/deadline ceilings, and operator hard-limit acknowledgement. Append chained phase frames and validate/reconcile every complete checkpoint/audit prefix under lock before resume. Persist exact bounded retrieval payloads and exact provider-message payloads as framed/hash-chained audit events, fsync them, then append the checkpoint head reference; neither audit contains headers, credentials, raw dataset ids, or forbidden labels. Record opaque collection/source association, submitted/completed ids, document/readback digests, ordered chunk/audit heads, bounded canonical sources/graph/temporal digests, graph-context requested/consumed flags, resource-reservation id/head, answer metadata, measured-or-null usage/cost, and hypothesis. Build `hypotheses.jsonl` only from validated `answer-completed` events in the provenance's sorted-id order; never edit it in place.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts tests/unit/longmemeval-resource-ledger.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit durable resume**

```bash
git add benchmarks/longmemeval/checkpoint.ts benchmarks/longmemeval/audit.ts benchmarks/longmemeval/resource-ledger.ts tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts tests/unit/longmemeval-resource-ledger.test.ts
git commit -m "feat(benchmark): checkpoint serial LongMemEval runs"
```

---

### Task 5: HydraDB Cloud runner with strict receipt semantics

**Files:**
- Create: `benchmarks/longmemeval/cloud-run.ts`
- Modify: `benchmarks/longmemeval/cloud-types.ts`
- Create: `src/hydra/bounded-json.ts`
- Modify: `src/hydra/cloud.ts`
- Test: `tests/unit/longmemeval-cloud-run.test.ts`
- Test: `tests/unit/hydra-bounded-json.test.ts`
- Modify: `tests/unit/cloud-source.test.ts`

**Interfaces:**
- Produces: `runCloudLongMemEval(options): Promise<CloudRunSummary>`
- Produces: `verifyCloudBenchmarkCapability(options): Promise<CloudCapability>`
- Expands: `HydraCloud.ingestDocument` with deterministic `sourceId`, explicit `upsert`, and caller signal
- Produces: `readBoundedJson(response, limits)` and bounded canonical query auxiliary values
- Consumes: `HydraCloud.withCollection`, `ingestDocument`, `waitForIndexing`, `inspect`, and `query`

- [ ] **Step 1: Write successful fake-cloud orchestration test**

Assert each question selects `collectionFor(runId, id)`, submits each session under its expected opaque client source id with `upsert: true`, and requires exactly one receipt whose id and filename match that document. No code path accepts or substitutes a server-generated id. Append a `document-submitted` frame immediately after each unambiguous accepted receipt. Poll the exact unique receipt-id set, reject duplicate/foreign/empty/missing statuses, accept only `indexingStatus === 'completed'`, then `inspect(expectedClientId)` every source and require the unwrapped stored text SHA-256 to match the generated document before appending `document-completed`.

Call exactly `query(question, { type: 'all', maxResults: 12, signal })`. Stream every Hydra success body with an endpoint-independent `1,048,576`-byte ceiling (and every discarded error body with a `16,384`-byte ceiling), aborting the reader immediately when the cumulative bytes exceed the cap even when `Content-Length` is absent or false. Never call `Response.json()` or concatenate an unbounded body. Decode UTF-8 fatally and use a bounded JSON tokenizer/parser that rejects duplicate/prototype-polluting keys, trailing values, excessive nesting/tokens/strings, and non-canonical unsupported values before constructing the response object.

Strictly decode at most 12 chunks; each has non-empty text of at most 16,384 Unicode scalar values, finite-or-null score, source id at most 256 characters, title at most 512, type at most 64, and timestamp at most 128, with source id/title mapping to a completed source/date sidecar. Decode `sources` as at most 12 values with depth 6, at most 64 keys per object, 256 elements per array, 1,024 total values, 8,192 scalar-value characters, and at most 131,072 RFC-8785 canonical bytes. Decode `graph_context` with depth 8, the same per-container limits, 2,048 total values, 16,384 scalar-value characters, and at most 262,144 canonical bytes; decode `temporal_facts` with depth 8, at most 128 top-level facts, 1,024 total values, 8,192 scalar-value characters, and at most 131,072 canonical bytes. Their combined canonical bytes may not exceed 524,288. Reject before digest rather than truncate, deduplicate, or stringify raw `unknown`; domain-separate and SHA-256 the validated canonical bytes. Deduplicate only exact duplicate **chunk identities**, preserve Hydra's returned order, and cap combined evidence at 60,000 characters and the final provider prompt at 70,000 characters.

Store exact bounded chunks plus the canonical auxiliary digests/counts/caps as a framed retrieval-audit event, store the exact prepared provider messages as a framed prompt-audit event, and fsync/checkpoint each head. Reserve and fsync the worst-case answer attempt in the campaign ledger, execute exactly that prepared call, and append `answer-completed` only after the reservation, audits, and result are durable.

- [ ] **Step 2: Write refusal/failure tests**

Cover missing/duplicate/foreign/server-generated receipt ids, receipt/source-id or filename mismatch, refused receipt, lost response, empty/duplicate/foreign status, timeout, `errored`/`failed` terminal status, missing completed id, failed/mismatched readback, query transport failure, and all query caps. Feed chunked response fixtures with absent/lying `Content-Length`, one byte below/at/above the body cap, split multibyte UTF-8, invalid UTF-8, duplicate keys, `__proto__`, excessive depth/tokens/string/container size, trailing JSON, more than 12 sources/chunks, oversized graph/temporal/canonical aggregate, oversized/empty chunk, oversized evidence/prompt, unknown/null source id, headerless chunk, duplicate chunk, and non-finite/wrong-typed score; assert rejection occurs before any auxiliary digest/audit/provider call. Cover answer-reservation failure, ambiguous answer with consumed reservation, audit/checkpoint failure, and canonical equality for differently ordered safe object keys. Zero retrieved chunks must still yield one reserved answerer call with empty evidence so the model can abstain, while the artifact records retrieval failure; it must never inject the reference answer or encoded identifiers.

- [ ] **Step 3: Write resume and serialism tests**

Use deferred fakes to prove no second question begins before the prior `answer-completed` frame is durable. A resumed completed id makes zero Hydra/provider/audit calls. In `idempotent-upsert` mode, simulate “server stored bytes, client lost response”; retry must send the same source id/document digest, receive the same id, inspect one matching stored source, and never change retrieval. Prove the capability matrix: (a) stable requested id + exact inspect readback + two unambiguous same-id/same-bytes submissions converging to one source enables resume; (b) stable requested id + exact inspect readback, with the duplicate probe yielding no evidence of divergence but insufficient proof of convergence, enables only a brand-new `fresh-only` run whose sources are each attempted once; (c) unstable/unaddressable client id, readback mismatch/unavailability, duplicate sources, or proven divergent upsert blocks every mode. In `fresh-only`, an ambiguity or any process interruption permanently abandons that run; it may not continue, resume, retry a source, use a server id, or claim cleanup/exactly-once semantics.

- [ ] **Step 4: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-cloud-run.test.ts tests/unit/hydra-bounded-json.test.ts tests/unit/cloud-source.test.ts --maxWorkers=1`

Expected: cloud runner is absent.

- [ ] **Step 5: Implement the cloud loop**

Extend `HydraCloud.ingestDocument` so deterministic mode sends the service's documented client source-id field and `upsert=true`, propagates a caller signal, strictly decodes exactly one receipt, and never invents or accepts a replacement id/filename/status. Add a live capability function that submits the first official document under its requested id, polls exact completion, performs exact `inspect(requestedId)` byte readback, probes a second same-id/same-bytes upsert, checks scoped bounded query/inspection for convergence, and returns only `idempotent-upsert`, `fresh-only-eligible`, or `blocked` with evidence digests. `fresh-only-eligible` requires proven stable requested id and exact readback plus no evidence of divergent/duplicate state; its sole missing fact is repeated-upsert convergence. Any client-id/readback failure or positive divergence is `blocked`, not fresh-only. Capability evidence records no token, response URL/query, or document text.

The public runner entry point accepts only `readonly IngestibleQuestion[]`, `HydraCloud`, `CloudAnswerer`, checkpoint, framed audit writers, campaign ledger, run id, clock, signal, immutable limits, and verified capability. Do not import the oracle schema. Enforce exact receipt/status/readback and the mode matrix before query; cap each ingest request at 120 seconds, status wait at 10 minutes per question, query at 30 seconds, answer at its configured deadline, and the full run at its identity-bound deadline. `HydraCloud.query()` requests `graph_context: true`; the bounded decoder returns typed chunks plus already-validated canonical auxiliary bytes/digests and `requested: true, consumed: false`. Never expose raw `graphContext: unknown`, digest an unbounded service value, pass graph/sources/temporal data to the answerer, or describe returned chunks as graph-enriched.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-cloud-run.test.ts tests/unit/hydra-bounded-json.test.ts tests/unit/cloud-source.test.ts tests/unit/ingest-source.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 7: Commit the Hydra runner**

```bash
git add benchmarks/longmemeval/cloud-run.ts benchmarks/longmemeval/cloud-types.ts src/hydra/bounded-json.ts src/hydra/cloud.ts tests/unit/longmemeval-cloud-run.test.ts tests/unit/hydra-bounded-json.test.ts tests/unit/cloud-source.test.ts
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
- Produces: immutable `resource-ledger-generation.jsonl` and `execution-identity.json` snapshots
- Expands: `RunArtifact` to a versioned oracle cloud schema

- [ ] **Step 1: Write exact hypotheses verification tests**

Require exactly 500 newline-delimited objects, exactly two own keys (`question_id`, `hypothesis`) per row, 500 unique expected ids, non-empty bounded hypotheses, lexically sorted provenance order, final newline, exact sorted-id digest `f038965c54b03632f86a59104dd77848b66e3f80c08d5fbabdd3984d16457811`, and SHA-256 equality with the generation manifest. Reject extra metadata keys even if harmless. Recompute hypotheses from the verified checkpoint and require byte equality.

- [ ] **Step 2: Write artifact invariants**

Write an immutable `generation-artifact.json` and require source/dataset commits, exact dataset/ID digests, `tier: 'oracle'`, exact clean Lacuna HEAD/tree/harness-manifest identity, the full pinned upstream expected/observed file-tuple digest, collection/source algorithms and capability/resume mode, Hydra database but no token or raw dataset identifiers, answer requested/reported identities, prices/caps/hard-limit acknowledgement, timestamps/durations, exact successful and total-attempt counts, measured token/cost totals or `null` with a reason, worst-case reserved totals, checkpoint/framed-retrieval/framed-prompt-audit heads, cumulative campaign-ledger genesis/head/totals, bounded canonical sources/graph/temporal caps and digests, graph-context requested/consumed truth, and `officialEvaluator: null`, `metrics: null`. A run under `incomplete` cannot contain either manifest, a final `artifact.json`, evaluator output, or score. The later evaluated `artifact.json` is a new file; Task 8 must not mutate `generation-artifact.json`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-adapter.test.ts --maxWorkers=1`

Expected: verifier and expanded artifact contract are absent.

- [ ] **Step 4: Implement immutable generation evidence**

Rebuild hypotheses from checkpoint, write to a sibling temporary file, fsync, atomically rename, and sync the directory. Under both locks validate the full campaign ledger, copy its exact genesis-through-generation-head bytes to immutable `resource-ledger-generation.jsonl`, and prove it includes all earlier abandoned/fallback-run reservations for the same budget identity. Re-read and verify `run.json`, `execution-identity.json`, chained checkpoint, both fully framed/hash-chained audits with exact checkpoint heads and no orphan tail, `resource-ledger-generation.jsonl`, `hypotheses.jsonl`, `generation-artifact.json`, and copied provenance with every upstream expected/observed blob tuple. Scan every file for the exact configured Hydra/provider/judge secret values and reject any match without recording value, prefix, or length. Also reject persisted authorization/cookie header keys. Write `generation-manifest.json` last through temp+fsync+rename; it contains only version, algorithm, creation time, and sorted `{relativePath, bytes, sha256}` entries for those immutable generation files and never contains its own digest. Re-read every entry and verify again. Only then atomically emit the run under `artifacts/benchmarks/longmemeval/<run-id>/`; every failure remains under `artifacts/benchmarks/incomplete/<run-id>/`.

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
- Produces: `npm run bench:longmemeval:cloud -- --preflight --budget-id <id> --run-id <id> --out <dir> --approved-total-collections <n> --approved-total-documents <n> --approved-total-hydra-spend-usd <decimal>`
- Produces: `npm run bench:longmemeval:cloud -- --resume --budget-id <id> --run-id <id> --out <dir> --approved-total-answer-attempts <n> --approved-total-answer-input-tokens <n> --approved-total-answer-output-tokens <n> --approved-total-answer-spend-usd <decimal> [--recover-stale-lock]`
- Produces: explicit `--fresh-only` mode permitted only by `fresh-only-eligible`, never resumable, and requiring a previously unused run id plus a new cumulative run allocation

- [ ] **Step 1: Write CLI parsing/environment tests**

Require `LACUNA_PROFILE=cloud`, the exact allowlisted Hydra Cloud origin/token/database/base collection, pinned cached provenance, exact clean Lacuna harness identity, safe never-reused run id, the deterministic Hydra-scope budget ledger (with later append-only answer/judge project bindings), output under the permitted artifact roots, and exclusive run- plus campaign-ledger-lock acquisition before reading answer/judge secrets. Preflight requires operator-approved **cumulative** totals that cover already reserved abandoned/fallback runs plus the new 500 persistent collections, 948 documents, and Hydra spend; it records numbers without credentials and accepts no answer-provider or judge option. Full/resume additionally requires cumulative answer attempt/input-token/output-token/spend approvals, verified `capability.json`, explicit answer provider/model, prices/per-attempt and run deadlines, external hard-limit acknowledgement, and complete identity equality. Reject a fresh ledger that omits known same-scope run records, node profile, implicit provider, output traversal, reused/abandoned/evaluated run, `--resume` with `fresh-only`, fresh-only without the exact eligible capability, stale recovery without explicit proof, server-id mode, and any CLI answer/reference/ground-truth field.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-cloud-cli.test.ts --maxWorkers=1`

Expected: cloud CLI is absent.

- [ ] **Step 3: Implement the serial CLI**

Load an env file only when explicitly passed `--env-file`; never print environment values. Preflight loads only Hydra credentials; acquires the campaign ledger then run lock; validates cumulative history; atomically/fsyncs the new full-run 500-collection/948-document/Hydra-spend reservation **before** its first request; and uses the first lexically sorted official id/collection and first official document to classify the exact capability matrix. Write atomic/fsynced `capability.json` with only evidence digests and `idempotent-upsert`, `fresh-only-eligible`, or `blocked`. It makes zero answer-provider and zero judge requests. `blocked` stops all runs. `fresh-only-eligible` may continue only via another brand-new run id whose additional 500/948 allocation fits newly confirmed cumulative approvals; each source gets one attempt, and the first interruption/ambiguity abandons it. Never use a returned server id.

For full/resume, bind `cloudFromEnv`, the explicit answerer, stripped loader, verified capability, run lock, campaign ledger, checkpoint, framed audit writers, and runner. Install SIGINT/SIGTERM before network work, relay abort to ingest/status/query/provider calls, stop before the next irreversible phase, sync/close every chain, and release only owned locks. Prepare and audit each answer request, append/fsync its worst-case attempt/token/spend reservation, then call the provider; timeout, disconnect, or unknown outcome consumes that reservation and total-attempt allowance. `idempotent-upsert` mode preserves a resumable incomplete artifact; `fresh-only` records abandonment. Print progress as question ordinal/id digest, phase, elapsed time, measured-or-null usage, total attempts, reserved maxima, and cumulative measured cost only—never collection, source ids, environment values, prompts, or secret/account identifiers.

Add:

```json
"bench:longmemeval:cloud": "tsx scripts/longmemeval-cloud.ts"
```

Document only variable names in `.env.example`: `LONGMEMEVAL_BUDGET_ID`, `LONGMEMEVAL_ANSWER_PROVIDER`, `LONGMEMEVAL_ANSWER_MODEL`, `LONGMEMEVAL_ANSWER_INPUT_USD_PER_MILLION`, `LONGMEMEVAL_ANSWER_OUTPUT_USD_PER_MILLION`, `LONGMEMEVAL_MAX_ANSWER_ATTEMPTS`, `LONGMEMEVAL_MAX_ANSWER_INPUT_TOKENS`, `LONGMEMEVAL_MAX_ANSWER_OUTPUT_TOKENS`, `LONGMEMEVAL_MAX_ANSWER_SPEND_USD`, `LONGMEMEVAL_RUN_DEADLINE_MS`, `LONGMEMEVAL_RUN_ID`, `LONGMEMEVAL_UPSTREAM_DIR`, `LONGMEMEVAL_HYDRA_RESPONSE_MAX_BYTES`, `LONGMEMEVAL_JUDGE_MODEL`, `LONGMEMEVAL_MAX_JUDGE_BATCH_ATTEMPTS`, `LONGMEMEVAL_MAX_JUDGE_CALL_ALLOWANCE`, `LONGMEMEVAL_JUDGE_MAX_OUTPUT_TOKENS_PER_CALL`, `LONGMEMEVAL_MAX_JUDGE_INPUT_TOKENS`, `LONGMEMEVAL_MAX_JUDGE_OUTPUT_TOKENS`, `LONGMEMEVAL_JUDGE_INPUT_USD_PER_MILLION`, `LONGMEMEVAL_JUDGE_OUTPUT_USD_PER_MILLION`, `LONGMEMEVAL_MAX_JUDGE_SPEND_USD`, `LONGMEMEVAL_JUDGE_BATCH_DEADLINE_MS`, and `LONGMEMEVAL_JUDGE_GLOBAL_DEADLINE_MS`. Values remain absent. Do not put evaluator keys or benchmark spend controls into Vercel deployment configuration.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-cloud-cli.test.ts tests/unit/longmemeval-cloud-run.test.ts tests/unit/longmemeval-resource-ledger.test.ts tests/unit/longmemeval-execution-identity.test.ts --maxWorkers=1`

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
- Consumes: the same locked `CampaignResourceLedger` and clean `ExecutionIdentity` sealed by generation
- Produces: `npm run bench:longmemeval:evaluate -- --run-dir <dir>`

- [ ] **Step 1: Write pin/generation-manifest/environment gate tests**

Refuse evaluation unless the generation verifier re-hashes every `generation-manifest.json` entry; checkpoint and framed audits have exact sealed heads and no orphan; the cumulative campaign-ledger prefix byte-matches `resource-ledger-generation.jsonl`; the exact clean Lacuna HEAD/tree/harness manifest still matches; the upstream HEAD/remote equal the pinned values under isolated Git configuration; every materialized evaluator-bundle file byte-matches its pinned Git blob tuple; and dataset bytes/SHA/sorted-id digest match the constants above. Require `uv 0.11.21`; provision CPython exactly `3.9.25` under `.cache/longmemeval/python/`; create `.cache/longmemeval/venv-3.9.25`; install only `benchmarks/longmemeval/requirements-lite.lock.txt` with hash enforcement; verify the lock records the pinned upstream `requirements-lite.txt` blob/digest; import required modules; and record interpreter executable SHA-256, `python --version`, platform, lock digest, and `pip freeze --all`. Refuse any other interpreter or unlocked/mismatched environment.

All child processes—`uv`, Python provisioning/version/import/freeze checks, each judge batch, and metrics—must be launched only through `verifyImmediatelyBeforeSpawn`. In the same synchronous spawn turn, it revalidates the clean Lacuna identity, dataset, complete declared upstream bundle, and each consumed input; there is no intervening await or callback. Create immutable `evaluator-identity.json` containing Lacuna HEAD/tree/harness digest plus every upstream `{path, blobOid, expectedBytes, expectedSha256, observedBytes, observedSha256}` tuple. Tests alter a script after initial preflight and immediately before each distinct child, including same-length substitution, and assert that child was never invoked.

Require judge alias exactly `gpt-4o`, expected evaluator-reported model exactly `gpt-4o-2024-08-06`, `OPENAI_API_KEY` set, optional organization, positive global/batch deadlines, exactly 500 successful labels, an explicit maximum over all judge **batch attempts**, cumulative API-call-allowance/input-token/output-token/spend ceilings with versioned prices, and an operator-approved external OpenAI project hard spend limit at or below `LONGMEMEVAL_MAX_JUDGE_SPEND_USD`. Before a batch, derive its worst-case reservation from the exact pinned prompt renderer: one batch attempt, the configured retry-inclusive call allowance, `callAllowance * (maximum UTF-8 bytes of any exact batch prompt + 4096)` input tokens, `callAllowance * configuredMaximumOutputTokensPerCall`, and decimal spend rounded upward. If that finite bound cannot be proven from the pinned evaluator plus external hard controls, block before the first judge call. The shared campaign ledger's cumulative approvals must cover generation, abandoned/fallback runs, and every possible judge retry. Verify only set/unset and approved numeric limits; never print or persist key value, prefix, length, organization value, or project identifier.

- [ ] **Step 2: Write subprocess/output parser tests**

Use a fake process runner with literal pinned-script stdout/result fixtures. Split pending ids in lexical official order into immutable batches of 10. Every attempt gets a new exclusive-create `judge-attempts/<six-digit-attempt>-<batch-digest>/` directory; never reuse or overwrite it. Write/fsync its exact two-key `hypotheses.input.jsonl`, references to the separately sealed byte-exact `oracle.input.json`, exact argv/cwd/environment identity, and empty bounded stdout/stderr capture files. Before spawn, append/fsync both a judge-checkpoint `attempt-reserved` frame and a campaign-ledger worst-case batch-attempt/API-call-allowance/input-token/output-token/spend reservation bound to the attempt/input digests. For each batch invoke, from the verified materialized `<upstream>/src/evaluation`:

```text
<venv-python> evaluate_qa.py gpt-4o <absolute-batch-hypotheses.jsonl> <absolute-oracle.json>
```

Expect `<absolute-batch-hypotheses.input.jsonl>.eval-results-gpt-4o`; never look for upstream `.log`. Stream stdout/stderr to capped files, fsync all outputs, copy the raw result without normalization when present, and always write an outcome that explicitly records result presence/absence. Validate every complete row's exact pending id, unique coverage, two input keys plus one `autoeval_label`, boolean label, and model `gpt-4o-2024-08-06`. Preserve a valid completed prefix from a failed batch only through new fsynced judge-checkpoint frames; never mutate the attempt result. Write `attempt-manifest.json` last with sorted byte/SHA-256 entries for every input/reference, command/environment record, raw result or explicit absence record, stdout, stderr, and outcome; fsync/rename/sync, mark the attempt closed, and reject any later byte or extra-file change. Retry still-pending ids only in another attempt directory and reservation. Test changed/duplicate/foreign ids, malformed/ambiguous final row, changed hypotheses/generation-manifest/upstream/harness digest, non-zero exit with no salvageable prefix, stdout/stderr overflow, deadline kill, hard-limit/ledger-reservation absence, total-attempt exhaustion despite fewer than 500 successes, and a second evaluator process.

After 500 unique labels, merge them in lexical official-id order to atomic/fsynced `official-evaluator.jsonl`, then invoke exactly:

```text
<venv-python> print_qa_metrics.py <absolute-official-evaluator.jsonl> <absolute-oracle.json>
```

Run metrics in its own exclusive immutable `metrics-attempt/` directory after another immediate identity/blob/input verification. Capture exact bounded stdout/stderr and exit code, manifest command, merged evaluator input, oracle reference, stdout, stderr, parsed output, and outcome, then close it immutably. Validate per-type counts against the pinned dataset join; extract overall, task-averaged, per-question-type, and abstention metrics; and reject partial output, NaN/out-of-range metrics, model mismatch, changed generation/evaluator inputs, or non-zero exit. Judge usage/cost is `null` with `official_evaluator_does_not_report_usage` unless an exact dedicated-provider usage record is available; reservations still record worst-case token/spend and are never replaced by estimates or refunded.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-resource-ledger.test.ts tests/unit/longmemeval-execution-identity.test.ts --maxWorkers=1`

Expected: evaluator wrapper is absent.

- [ ] **Step 4: Implement isolated official evaluation**

Generate and review `requirements-lite.lock.txt` once from the pinned upstream top-level requirements using exact CPython 3.9 resolution and hashes for every allowed wheel/sdist; tests reject a dependency line without hashes or an undeclared top-level package. Provision/reuse only the exact verified uv/Python/lock environment above. The child receives an allowlist of required operating-system/TLS/temp variables, `PYTHONHASHSEED=0`, `OPENAI_API_KEY`, optional organization, and controlled absolute paths; it receives no Hydra token, answer-provider key, env-file path, or unrelated environment value.

Run deterministic pending-id batches with a versioned, exclusive, hash-chained `judge-checkpoint.jsonl`; sync after reservation and every accepted label. Each pre-spawn campaign-ledger reservation charges one total batch attempt plus the configured worst-case underlying call allowance, input tokens, output tokens, and spend; unknown/timeout/killed/no-result attempts remain fully consumed. Apply per-batch and global deadlines, kill the subprocess tree on expiry, salvage only a strictly valid complete prefix, cap total batch attempts independently of 500 successful labels, and never exceed 500 unique successes. The upstream backoff loop is unbounded, so the conservative reservation, outer deadline, and external project hard limit are mandatory rather than advisory. Resume under both locks revalidates the generation manifest, immutable attempt manifests/directories, every judge frame, and the cumulative ledger prefix before reserving another attempt.

Write, without modifying any generation file: sealed `oracle.input.json`, `evaluator-identity.json`, all immutable `judge-attempts/**` and `metrics-attempt/**` files, `official-evaluator.jsonl`, aggregate `official-evaluator.stdout.txt`/`stderr.txt`, `official-evaluator-command.json`, `official-evaluator-environment.json`, `judge-checkpoint.jsonl`, `resource-ledger-evaluation.jsonl`, `official-metrics.json`, and final `artifact.json`. Command/identity metadata contains exact argv/cwd/exit/deadline/batch-input digests, clean Lacuna HEAD/tree/harness digest, every upstream expected/observed Git-blob tuple, generation identity, campaign-ledger genesis/final head/cumulative approved/reserved/measured totals, and successful-versus-total attempt counts—never secrets. Under the campaign lock, copy and seal the exact full ledger prefix through evaluation and require its generation prefix to byte-match the generation snapshot. Run the exact-secret/header scan over all generation and evaluation files. Write `evaluation-manifest.json` last as sorted `{relativePath, bytes, sha256}` entries covering `generation-manifest.json` plus every attempt input/result/stdout/stderr/command/outcome/attempt-manifest and every aggregate evaluation/final artifact, excluding only itself. Re-read every digest, verify hypotheses/generation manifest/attempt directories unchanged, and reject an unmanifested attempt, extra file, or extra score-bearing output.

Add `"bench:longmemeval:evaluate": "tsx scripts/longmemeval-evaluate.ts"` to `package.json`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-resource-ledger.test.ts tests/unit/longmemeval-execution-identity.test.ts --maxWorkers=1`

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
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/run.json`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/checkpoint.jsonl`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/provenance.json`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/capability.json`
- Create after successful run: `artifacts/benchmarks/longmemeval/<run-id>/hypotheses.jsonl`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/retrieval-audit.jsonl`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/prompt-audit.jsonl`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/execution-identity.json`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/resource-ledger-generation.jsonl`
- Create after successful generation: `artifacts/benchmarks/longmemeval/<run-id>/generation-manifest.json`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/evaluator-identity.json`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/judge-attempts/`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/metrics-attempt/`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/resource-ledger-evaluation.jsonl`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/oracle.input.json`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/judge-checkpoint.jsonl`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/official-evaluator.jsonl`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/official-evaluator.stdout.txt`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/official-evaluator.stderr.txt`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/official-evaluator-command.json`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/official-evaluator-environment.json`
- Create after successful run: `artifacts/benchmarks/longmemeval/<run-id>/official-metrics.json`
- Create after successful evaluation: `artifacts/benchmarks/longmemeval/<run-id>/evaluation-manifest.json`
- Modify only after verified score: `docs/BENCHMARK_LONGMEMEVAL.md`
- Modify only after verified score: `docs/V10_RELEASE_STATUS.md`
- Modify only after verified score: `web/src/landing/Evals.tsx`
- Modify only after verified score: `web/src/app/routes/evaluations.tsx`

- [ ] **Step 1: Run all benchmark-local gates**

Run: `npm run typecheck`

Run: `npx vitest run tests/unit/longmemeval-adapter.test.ts tests/unit/ground-truth-isolation.test.ts tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-cloud-documents.test.ts tests/unit/longmemeval-answerer.test.ts tests/unit/provider-openai.test.ts tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts tests/unit/longmemeval-resource-ledger.test.ts tests/unit/longmemeval-cloud-run.test.ts tests/unit/hydra-bounded-json.test.ts tests/unit/cloud-source.test.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-cloud-cli.test.ts tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts --maxWorkers=1`

Expected: all commands exit zero with no benchmark test skipped.

- [ ] **Step 2: Run the no-paid-call production capability and quota gate**

Before loading answer-provider or judge credentials, select the deterministic non-secret budget id for the exact Hydra account/database and inspect its locked cumulative ledger. Obtain operator confirmation for totals covering **all** existing/abandoned/fallback reservations plus this run's additional 500 persistent collections, 948 documents, and maximum Hydra spend/storage cost. A prior failed preflight or abandoned fresh-only run therefore requires at least another 500/948 allocation; a new run id never resets consumption. Run:

```bash
npm run bench:longmemeval:cloud -- --preflight --budget-id <account-project-budget-id> --run-id oracle-2026-08-21 --out artifacts/benchmarks/incomplete/oracle-2026-08-21 --approved-total-collections <existing-plus-500> --approved-total-documents <existing-plus-948> --approved-total-hydra-spend-usd <cumulative-approved-limit>
```

Require the full-run allocation frame to be durable before the first request. Require the first official collection/document to prove stable requested client id, completed readiness, exact `inspect(requestedId)` byte readback, streamed/bounded scoped query, and persisted opaque source/date sidecar. Two unambiguous identical same-id upserts converging to exactly one source select resumable `idempotent-upsert`. If and only if client-id/readback facts hold while the duplicate probe neither proves convergence nor shows divergence, record `fresh-only-eligible`; starting it requires a new run id and another cumulative 500/948 reservation. Any unstable id, unavailable/mismatched readback, duplicate/divergent state, or server-id-only behavior blocks execution. Require zero answer-provider and zero judge requests.

If the result is `fresh-only-eligible`, do not reuse `oracle-2026-08-21`. Repeat this preflight with `--fresh-only`, a new never-used run id/output directory, and approvals increased by another 500 collections, 948 documents, and worst-case Hydra spend. If that new run's own first stable-id/readback check fails, block; never downgrade again or adopt a server id. The remaining commands use the selected new run id and `--fresh-only` instead of `--resume`.

- [ ] **Step 3: Confirm secret and hard-limit availability without disclosure**

Check only set/unset state for Hydra Cloud credentials, the selected answer-provider credentials/base URL, and official judge credentials. Require operator-approved cumulative totals and per-run ceilings for all answer attempts/input tokens/output tokens/spend and all judge batch attempts/call allowance/input tokens/output tokens/spend, explicit versioned provider/judge prices, answer and judge deadlines, and external provider/OpenAI hard limits at or below the recorded maxima. Ceilings count reservations and ambiguous attempts, not successes. Abort before spending if any control is absent or if cumulative ledger history plus worst-case remaining work exceeds an approval. Record only provider/requested model, expected response-model rule, judge alias/snapshot, numeric limits, price provenance/version, budget/run ids, and account/project-scope digests; never record secret length, prefix, or value.

- [ ] **Step 4: Execute or resume the serial cloud run**

Run:

```bash
npm run bench:longmemeval:cloud -- --resume --budget-id <account-project-budget-id> --run-id oracle-2026-08-21 --out artifacts/benchmarks/incomplete/oracle-2026-08-21 --approved-total-answer-attempts <cumulative-limit> --approved-total-answer-input-tokens <cumulative-limit> --approved-total-answer-output-tokens <cumulative-limit> --approved-total-answer-spend-usd <cumulative-limit>
```

The capability gate already created the run and first phase, so `idempotent-upsert` execution resumes it. If interrupted in that verified mode, rerun the same command after both exclusive locks are absent or use explicit `--recover-stale-lock` only after proof succeeds. For the narrowly eligible branch, invoke the equivalent command once with `--fresh-only` and the new run id; never pass `--resume`. Keep concurrency at one. Before every answer call, require a new durable worst-case campaign-ledger reservation and matching checkpoint frame; an ambiguous call consumes it. Inspect every non-completed receipt/readback/retrieval/provider/audit/ledger failure and fix the root cause before resuming only the resumable mode; do not silently skip a question. A `fresh-only` interruption is never resumed, and its cumulative allocation/attempt reservations remain consumed.

- [ ] **Step 5: Verify and manifest exactly 500 hypotheses**

Run the verifier independently. Require 500/500 unique ids, exact sorted-id digest, two keys per line, matching provenance/chained-checkpoint/framed-audit heads with exact orphan reconciliation, every document completed and read back, reconstructable exact bounded retrieval/provider-message evidence, zero forbidden key/value findings, exact clean Lacuna harness and upstream expected/observed blob tuples, recorded deterministic Hydra collection/source algorithms and proven mode, cumulative resource-ledger snapshot including abandoned/fallback reservations, successful/total attempt counts, worst-case reserved and measured-or-null usage/cost truth, no score fields, and an exact-secret scan with zero findings. Write and reverify non-circular `generation-manifest.json`. Only then atomically emit the immutable generation run under `artifacts/benchmarks/longmemeval/oracle-2026-08-21/`.

- [ ] **Step 6: Run the pinned official evaluator**

Run:

```bash
npm run bench:longmemeval:evaluate -- --budget-id <account-project-budget-id> --run-dir artifacts/benchmarks/longmemeval/oracle-2026-08-21 --approved-total-judge-batch-attempts <cumulative-limit> --approved-total-judge-call-allowance <cumulative-limit> --approved-total-judge-input-tokens <cumulative-limit> --approved-total-judge-output-tokens <cumulative-limit> --approved-total-judge-spend-usd <cumulative-limit>
```

Require every subprocess to pass the immediate clean-harness and pinned-Git-blob verification. Require each judge batch attempt to have a prior fsynced worst-case reservation and a closed immutable attempt directory/manifest; total attempts, not successes, must remain under the approved cumulative ceiling. Require exactly 500 unique official evaluator JSONL rows with judge snapshot `gpt-4o-2024-08-06`, then run the exact two-argument metrics command in its immutable attempt directory. Require validated overall/task-averaged/per-type/abstention metrics, zero secret findings, an exact evaluation resource-ledger snapshot, and a non-circular `evaluation-manifest.json` covering unchanged generation evidence plus every evaluator identity/attempt input/result/stdout/stderr/manifest and aggregate/final output. Re-run both manifest verifiers and require every generation digest, especially hypotheses, unchanged.

- [ ] **Step 7: Perform an independent artifact review**

Have a fresh review agent compare the official dataset id set/digests, hypotheses, both manifests, exact clean Lacuna harness commit/tree/manifest, every expected/observed upstream Git-blob tuple, chained generation/judge checkpoints, framed audit chains and orphan reconciliation, exact readback and bounded retrieval/prompt evidence, both cumulative resource-ledger snapshots including abandoned/fallback runs, every immutable judge/metrics attempt input/result/stdout/stderr/manifest, raw merged evaluator records, parsed metrics, requested/reported answer and judge identities, successful/total attempts, reserved and measured-or-null usage/cost, limits, retrieval failures, and forbidden-key/value plus exact-secret scans. Any discrepancy keeps all public product copy at `No official score exists`.

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
