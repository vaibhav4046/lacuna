# Official LongMemEval Oracle Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, auditable LongMemEval oracle harness in which HydraDB Cloud is the actual memory/retrieval system and no ground-truth answer fields or encoded labels cross the generation boundary, while exposing no executable paid 500-question path until both a trusted descriptor launcher and Hydra's stable authenticated scope identity plus authoritative inventory/quota gate are concretely available.

**Architecture:** A cloud-only runner loads an `IngestibleQuestion[]` through a ground-truth-stripping loader, writes each question's dated sessions under opaque deterministic source ids, requires stable client ids, exact inspect readback, and repeated-upsert convergence, and passes only strictly decoded, bounded Hydra-returned chunks plus verbatim benchmark wall-clock dates to a narrow answer input. Acquisition records immutable upstream/data provenance only; dependency-runtime and Git-blob-exact handoff builders remain no-paid libraries. Production execution first requires a concrete, independently provisioned and byte-pinned trusted descriptor-launcher capability, then a server-authenticated Hydra scope and authoritative inventory/quota gate. No such launcher identity or adapter exists in this plan, so the current production composition stops with `trusted_descriptor_launcher_unavailable` before it creates a handoff, `capability.json`, or any benchmark child. Run-local locks protect framed/fsynced evidence, but they are not an account-wide quota authority. Official judging retains the pinned scoring path, atomically initialized attempts, three-stream crash reconciliation, a provider-enforced external spend cap, and separate non-circular generation/evaluation manifests.

**Tech Stack:** TypeScript, HydraDB Cloud, existing OpenAI-compatible provider adapter, Node filesystem/crypto/process, Python 3.9 official evaluator, Vitest. A trusted native descriptor launcher is a future host capability prerequisite, not a component supplied or made reachable by this plan.

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
- A judge/metrics ordinal is never reserved before its complete `initialized` attempt directory is atomically visible and parent-directory-synced. Before any later ordinal, recovery under `run.lock` deterministically reconciles that attempt's state chain, evaluator checkpoint, resource journal, and authenticated cgroup creation/cleanup evidence; every pre-GO crash—including mkdir-before-record and record-before-state—becomes a cleaned, sealed `recovered_failed` attempt with the ordinal conservatively consumed, while unsupported cgroup preflight creates no attempt or reservation.
- No production 500-run command or paid judge command exists until two ordered gates are both available: first a trusted descriptor-launcher capability, then a provider-authenticated stable Hydra account/database identity with an authoritative inventory/quota response for that same identity. A caller label, environment value, path-derived digest, local hash, runtime manifest, local lock/ledger, operator-entered count, ambient executable, or dynamically obtained helper cannot satisfy either gate. The current production composition reports `executionAvailable: false` with exact safe reason `trusted_descriptor_launcher_unavailable` before reading Hydra/provider/judge credentials, probing Hydra eligibility, or starting any Node, Python, Hydra, answer-provider, or judge action. `authoritative_hydra_scope_inventory_unavailable` is reachable only in a future composition after a genuine trusted-launcher capability has already passed.
- Acquisition writes only pinned source/data provenance. The runtime sealer and hermetic-handoff builder are no-paid preparation libraries, not a current production entrypoint. This plan adds no launcher command, capability CLI, native executable, host adapter, or authorized production path to materialize a final handoff/run identity/`capability.json`; Task 9 stops at the unavailable launcher gate. A future activation may materialize an execution workspace exclusively from exact current-HEAD Git blobs and copy only byte-recorded acquisition inputs, a sealed runtime, and one initially empty selected-output directory, but only after the launcher prerequisite below is concretely provisioned and reviewed. The source checkout may contain unrelated dirt because it must never become an execution/import root.
- Every executable/importable file in the dedicated Node/TS, uv, CPython, virtualenv, and evaluator dependency runtime is listed by normalized relative path, byte length, mode/type, and SHA-256. Symlinks, special files, path escape, missing files, and extras fail before spawn. Python runs isolated with bytecode writes disabled; no child may mutate a sealed runtime.
- A successor plan may make the trusted-launcher gate available only from one concrete, independently provisioned native launcher identity and a closed, authenticated `TrustedDescriptorLauncherAttestationV1`. That attestation must bind its schema/version, named provider and release, source origin and exact revision, reviewed build-provenance digest, target OS/architecture, absolute installed path, exact bytes/SHA-256, package/signature/transparency/install-receipt digests, owner/group/mode, device/inode/install generation, static-versus-dynamic dependency declaration, descriptor-pinned execution semantics, fixed argv/environment-policy digest, observation time, and expiry. The successor must pin the exact accepted provider/release/digests and document independent install/audit evidence; a repository binary/source file, local compilation, PATH result, environment path, downloaded helper, runtime manifest, or caller-supplied digest is never sufficient. Its reviewed adapter must open and pin the sealed Node and exact-Git-blob bootstrap descriptors before verification, execute the already-opened Node descriptor with the bootstrap descriptor, close unrelated descriptors, and construct an environment from empty with only fixed allowlisted values; it must not execute a pathname after hashing, consult PATH/package managers, accept executable/module passthrough, or inherit preload variables. This paragraph is a future prerequisite contract only: this plan has no provisioned identity, trusted attestation source, adapter, executable command, or reachability claim, and therefore returns `trusted_descriptor_launcher_unavailable` before Hydra eligibility is queried.
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
- Create: `benchmarks/longmemeval/hermetic-handoff.ts`
- Create: `scripts/longmemeval-seal-runtime.ts`
- Modify: `package.json`
- Test: `tests/unit/longmemeval-provenance.test.ts`
- Test: `tests/unit/longmemeval-execution-identity.test.ts`
- Test: `tests/unit/longmemeval-dependency-runtime.test.ts`
- Test: `tests/unit/longmemeval-hermetic-handoff.test.ts`

**Interfaces:**
- Produces: `LongMemEvalProvenance`
- Produces: internal `captureFinalRunIdentity(handoff, provenance, capability, runtimeManifest)` and `verifyImmediatelyBeforeSpawn(identity, childSpec)` libraries with no production entrypoint; Task 7 adds the trusted-launcher brand before any production composition may reference them
- Produces: `sealDependencyRuntime(stagingRoot, outputManifest)` and `verifyDependencyRuntime(manifest)`
- Produces: no-paid `createHermeticHandoff(options): HermeticExecutionWorkspace` and `verifyHermeticHandoff(workspace, expectedIdentity)` libraries with no production caller in this plan
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

Test acquisition provenance separately from run identity. Acquisition must not write, cache, predict, or name a Lacuna HEAD/tree as the final run identity. Tests may call `createHermeticHandoff` only with temporary fixtures after simulating Tasks 1-8 committed and a runtime sealed for that exact HEAD; no production entrypoint may call it, and Task 7 adds an unconstructible-currently trusted-launcher brand before any future production connection. Through the same isolated/no-hooks Git configuration used by acquisition, it reads the current HEAD/tree and materializes every tracked regular blob and executable mode from `git ls-tree`/`git cat-file` into a new sibling staging directory; it never copies a worktree byte. Reject symlinks, submodules, hard links, special files, normalized-path collisions, a changed HEAD during materialization, or any expected/observed blob mismatch. Copy—not link—the exact acquisition files named by provenance and the exact sealed runtime files named by its manifest; verify bytes/type/mode before and after copying. Create only one exact selected-output directory, initially empty. Atomically/fsync a canonical non-circular handoff manifest binding HEAD/tree/tracked tuples, acquisition tuples, runtime tuples/digest, selected-output path, and the absence of all other paths; its sorted entry list excludes only itself and initially empty output contents, and its exact-byte digest names the final workspace. Make every path except selected output non-writable, atomically rename the fully synced staging directory to that digest-named final workspace, and fsync its parent.

The handoff library's temporary-fixture tests require the exact tracked HEAD export, one recorded handoff-control manifest, recorded acquisition cache, selected sealed runtime, and selected output—no `.git`, source-worktree path, root `node_modules`, package-manager cache, `.env*`, alternate ignored directory, symlink, hard link, special file, socket, or extra importable root. The dependency-runtime manifest records all files but designates no trusted launcher, launch bootstrap, capability child, or executable authorization. `captureFinalRunIdentity` remains an internal future-facing library with no production import/call path in Tasks 1-6; Task 7 must add and require the branded trusted-launcher input, which current production cannot construct. Therefore no current production path can produce a final run identity or `capability.json`. A dirty source checkout or ignored root cannot be copied. A crash before final-directory rename leaves no usable fixture; orphan staging is never launched and may be removed only by an explicit no-paid cleanup after proving no final workspace exists.

Test the common synchronous spawn verifier as a pure library with injected, non-executing fixture callbacks. It rechecks the handoff manifest, exact HEAD/tree/exported tracked digest, selected-output allowlist, every tracked digest, and each declared runtime/acquisition/input root, rejecting any missing, changed, differently typed, hard-linked, symlinked, special, or extra entry. Tests must separately prove that the real production composition stops at `trusted_descriptor_launcher_unavailable` before this verifier, handoff materialization, credential access, or any child-spawn callback. Acquisition, sealing, and fixture handoff construction cannot load production credentials or produce benchmark evidence.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts tests/unit/longmemeval-hermetic-handoff.test.ts --maxWorkers=1`

Expected: acquisition, provenance, execution-identity, dependency-runtime, and hermetic-handoff modules are absent.

- [ ] **Step 4: Implement deterministic acquisition**

Download to a temporary sibling, stream while hashing, require the expected byte count and SHA-256 before parsing, validate JSON and the exact sorted-id digest before atomic rename, fsync the file and containing directory, and refuse an existing file whose digest or question set differs. Clone/check out the evaluator under the isolated Git configuration; verify `git rev-parse HEAD`, exact remote URL, and the complete tree-derived bundle; then materialize the execution bundle from `git cat-file blob` bytes rather than trusting checkout bytes. Write `.cache/longmemeval/provenance.json` atomically with URLs, commits, filenames, expected/observed dataset bytes and SHA-256, acquisition time, 500 sorted ids, sorted-id digest, and the sorted per-upstream-file `{path, blobOid, expectedBytes, expectedSha256, observedBytes, observedSha256}` tuples. It contains no Lacuna HEAD/tree, run id, `capability.json`, runtime identity, or generation identity. Never store credentials, response headers, redirect query strings, or environment values.

Implement a no-paid-action runtime builder. It stages one dedicated root containing exact copied tracked harness files, the Node executable, complete copied Node dependency tree needed by the library entrypoints, exact uv executable, CPython distribution, virtualenv, hash-locked packages, evaluator bundle, and required certificate/data files. Resolve source-package links while staging, copy only regular target bytes, and reject every link in the final root. The bootstrap uv root is itself recursively byte-manifested and sealed before any uv spawn. After provisioning/import checks, delete every `__pycache__`/`.pyc`, reject symlinks/special files, make runtime files non-writable, recursively sort and record every regular file as `{relativePath, bytes, sha256, mode, role}`, and atomically/fsync `dependency-runtime.json` outside the sealed root. The manifest contains no launcher attestation, launch command, `handoff-prelauncher`, or `handoff-bootstrap` role and grants no execution authority. Evaluator paths remain data for future guarded children; current production cannot invoke them.

For any future post-commit candidate seal, materialize every tracked harness file from the twice-checked current HEAD tree/blob bytes through isolated Git, never from the source worktree; a HEAD change discards the candidate. Dependency inputs are accepted only from exact lock/cache manifests. The sealed manifest emits no shell fragment, helper path, attestation, or authorization and cannot satisfy the trusted-launcher gate. Thus unrelated source tracked/untracked/ignored dirt never becomes evidence of launcher availability.

Implement the no-paid hermetic-handoff builder exactly as tested above, but expose no script or production call path to it in this plan. It accepts only normalized tracked-HEAD, acquisition, runtime, control-manifest, and selected-output tuples; it never spawns a child, loads credentials, writes `capability.json`, or treats a local digest as launcher authority. A successor plan may connect it only after the provisioned trusted-launcher prerequisite is independently reviewed.

Add `"bench:longmemeval:acquire": "tsx scripts/longmemeval-acquire.ts"` and `"bench:longmemeval:seal-runtime": "tsx scripts/longmemeval-seal-runtime.ts"` to `package.json`. The latter can create only an untrusted candidate runtime; neither command can load production credentials, call Hydra/providers, create a final handoff/run identity, or create publishable evidence. Never add a package-manager handoff, capability, cloud-run, or evaluator script.

- [ ] **Step 5: Run focused tests and a real acquisition**

Run: `npx vitest run tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts tests/unit/longmemeval-hermetic-handoff.test.ts --maxWorkers=1`

Run: `npm run bench:longmemeval:acquire`

Expected: the tests pass; the ignored cache contains the pinned evaluator, the exact 15,388,478-byte/500-question oracle file, and a verified acquisition provenance manifest whose dataset and sorted-id digests equal the constants above. No final run identity exists yet.

- [ ] **Step 6: Commit the acquisition boundary**

```bash
git add scripts/longmemeval-acquire.ts scripts/longmemeval-seal-runtime.ts benchmarks/longmemeval/provenance.ts benchmarks/longmemeval/execution-identity.ts benchmarks/longmemeval/dependency-runtime.ts benchmarks/longmemeval/hermetic-handoff.ts package.json tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts tests/unit/longmemeval-hermetic-handoff.test.ts
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

Set immutable run-identity ceilings before the first call: exactly 500 successful hypotheses, an explicit maximum over **all** answer attempts (including timeouts/ambiguous failures), 70,000 prompt characters per attempt, 1,200 output tokens per attempt, caller-supplied per-run input-token/output-token ceilings, a caller-supplied run deadline, and a caller-supplied maximum answer spend. A cloud answer run additionally requires a branded trusted descriptor-launcher capability, explicit versioned per-million input/output prices, the authoritative Hydra execution-eligibility gate, and an operator-approved external provider-account hard limit at or below the recorded maximum. `prepareAnswer` emits the exact messages/digest and no network I/O; its conservative reservation uses `utf8ByteLength(canonicalMessages) + 4096` input tokens, exactly 1,200 output tokens, and decimal spend rounded upward at the configured prices. `executePreparedAnswer` accepts only a durable run-resource-journal reservation bound to that digest/provider/model/attempt ordinal and rejects a missing, reused, mismatched, or unsynced reservation. The journal enforces this run's local limits but never claims account-wide quota. Test caller abort, timeout, total-attempt/token/spend exhaustion, ambiguous attempts remaining consumed, missing price, exact measured cost, and measured-or-null usage.

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
- Produces: `RunResourceJournal.open(runDir, runIdentity)` and durable `reserveAnswerAttempt`, `reserveEvaluatorAttempt`, `recordEvaluatorOutcome`, and measured-or-null outcome operations

- [ ] **Step 1: Write filesystem-backed checkpoint tests**

Use a temporary directory and assert `run.json` is written to a sibling temporary file, synced, atomically renamed, and followed by a containing-directory sync before any event may append. Each checkpoint or audit line is a versioned frame containing `stream`, `sequence`, `previousSha256`, canonical `event`, `eventBytes`, and `eventSha256`; append through an open handle, sync, and close before the promise resolves. Validate every complete hash chain and contiguous sequence on open. Bind exact hermetic-handoff HEAD/tree/tracked/control manifests, acquisition provenance, dependency runtime, `capability.json`, authoritative eligibility, and upstream tuple digests. Cover resume after interruption, lexically sorted official-id order, duplicate/foreign id, modified complete line, missing newline after an otherwise complete line, malformed length/digest, mismatched dataset/provider/model/prices/caps/prompt/retrieval/Hydra/run/code/eligibility/runtime/capability/handoff identity, dirty or changed handoff, ambient import root, blank hypothesis, and an existing generation/evaluation manifest.

Simulate a crash at every byte boundary of the final frame in each stream. Recovery may truncate exactly one unterminated trailing fragment to the last verified newline, only while the exclusive run lock is held, and must append a recovery frame containing the stream, discarded byte count, discarded-byte digest, and prior verified head. A complete newline-terminated but invalid row, corruption before the last row, sequence/hash mismatch, or more than one fragment is fatal and is never auto-repaired. Reconcile audit/checkpoint heads exactly under the same lock: an audit may have at most one complete fsynced orphan frame beyond the checkpointed head, and it is adopted only if its stream, next phase, question ordinal digest, payload bytes/digest, and prior head are the single deterministic event currently expected; append/fsync `audit-orphan-adopted` before proceeding. An audit behind its checkpoint, two or foreign orphan frames, a changed payload, or any ambiguity fails closed; no complete orphan is silently truncated or replayed.

- [ ] **Step 2: Write no-reingest resume tests**

Acquire the run lock with exclusive-create semantics and record version, random nonce, PID, process start time, hostname, and run identity. A second live owner must fail before reading secrets or making network calls. Stale recovery requires explicit `--recover-stale-lock`, proves the recorded process is absent and identity matches, atomically archives the stale lock record, and writes a recovery event; uncertainty or PID reuse fails closed. Release removes only a lock whose nonce still matches. Test live contention, stale success, stale identity mismatch, nonce mismatch, and abnormal-exit recovery.

Load three ids with two completed hypotheses and assert `pendingIds()` returns only the third. Define append-only phase events for `document-submitted`, `document-completed`, `retrieval-audited`, `prompt-audited`, `answer-attempt-reserved`, and `answer-completed`. A completed hypothesis is immutable. Retrying a missing phase is allowed only under the exact sealed `idempotent-upsert` capability; every other capability value blocks before a run exists.

Create one `resource-journal.jsonl` inside the run directory and bind its genesis to the final run identity, authoritative execution-eligibility evidence digest, answer-provider scope digest, price version, and immutable per-run limits. It is not stored at a caller-derived account path and does not purport to serialize other machines/runs. Under `run.lock`, append/fsync a digest-bound answer reservation with the next attempt ordinal and conservative tokens/spend before each answer call. For judge/metrics, `reserveEvaluatorAttempt` may append only after the matching atomically visible initialized attempt exists; it binds kind, ordinal, attempt identity/directory digest, input, deadline, and spend-cap observation, and conservatively consumes the total-attempt ordinal even when recovery proves GO never occurred. Do not claim internal judge API-call or token reservations. No reservation/start is removed, reused, decremented, or refunded. Test concurrent local opens, identity/capability mismatch, reservation without initialized attempt, initialized-attempt orphan adoption, truncated-tail recovery, corrupt chains, ceiling equality/exhaustion, and ambiguity/timeout/no-result outcomes. Separately prove that this journal can never make `executionAvailable` true and that a caller-supplied account id/count/quota cannot substitute for the authoritative Hydra gate.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts tests/unit/longmemeval-resource-journal.test.ts --maxWorkers=1`

Expected: checkpoint module is absent.

- [ ] **Step 4: Implement append-only checkpointing**

Acquire `run.lock` before opening mutable state. Write the atomic/fsynced versioned `run.json` identity before the first frame. Identity includes run/dataset/evaluator commits and complete expected/observed upstream file tuples, sorted-id digest/order, exact hermetic-handoff HEAD/tree/tracked/control-manifest digest, acquisition-provenance digest, dependency-runtime digest, exact `capability.json` digest, authoritative execution-eligibility scope/inventory/quota evidence digest, Hydra collection/source algorithms, answer provider/requested model/base-origin digest, provider-reported model rule, prompt/retrieval versions and limits, prices, per-run total-attempt/token/spend/deadline ceilings, and external hard-limit acknowledgements. Append chained phase frames and validate/reconcile every complete checkpoint/audit/journal prefix under lock before resume. Persist exact bounded retrieval payloads and exact provider-message payloads as framed/hash-chained audit events, fsync them, then append the checkpoint head reference; neither audit contains headers, credentials, raw dataset ids, or forbidden labels. Record opaque collection/source association, submitted/completed ids, document/readback digests, ordered chunk/audit heads, bounded canonical sources/graph/temporal digests, graph-context requested/consumed flags, run-journal reservation id/head, answer metadata, measured-or-null usage/cost, and hypothesis. Build `hypotheses.jsonl` only from validated `answer-completed` events in the provenance's sorted-id order; never edit it in place.

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
- Produces: opaque `TrustedDescriptorLauncherCapability` and `VerifiedHydraExecutionEligibility` input shapes in `cloud-types.ts`; Task 7's ordered gate is the only production construction seam, and its current implementation can construct neither available brand
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

Use deferred fakes to prove no second question begins before the prior `answer-completed` frame is durable. A resumed completed id makes zero Hydra/provider/audit calls. In `idempotent-upsert` mode, simulate “server stored bytes, client lost response”; retry must send the same source id/document digest, receive the same id, inspect one matching stored source, and never change retrieval. Prove the only capability outcomes: stable requested id + exact inspect readback + two unambiguous same-id/same-bytes submissions converging to exactly one source may produce `idempotent-upsert`; uncertainty, unstable/unaddressable client id, readback mismatch/unavailability, duplicate sources, or divergence produces `blocked`. Eligible `capability.json` is schema 1 with `executionAvailable: true`, exact `mode: 'idempotent-upsert'`, authoritative eligibility/reservation digest, pre-probe handoff/runtime/provenance scope digest, probe input/evidence digest, and first-source checkpoint head. It contains no raw account/database/source/text/token value. There is no fresh-only branch, downgrade, one-shot exception, server-id adoption, or exactly-once claim.

- [ ] **Step 4: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-cloud-run.test.ts tests/unit/hydra-bounded-json.test.ts tests/unit/cloud-source.test.ts --maxWorkers=1`

Expected: cloud runner is absent.

- [ ] **Step 5: Implement the cloud loop**

Extend `HydraCloud.ingestDocument` so deterministic mode sends the service's documented client source-id field and `upsert=true`, propagates a caller signal, strictly decodes exactly one receipt, and never invents or accepts a replacement id/filename/status. Add a live capability function that can run only inside the verified hermetic handoff, after both a branded trusted descriptor-launcher capability and an authoritative eligibility object for the authenticated Hydra scope are supplied and after the exact handoff/runtime/provenance probe scope is atomically/fsync sealed. It submits the first official document under its requested id, polls exact completion, performs exact `inspect(requestedId)` byte readback, probes a second same-id/same-bytes upsert, checks scoped bounded query/inspection for convergence, and returns only `idempotent-upsert` or `blocked` with evidence digests. Any uncertainty, client-id/readback failure, or divergence is `blocked`. Atomically write/read back `capability.json`, then capture the final per-run identity that binds its exact bytes before any remaining source or answer work. Capability evidence records only authenticated scope/inventory/quota, pre-probe handoff/runtime/provenance scope, and probe evidence digests, never token, response URL/query, raw account/database/source identifier, or document text. This path is unreachable in the current composition because the trusted-launcher brand has no production constructor.

The library runner entry point accepts only `readonly IngestibleQuestion[]`, `HydraCloud`, `CloudAnswerer`, checkpoint, framed audit writers, run resource journal, final run identity, signal, immutable limits, a branded trusted descriptor-launcher capability, and verified `idempotent-upsert` capability bound to the same authoritative eligibility digest. It is testable with injected fakes but is not exported by a production CLI while either ordered execution gate is unavailable. Do not import the oracle schema. Enforce exact receipt/status/readback before query; cap each ingest request at 120 seconds, status wait at 10 minutes per question, query at 30 seconds, answer at its configured deadline, and the full run at its identity-bound deadline. `HydraCloud.query()` requests `graph_context: true`; the bounded decoder returns typed chunks plus already-validated canonical auxiliary bytes/digests and `requested: true, consumed: false`. Never expose raw `graphContext: unknown`, digest an unbounded service value, pass graph/sources/temporal data to the answerer, or describe returned chunks as graph-enriched.

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
- Produces: immutable `resource-journal-generation.jsonl`, `execution-identity.json`, `hermetic-handoff.json`, `dependency-runtime.json`, and `capability.json` snapshots
- Expands: `RunArtifact` to a versioned oracle cloud schema

- [ ] **Step 1: Write exact hypotheses verification tests**

Require exactly 500 newline-delimited objects, exactly two own keys (`question_id`, `hypothesis`) per row, 500 unique expected ids, non-empty bounded hypotheses, lexically sorted provenance order, final newline, exact sorted-id digest `f038965c54b03632f86a59104dd77848b66e3f80c08d5fbabdd3984d16457811`, and SHA-256 equality with the generation manifest. Reject extra metadata keys even if harmless. Recompute hypotheses from the verified checkpoint and require byte equality.

- [ ] **Step 2: Write artifact invariants**

Write an immutable `generation-artifact.json` and require source/dataset commits, exact dataset/ID digests, `tier: 'oracle'`, exact hermetic-handoff HEAD/tree/tracked/handoff-manifest identity, acquisition-provenance digest, full dependency-runtime manifest digest, and exact eligible `capability.json` bytes/digest. The capability must be schema 1, `executionAvailable: true`, exact `mode: 'idempotent-upsert'`, and bind authoritative authenticated Hydra scope/inventory/quota reservation, pre-probe final-handoff/runtime/provenance scope, probe evidence, and first-source checkpoint-head digests. Also require the full pinned upstream tuple digest, collection/source algorithms, answer requested/reported identities, prices/caps/hard-limit acknowledgement, timestamps/durations, exact successful and total-attempt counts, measured token/cost totals or `null` with a reason, worst-case per-run reserved totals, checkpoint/framed-retrieval/framed-prompt-audit heads, run-resource-journal head/totals, bounded canonical sources/graph/temporal caps and digests, graph-context requested/consumed truth, and `officialEvaluator: null`, `metrics: null`. Raw Hydra account/database/source identifiers and tokens remain absent. A blocked/false/malformed capability or run under `incomplete` cannot contain either manifest, a final `artifact.json`, evaluator output, or score. The later evaluated `artifact.json` is a new file; Task 8 must not mutate `generation-artifact.json`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-adapter.test.ts --maxWorkers=1`

Expected: verifier and expanded artifact contract are absent.

- [ ] **Step 4: Implement immutable generation evidence**

Rebuild hypotheses from checkpoint, write to a sibling temporary file, fsync, atomically rename, and sync the directory. Under `run.lock`, validate the run resource journal and copy its exact genesis-through-generation-head bytes to immutable `resource-journal-generation.jsonl`; do not call this account-wide inventory or quota evidence. Re-read and verify `run.json`, `execution-identity.json`, `hermetic-handoff.json`, `dependency-runtime.json`, exact `capability.json`, chained checkpoint, both fully framed/hash-chained audits with exact checkpoint heads and no orphan tail, `resource-journal-generation.jsonl`, `hypotheses.jsonl`, `generation-artifact.json`, and copied provenance with every upstream expected/observed blob tuple. Require `execution-identity.json` to bind byte-exact handoff, `capability.json`, and dependency-runtime digests. Scan every file for the exact configured Hydra/provider/judge secret values and reject any match without recording value, prefix, or length. Also reject persisted authorization/cookie header keys. Write `generation-manifest.json` last through temp+fsync+rename; it contains only version, algorithm, creation time, and sorted `{relativePath, bytes, sha256}` entries for every allowed immutable generation file, including `hermetic-handoff.json`, `capability.json`, `execution-identity.json`, and `dependency-runtime.json`, and never contains its own digest. Recursively reject every extra file, directory, symlink, socket, or device in the generation namespace before sealing. On later verification, permit only the exact evaluation namespace entries covered by `evaluation-manifest.json`; any unmanifested generation/evaluation path remains fatal. Re-read every entry and verify again. Only then atomically emit the run under `artifacts/benchmarks/longmemeval/<run-id>/`; every failure remains under `artifacts/benchmarks/incomplete/<run-id>/`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-adapter.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit artifact verification**

```bash
git add benchmarks/longmemeval/artifact.ts benchmarks/longmemeval/verify.ts benchmarks/longmemeval/manifest.ts benchmarks/longmemeval/secret-scan.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-adapter.test.ts
git commit -m "feat(benchmark): seal immutable oracle generation evidence"
```

---

### Task 7: Trusted-launcher prerequisite and authoritative Hydra eligibility

**Files:**
- Create: `benchmarks/longmemeval/trusted-descriptor-launcher.ts`
- Create: `benchmarks/longmemeval/execution-eligibility.ts`
- Modify: `benchmarks/longmemeval/cloud-types.ts`
- Modify: `benchmarks/longmemeval/execution-identity.ts`
- Modify: `benchmarks/longmemeval/hermetic-handoff.ts`
- Test: `tests/unit/longmemeval-trusted-descriptor-launcher.test.ts`
- Test: `tests/unit/longmemeval-execution-eligibility.test.ts`
- Modify: `tests/unit/longmemeval-hermetic-handoff.test.ts`

**Interfaces:**
- Produces: `TrustedDescriptorLauncherGate.probe(): Promise<TrustedDescriptorLauncherEligibility>`
- Produces: `UnavailableTrustedDescriptorLauncherGate`, whose only result is `{ available: false, reason: 'trusted_descriptor_launcher_unavailable' }`
- Produces: `AuthoritativeHydraExecutionGate.probe(signal): Promise<HydraExecutionEligibility>`
- Produces: ordered `resolveExecutionEligibility(...)`; it may call the Hydra gate only after receiving an opaque branded `TrustedDescriptorLauncherCapability`
- Does not produce: an available launcher adapter/constructor/decoder, native helper, launcher/handoff/capability CLI, `capability.json`, cloud run, preflight write, resume, fresh-only, judge, or paid-provider command

- [ ] **Step 1: Write launcher and Hydra eligibility refusal tests**

Define a future Hydra-eligible result only from a provider-authenticated response that supplies a stable opaque account/database scope, a monotonic inventory revision, exact current persistent collection/document counts, exact hard maxima, and an atomic durable idempotent reservation for this run's additional 500 collections and 948 documents bound to that scope/revision. Validate the response through the Hydra streamed bounded/fatal UTF-8/strict JSON boundary and bind its canonical digest. A caller-provided budget id, environment account/database label, locally hashed origin/token, filesystem ledger/lock, operator-entered counts, eventually consistent list, or unsigned snapshot cannot satisfy the interface. Reservation conflict, missing identity, scope drift, stale revision, insufficient quota, unknown fields, malformed response, or unsupported endpoint is `unavailable`.

Make launcher eligibility an earlier, independent gate. The only production launcher implementation in this plan is `UnavailableTrustedDescriptorLauncherGate`; it performs no filesystem discovery, PATH lookup, environment lookup, network/download, compilation, dynamic loading, or helper invocation and returns the exact safe reason `trusted_descriptor_launcher_unavailable`. Its opaque available brand has no exported production constructor or JSON decoder. Test no configured launcher, an ambient PATH helper, environment-supplied helper path, repository-local binary/source, caller-supplied path/hash/runtime manifest, mutable helper, dynamically downloaded or compiled helper, wrong platform/version/digest, incomplete provenance, and missing/invalid install attestation. Every case must return that same reason before handoff creation, capability output, credential reads, Hydra eligibility/probe/write/query, sealed Node or Python child spawn, answer-provider creation/call, or judge/metrics spawn; injected counters for all of those actions remain zero and no output file exists.

Reserve the following closed contract for a successor plan; do not implement an accepting adapter here. `TrustedDescriptorLauncherAttestationV1` must name its schema/version, provider, release/version, source origin and exact revision, reviewed build-provenance digest, target OS/architecture, absolute provisioned install path, bytes/SHA-256, package/signature/transparency/install-receipt digests, owner/group/mode, device/inode/install generation, static-versus-dynamic dependency declaration, descriptor-execution semantics, fixed argv/environment-policy digest, observation time, and expiry. The successor must pin the one accepted provider/release/digest set and the independent authority that authenticates the attestation. Unknown/missing fields, a mismatched byte/property, stale observation, mutable install, caller attestation, local build, or ambient/dynamic helper must refuse. Tests document that an `available` fixture used to exercise second-gate ordering is test-only and cannot be constructed through production exports.

Test exact composition order. Current production returns `{ executionAvailable: false, reason: 'trusted_descriptor_launcher_unavailable' }` and never calls `UnavailableAuthoritativeHydraExecutionGate`. Only a test-injected branded launcher capability may advance to the Hydra gate; if that future first gate passes while Hydra identity/quota remains unavailable, the result is `{ executionAvailable: false, reason: 'authoritative_hydra_scope_inventory_unavailable' }`. Neither result is permission, run identity, or artifact evidence. Prove production imports/calls cannot reach `createHermeticHandoff`, `captureFinalRunIdentity`, `runCloudLongMemEval`, `verifyCloudBenchmarkCapability`, provider creation, or official evaluation.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-trusted-descriptor-launcher.test.ts tests/unit/longmemeval-execution-eligibility.test.ts tests/unit/longmemeval-hermetic-handoff.test.ts --maxWorkers=1`

Expected: trusted-launcher and ordered eligibility modules are absent.

- [ ] **Step 3: Implement the fail-closed, non-executable gates**

Implement the interfaces, safe discriminated unions, unavailable launcher implementation, unavailable Hydra implementation, and ordered composition exactly as tested. Modify `createHermeticHandoff`, `captureFinalRunIdentity`, and `verifyImmediatelyBeforeSpawn` so every production-facing signature requires the opaque trusted-launcher brand defined in `cloud-types.ts`; tests use explicit test-only fixtures, and no production constructor exists. Do not implement `TrustedDescriptorLauncherAttestationV1` decoding or an available launcher factory/adapter in production; retain its exact future schema only as a non-constructible interface/contract comment. The ordered composition probes the unavailable launcher first and, after that constant result resolves, returns without accessing process environment, paths, runtime manifests, credentials, Hydra clients, handoff builders, child-process APIs, or output writers. A test-only dependency injection seam may provide the opaque brand solely to test that Hydra is second; it must not be exported from a production entrypoint.

Do not add `bench:longmemeval:capabilities`, `bench:longmemeval:handoff-capabilities`, a launcher/bootstrap script, a native binary/source, a host adapter, or any equivalent executable surface. Do not modify `.env.example` or deployment configuration. `LONGMEMEVAL_BUDGET_ID`, caller approvals, executable paths/digests, and benchmark answer/judge credentials remain absent from public configuration. A future available adapter and every command that could create a handoff, capability, cloud write, or judge attempt require a new plan, independently reviewed launcher provenance/install attestation, implementation, security review, tests, and commit.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-trusted-descriptor-launcher.test.ts tests/unit/longmemeval-execution-eligibility.test.ts tests/unit/longmemeval-hermetic-handoff.test.ts tests/unit/longmemeval-cloud-run.test.ts tests/unit/longmemeval-resource-journal.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts --maxWorkers=1`

Expected: all focused tests pass; current production reports only `trusted_descriptor_launcher_unavailable`; no executable 500-run, capability, handoff, or paid-judge command exists.

- [ ] **Step 5: Commit the fail-closed capability boundary**

```bash
git add benchmarks/longmemeval/trusted-descriptor-launcher.ts benchmarks/longmemeval/execution-eligibility.ts benchmarks/longmemeval/cloud-types.ts benchmarks/longmemeval/execution-identity.ts benchmarks/longmemeval/hermetic-handoff.ts tests/unit/longmemeval-trusted-descriptor-launcher.test.ts tests/unit/longmemeval-execution-eligibility.test.ts tests/unit/longmemeval-hermetic-handoff.test.ts
git commit -m "feat(benchmark): require trusted launch and Hydra eligibility"
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
- Modify: `tests/unit/longmemeval-resource-journal.test.ts`
- Modify: `tests/unit/longmemeval-manifest.test.ts`

**Interfaces:**
- Produces: `evaluateOfficial(input: VerifiedEvaluationInput): Promise<OfficialEvaluation>`, where input contains exact run directory, a branded trusted descriptor-launcher capability, verified generation/run/runtime/capability identities, `RunResourceJournal`, authoritative Hydra eligibility, verified external judge spend-cap authority, fixed judge configuration, deadline, and signal
- Produces: `writeEvaluationManifest(runDir): Promise<EvaluationManifest>`
- Produces: `AttemptState.initialiseAtomically(parent, kind, ordinal, identity)`, `reconcileEvaluatorAttempt(runState, attempt)`, and `recoverAndSealAttempt(dir, identity)`
- Consumes: the same `RunResourceJournal`, authoritative Hydra eligibility, verified external judge hard-spend-cap evidence, dependency runtime, and final `ExecutionIdentity` sealed by generation
- Does not produce: a production evaluator command in this plan revision

- [ ] **Step 1: Write pin/generation-manifest/environment gate tests**

Refuse evaluation unless the generation verifier re-hashes every `generation-manifest.json` entry, rejects extras, and proves byte-exact `hermetic-handoff.json`, `capability.json`, dependency-runtime, acquisition-provenance, and final run-identity bindings; checkpoint and framed audits have exact sealed heads and no orphan; the run-resource-journal prefix byte-matches `resource-journal-generation.jsonl`; the exact handoff HEAD/tree/tracked/handoff manifests still match with no ambient import root; every materialized evaluator-bundle file byte-matches its pinned Git blob tuple; and dataset bytes/SHA/sorted-id digest match the constants above. The sealed runtime must contain exact uv `0.11.21`, CPython `3.9.25`, and a virtualenv installed only from `benchmarks/longmemeval/requirements-lite.lock.txt` with hash enforcement. Verify the lock records the pinned upstream `requirements-lite.txt` blob/digest; record interpreter executable digest, `python --version`, platform, lock digest, and `pip freeze --all`; then require those outputs to match the already sealed runtime manifest. Refuse any unlocked/mismatched environment, writable runtime, extra/missing file, `__pycache__`, or `.pyc`.

The no-paid runtime builder may invoke its separately sealed bootstrap uv only while creating the candidate runtime; those provisioning processes cannot access production credentials or produce benchmark evidence. Every evidence-producing Python, judge, metrics, or supervisor child runs only through `verifyImmediatelyBeforeSpawn`. In the same synchronous spawn turn it revalidates hermetic handoff identity/allowlist, exact complete dependency-runtime file set/bytes, dataset, complete declared upstream bundle, and each consumed input; there is no intervening await or callback. Invoke Python exactly as `<venv-python> -I -B <script> ...` with bytecode/user-site/environment imports disabled. Create immutable `evaluator-identity.json` containing handoff HEAD/tree/tracked/handoff digest, dependency-runtime digest/file-count/byte-count, `capability.json` digest, and every upstream tuple. Tests add an ambient/root `node_modules`, ignored import root, extra handoff importable file, change a script/runtime file after preflight, substitute same-length bytes, or cause a child to emit bytecode and assert no evidence-producing child starts or the attempt fails and seals.

Require judge alias exactly `gpt-4o`, expected evaluator-reported model exactly `gpt-4o-2024-08-06`, `OPENAI_API_KEY` set, optional organization, positive global/batch process deadlines, exactly 500 successful labels, and an explicit maximum over all judge **subprocess attempts**. Do not expose or record an internal judge API-call allowance or input/output-token ceiling: the pinned evaluator controls those calls and its retry loop cannot prove either bound. Before loading the key and again within 60 monotonic seconds before every child, require a machine-verified provider-authoritative response for the dedicated OpenAI project/key stating `hardEnforced: true`, currency USD, a stable opaque scope, nonnegative current spend not above the cap, a hard maximum at or below the operator-approved evaluation maximum, and an enforcement expiry later than the global deadline. Scope/cap changes, expiry, failed refresh, or a cap increase refuses the attempt; bind the canonical response digest and observation ordinal, but not raw response, to the attempt. Caller attestations, dashboard screenshots, environment ids, price estimates, or a local journal do not satisfy it. The current production composition has no reviewed implementation of this authority, so paid judging remains unavailable. The run journal records only subprocess-attempt ordinals and measured-or-null usage/cost. Verify only set/unset for secrets and never print/persist key value, prefix, length, organization value, project identifier, or raw spend-cap response.

- [ ] **Step 2: Write subprocess/output parser tests**

Use a fake process runner with literal pinned-script stdout/result fixtures. Split pending ids in lexical official order into immutable batches of 10. Under `run.lock`, first prove the per-kind total-attempt ceiling has capacity, then derive the next six-digit **candidate** only after every lower ordinal is reconciled and sealed; the candidate is not an allocated/consumed ordinal until its later resource reservation, and exhaustion creates nothing. `AttemptState.initialiseAtomically` creates an `O_EXCL` same-filesystem staging directory, writes/fsyncs exact two-key `hypotheses.input.jsonl`, the reference to separately sealed byte-exact `oracle.input.json`, exact argv/cwd/environment identity, initial empty bounded stdout/stderr files, an initialization manifest, and the genesis `initialized` frame of a framed/hash-chained `attempt-state.jsonl`, then fsyncs the staging directory. The initialization manifest precommits the preflight boot id, exact delegated cgroup-v2 root resolved path/device/inode, one cryptographically random 256-bit attempt nonce, and the single derived child-cgroup basename/path; none of those values may be regenerated during recovery. Atomically rename the staging directory to `judge-attempts/<six-digit-attempt>-<batch-digest>/` and fsync the attempts parent. Only this atomically visible, fully initialized directory is an attempt; never reuse or overwrite it. A crash before rename has no global reservation, cgroup, supervisor, or GO: recovery may promote one byte-complete initialized staging directory or remove one partial staging directory only after proving all three global streams still end at the prior ordinal. No resource-journal or evaluator-checkpoint ordinal may exist without the final initialized directory.

The exact normal state graph is `initialized -> resource_reserved -> checkpoint_reserved -> cgroup_created -> supervisor_ready -> go_committed -> started -> (exited | killed | recovered_failed) -> checkpoint_reconciled -> resource_reconciled -> sealing`. `recovered_failed` is also an allowed terminal transition from any earlier nonterminal state, but only after the state-specific no-live-child proof and, whenever a cgroup exists or was recorded, the cleanup-first durable-intent/removal/cleaned-record protocol below; `exited` and `killed` have the same cleanup precondition. A terminal transition then continues through checkpoint/resource reconciliation and sealing. No state may be skipped. Every frame validates and records the prior state hash plus exact resource-journal and evaluator-checkpoint heads, and fsyncs before returning. After final-directory visibility, append/fsync the matching `reserveEvaluatorAttempt` resource frame first, append/fsync `resource_reserved`, append/fsync evaluator-checkpoint `attempt-reserved`, then append/fsync `checkpoint_reserved`. The reservation binds kind, ordinal, initialized-directory/input/identity/deadline/spend-cap digests and remains consumed even if GO never occurs. A resource reservation before directory visibility, checkpoint reservation before the exact resource frame, or state frame ahead of either referenced global head is corruption.

Evidence-producing subprocesses are supported only on Linux with a writable delegated cgroup-v2 root. Before creating a staging directory or reading the judge key, a read-only host preflight requires `/proc`, boot id, `cgroup.controllers`, delegated subtree control, and `cgroup.kill`; failure returns `unsupported_cgroup_v2` with zero attempt directory, resource/checkpoint frame, key read, cgroup, supervisor, or GO. After `checkpoint_reserved`, resolve the precommitted delegated-root tuple again and exclusive-create only its precommitted nonce-named child. Holding non-following descriptors, require exact parent path/device/inode and boot id, capture the child path/device/inode/controllers, require `cgroup.procs` empty and bounded `cgroup.events` exactly `populated 0`, and atomically write/fsync/rename `cgroup.json` plus fsync the attempt directory before appending/fsyncing `cgroup_created`. A record contains the precommitted nonce/root tuple and captured child/membership tuple; no supervisor may be launched before the durable state frame. Launch only the sealed evaluator supervisor. Before accepting GO or spawning Python it exclusive-creates/fsyncs `supervisor-ready.json` with PID, `/proc/sys/kernel/random/boot_id`, `/proc/<pid>/stat` start-time field 22, nonce, parent identity, attempt ordinal, absolute deadline, and the expected initialized/resource/checkpoint state hashes, then syncs the attempt directory. If parent/IPC dies before GO, it exits without spawning Python.

The parent moves the verified supervisor PID into `cgroup.procs`, rechecks boot/PID/start/cgroup path device/inode and exact membership, and appends/fsyncs `supervisor_ready`. It then appends/fsyncs `go_committed` containing the one-use GO nonce and all three current stream heads **before** sending GO. The GO message carries that frame hash; the supervisor rereads and validates it, its own ready identity, cgroup membership, sealed inputs/runtime, and the same heads before appending/fsyncing `started` and spawning Python. Without a durable matching `go_committed` frame the supervisor refuses GO. No shell, PID-only `kill`, process-name scan, Windows `taskkill`, unowned process-group fallback, or second GO is allowed. Only after this proof may it invoke, from the sealed evaluator bundle:

```text
<venv-python> -I -B evaluate_qa.py gpt-4o <absolute-batch-hypotheses.jsonl> <absolute-oracle.json>
```

Expect `<absolute-batch-hypotheses.input.jsonl>.eval-results-gpt-4o`; never look for upstream `.log`. Stream stdout and stderr to separate exact 1,048,576-byte caps and bound the raw result at 4,194,304 bytes; crossing a cap kills/confirms the owned tree and fails the attempt. Fsync all outputs, copy the raw result without normalization when present, and always write an outcome that explicitly records result presence/absence. Validate every complete row's exact pending id, unique coverage, two input keys plus one `autoeval_label`, boolean label, and model `gpt-4o-2024-08-06`. Preserve a valid completed prefix from a failed batch only through new fsynced judge-checkpoint frames; never mutate the attempt result.

On open/resume, recovery first acquires `run.lock` and jointly enumerates attempt directories, state heads, evaluator-checkpoint frames, resource-journal frames, and the precommitted cgroup path plus canonical/staging/cleanup records. For the single highest unsealed initialized attempt, it deterministically completes only the canonical reservation prefix: no resource frame means append that exact reservation then `resource_reserved`; one exact fsynced resource orphan means validate/adopt it then append `resource_reserved`; no checkpoint frame then means append the exact checkpoint reservation then `checkpoint_reserved`; one exact checkpoint orphan means validate/adopt it then append `checkpoint_reserved`. A resource/checkpoint frame without its initialized directory, checkpoint without resource, state ahead of a missing global frame, differing identity/input/deadline/cap digest, duplicate/orphan frame, more than one unsealed attempt, ordinal gap, or any non-prefix combination is fatal. After completing that prefix, it applies the cgroup recovery table below; a pre-GO crash is never resumed. It is conservatively consumed and, whenever a cgroup exists or was recorded, must complete authenticated cgroup cleanup first; only then may it append `recovered_failed`, checkpoint reconciliation, resource reconciliation, and sealing in the exact order below. No next ordinal is derived until all earlier attempt manifests and the state/checkpoint/resource heads cross-reference exactly and no owned cgroup remains.

The no-live-child proof is state-specific and includes an exhaustive `checkpoint_reserved` cgroup recovery table. With no expected child, no canonical/staging cgroup record, no ready/GO, and untouched empty outputs, ordering proves no supervisor could start and recovery may proceed directly to `recovered_failed`. If the exact nonce child exists but `cgroup.json` does not (crash after mkdir/before record), revalidate the precommitted boot/root path/device/inode and child path/device/inode/controllers through non-following descriptors, require `cgroup.procs` empty and bounded `cgroup.events` `populated 0`, discard only a uniquely attributable partial record staging file or promote a byte-complete one, then atomically write/fsync/rename the canonical record. If the exact child and canonical record exist while state is still `checkpoint_reserved` (crash after record/before state), require byte-exact nonce/root/child/membership tuples and the same live empty-membership proof. In **both** adoption branches, reopen canonical `cgroup.json` without following links, revalidate and fsync that exact file, unconditionally fsync the attempt directory so a previously visible-but-unsynced rename becomes durable, and only then append/fsync `cgroup_created`. A second crash after the recovery directory fsync but before the state append therefore leaves a durable canonical record that the next recovery adopts identically; the state may never outrun an unsynced record. These are the only adoptable cgroup leads. A record without its child, an unexpected/second child or record, boot/root/path/device/inode/controller mismatch, nonempty/uncertain membership, ready/GO evidence before state, or foreign replacement is fatal and is never killed as owned.

At or after `cgroup_created` but before `go_committed`, validate any ready PID/start identity, wait for its mandated IPC-death exit or kill only the authenticated owned cgroup, and require bounded `cgroup.events` polling to reach `populated 0`; absence of `go_committed` proves the protocol could not spawn Python. At or after `go_committed`, assume Python may have run: recheck boot id, PID/start identity, cgroup path device/inode and exact membership, kill the owned tree through `cgroup.kill`, and require `populated 0`. Mismatch, PID reuse, inability to kill/read, or uncertain liveness fails closed without sealing or starting another attempt. A durable ready file one state ahead may be adopted only when its nonce/identity is the unique deterministic next event; any other state lead is corruption. Once this state-specific proof establishes no live process—or immediately after either `checkpoint_reserved` adoption, for which ordering proves no supervisor was launched—cleanup is an authenticated two-record protocol. Atomically write/fsync/rename `cgroup-cleanup-intent.json` binding the nonce/path/device/inode and current state head, reopen and fsync the exact canonical intent, and unconditionally fsync the attempt directory before any cgroup removal; revalidate exact ownership and `populated 0`; remove only that exact empty child; boundedly prove the child path absent; then atomically write/fsync/rename `cgroup-cleaned.json`, reopen/fsync it, and sync the attempt directory before terminal/reconciliation frames. Recovery with a durable intent plus the exact still-present empty child repeats removal; durable intent plus an absent child completes `cgroup-cleaned.json`; cleaned plus absence continues. A crash after intent file fsync but before its parent-directory fsync cannot remove the child; a crash after the parent-directory fsync and removal is deterministically recoverable from the durable intent. Absence after durable `cgroup_created` without the exact parent-synced cleanup intent, or presence after `cgroup-cleaned.json`, is corruption.

Once no owned process remains, first complete and parent-directory-fsync the authenticated cgroup cleanup protocol whenever a cgroup was created, adopted, or durably recorded. Cleanup-first is mandatory: no terminal attempt-state frame, evaluator-checkpoint result/failure frame, resource outcome, `sealing`, or attempt manifest may be written while the owned child exists or before durable `cgroup-cleaned.json` plus verified path absence. Then use this order without variation: sync bounded stdout/stderr/result-or-explicit-absence and `outcome.json`, sync the attempt directory, append/fsync terminal `exited | killed | recovered_failed`, append/fsync the evaluator-checkpoint result/accepted-label-or-failure frame, append/fsync `checkpoint_reconciled`, append/fsync the measured-or-null resource-journal outcome, append/fsync `resource_reconciled`, then append/fsync `sealing`. Write `attempt-manifest.json` last, excluding itself, with sorted byte/SHA-256 entries for every initialization/state/ready/cgroup record/cgroup cleanup/input/reference/command/environment/result-or-absence/stdout/stderr/outcome file plus the exact external stream heads; fsync/rename/sync it, make the directory immutable, and treat exact manifest presence as the seal. No covered file is appended after manifest creation. On recovery, an exact single orphan at each canonical write gap is adopted only if it is the unique next bytes/head; a downstream frame without its required predecessor is fatal. Reject every later byte or extra-file change. The next ordinal requires the sealed manifest, exact three-stream reconciled heads, `cgroup-cleaned.json` for every created/adopted cgroup, and verified absence of its precommitted child path.

Fault-inject a crash immediately before and after every file write, file fsync, staging-directory fsync, atomic rename, parent-directory fsync, resource frame/state frame, checkpoint frame/state frame, cgroup mkdir, record write/fsync/rename/directory-sync, `cgroup_created`, cleanup-intent write/file-fsync/rename/parent-directory-fsync, removal, cleaned-record write/file-fsync/rename/parent-directory-fsync, ready-file/state, PID move/recheck, `go_committed` fsync, GO send, `started`, each output/outcome sync, terminal/checkpoint/resource reconciliation frame, `sealing`, manifest rename/directory sync, and mode hardening. For both judge and metrics, separately prove crash-after-mkdir/before-record and crash-after-record/before-state are authenticated, adopted, canonical-record-file-fsynced, parent-directory-fsynced, cleaned, taken through fsynced `recovered_failed` plus exact checkpoint/resource reconciliation, and sealed before the next ordinal. Add explicit second-crash cases: crash after recovery sees a renamed-but-unsynced `cgroup.json`, after it re-fsyncs the file, after it fsyncs the parent but before `cgroup_created`, after cleanup-intent rename/file fsync but before parent fsync, and after parent fsync plus removal but before `cgroup-cleaned.json`; repeat recovery at every sub-gap and require identical final manifests/stream heads. Assert no terminal/checkpoint/resource reconciliation frame exists before durable cleanup. Assert unsupported/no-cgroup preflight produces no attempt/reservation/key read/GO; every initialized pre-GO orphan becomes one sealed `recovered_failed` ordinal with no evaluator/provider call; every ambiguous post-GO tree is killed and accounted before retry; repeated recovery is idempotent; and no next ordinal appears at any intermediate gap. Also cover parent death before/after ready, exact late exit, boot/PID reuse, cgroup replacement/foreign membership/failed kill/nonempty tree, changed/duplicate/foreign ids, malformed final row, changed sealed inputs/runtime, stdout/stderr overflow, deadline kill, absent spend-cap evidence, total-attempt exhaustion despite fewer than 500 successes, and a second evaluator process.

After 500 unique labels, merge them in lexical official-id order to atomic/fsynced `official-evaluator.jsonl`, then invoke exactly:

```text
<venv-python> -I -B print_qa_metrics.py <absolute-official-evaluator.jsonl> <absolute-oracle.json>
```

Run metrics in ordinal `metrics-attempts/<six-digit-attempt>-<input-digest>/` directories, with a fixed maximum of three conservatively consumed ordinals. Metrics use the identical atomic staging-directory initialization, precommitted cgroup root/nonce/path identity, `initialized -> resource_reserved -> checkpoint_reserved` ordering, shared evaluator-checkpoint frames tagged `kind: 'metrics'`, cgroup record/adoption/cleanup and ready/GO state graph, terminal checkpoint/resource reconciliation, immutable attempt manifest, and no-extra-file verification as judge attempts. In particular, metrics implement the same authenticated mkdir-before-record adoption, record-before-state adoption, two-record owned cleanup, three-stream reconciliation, fsynced `recovered_failed`, and no-next-ordinal rule; no shorthand or separate recovery implementation is permitted. Capture stdout and stderr under separate exact 1,048,576-byte caps plus exact exit code, command, merged evaluator input, oracle reference, parsed output, and outcome; cap breach kills/confirms the tree and fails. A crashed/failed or pre-GO metrics attempt becomes sealed `recovered_failed` before the next ordinal; it never overwrites or resumes a directory, and its ordinal is not refunded. Validate per-type counts against the pinned dataset join; extract overall, task-averaged, per-question-type, and abstention metrics; and reject partial output, NaN/out-of-range metrics, model mismatch, changed generation/evaluator inputs, or non-zero exit. Run the same every-write-gap matrix for metrics, including no-cgroup/no-attempt, initialized-before-reservation, each cross-stream orphan, both cgroup pre-state gaps and every cleanup sub-gap, crash before GO, partial stdout/result, process exit before outcome fsync, and manifest rename before mode hardening; manifest presence still makes the attempt immutable and recovery only verifies it. Judge usage/cost remains `null` with `official_evaluator_does_not_report_usage` unless exact provider-authoritative usage exists; do not replace it with estimates.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-attempt-state.test.ts tests/unit/longmemeval-judge-spend-cap.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-resource-journal.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts tests/unit/longmemeval-hermetic-handoff.test.ts tests/unit/longmemeval-trusted-descriptor-launcher.test.ts --maxWorkers=1`

Expected: evaluator wrapper, spend-cap authority, and attempt-state modules are absent.

- [ ] **Step 4: Implement isolated official evaluation**

Generate and review `requirements-lite.lock.txt` once from the pinned upstream top-level requirements using exact CPython 3.9 resolution and hashes for every allowed wheel/sdist; tests reject a dependency line without hashes or an undeclared top-level package. The no-paid builder provisions the candidate uv/Python/lock environment once, removes bytecode caches, seals every file, and never mutates/reuses an unsealed environment for evidence. Each evaluator child receives only required operating-system/TLS/temp variables, `PYTHONHASHSEED=0`, `PYTHONDONTWRITEBYTECODE=1`, `PYTHONNOUSERSITE=1`, `OPENAI_API_KEY`, optional organization, and controlled absolute paths; `PYTHONPATH` is absent. It receives no Hydra token, answer-provider key, env-file path, or unrelated environment value.

Run deterministic pending-id batches with one versioned, exclusive, hash-chained `judge-checkpoint.jsonl` carrying typed judge and metrics reservation/outcome frames. The coordinator atomically exposes the initialized attempt first, then fsyncs resource reservation, state, checkpoint reservation, and state in the exact order above; every accepted label and failure outcome is synced in the terminal reconciliation order. The matching run-journal ordinal remains consumed for pre-GO recovery, unknown/timeout/killed/no-result attempts. Apply per-batch and global deadlines, kill and confirm the owned subprocess tree on expiry, salvage only a strictly valid complete prefix after the tree is dead, cap total subprocess attempts independently of 500 successful labels, and never exceed 500 unique successes. The upstream backoff loop is unbounded, so no internal call/token bound is claimed; the verified external hard spend cap and outer process deadline are mandatory. Resume under `run.lock` first reconciles the attempt-state/checkpoint/resource triplet, marks and seals every partial attempt, then revalidates generation manifest, immutable attempt manifests/directories, every evaluator checkpoint frame, and the resource-journal prefix before deriving another ordinal. Without a branded trusted descriptor-launcher capability, authoritative Hydra eligibility, and external spend-cap authority, or without supported cgroup preflight, `evaluateOfficial` refuses before reading the judge key or creating an attempt. The current production composition cannot construct the launcher brand, so it cannot reach this evaluator even if later gates are injected.

Write, without modifying any generation file: sealed `oracle.input.json`, `evaluator-identity.json`, all immutable `judge-attempts/**` and `metrics-attempts/**` files, `official-evaluator.jsonl`, aggregate `official-evaluator.stdout.txt`/`stderr.txt`, `official-evaluator-command.json`, `official-evaluator-environment.json`, `judge-checkpoint.jsonl`, `resource-journal-evaluation.jsonl`, `official-metrics.json`, and final `artifact.json`. Command/identity metadata contains exact argv/cwd/exit/deadline/batch-input digests, hermetic-handoff HEAD/tree/tracked/control-manifest digest, dependency-runtime and capability digests, every upstream expected/observed Git-blob tuple, generation identity, external-spend-cap evidence digest, run-journal generation/final heads, measured-or-null totals, and allocated/pre-GO-recovered/started/successful/total judge and metrics attempt counts—never secrets. Under `run.lock`, copy and seal the exact journal prefix through evaluation and require its generation prefix to byte-match the generation snapshot. Run the exact-secret/header scan over all generation and evaluation files. Write `evaluation-manifest.json` last as sorted `{relativePath, bytes, sha256}` entries covering `generation-manifest.json` plus every attempt initialization manifest, state/input/result-or-absence/stdout/stderr/command/cgroup/ready/outcome/attempt-manifest and every aggregate evaluation/final artifact, excluding only itself. Each sealed attempt manifest's exact state/checkpoint/resource heads must appear in the final three-stream reconciliation table. Recursively reject any extra file/directory/staging remnant/symlink/special file, re-read every digest, verify hypotheses/generation manifest/attempt directories unchanged, and reject an unmanifested attempt, ordinal gap, unreconciled stream head, or score-bearing output.

Do not add `bench:longmemeval:evaluate` or any generic evaluator launcher to `package.json`. The evaluator remains a testable library until a later reviewed change supplies a genuine trusted descriptor-launcher capability, authoritative Hydra eligibility, and provider-enforced spend-cap verification in that order.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-attempt-state.test.ts tests/unit/longmemeval-judge-spend-cap.test.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-resource-journal.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts tests/unit/longmemeval-hermetic-handoff.test.ts tests/unit/longmemeval-trusted-descriptor-launcher.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit the official evaluator gate**

```bash
git add benchmarks/longmemeval/evaluator.ts benchmarks/longmemeval/evaluator-checkpoint.ts benchmarks/longmemeval/attempt-state.ts benchmarks/longmemeval/judge-spend-cap.ts benchmarks/longmemeval/requirements-lite.lock.txt scripts/longmemeval-evaluator-supervisor.ts tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-attempt-state.test.ts tests/unit/longmemeval-judge-spend-cap.test.ts tests/unit/longmemeval-resource-journal.test.ts tests/unit/longmemeval-manifest.test.ts
git commit -m "feat(benchmark): isolate the pinned official LongMemEval judge"
```

---

### Task 9: Prove the unavailable launch gate and stop

**Files:**
- Must not create: `.cache/longmemeval/runtime/**`, `.cache/longmemeval/dependency-runtime.json`, `.cache/longmemeval/handoff/**`, `capability.json`, `hypotheses.jsonl`, `generation-manifest.json`, evaluator outputs, metrics, `artifact.json`, or an official score
- Must not modify: `docs/BENCHMARK_LONGMEMEVAL.md`, `docs/V10_RELEASE_STATUS.md`, `web/src/landing/Evals.tsx`, or `web/src/app/routes/evaluations.tsx`

- [ ] **Step 1: Run every benchmark-local code gate**

Run: `npm run typecheck`

Run: `git status --porcelain=v1 --untracked-files=all`

Expected: capture the exact source-checkout status baseline. No Task 9 action creates a runtime, handoff, capability artifact, generation artifact, evaluator artifact, or score.

Run: `npx vitest run tests/unit/longmemeval-adapter.test.ts tests/unit/ground-truth-isolation.test.ts tests/unit/longmemeval-provenance.test.ts tests/unit/longmemeval-execution-identity.test.ts tests/unit/longmemeval-dependency-runtime.test.ts tests/unit/longmemeval-hermetic-handoff.test.ts tests/unit/longmemeval-trusted-descriptor-launcher.test.ts tests/unit/longmemeval-cloud-documents.test.ts tests/unit/longmemeval-answerer.test.ts tests/unit/provider-bounded-json.test.ts tests/unit/provider-openai.test.ts tests/unit/longmemeval-checkpoint.test.ts tests/unit/longmemeval-audit.test.ts tests/unit/longmemeval-resource-journal.test.ts tests/unit/longmemeval-cloud-run.test.ts tests/unit/hydra-bounded-json.test.ts tests/unit/cloud-source.test.ts tests/unit/longmemeval-verify.test.ts tests/unit/longmemeval-manifest.test.ts tests/unit/longmemeval-secret-scan.test.ts tests/unit/longmemeval-execution-eligibility.test.ts tests/unit/longmemeval-evaluator.test.ts tests/unit/longmemeval-evaluator-checkpoint.test.ts tests/unit/longmemeval-attempt-state.test.ts tests/unit/longmemeval-judge-spend-cap.test.ts --maxWorkers=1`

Expected: all commands exit zero with no benchmark test skipped. Source-contract tests prove `package.json` exposes only the no-paid acquisition and candidate-runtime sealing commands, and exposes no `bench:longmemeval:cloud`, `bench:longmemeval:evaluate`, `bench:longmemeval:capabilities`, `bench:longmemeval:handoff-capabilities`, launcher, bootstrap, or generic benchmark-child command. No native launcher/helper source or binary, launcher CLI, host adapter, available launcher constructor, or production attestation decoder exists.

- [ ] **Step 2: Verify the explicit unsupported host capability; do not launch or seal**

There is deliberately no production command to run in this step. Do not invoke `bench:longmemeval:acquire`, `bench:longmemeval:seal-runtime`, Node, Python, uv, a shell helper, Hydra, an answer provider, or the judge to manufacture evidence of the missing trust boundary. The source/test acceptance result of the current production composition is exactly:

```json
{ "executionAvailable": false, "reason": "trusted_descriptor_launcher_unavailable" }
```

This result is a fail-closed preflight outcome, not `capability.json`, permission, a run identity, or publishable evidence. It is reached before handoff/runtime verification, credential access, `AuthoritativeHydraExecutionGate.probe`, Hydra reads/writes, answer-provider creation/calls, or evaluator/judge work. Consequently `authoritative_hydra_scope_inventory_unavailable` is not the expected current outcome: that second gate is observable only after a future, genuinely provisioned trusted-launcher capability passes.

- [ ] **Step 3: Prove ambient and dynamic helpers cannot change the outcome**

The focused tests repeat the production composition with no helper; shadow `node`, `node.cmd`, `python`, `python3`, `uv`, `npm`, and `npx` on PATH; environment-supplied launcher paths/digests; hostile preload/import variables; repository-local binaries/source; caller-supplied runtime manifests and hashes; mutable helpers; and helpers downloaded, compiled, or generated during the test. Every case returns exact `trusted_descriptor_launcher_unavailable`. File-open, network, compiler, dynamic-loader, child-spawn, credential-read, handoff/output, Hydra-gate, Hydra-operation, answer-provider, Python, judge, and metrics sentinels remain zero. Here “no Node call” means no benchmark/sealed child is started by the production composition; the Vitest host itself is only the test harness. Any ambient or dynamic helper is ignored rather than inspected or promoted into a trust root.

Run: `git status --porcelain=v1 --untracked-files=all`

Expected: status is byte-for-byte the Step 1 baseline; no handoff, runtime seal, `capability.json`, official benchmark artifact, or score exists.

- [ ] **Step 4: Stop; activation requires a new reviewed plan**

Do not run 500 questions or the paid judge under this plan. A successor plan must first name and independently provision one concrete native descriptor launcher and pin the complete `TrustedDescriptorLauncherAttestationV1` identity from Global Constraints: provider, release/version, source revision, build provenance, target, installed path and byte digest, package/signature/transparency/install receipt, ownership/mode/device/inode/generation, dependency declaration, execution/environment semantics, and validity window. It must document the exact trusted attestation authority and installation/audit procedure, implement and review a byte-pinned descriptor adapter, and prove the Node/bootstrap descriptor and hostile-environment properties before adding any launcher, handoff, capability, cloud, or evaluation command. A local/dynamic helper or this repository's own manifest cannot meet that prerequisite.

Only after that first gate is genuinely provisioned may the successor query and require a provider-authenticated stable Hydra account/database identity, atomic authoritative inventory/quota reservation for 500 additional collections and 948 documents, and exact repeated-upsert capability in that reserved scope. Only after both launcher and Hydra gates pass may it create a new exact-HEAD runtime/handoff/final run identity/`capability.json`; paid judging additionally requires the machine-verified provider hard spend cap. It must retain official scoring, ground-truth isolation, bounded transports, attempt crash recovery, exact 500-id manifests, and truthful oracle labelling. Until then every public surface remains at `No official score exists`, and there is no git-add/commit step for runtime, capability, or score evidence.
