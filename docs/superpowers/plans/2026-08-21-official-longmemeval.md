# Official LongMemEval Oracle Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, auditable LongMemEval oracle harness in which HydraDB Cloud is the actual memory/retrieval system and no ground-truth answer fields or encoded labels cross the generation boundary, while exposing no executable paid 500-question path until Hydra supplies a stable authenticated scope identity and authoritative inventory/quota gate.

**Architecture:** A cloud-only runner loads an `IngestibleQuestion[]` through a ground-truth-stripping loader, writes each question's dated sessions under opaque deterministic source ids, requires stable client ids, exact inspect readback, and repeated-upsert convergence, and passes only strictly decoded, bounded Hydra-returned chunks plus verbatim benchmark wall-clock dates to a narrow answer input. Acquisition records immutable upstream/data provenance only; after every harness commit, a separate final run identity seals the clean tracked harness, a recursively byte-manifested dependency runtime, and `capability.json`. Run-local locks protect framed/fsynced evidence, but they are not an account-wide quota authority: production execution remains unavailable until a server-authenticated Hydra scope and authoritative inventory/quota check exist. Official judging retains the pinned scoring path, bounded subprocess attempts, crash recovery, a provider-enforced external spend cap, and separate non-circular generation/evaluation manifests.

**Tech Stack:** TypeScript, HydraDB Cloud, existing OpenAI-compatible provider adapter, Node filesystem/crypto/process, Python 3.9 official evaluator, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-production-convergence-design.md`

**Pinned primary sources:**

- Evaluator repository: `https://github.com/xiaowu0162/LongMemEval.git` at commit `9e0b455f4ef0e2ab8f2e582289761153549043fc`.
- Cleaned official dataset repository: `https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned` at commit `98d7416c24c778c2fee6e6f3006e7a073259d48f`.
- Dataset file: `longmemeval_oracle.json`, exactly 500 questions.
- Dataset bytes: exactly `15388478`; SHA-256 `821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c`; SHA-256 of the lexically sorted ids joined by `\n` with one final `\n`: `f038965c54b03632f86a59104dd77848b66e3f80c08d5fbabdd3984d16457811`.
- Official judge commands, from cwd `<upstream>/src/evaluation`: `python evaluate_qa.py gpt-4o <hypotheses-or-batch.jsonl> <oracle.json>`, producing `<hypotheses-or-batch.jsonl>.eval-results-gpt-4o`, then `python print_qa_metrics.py <merged-eval-results.jsonl> <oracle.json>`. The wrapper inserts only interpreter isolation flags `-I -B`; `print_qa_metrics.py` receives no model argument.
- Evaluator runtime: `uv 0.11.21`, CPython `3.9.25`, and a reviewed hash-locked transitive requirements file derived from the pinned upstream `requirements-lite.txt`. Python 3.9 is end-of-life and is used only inside this isolated evaluator environment because it is the upstream-declared runtime.

## Global Constraints

- The cloud runner never imports or calls `loadDataset()` and never receives a `LongMemEvalRecord`. The answerer receives `AnswerInput`, never `IngestibleQuestion`; `AnswerInput` excludes question id, question type, session ids, collection, and all dataset records.
- `answer`, `answer_session_ids`, `has_answer`, raw `question_id`, raw `haystack_session_ids`, the `_abs` encoded abstention label, and the `answer_` session-id marker are forbidden in indexed document text/title/filename, answer input, provider messages, retrieval/prompt audit, and any consumed graph context. The runner alone retains question id for collection selection, checkpoint association, and hypotheses output.
- LongMemEval dates remain byte-for-byte wall-clock strings such as `2023/05/30 (Tue) 23:40`; no timezone is invented and no ISO conversion occurs. `Chunk.observedAt` is Hydra upload time and is never a benchmark session date. A durable opaque-source-to-verbatim-date sidecar supplies dates even when a returned chunk contains no header.
- Each question uses a deterministic, per-run Hydra collection; collections persist because the current Cloud API exposes no delete.
- Ingestion is serial per question and answer generation is serial across questions. Resume never re-ingests or re-answers a completed checkpoint row. `idempotent-upsert` requires all three live facts: the requested deterministic client id is the returned/addressable id, `inspect(id)` returns exact submitted bytes, and a repeated same-id/same-bytes upsert converges to exactly one identical source. Failure or uncertainty in any fact blocks all execution. There is no `fresh-only`, server-generated-id, or fallback mode.
- Exactly one process owns a run directory. `run.json`, checkpoint frames, audit frames, hypotheses, manifests, and evaluator attempt outputs use atomic rename or framed append+fsync as specified below; no completed state is inferred from an unsynced file. A local journal is evidence and per-run accounting only, never proof of account-wide inventory, exclusivity, or quota.
- No production 500-run command or paid judge command exists until the provider returns a stable authenticated Hydra account/database identity and an authoritative inventory/quota response for that same identity. A caller label, environment value, path-derived digest, local lock, local ledger, or operator-entered cumulative count cannot satisfy this gate. The current Hydra composition therefore reports `executionAvailable: false` and exits before credentials capable of paid writes/judging are loaded.
- Acquisition writes only pinned source/data provenance. After Tasks 1-8 are committed, every run binds a newly captured exact clean Lacuna HEAD commit/tree and sorted tracked harness manifest, the acquisition-provenance digest, the exact `capability.json` digest, and a separately sealed dependency-runtime manifest. Dirty index/tracked/untracked harness state is a hard failure; the one verified runtime cache is excluded from Git cleanliness only because its recursively exact file set and bytes are checked independently before every spawn.
- Every executable/importable file in the dedicated Node/TS, uv, CPython, virtualenv, and evaluator dependency runtime is listed by normalized relative path, byte length, mode/type, and SHA-256. Symlinks, special files, path escape, missing files, and extras fail before spawn. Python runs isolated with bytecode writes disabled; no child may mutate a sealed runtime.
- A run with fewer than exactly 500 unique official ids stays under `artifacts/benchmarks/incomplete/` and cannot contain a score.
- The official evaluator runs only after the hypotheses schema, exact sorted-id digest, and immutable generation manifest pass. The final score is publishable only after a separate non-circular evaluation manifest covers every raw evaluator and metric artifact.
- Oracle-tier results are labelled `oracle`; they are never described as LongMemEval-S, LongMemEval-M, or leaderboard-comparable retrieval over distractor history.
- The answer path is described as bounded `HydraDB Cloud returned chunks`. Every Hydra response is streamed through a byte ceiling and strict UTF-8/bounded JSON decoder before schema decoding. Although `HydraCloud.query()` requests `graph_context: true`, bounded canonical `sources`, `graph_context`, and `temporal_facts` are audited/digested but never put into the prompt. No raw `unknown` value is parsed or digested without structural and canonical-byte caps, and no copy calls the chunks graph-enriched. A future consumed graph mode requires its own bounded typed contract and is outside this run.
- Answer-provider calls retain explicit request/output/deadline/spend controls. The pinned official judge does not expose a trustworthy internal API-call or token counter, so this plan makes no judge N+1 or token-cap claim. A judge subprocess may start only with an authoritatively verified provider-enforced hard spend cap on its dedicated project/key plus a process-tree deadline; otherwise paid evaluation fails closed. Exact usage/cost is recorded only when measured, otherwise `null` plus a reason.
- Every publishable text or JSON artifact is scanned for the exact configured secret values before the evaluation manifest is written; scans never record secret value, prefix, or length.
- Heavy tests and the real run use one worker/process.

---

### Task 1: Pinned upstream/data acquisition and provenance manifest

**Files:**
- Create: `scripts/longmemeval-acquire.ts`
- Create: `benchmarks/longmemeval/provenance.ts`
- Create: `benchmarks/longmemeval/execution-identity.ts`
- Create: `benchmarks/longmemeval/dependency-runtime.ts`
- Create: `scripts/longmemeval-seal-runtime.ts`
- Modify: `package.json`
- Test: `tests/unit/longmemeval-provenance.test.ts`
- Test: `tests/unit/longmemeval-execution-identity.test.ts`
- Test: `tests/unit/longmemeval-dependency-runtime.test.ts`

**Interfaces:**
- Produces: `LongMemEvalProvenance`
- Produces: `captureFinalRunIdentity(provenance, capability, runtimeManifest)` and `verifyImmediatelyBeforeSpawn(identity, childSpec)`
- Produces: `sealDependencyRuntime(stagingRoot, outputManifest)` and `verifyDependencyRuntime(manifest)`
- Produces: `npm run bench:longmemeval:acquire`
- Produces: `npm run bench:longmemeval:seal-runtime`
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

Test acquisition provenance separately from run identity. Acquisition must not write, cache, predict, or name a Lacuna HEAD/tree as the final run identity. `captureFinalRunIdentity` is callable only after Tasks 1-8 are committed and requires the index plus every tracked worktree file to equal the then-current HEAD. It records that final commit/tree and a sorted byte/SHA-256/mode manifest of all tracked files, and binds the exact acquisition-provenance, `capability.json`, and dependency-runtime manifest digests. Non-ignored untracked files are allowed only inside the exact selected benchmark output directory. Ignored acquisition inputs and the one selected verified dependency runtime are allowed only at their recorded `.cache/longmemeval/` paths; the acquisition cache is never executable/importable, while the dependency runtime is excluded from Git cleanliness only after its independent recursive verification succeeds. Any other untracked/ignored executable or importable path is dirty harness state.

Test the common spawn guard in the same synchronous spawn turn. It rechecks final HEAD/tree/cleanliness and every tracked digest, then recursively enumerates each declared runtime root and rejects a missing, changed, differently typed, symlinked, special, or extra entry before byte-comparing all files to the sealed manifest. It also rechecks the dataset and each consumed evaluator bundle/input tuple. The spawn cannot occur after an intervening await, callback, timer, or user hook. A child executable, script, native add-on, importable Node/Python module, package metadata file, certificate bundle, or data file outside the exact declared runtime/input manifests is refused. Acquisition Git/download commands are outside run identity and cannot produce benchmark evidence.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts --maxWorkers=1`

Expected: acquisition, provenance, execution-identity, and dependency-runtime modules are absent.

- [ ] **Step 4: Implement deterministic acquisition**

Download to a temporary sibling, stream while hashing, require the expected byte count and SHA-256 before parsing, validate JSON and the exact sorted-id digest before atomic rename, fsync the file and containing directory, and refuse an existing file whose digest or question set differs. Clone/check out the evaluator under the isolated Git configuration; verify `git rev-parse HEAD`, exact remote URL, and the complete tree-derived bundle; then materialize the execution bundle from `git cat-file blob` bytes rather than trusting checkout bytes. Write `.cache/longmemeval/provenance.json` atomically with URLs, commits, filenames, expected/observed dataset bytes and SHA-256, acquisition time, 500 sorted ids, sorted-id digest, and the sorted per-upstream-file `{path, blobOid, expectedBytes, expectedSha256, observedBytes, observedSha256}` tuples. It contains no Lacuna HEAD/tree, run id, `capability.json`, runtime identity, or generation identity. Never store credentials, response headers, redirect query strings, or environment values.

Implement a no-paid-action runtime builder. It stages one dedicated root containing the exact copied tracked harness entry files, the Node executable, complete copied Node dependency tree needed by the direct runner entrypoints, the exact uv executable, CPython distribution, virtualenv, hash-locked packages, evaluator bundle, and required certificate/data files. Resolve source-package links while staging, copy only regular target bytes, and reject every link in the final root. The bootstrap uv root is itself recursively byte-manifested and sealed before any uv spawn. After provisioning/import checks, delete every `__pycache__`/`.pyc`, reject symlinks/special files, make runtime files non-writable, recursively sort and record every regular file as `{relativePath, bytes, sha256, mode, role}`, and atomically/fsync `dependency-runtime.json` outside the sealed root. Node children invoke exactly the sealed Node executable, sealed `node_modules/tsx/dist/cli.mjs`, and a sealed copied tracked TypeScript entrypoint; no worktree or ambient `node_modules` import is permitted. Evaluator children use `<venv-python> -I -B` with `PYTHONDONTWRITEBYTECODE=1`, `PYTHONNOUSERSITE=1`, no `PYTHONPATH`, and an empty controlled cwd/temp directory. Every child imports only from the exact sealed roots. Host kernel/system-loader libraries and device interfaces are recorded as platform facts but are not misrepresented as portable dependency files.

Add `"bench:longmemeval:acquire": "tsx scripts/longmemeval-acquire.ts"` and `"bench:longmemeval:seal-runtime": "tsx scripts/longmemeval-seal-runtime.ts"` to `package.json`. The latter can create only a candidate runtime; it cannot load production credentials, call Hydra/providers, or create publishable run evidence.

- [ ] **Step 5: Run focused tests and a real acquisition**

Run: `npx vitest run tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts --maxWorkers=1`

Run: `npm run bench:longmemeval:acquire`

Expected: the tests pass; the ignored cache contains the pinned evaluator, the exact 15,388,478-byte/500-question oracle file, and a verified acquisition provenance manifest whose dataset and sorted-id digests equal the constants above. No final run identity exists yet.

- [ ] **Step 6: Commit the acquisition boundary**

```bash
git add scripts/longmemeval-acquire.ts scripts/longmemeval-seal-runtime.ts benchmarks/longmemeval/provenance.ts benchmarks/longmemeval/execution-identity.ts benchmarks/longmemeval/dependency-runtime.ts package.json tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts
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
- Create: `src/provider/bounded-json.ts`
- Modify: `src/provider/openai.ts`
- Test: `tests/unit/longmemeval-answerer.test.ts`
- Test: `tests/unit/provider-bounded-json.test.ts`
- Test: `tests/unit/provider-openai.test.ts`

**Interfaces:**
- Produces: `CloudAnswerer`
- Produces: `OpenAiCompatibleCloudAnswerer`
- Produces: `prepareAnswer(input): PreparedAnswerCall` and `executePreparedAnswer(prepared, reservation, signal)`; preparation performs no network I/O
- Produces: `readBoundedProviderJson(response, limits, signal)`
- Expands: `complete(..., { signal, timeoutMs, maxTokens })` with keyless-local support and strict optional usage
- Consumes: `src/provider/openai.ts#complete`

- [ ] **Step 1: Write prompt-boundary tests**

Construct literal bounded evidence plus an opaque-source/date sidecar and assert the provider receives one system message and one user message containing only the question, verbatim question wall-clock date, evidence text, opaque source id/title, and sidecar session date. Include a headerless chunk and prove it receives the correct date from the sidecar. Recursively audit both prompt keys and serialized values for the forbidden ground-truth fields/encoded labels in Global Constraints; ensure `Chunk.observedAt`, raw question/session ids, `_abs`, and `answer_` never occur. The exact messages written to `prompt-audit.jsonl` must byte-match the messages passed to `complete()` and contain no request headers or provider configuration.

- [ ] **Step 2: Write provider/output tests**

Require an explicit `LONGMEMEVAL_ANSWER_PROVIDER` in `groq|deepseek|ollama|vllm` and explicit model. Reject auto-selection, Anthropic, missing cloud key, missing base URL, blank hypothesis, a response over 4,096 characters, or provider error. Permit a missing key only when `ProviderConfig.where === 'local'`; omit the Authorization header entirely in that case. Strictly decode optional non-negative integer `prompt_tokens`, `completion_tokens`, and `total_tokens`, preserve both requested and provider-reported model identities, and reject malformed usage or a response-model change after the first completed answer. Record usage as measured or `null` with `provider_did_not_report_usage`; cost is measured only from reported usage and explicit versioned input/output prices.

Stream an answer-provider success body through an exact 262,144-byte cap and a non-2xx body through an exact 16,384-byte cap, regardless of missing/lying `Content-Length`. Abort/cancel the reader at the first excess byte, decode UTF-8 fatally, and parse with bounded JSON structure: depth 8, at most 64 keys per object, 256 array elements, 2,048 total tokens, 65,536 scalar Unicode values, no duplicate/prototype-polluting keys, no trailing value, and only the one-choice OpenAI-compatible response schema. Error details are reduced to status plus a fixed safe code; raw body/header/provider text is neither returned nor logged. Test one byte below/at/above each cap, split multibyte sequences, invalid UTF-8, duplicate keys, excessive depth/tokens/string, trailing JSON, abort/timeout during streaming, reader cancellation, timer/listener removal, late chunks, and success/error teardown with no retry or lingering body read.

Set immutable run-identity ceilings before the first call: exactly 500 successful hypotheses, an explicit maximum over **all** answer attempts (including timeouts/ambiguous failures), 70,000 prompt characters per attempt, 1,200 output tokens per attempt, caller-supplied per-run input-token/output-token ceilings, a caller-supplied run deadline, and a caller-supplied maximum answer spend. A cloud answer run additionally requires explicit versioned per-million input/output prices, the authoritative Hydra execution-eligibility gate, and an operator-approved external provider-account hard limit at or below the recorded maximum. `prepareAnswer` emits the exact messages/digest and no network I/O; its conservative reservation uses `utf8ByteLength(canonicalMessages) + 4096` input tokens, exactly 1,200 output tokens, and decimal spend rounded upward at the configured prices. `executePreparedAnswer` accepts only a durable run-resource-journal reservation bound to that digest/provider/model/attempt ordinal and rejects a missing, reused, mismatched, or unsynced reservation. The journal enforces this run's local limits but never claims account-wide quota. Test caller abort, timeout, total-attempt/token/spend exhaustion, ambiguous attempts remaining consumed, missing price, exact measured cost, and measured-or-null usage.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-answerer.test.ts tests/unit/provider-bounded-json.test.ts tests/unit/provider-openai.test.ts --maxWorkers=1`

Expected: answerer module is absent.

- [ ] **Step 4: Implement the answer-only prompt**

Extend and use the existing `complete(config, model, messages, { maxTokens: 1200, timeoutMs, signal })` seam. Replace all provider `Response.json()`/unbounded text reads with `readBoundedProviderJson`; one composed abort controller owns caller abort, timeout, fetch, and body reader, and a single `finally` cancels an unfinished reader and removes timers/listeners. The system instruction says answer from retrieved evidence, preserve the supplied verbatim wall-clock dates, and abstain plainly when unsupported; it must not mention reference answers, question ids, question types, abstention labels, collection names, or Hydra upload time. Evidence dates come only from the validated opaque-source sidecar; remove the generated document header from a chunk when present, but do not require a chunk to contain it. Split preparation from execution: canonicalize/audit the exact messages and compute conservative token/spend maxima first; only the execution method holding the matching fsynced reservation may invoke `complete`. Enforce prompt/output/total-attempt/token/spend ceilings before returning typed answer metadata.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-answerer.test.ts tests/unit/provider-bounded-json.test.ts tests/unit/provider-openai.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit the answerer**

```bash
git add benchmarks/longmemeval/cloud-answerer.ts benchmarks/longmemeval/cloud-types.ts src/provider/bounded-json.ts src/provider/openai.ts tests/unit/longmemeval-answerer.test.ts tests/unit/provider-bounded-json.test.ts tests/unit/provider-openai.test.ts
git commit -m "feat(benchmark): answer only from retrieved Hydra evidence"
```

---

### Task 4: Durable checkpoint, resume, and canonical hypotheses

**Files:**
- Create: `benchmarks/longmemeval/checkpoint.ts`
- Create: `benchmarks/longmemeval/audit.ts`
- Create: `benchmarks/longmemeval/resource-journal.ts`
- Test: `tests/unit/longmemeval-checkpoint.test.ts`
- Test: `tests/unit/longmemeval-audit.test.ts`
- Test: `tests/unit/longmemeval-resource-journal.test.ts`

**Interfaces:**
- Produces: `CloudRunCheckpoint.open(path, expectedIds, identity)`
- Produces: `checkpoint.append(event): Promise<void>`
- Produces: `checkpoint.serialiseHypotheses(order): string`
- Produces: `RunLock.acquire(path, identity, { recoverStale }): Promise<RunLock>`
- Produces: framed/hash-chained/fsynced `retrieval-audit.jsonl` and `prompt-audit.jsonl` writers whose stream heads are checkpointed
- Produces: `RunResourceJournal.open(runDir, runIdentity)` and durable `reserveAnswerAttempt`, `recordJudgeAttemptStart`, and measured-or-null outcome operations

- [ ] **Step 1: Write filesystem-backed checkpoint tests**

Use a temporary directory and assert `run.json` is written to a sibling temporary file, synced, atomically renamed, and followed by a containing-directory sync before any event may append. Each checkpoint or audit line is a versioned frame containing `stream`, `sequence`, `previousSha256`, canonical `event`, `eventBytes`, and `eventSha256`; append through an open handle, sync, and close before the promise resolves. Validate every complete hash chain and contiguous sequence on open. Bind exact final Lacuna HEAD/tree/harness-manifest, acquisition-provenance, dependency-runtime, `capability.json`, authoritative eligibility, and upstream tuple digests. Cover resume after interruption, lexically sorted official-id order, duplicate/foreign id, modified complete line, missing newline after an otherwise complete line, malformed length/digest, mismatched dataset/provider/model/prices/caps/prompt/retrieval/Hydra/run/code/eligibility/runtime/capability identity, dirty or changed harness, blank hypothesis, and an existing generation/evaluation manifest.

Simulate a crash at every byte boundary of the final frame in each stream. Recovery may truncate exactly one unterminated trailing fragment to the last verified newline, only while the exclusive run lock is held, and must append a recovery frame containing the stream, discarded byte count, discarded-byte digest, and prior verified head. A complete newline-terminated but invalid row, corruption before the last row, sequence/hash mismatch, or more than one fragment is fatal and is never auto-repaired. Reconcile audit/checkpoint heads exactly under the same lock: an audit may have at most one complete fsynced orphan frame beyond the checkpointed head, and it is adopted only if its stream, next phase, question ordinal digest, payload bytes/digest, and prior head are the single deterministic event currently expected; append/fsync `audit-orphan-adopted` before proceeding. An audit behind its checkpoint, two or foreign orphan frames, a changed payload, or any ambiguity fails closed; no complete orphan is silently truncated or replayed.

- [ ] **Step 2: Write no-reingest resume tests**

Acquire the run lock with exclusive-create semantics and record version, random nonce, PID, process start time, hostname, and run identity. A second live owner must fail before reading secrets or making network calls. Stale recovery requires explicit `--recover-stale-lock`, proves the recorded process is absent and identity matches, atomically archives the stale lock record, and writes a recovery event; uncertainty or PID reuse fails closed. Release removes only a lock whose nonce still matches. Test live contention, stale success, stale identity mismatch, nonce mismatch, and abnormal-exit recovery.

Load three ids with two completed hypotheses and assert `pendingIds()` returns only the third. Define append-only phase events for `document-submitted`, `document-completed`, `retrieval-audited`, `prompt-audited`, `answer-attempt-reserved`, and `answer-completed`. A completed hypothesis is immutable. Retrying a missing phase is allowed only under the exact sealed `idempotent-upsert` capability; every other capability value blocks before a run exists.

Create one `resource-journal.jsonl` inside the run directory and bind its genesis to the final run identity, authoritative execution-eligibility evidence digest, answer-provider scope digest, price version, and immutable per-run limits. It is not stored at a caller-derived account path and does not purport to serialize other machines/runs. Under `run.lock`, append/fsync a digest-bound answer reservation with the next attempt ordinal and conservative tokens/spend before each answer call; append a judge/metrics attempt-start ordinal before each subprocess, but do not claim internal judge API-call or token reservations. No reservation/start is removed, reused, decremented, or refunded. Test concurrent local opens, identity/capability mismatch, truncated-tail recovery, corrupt chains, ceiling equality/exhaustion, and ambiguity/timeout/no-result outcomes. Separately prove that this journal can never make `executionAvailable` true and that a caller-supplied account id/count/quota cannot substitute for the authoritative Hydra gate.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts tests/unit/longmemeval-resource-journal.test.ts --maxWorkers=1`

Expected: checkpoint module is absent.

- [ ] **Step 4: Implement append-only checkpointing**

Acquire `run.lock` before opening mutable state. Write the atomic/fsynced versioned `run.json` identity before the first frame. Identity includes run/dataset/evaluator commits and complete expected/observed upstream file tuples, sorted-id digest/order, exact final clean Lacuna HEAD/tree/harness-manifest digest, acquisition-provenance digest, dependency-runtime digest, exact `capability.json` digest, authoritative execution-eligibility scope/inventory/quota evidence digest, Hydra collection/source algorithms, answer provider/requested model/base-origin digest, provider-reported model rule, prompt/retrieval versions and limits, prices, per-run total-attempt/token/spend/deadline ceilings, and external hard-limit acknowledgements. Append chained phase frames and validate/reconcile every complete checkpoint/audit/journal prefix under lock before resume. Persist exact bounded retrieval payloads and exact provider-message payloads as framed/hash-chained audit events, fsync them, then append the checkpoint head reference; neither audit contains headers, credentials, raw dataset ids, or forbidden labels. Record opaque collection/source association, submitted/completed ids, document/readback digests, ordered chunk/audit heads, bounded canonical sources/graph/temporal digests, graph-context requested/consumed flags, run-journal reservation id/head, answer metadata, measured-or-null usage/cost, and hypothesis. Build `hypotheses.jsonl` only from validated `answer-completed` events in the provenance's sorted-id order; never edit it in place.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts tests/unit/longmemeval-resource-journal.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit durable resume**

```bash
git add benchmarks/longmemeval/checkpoint.ts benchmarks/longmemeval/audit.ts benchmarks/longmemeval/resource-journal.ts tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts tests/unit/longmemeval-resource-journal.test.ts
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
- Produces: an opaque `VerifiedHydraExecutionEligibility` input shape in `cloud-types.ts`; only Task 7's reviewed gate can construct the production brand
- Expands: `HydraCloud.ingestDocument` with deterministic `sourceId`, explicit `upsert`, and caller signal
- Produces: `readBoundedJson(response, limits)` and bounded canonical query auxiliary values
- Consumes: `HydraCloud.withCollection`, `ingestDocument`, `waitForIndexing`, `inspect`, and `query`

- [ ] **Step 1: Write successful fake-cloud orchestration test**

Assert each question selects `collectionFor(runId, id)`, submits each session under its expected opaque client source id with `upsert: true`, and requires exactly one receipt whose id and filename match that document. No code path accepts or substitutes a server-generated id. Append a `document-submitted` frame immediately after each unambiguous accepted receipt. Poll the exact unique receipt-id set, reject duplicate/foreign/empty/missing statuses, accept only `indexingStatus === 'completed'`, then `inspect(expectedClientId)` every source and require the unwrapped stored text SHA-256 to match the generated document before appending `document-completed`.

Call exactly `query(question, { type: 'all', maxResults: 12, signal })`. Stream every Hydra success body with an endpoint-independent `1,048,576`-byte ceiling (and every discarded error body with a `16,384`-byte ceiling), aborting the reader immediately when the cumulative bytes exceed the cap even when `Content-Length` is absent or false. Never call `Response.json()` or concatenate an unbounded body. Decode UTF-8 fatally and use a bounded JSON tokenizer/parser that rejects duplicate/prototype-polluting keys, trailing values, excessive nesting/tokens/strings, and non-canonical unsupported values before constructing the response object.

Strictly decode at most 12 chunks; each has non-empty text of at most 16,384 Unicode scalar values, finite-or-null score, source id at most 256 characters, title at most 512, type at most 64, and timestamp at most 128, with source id/title mapping to a completed source/date sidecar. Decode `sources` as at most 12 values with depth 6, at most 64 keys per object, 256 elements per array, 1,024 total values, 8,192 scalar-value characters, and at most 131,072 RFC-8785 canonical bytes. Decode `graph_context` with depth 8, the same per-container limits, 2,048 total values, 16,384 scalar-value characters, and at most 262,144 canonical bytes; decode `temporal_facts` with depth 8, at most 128 top-level facts, 1,024 total values, 8,192 scalar-value characters, and at most 131,072 canonical bytes. Their combined canonical bytes may not exceed 524,288. Reject before digest rather than truncate, deduplicate, or stringify raw `unknown`; domain-separate and SHA-256 the validated canonical bytes. Deduplicate only exact duplicate **chunk identities**, preserve Hydra's returned order, and cap combined evidence at 60,000 characters and the final provider prompt at 70,000 characters.

Store exact bounded chunks plus the canonical auxiliary digests/counts/caps as a framed retrieval-audit event, store the exact prepared provider messages as a framed prompt-audit event, and fsync/checkpoint each head. Reserve and fsync the worst-case answer attempt in the run resource journal, execute exactly that prepared call, and append `answer-completed` only after the reservation, audits, and result are durable.

- [ ] **Step 2: Write refusal/failure tests**

Cover missing/duplicate/foreign/server-generated receipt ids, receipt/source-id or filename mismatch, refused receipt, lost response, empty/duplicate/foreign status, timeout, `errored`/`failed` terminal status, missing completed id, failed/mismatched readback, query transport failure, and all query caps. Feed chunked response fixtures with absent/lying `Content-Length`, one byte below/at/above the body cap, split multibyte UTF-8, invalid UTF-8, duplicate keys, `__proto__`, excessive depth/tokens/string/container size, trailing JSON, more than 12 sources/chunks, oversized graph/temporal/canonical aggregate, oversized/empty chunk, oversized evidence/prompt, unknown/null source id, headerless chunk, duplicate chunk, and non-finite/wrong-typed score; assert rejection occurs before any auxiliary digest/audit/provider call. Cover answer-reservation failure, ambiguous answer with consumed reservation, audit/checkpoint failure, and canonical equality for differently ordered safe object keys. Zero retrieved chunks must still yield one reserved answerer call with empty evidence so the model can abstain, while the artifact records retrieval failure; it must never inject the reference answer or encoded identifiers.

- [ ] **Step 3: Write resume and serialism tests**

Use deferred fakes to prove no second question begins before the prior `answer-completed` frame is durable. A resumed completed id makes zero Hydra/provider/audit calls. In `idempotent-upsert` mode, simulate “server stored bytes, client lost response”; retry must send the same source id/document digest, receive the same id, inspect one matching stored source, and never change retrieval. Prove the only capability outcomes: stable requested id + exact inspect readback + two unambiguous same-id/same-bytes submissions converging to exactly one source may produce `idempotent-upsert`; uncertainty, unstable/unaddressable client id, readback mismatch/unavailability, duplicate sources, or divergence produces `blocked`. Eligible `capability.json` is schema 1 with `executionAvailable: true`, exact `mode: 'idempotent-upsert'`, authoritative eligibility/reservation digest, pre-probe final-harness/runtime/provenance scope digest, probe input/evidence digest, and first-source checkpoint head. It contains no raw account/database/source/text/token value. There is no fresh-only branch, downgrade, one-shot exception, server-id adoption, or exactly-once claim.

- [ ] **Step 4: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-cloud-run.test.ts tests/unit/hydra-bounded-json.test.ts tests/unit/cloud-source.test.ts --maxWorkers=1`

Expected: cloud runner is absent.

- [ ] **Step 5: Implement the cloud loop**

Extend `HydraCloud.ingestDocument` so deterministic mode sends the service's documented client source-id field and `upsert=true`, propagates a caller signal, strictly decodes exactly one receipt, and never invents or accepts a replacement id/filename/status. Add a live capability function that can run only after an authoritative eligibility object for the authenticated Hydra scope is supplied and after the exact final harness/runtime/provenance probe scope is atomically/fsync sealed. It submits the first official document under its requested id, polls exact completion, performs exact `inspect(requestedId)` byte readback, probes a second same-id/same-bytes upsert, checks scoped bounded query/inspection for convergence, and returns only `idempotent-upsert` or `blocked` with evidence digests. Any uncertainty, client-id/readback failure, or divergence is `blocked`. Atomically write/read back `capability.json`, then capture the final per-run identity that binds its exact bytes before any remaining source or answer work. Capability evidence records only authenticated scope/inventory/quota, pre-probe scope, and probe evidence digests, never token, response URL/query, raw account/database/source identifier, or document text.

The library runner entry point accepts only `readonly IngestibleQuestion[]`, `HydraCloud`, `CloudAnswerer`, checkpoint, framed audit writers, run resource journal, final run identity, signal, immutable limits, and verified `idempotent-upsert` capability bound to the same authoritative eligibility digest. It is testable with injected fakes but is not exported by a production CLI while execution eligibility is unavailable. Do not import the oracle schema. Enforce exact receipt/status/readback before query; cap each ingest request at 120 seconds, status wait at 10 minutes per question, query at 30 seconds, answer at its configured deadline, and the full run at its identity-bound deadline. `HydraCloud.query()` requests `graph_context: true`; the bounded decoder returns typed chunks plus already-validated canonical auxiliary bytes/digests and `requested: true, consumed: false`. Never expose raw `graphContext: unknown`, digest an unbounded service value, pass graph/sources/temporal data to the answerer, or describe returned chunks as graph-enriched.

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
- Produces: immutable `resource-journal-generation.jsonl`, `execution-identity.json`, `dependency-runtime.json`, and `capability.json` snapshots
- Expands: `RunArtifact` to a versioned oracle cloud schema

- [ ] **Step 1: Write exact hypotheses verification tests**

Require exactly 500 newline-delimited objects, exactly two own keys (`question_id`, `hypothesis`) per row, 500 unique expected ids, non-empty bounded hypotheses, lexically sorted provenance order, final newline, exact sorted-id digest `f038965c54b03632f86a59104dd77848b66e3f80c08d5fbabdd3984d16457811`, and SHA-256 equality with the generation manifest. Reject extra metadata keys even if harmless. Recompute hypotheses from the verified checkpoint and require byte equality.

- [ ] **Step 2: Write artifact invariants**

Write an immutable `generation-artifact.json` and require source/dataset commits, exact dataset/ID digests, `tier: 'oracle'`, exact final clean Lacuna HEAD/tree/harness-manifest identity, acquisition-provenance digest, full dependency-runtime manifest digest, and exact eligible `capability.json` bytes/digest. The capability must be schema 1, `executionAvailable: true`, exact `mode: 'idempotent-upsert'`, and bind authoritative authenticated Hydra scope/inventory/quota reservation, pre-probe final-harness/runtime/provenance scope, probe evidence, and first-source checkpoint-head digests. Also require the full pinned upstream tuple digest, collection/source algorithms, answer requested/reported identities, prices/caps/hard-limit acknowledgement, timestamps/durations, exact successful and total-attempt counts, measured token/cost totals or `null` with a reason, worst-case per-run reserved totals, checkpoint/framed-retrieval/framed-prompt-audit heads, run-resource-journal head/totals, bounded canonical sources/graph/temporal caps and digests, graph-context requested/consumed truth, and `officialEvaluator: null`, `metrics: null`. Raw Hydra account/database/source identifiers and tokens remain absent. A blocked/false/malformed capability or run under `incomplete` cannot contain either manifest, a final `artifact.json`, evaluator output, or score. The later evaluated `artifact.json` is a new file; Task 8 must not mutate `generation-artifact.json`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-adapter.test.ts --maxWorkers=1`

Expected: verifier and expanded artifact contract are absent.

- [ ] **Step 4: Implement immutable generation evidence**

Rebuild hypotheses from checkpoint, write to a sibling temporary file, fsync, atomically rename, and sync the directory. Under `run.lock`, validate the run resource journal and copy its exact genesis-through-generation-head bytes to immutable `resource-journal-generation.jsonl`; do not call this account-wide inventory or quota evidence. Re-read and verify `run.json`, `execution-identity.json`, `dependency-runtime.json`, exact `capability.json`, chained checkpoint, both fully framed/hash-chained audits with exact checkpoint heads and no orphan tail, `resource-journal-generation.jsonl`, `hypotheses.jsonl`, `generation-artifact.json`, and copied provenance with every upstream expected/observed blob tuple. Require `execution-identity.json` to bind byte-exact `capability.json` and dependency-runtime digests. Scan every file for the exact configured Hydra/provider/judge secret values and reject any match without recording value, prefix, or length. Also reject persisted authorization/cookie header keys. Write `generation-manifest.json` last through temp+fsync+rename; it contains only version, algorithm, creation time, and sorted `{relativePath, bytes, sha256}` entries for every allowed immutable generation file, including `capability.json`, `execution-identity.json`, and `dependency-runtime.json`, and never contains its own digest. Recursively reject every extra file, directory, symlink, socket, or device in the generation namespace before sealing. On later verification, permit only the exact evaluation namespace entries covered by `evaluation-manifest.json`; any unmanifested generation/evaluation path remains fatal. Re-read every entry and verify again. Only then atomically emit the run under `artifacts/benchmarks/longmemeval/<run-id>/`; every failure remains under `artifacts/benchmarks/incomplete/<run-id>/`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-adapter.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit artifact verification**

```bash
git add benchmarks/longmemeval/artifact.ts benchmarks/longmemeval/verify.ts benchmarks/longmemeval/manifest.ts benchmarks/longmemeval/secret-scan.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-adapter.test.ts
git commit -m "feat(benchmark): seal immutable oracle generation evidence"
```

---

### Task 7: Authoritative Hydra eligibility and non-executable capability CLI

**Files:**
- Create: `benchmarks/longmemeval/execution-eligibility.ts`
- Create: `scripts/longmemeval-capabilities.ts`
- Create: `scripts/longmemeval-launch.cjs`
- Modify: `package.json`
- Test: `tests/unit/longmemeval-execution-eligibility.test.ts`
- Test: `tests/unit/longmemeval-capabilities-cli.test.ts`

**Interfaces:**
- Produces: `AuthoritativeHydraExecutionGate.probe(signal): Promise<HydraExecutionEligibility>`
- Produces: `HydraExecutionEligibility` with only `available | unavailable`, stable authenticated scope evidence, authoritative inventory/quota reservation evidence, and safe reason codes
- Produces: `npm run bench:longmemeval:capabilities -- --out <empty-dir>`
- Does not produce: a cloud run, preflight write, resume, fresh-only, judge, or paid-provider command

- [ ] **Step 1: Write eligibility and CLI refusal tests**

Define an eligible result only from a provider-authenticated response that supplies a stable opaque account/database scope, a monotonic inventory revision, exact current persistent collection/document counts, exact hard maxima, and an atomic durable idempotent reservation for this run's additional 500 collections and 948 documents bound to that scope/revision. Validate the response through the Hydra streamed bounded/fatal UTF-8/strict JSON boundary and bind its canonical digest. A caller-provided budget id, environment account/database label, locally hashed origin/token, filesystem ledger/lock, operator-entered counts, eventually consistent list, or unsigned snapshot cannot satisfy the interface. Reservation conflict, missing identity, scope drift, stale revision, insufficient quota, unknown fields, malformed response, or unsupported endpoint is `unavailable`.

The production composition at this plan revision must use `UnavailableAuthoritativeHydraExecutionGate` because the current Hydra API contract has no reviewed stable authenticated identity plus authoritative inventory/reservation primitive. The CLI accepts only `--out` to an exclusive empty directory, reads no answer/judge credential, performs no write/probe document, and atomically/fsyncs `capability.json` with `executionAvailable: false`, exact acquisition/runtime-manifest digests, safe reason `authoritative_hydra_scope_inventory_unavailable`, and no caller-supplied identity. It exits nonzero after writing the evidence. Reject `--run`, `--resume`, `--fresh-only`, `--preflight`, `--budget-id`, approvals, provider/model, env-file, ground truth, reused output, or any unknown option before credential loading. Prove no production import/call path reaches `runCloudLongMemEval`, `verifyCloudBenchmarkCapability`, answer-provider creation, or official evaluation.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-execution-eligibility.test.ts tests/unit/longmemeval-capabilities-cli.test.ts --maxWorkers=1`

Expected: eligibility and capability CLI modules are absent.

- [ ] **Step 3: Implement the fail-closed capability surface**

Implement the typed interface and strict decoder for a future reviewed adapter, but wire only the unavailable production implementation. `scripts/longmemeval-launch.cjs` is a minimal tracked bootstrap: it accepts only the `capabilities` verb, resolves the one sealed runtime manifest, revalidates its complete recursive file set and final tracked harness identity, then synchronously spawns exactly sealed Node + sealed `tsx/dist/cli.mjs` + sealed copied `scripts/longmemeval-capabilities.ts` with a fixed environment allowlist. It has no generic module/path/argument passthrough. `capability.json` is immutable evidence, not permission; a future available adapter and any executable run command require a new plan, implementation, security review, tests, and commit before use.

Add:

```json
"bench:longmemeval:capabilities": "node scripts/longmemeval-launch.cjs capabilities"
```

Do not modify `.env.example`: the capability launcher uses exact fixed acquisition/runtime manifest paths plus its required `--out` argument. Source-contract tests forbid `LONGMEMEVAL_BUDGET_ID` and executable benchmark run variables; this command consumes no answer-provider, Hydra-write, or judge secret. Benchmark answer/judge credentials and controls are never added to Vercel deployment configuration.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-execution-eligibility.test.ts tests/unit/longmemeval-capabilities-cli.test.ts tests/unit/longmemeval-cloud-run.test.ts tests/unit/longmemeval-resource-journal.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts --maxWorkers=1`

Expected: all focused tests pass and source inspection proves no executable 500-run or paid-judge command exists.

- [ ] **Step 5: Commit the fail-closed capability boundary**

```bash
git add benchmarks/longmemeval/execution-eligibility.ts scripts/longmemeval-capabilities.ts scripts/longmemeval-launch.cjs package.json tests/unit/longmemeval-execution-eligibility.test.ts tests/unit/longmemeval-capabilities-cli.test.ts
git commit -m "feat(benchmark): require authoritative Hydra execution eligibility"
```

---

### Task 8: Pinned official evaluator wrapper and metric parser

**Files:**
- Create: `benchmarks/longmemeval/evaluator.ts`
- Create: `benchmarks/longmemeval/evaluator-checkpoint.ts`
- Create: `benchmarks/longmemeval/attempt-state.ts`
- Create: `benchmarks/longmemeval/judge-spend-cap.ts`
- Create: `benchmarks/longmemeval/requirements-lite.lock.txt`
- Create: `scripts/longmemeval-evaluator-supervisor.ts`
- Test: `tests/unit/longmemeval-evaluator.test.ts`
- Test: `tests/unit/longmemeval-evaluator-checkpoint.test.ts`
- Test: `tests/unit/longmemeval-attempt-state.test.ts`
- Test: `tests/unit/longmemeval-judge-spend-cap.test.ts`
- Modify: `tests/unit/longmemeval-manifest.test.ts`

**Interfaces:**
- Produces: `evaluateOfficial(input: VerifiedEvaluationInput): Promise<OfficialEvaluation>`, where input contains exact run directory, verified generation/run/runtime/capability identities, `RunResourceJournal`, authoritative Hydra eligibility, verified external judge spend-cap authority, fixed judge configuration, deadline, and signal
- Produces: `writeEvaluationManifest(runDir): Promise<EvaluationManifest>`
- Produces: `AttemptState.openExclusive(dir, ordinal, identity)` and `recoverAndSealAttempt(dir, identity)`
- Consumes: the same `RunResourceJournal`, authoritative Hydra eligibility, verified external judge hard-spend-cap evidence, dependency runtime, and final `ExecutionIdentity` sealed by generation
- Does not produce: a production evaluator command in this plan revision

- [ ] **Step 1: Write pin/generation-manifest/environment gate tests**

Refuse evaluation unless the generation verifier re-hashes every `generation-manifest.json` entry, rejects extras, and proves byte-exact `capability.json`, dependency-runtime, acquisition-provenance, and final run-identity bindings; checkpoint and framed audits have exact sealed heads and no orphan; the run-resource-journal prefix byte-matches `resource-journal-generation.jsonl`; the exact clean final Lacuna HEAD/tree/harness manifest still matches; every materialized evaluator-bundle file byte-matches its pinned Git blob tuple; and dataset bytes/SHA/sorted-id digest match the constants above. The sealed runtime must contain exact uv `0.11.21`, CPython `3.9.25`, and a virtualenv installed only from `benchmarks/longmemeval/requirements-lite.lock.txt` with hash enforcement. Verify the lock records the pinned upstream `requirements-lite.txt` blob/digest; record interpreter executable digest, `python --version`, platform, lock digest, and `pip freeze --all`; then require those outputs to match the already sealed runtime manifest. Refuse any unlocked/mismatched environment, writable runtime, extra/missing file, `__pycache__`, or `.pyc`.

The no-paid runtime builder may invoke its separately sealed bootstrap uv only while creating the candidate runtime; those provisioning processes cannot access production credentials or produce benchmark evidence. Every evidence-producing Python, judge, metrics, or supervisor child runs only through `verifyImmediatelyBeforeSpawn`. In the same synchronous spawn turn it revalidates clean final Lacuna identity, exact complete dependency-runtime file set/bytes, dataset, complete declared upstream bundle, and each consumed input; there is no intervening await or callback. Invoke Python exactly as `<venv-python> -I -B <script> ...` with bytecode/user-site/environment imports disabled. Create immutable `evaluator-identity.json` containing final Lacuna HEAD/tree/harness digest, dependency-runtime digest/file-count/byte-count, `capability.json` digest, and every upstream tuple. Tests add an extra importable file, change a script/runtime file after preflight, substitute same-length bytes, or cause a child to emit bytecode and assert no evidence-producing child starts or the attempt fails and seals.

Require judge alias exactly `gpt-4o`, expected evaluator-reported model exactly `gpt-4o-2024-08-06`, `OPENAI_API_KEY` set, optional organization, positive global/batch process deadlines, exactly 500 successful labels, and an explicit maximum over all judge **subprocess attempts**. Do not expose or record an internal judge API-call allowance or input/output-token ceiling: the pinned evaluator controls those calls and its retry loop cannot prove either bound. Before loading the key and again within 60 monotonic seconds before every child, require a machine-verified provider-authoritative response for the dedicated OpenAI project/key stating `hardEnforced: true`, currency USD, a stable opaque scope, nonnegative current spend not above the cap, a hard maximum at or below the operator-approved evaluation maximum, and an enforcement expiry later than the global deadline. Scope/cap changes, expiry, failed refresh, or a cap increase refuses the attempt; bind the canonical response digest and observation ordinal, but not raw response, to the attempt. Caller attestations, dashboard screenshots, environment ids, price estimates, or a local journal do not satisfy it. The current production composition has no reviewed implementation of this authority, so paid judging remains unavailable. The run journal records only subprocess-attempt ordinals and measured-or-null usage/cost. Verify only set/unset for secrets and never print/persist key value, prefix, length, organization value, project identifier, or raw spend-cap response.

- [ ] **Step 2: Write subprocess/output parser tests**

Use a fake process runner with literal pinned-script stdout/result fixtures. Split pending ids in lexical official order into immutable batches of 10. Every attempt gets a new exclusive-create `judge-attempts/<six-digit-attempt>-<batch-digest>/` directory; never reuse or overwrite it. Write/fsync its exact two-key `hypotheses.input.jsonl`, references to the separately sealed byte-exact `oracle.input.json`, exact argv/cwd/environment identity, initial empty bounded stdout/stderr files, and a framed/hash-chained `attempt-state.jsonl`. Its only state sequence is `allocated -> supervisor_ready -> started -> exited | killed | recovered_failed -> sealing`; every transition validates the prior hash/state and fsyncs before returning. Before any evaluator process can run, append/fsync a judge-checkpoint `attempt-reserved` frame and run-journal subprocess-attempt ordinal bound to the input, identity, deadline, and verified external-spend-cap digest.

Evidence-producing subprocesses are supported only on Linux with a writable delegated cgroup-v2 root; absence of `/proc`, boot id, `cgroup.controllers`, delegated subtree control, or `cgroup.kill` blocks before the judge key is read. Launch only the sealed evaluator supervisor. Before signaling ready or spawning Python, it exclusive-creates/fsyncs `supervisor-ready.json` with PID, `/proc/sys/kernel/random/boot_id`, `/proc/<pid>/stat` start-time field 22, nonce, parent identity, attempt ordinal, and absolute deadline, then syncs the directory. If parent/IPC dies before `GO`, it exits without spawning Python. The parent creates one nonce-named cgroup exclusively, records/fsyncs its resolved path plus device/inode, moves the verified supervisor PID into `cgroup.procs`, rechecks boot/PID/start/cgroup membership, appends/fsyncs `supervisor_ready`, and only then sends one-use `GO`; descendants inherit the cgroup. No shell, PID-only `kill`, process-name scan, Windows `taskkill`, or unowned process-group fallback is allowed. Only after GO may the supervisor append/fsync `started`, synchronously verify runtime/input manifests again, and invoke, from the sealed evaluator bundle:

```text
<venv-python> -I -B evaluate_qa.py gpt-4o <absolute-batch-hypotheses.jsonl> <absolute-oracle.json>
```

Expect `<absolute-batch-hypotheses.input.jsonl>.eval-results-gpt-4o`; never look for upstream `.log`. Stream stdout and stderr to separate exact 1,048,576-byte caps and bound the raw result at 4,194,304 bytes; crossing a cap kills/confirms the owned tree and fails the attempt. Fsync all outputs, copy the raw result without normalization when present, and always write an outcome that explicitly records result presence/absence. Validate every complete row's exact pending id, unique coverage, two input keys plus one `autoeval_label`, boolean label, and model `gpt-4o-2024-08-06`. Preserve a valid completed prefix from a failed batch only through new fsynced judge-checkpoint frames; never mutate the attempt result.

On normal exit, timeout, cancellation, parent crash, or lost supervisor response, recovery first acquires `run.lock`, validates attempt nonce/ordinal/identity, and uses fsynced `supervisor-ready.json` when the parent state frame was never reached. It rechecks boot id, PID/start identity, cgroup path device/inode, and exact membership before acting. A matching live tree is terminated by writing `1` to that cgroup's `cgroup.kill` and is confirmed dead only when bounded polling reads `populated 0` from its `cgroup.events`; mismatch, PID reuse, replaced cgroup, inability to kill/read, or uncertain liveness fails closed without starting another attempt. Once no owned process remains, recovery fsyncs captured partial bytes, validates only a complete result prefix, writes explicit absence/truncation digests, and appends/fsyncs terminal `exited | killed | recovered_failed` plus final `sealing` state. It then writes `attempt-manifest.json` last, excluding itself, with sorted byte/SHA-256 entries for every state/ready/input/reference/command/environment/result-or-absence/stdout/stderr/outcome file, fsyncs/renames/syncs it, makes the directory immutable, and treats exact manifest presence as the seal; no covered file is appended after manifest creation. Reject every later byte or extra-file change. No attempt can be retried until its predecessor is terminal and sealed; the next attempt uses the next ordinal and a new directory. Test a crash at every boundary from directory creation through ready-file/cgroup/PID-state/GO/result/outcome/sealing/manifest writes, parent death before and after ready, exact receipt of a late exit, repeated recovery, boot/PID reuse, cgroup path replacement, foreign membership, failed kill or nonempty tree, unsupported host, changed/duplicate/foreign ids, malformed final row, changed sealed inputs/runtime, stdout/stderr overflow, deadline kill, absent spend-cap evidence, total-attempt exhaustion despite fewer than 500 successes, and a second evaluator process.

After 500 unique labels, merge them in lexical official-id order to atomic/fsynced `official-evaluator.jsonl`, then invoke exactly:

```text
<venv-python> -I -B print_qa_metrics.py <absolute-official-evaluator.jsonl> <absolute-oracle.json>
```

Run metrics in ordinal `metrics-attempts/<six-digit-attempt>-<input-digest>/` directories, with a fixed maximum of three total starts. Each uses the same ready-file/handshake, fsynced PID/start/process-tree state, deadline, crash recovery, terminal outcome, immutable attempt manifest, and no-extra-file verification as judge attempts. Capture stdout and stderr under separate exact 1,048,576-byte caps plus exact exit code, command, merged evaluator input, oracle reference, parsed output, and outcome; cap breach kills/confirms the tree and fails. A crashed/failed metrics attempt is sealed as failed before the next ordinal starts; it never overwrites or resumes a directory. Validate per-type counts against the pinned dataset join; extract overall, task-averaged, per-question-type, and abstention metrics; and reject partial output, NaN/out-of-range metrics, model mismatch, changed generation/evaluator inputs, or non-zero exit. Test crashes before spawn, while stdout/result files are partial, after process exit but before outcome fsync, and after manifest rename before directory mode hardening; manifest presence still makes the attempt immutable and recovery only verifies it. Judge usage/cost remains `null` with `official_evaluator_does_not_report_usage` unless exact provider-authoritative usage exists; do not replace it with estimates.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-attempt-state.test.ts tests/unit/longmemeval-judge-spend-cap.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-resource-journal.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts --maxWorkers=1`

Expected: evaluator wrapper, spend-cap authority, and attempt-state modules are absent.

- [ ] **Step 4: Implement isolated official evaluation**

Generate and review `requirements-lite.lock.txt` once from the pinned upstream top-level requirements using exact CPython 3.9 resolution and hashes for every allowed wheel/sdist; tests reject a dependency line without hashes or an undeclared top-level package. The no-paid builder provisions the candidate uv/Python/lock environment once, removes bytecode caches, seals every file, and never mutates/reuses an unsealed environment for evidence. Each evaluator child receives only required operating-system/TLS/temp variables, `PYTHONHASHSEED=0`, `PYTHONDONTWRITEBYTECODE=1`, `PYTHONNOUSERSITE=1`, `OPENAI_API_KEY`, optional organization, and controlled absolute paths; `PYTHONPATH` is absent. It receives no Hydra token, answer-provider key, env-file path, or unrelated environment value.

Run deterministic pending-id batches with a versioned, exclusive, hash-chained `judge-checkpoint.jsonl`; sync after each subprocess-attempt start and every accepted label. The matching run-journal start ordinal remains consumed for unknown/timeout/killed/no-result attempts. Apply per-batch and global deadlines, kill and confirm the owned subprocess tree on expiry, salvage only a strictly valid complete prefix after the tree is dead, cap total subprocess attempts independently of 500 successful labels, and never exceed 500 unique successes. The upstream backoff loop is unbounded, so no internal call/token bound is claimed; the verified external hard spend cap and outer process deadline are mandatory. Resume under `run.lock` first recovers and seals every partial attempt, then revalidates generation manifest, immutable attempt manifests/directories, every judge frame, and run-journal prefix before another attempt. Without authoritative Hydra eligibility and external spend-cap authority, `evaluateOfficial` refuses before reading the judge key or spawning.

Write, without modifying any generation file: sealed `oracle.input.json`, `evaluator-identity.json`, all immutable `judge-attempts/**` and `metrics-attempts/**` files, `official-evaluator.jsonl`, aggregate `official-evaluator.stdout.txt`/`stderr.txt`, `official-evaluator-command.json`, `official-evaluator-environment.json`, `judge-checkpoint.jsonl`, `resource-journal-evaluation.jsonl`, `official-metrics.json`, and final `artifact.json`. Command/identity metadata contains exact argv/cwd/exit/deadline/batch-input digests, final clean Lacuna HEAD/tree/harness digest, dependency-runtime and capability digests, every upstream expected/observed Git-blob tuple, generation identity, external-spend-cap evidence digest, run-journal generation/final heads, measured-or-null totals, and successful-versus-total subprocess/metrics attempt counts—never secrets. Under `run.lock`, copy and seal the exact journal prefix through evaluation and require its generation prefix to byte-match the generation snapshot. Run the exact-secret/header scan over all generation and evaluation files. Write `evaluation-manifest.json` last as sorted `{relativePath, bytes, sha256}` entries covering `generation-manifest.json` plus every attempt state/input/result-or-absence/stdout/stderr/command/outcome/attempt-manifest and every aggregate evaluation/final artifact, excluding only itself. Recursively reject any extra file/directory/symlink/special file, re-read every digest, verify hypotheses/generation manifest/attempt directories unchanged, and reject an unmanifested attempt or score-bearing output.

Do not add `bench:longmemeval:evaluate` or any generic evaluator launcher to `package.json`. The evaluator remains a testable library until a later reviewed change supplies both authoritative Hydra eligibility and provider-enforced spend-cap verification.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-attempt-state.test.ts tests/unit/longmemeval-judge-spend-cap.test.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-resource-journal.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit the official evaluator gate**

```bash
git add benchmarks/longmemeval/evaluator.ts benchmarks/longmemeval/evaluator-checkpoint.ts benchmarks/longmemeval/attempt-state.ts benchmarks/longmemeval/judge-spend-cap.ts benchmarks/longmemeval/requirements-lite.lock.txt scripts/longmemeval-evaluator-supervisor.ts tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-attempt-state.test.ts tests/unit/longmemeval-judge-spend-cap.test.ts tests/unit/longmemeval-manifest.test.ts
git commit -m "feat(benchmark): isolate the pinned official LongMemEval judge"
```

---

### Task 9: Seal the harness and prove production execution remains blocked

**Files:**
- Create ignored candidate runtime: `.cache/longmemeval/runtime/<manifest-sha256>/`
- Create ignored runtime manifest: `.cache/longmemeval/dependency-runtime.json`
- Create blocked evidence only: `artifacts/benchmarks/incomplete/oracle-capability-blocked-2026-08-21/capability.json`
- Must not create: `hypotheses.jsonl`, `generation-manifest.json`, evaluator outputs, metrics, `artifact.json`, or an official score
- Must not modify: `docs/BENCHMARK_LONGMEMEVAL.md`, `docs/V10_RELEASE_STATUS.md`, `web/src/landing/Evals.tsx`, or `web/src/app/routes/evaluations.tsx`

- [ ] **Step 1: Run every benchmark-local gate**

Run: `npm run typecheck`

Run: `npx vitest run tests/unit/longmemeval-adapter.test.ts tests/unit/ground-truth-isolation.test.ts tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts tests/unit/longmemeval-cloud-documents.test.ts tests/unit/longmemeval-answerer.test.ts tests/unit/provider-bounded-json.test.ts tests/unit/provider-openai.test.ts tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts tests/unit/longmemeval-resource-journal.test.ts tests/unit/longmemeval-cloud-run.test.ts tests/unit/hydra-bounded-json.test.ts tests/unit/cloud-source.test.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-execution-eligibility.test.ts tests/unit/longmemeval-capabilities-cli.test.ts tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-attempt-state.test.ts tests/unit/longmemeval-judge-spend-cap.test.ts --maxWorkers=1`

Expected: all commands exit zero with no benchmark test skipped. Source-contract tests prove `package.json` exposes neither `bench:longmemeval:cloud` nor `bench:longmemeval:evaluate`, the capability launcher has no generic verb/path passthrough, and production composition cannot reach cloud writes, answer providers, or judge subprocesses.

- [ ] **Step 2: After all Tasks 1-8 commits, acquire and seal the dependency runtime**

Run: `npm run bench:longmemeval:acquire`

Run: `npm run bench:longmemeval:seal-runtime -- --provenance .cache/longmemeval/provenance.json --out-root .cache/longmemeval/runtime --manifest .cache/longmemeval/dependency-runtime.json`

Expected: the builder performs no Hydra, answer-provider, judge, or other paid-service action; any dependency download is exact-version/hash verified before staging. It then seals one digest-named non-writable runtime. Independently recurse it and require exact equality with every sorted manifest path/type/mode/byte/SHA-256 tuple, zero extras, zero symlinks/special files, zero `__pycache__`/`.pyc`, exact Node/uv/Python versions, exact hash-locked `pip freeze --all`, and byte-equal copied tracked harness inputs at the current final HEAD. Any later harness commit invalidates this runtime and requires a new seal; acquisition provenance remains unchanged.

- [ ] **Step 3: Run the only production capability command and verify the expected block**

Run: `npm run bench:longmemeval:capabilities -- --out artifacts/benchmarks/incomplete/oracle-capability-blocked-2026-08-21`

Expected: exit nonzero after atomically/fsyncing only `capability.json` with `executionAvailable: false` and safe reason `authoritative_hydra_scope_inventory_unavailable`. It binds the acquisition provenance, final clean HEAD/tree/tracked manifest, and exact dependency-runtime digest; it contains no raw account/database/secret/provider value. It performs zero Hydra writes, answer-provider calls, judge calls, hypotheses writes, score writes, or product-copy changes.

- [ ] **Step 4: Re-run the fail-closed and cleanliness checks**

Run: `npx vitest run tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts tests/unit/longmemeval-execution-eligibility.test.ts tests/unit/longmemeval-capabilities-cli.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-attempt-state.test.ts tests/unit/longmemeval-judge-spend-cap.test.ts --maxWorkers=1`

Run: `git status --short`

Expected: tests pass; only the documented ignored cache and blocked incomplete evidence may be new. No official benchmark artifact or score exists.

- [ ] **Step 5: Stop; activation requires a new reviewed plan**

Do not run 500 questions or the paid judge under this plan. A successor plan may add executable commands only after all of these facts exist and are independently reviewed: a provider-authenticated stable Hydra account/database identity; atomic authoritative inventory/quota reservation for 500 additional collections and 948 documents; exact repeated-upsert capability within that same reserved scope; a machine-verified provider-enforced judge hard spend cap; and a newly captured final run identity/runtime/capability seal after the activation commits. It must retain the official evaluator/scoring, ground-truth isolation, bounded transports, attempt crash recovery, exact 500-id manifests, and truthful oracle labelling defined above. Until then every public surface remains at `No official score exists`, and there is no git-add/commit step for score evidence.
