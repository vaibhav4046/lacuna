# Authenticated Voice Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` and
> implement every task test-first with one test worker.

**Goal:** Replace the floating voice navigation shortcut with one persistent
assistant that captures speech, plans only allowlisted Lacuna operations,
confirms mutations, executes through existing authenticated APIs, displays real
results, and speaks those results through the native-first playback boundary.

**Architecture:** `VoiceAssistantProvider` is mounted once by `Shell` and owns a
single media `VoiceController`, operation controller, browser executor, and
playback session across route changes. Committed or typed text is sent to an
authenticated deterministic intent endpoint. The returned closed union carries
no authority: an exhaustive browser executor maps it to existing APIs, each of
which rechecks session, CSRF, tenant scope, validation, quota, and receipts.
Reads execute directly. Mutations require a second, expiring confirmation turn.

**Spec:**
`docs/superpowers/specs/2026-08-21-production-convergence-design.md`

## Global constraints

- Never request microphone permission without an explicit user gesture.
- Public explore mode is read-only; no public mutation may be planned or run.
- Intent output cannot contain an arbitrary URL, method, workspace, collection,
  credential, run id, webhook id, shell command, MCP method, or tool invocation.
- Unknown imperatives are refused. Only question-like unmatched text falls
  through to private Ask.
- Every write needs a separately captured exact `confirm` or a visible confirm
  button. `and confirm` in the original utterance never bypasses preview.
- Pending actions are one-shot, workspace-bound, and expire after 30 seconds.
- Operation success and speech playback success are independent states. A
  playback error cannot re-run a completed operation.
- Request identifiers are reused across retries; do not claim exactly-once.
- No secret, cookie, workspace collection, raw provider body, or unredacted URL
  query may be shown, spoken, logged, or stored in voice state.

---

### Task 1: Closed operation registry and deterministic parser

**Files:**
- Create: `src/voice/operations.ts`
- Create: `src/voice/intent.ts`
- Test: `tests/unit/voice-operations.test.ts`
- Test: `tests/unit/voice-intent.test.ts`

**Interfaces:**
- Produces: versioned `VoiceOperation` closed union
- Produces: `VoiceEffect = 'navigation' | 'read' | 'write'`
- Produces: `planVoiceIntent(transcript, currentRoute, scope)`
- Produces: fixed preview and result-summary formatters

- [ ] Write failing registry tests that enumerate every operation and effect.
  Initial operations are route navigation, private Ask, observed summaries for
  `summary`, `memory`, `changes`, `conflicts`, `health`, `graph`, `runs`,
  `agents`, `tools`, `schedules`, `models`, `evaluations`, and `connectors`,
  open connector/file setup, remember bounded text, start Researcher work,
  cancel/retry the uniquely selected eligible run, and run a uniquely selected
  enabled schedule. Mark connector summaries unavailable until connector Task 1
  lands. Destructive/security operations and arbitrary tool execution are not
  members of the union.
- [ ] Write failing parser tests for route aliases, `ask`, question fallthrough,
  summary phrases, `remember`, Researcher work, run controls, schedule run,
  exact `confirm`/`cancel`, hostile URLs/commands, ambiguous targets, empty and
  overlong input, extra control words, and public-scope mutation refusal.
- [ ] Run
  `npx vitest run tests/unit/voice-operations.test.ts tests/unit/voice-intent.test.ts --maxWorkers=1`
  and verify RED.
- [ ] Implement a precedence-ordered deterministic parser and exhaustive
  validators. Fixed formatters may interpolate only already-bounded labels and
  counts. Do not add a model fallback in this release.
- [ ] Run the focused tests and verify GREEN.
- [ ] Commit as `feat(voice): define safe operation intents`.

---

### Task 2: Authenticated intent API

**Files:**
- Modify: `src/api/router.ts`
- Modify: `api/index.ts`
- Test: `tests/unit/voice-api.test.ts`
- Test: `tests/unit/voice-intent-api.test.ts`

**Interface:**
- Adds: `POST /api/workspace/voice/intent`
- Request: `{ version: 1, requestId, transcript, currentRoute }`
- Response: `{ version: 1, requestId, operation, effect,
  requiresConfirmation, available, reason, display }`

- [ ] Write failing API tests for exact origin, valid session, CSRF, no-store,
  strict keys/types/lengths, request-id grammar, per-workspace rate limiting,
  public mutation refusal, and ignored client workspace/collection fields.
- [ ] Assert two accounts receive plans derived only from their authenticated
  scope and that responses contain no email or collection identifier.
- [ ] Run
  `npx vitest run tests/unit/voice-api.test.ts tests/unit/voice-intent-api.test.ts --maxWorkers=1`
  and verify RED.
- [ ] Route the bounded body through `planVoiceIntent`; derive private/public
  scope from the session and route prefix. Keep the planner pure and provider
  independent.
- [ ] Run focused tests and verify GREEN.
- [ ] Commit as `feat(voice): authenticate operation planning`.

---

### Task 3: Exhaustive browser executor and idempotent request mapping

**Files:**
- Create: `web/src/api/voice-operations.ts`
- Create: `web/src/voice/operations.ts`
- Modify: `src/api/router.ts`
- Test: `tests/unit/voice-operation-executor.test.ts`
- Test: `tests/unit/agent-runtime-api.test.ts`

**Interfaces:**
- Produces: `VoiceOperationExecutor.plan()` and `.execute()`
- Produces: redacted `VoiceOperationResult`
- Changes: `/api/workspace/agent/run` accepts a validated optional `requestId`
  and maps it to durable `voice:<requestId>` idempotency; ordinary web calls
  retain generated `web:*` keys.

- [ ] Write failing tests that exhaustively map each union member to only these
  paths: local router navigation; `/api/workspace/query`; authenticated
  workspace GET resources; `/api/workspace/ingest`;
  `/api/workspace/agent/run`; eligible run cancel/retry; enabled schedule run;
  and connector catalogue/setup after that route exists.
- [ ] Assert credentials and CSRF on every POST, one in-flight execution per
  request id, request-id reuse on retry, unique-target refusal, `401` session
  handling, provider-error redaction, and no fetch for navigation/refusal.
- [ ] Add failing server tests proving a valid voice request id converges on the
  same agent idempotency key and arbitrary ids/extra keys are rejected.
- [ ] Implement the exhaustive switch. Re-fetch runs/schedules immediately
  before execution and require one eligible target; never trust an id supplied
  by the planner or transcript.
- [ ] Run
  `npx vitest run tests/unit/voice-operation-executor.test.ts tests/unit/agent-runtime-api.test.ts --maxWorkers=1`
  and verify GREEN.
- [ ] Commit as `feat(voice): execute allowlisted workspace actions`.

---

### Task 4: Orthogonal operation and confirmation controller

**Files:**
- Create: `web/src/voice/assistant-controller.ts`
- Modify: `web/src/voice/controller.ts`
- Modify: `web/src/voice/states.ts`
- Modify: `src/voice/states.ts`
- Test: `tests/unit/voice-controller.test.ts`
- Test: `tests/unit/voice-machine.test.ts`
- Test: `tests/unit/voice-assistant-controller.test.ts`

**Interfaces:**
- Produces: `VoiceOperationPhase = 'idle' | 'interpreting' |
  'awaiting_confirmation' | 'executing' | 'succeeded' | 'refused' |
  'unavailable'`
- Produces: `VoiceAssistantSnapshot` with pending preview, observed result, and
  speech status kept separate

- [ ] Write failing tests for immediate navigation/read execution, mutation
  preview without execution, separate exact confirmation, visible-button
  confirmation, cancel, 30-second expiry, new-command invalidation, session or
  scope change, disposal, stale callbacks, double-confirm, and playback failure
  after successful execution.
- [ ] Add an explicit committed-text delegate to `VoiceController` so the media
  machine does not hardcode private Ask. Preserve direct Ask as the default
  delegate for compatibility and public explore mode.
- [ ] Return fixed spoken summaries from observed results; never synthesize
  evidence or repeat the full remembered source.
- [ ] Run all controller/machine tests with one worker and verify GREEN.
- [ ] Commit as `feat(voice): confirm state-changing commands`.

---

### Task 5: One global provider and real floating dock

**Files:**
- Create: `web/src/voice/assistant-context.tsx`
- Create: `web/src/app/VoiceDock.tsx`
- Modify: `web/src/app/Shell.tsx`
- Modify: `web/src/app/routes/voice.tsx`
- Modify: `web/src/app/routes/Ask.tsx`
- Test: `tests/unit/shell.test.ts`
- Test: `tests/unit/web-product-contracts.test.ts`

- [ ] Write failing contracts proving Shell mounts one provider/controller, the
  bubble opens an accessible dialog instead of navigating, its explicit listen
  button starts capture, it never auto-requests microphone access, route changes
  keep transcript/result/pending state, Escape collapses without executing, and
  `/voice` consumes the same provider rather than constructing another runtime.
- [ ] Build a responsive dock with transcript, typed fallback, operation phase,
  exact preview, CONFIRM/CANCEL, observed result/evidence summary, replay,
  provider/local errors, and a link to the expanded Voice route. Trap focus only
  while expanded and restore focus to the bubble on close.
- [ ] Keep explore mode visibly read-only and route its questions through the
  existing public query endpoint.
- [ ] Run
  `npx vitest run tests/unit/shell.test.ts tests/unit/web-product-contracts.test.ts tests/unit/voice-controller.test.ts tests/unit/voice-assistant-controller.test.ts --maxWorkers=1`
  and verify GREEN.
- [ ] Commit as `feat(voice): make the assistant globally operational`.

---

### Task 6: Cross-surface Hydra continuity and production proof

**Files:**
- Create: `scripts/smoke-voice-operations.ts`
- Modify: `package.json`
- Create after successful deployment:
  `artifacts/verification/2026-08-21-convergence/voice-operations.json`
- Modify only after observed proof: `docs/V10_RELEASE_STATUS.md`

- [ ] Write a failing smoke contract that authenticates, ingests a unique note
  through confirmed voice execution, waits for indexing, asks it through voice,
  compares standing/evidence/trace-source identity with Web Ask, starts one
  confirmed Researcher run, verifies request-id convergence, tests public write
  refusal, refreshes, and confirms the signed-in global dock still works.
- [ ] Implement redacted proof output containing only operation name, status,
  counts, trace/context-pack/run ids, receipt/index state, and playback-analysis
  availability.
- [ ] Run the full voice unit set, root/web typechecks, web build, copy lint, and
  dependency audit serially with one worker.
- [ ] Deploy to an immutable production-configured URL. Exercise navigation,
  cited Ask, confirmed remember, refresh, agent run, cancellation safety, valid
  MP3 acquisition, native playback or truthful ENABLE SOUND recovery, and no
  error logs. Promote only when every gate passes.
- [ ] Commit only observed evidence and truthful product copy in the final
  convergence evidence commit.
