# First-Run Private Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a newly authenticated user create a workspace, preview and store a real first source, and execute a suggested private question with evidence before entering the main shell.

**Architecture:** A pure onboarding state machine derives its resume phase from the durable session and real workspace question index. A new authenticated preview route shares normalization and extraction with private ingest but never writes. The onboarding UI reuses the connector file-preparation path and the existing private question/Ask APIs rather than creating a second memory system.

**Tech Stack:** TypeScript, React, HydraDB Cloud, existing JSON/CSRF client, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-production-convergence-design.md`

## Global Constraints

- Workspace identity comes only from the authenticated account.
- Workspace creation, preview, ingest, and Ask are separate durable operations.
- No sample fact is stored without an explicit `Use an example` and `Store` action.
- Preview and store must share title/text normalization.
- A timed-out write is reported as ambiguous, not as definitely absent.
- Existing accounts with a workspace must not be forced through onboarding again.
- Heavy verification runs with one worker.

---

### Task 1: Shared source preparation and authenticated preview API

**Files:**
- Create: `src/api/extraction-preview.ts`
- Modify: `src/api/ingest.ts`
- Modify: `src/api/router.ts`
- Test: `tests/unit/onboarding-api.test.ts`
- Test: `tests/unit/ingest-source.test.ts`

**Interfaces:**
- Produces: `prepareSourceInput(title, rawText): PreparedSourceInput | IngestFailure`
- Produces: `previewSource(prepared): ExtractionPreview`
- Adds: `POST /api/workspace/ingest/preview`
- Reuses: `workspaceCollection(account.email)` and existing CSRF/session checks

- [ ] **Step 1: Write source-normalization parity tests**

```ts
it('previews the exact normalized input later given to ingest', () => {
  const prepared = prepareSourceInput('  Standup  ', 'A\r\nB\u0000');
  expect(prepared).toMatchObject({ title: 'Standup', text: 'A\nB' });
  expect(previewSource(prepared as PreparedSourceInput).inputDigest)
    .toBe(sourceInputDigest(prepared as PreparedSourceInput));
});
```

Cover empty title/text, title truncation, source truncation, CRLF normalization, NUL removal, and an all-unread source that produces no writes.

- [ ] **Step 2: Write authenticated preview route tests**

Require `401` without a session, `403` without valid CSRF, `400` for malformed input, and `200` for a real statement. Inject an ingest spy and assert the preview route never invokes it. Assert any request body field named `workspace` or `collection` is ignored and absent from the response.

- [ ] **Step 3: Run the preview tests and verify RED**

Run: `npx vitest run tests/unit/onboarding-api.test.ts tests/unit/ingest-source.test.ts --maxWorkers=1`

Expected: missing module and route failures.

- [ ] **Step 4: Implement shared preparation and preview**

Move the normalization used by `ingestSource` behind `prepareSourceInput`. `previewSource` calls the existing extractor and returns only:

```ts
interface ExtractionPreview {
  readonly inputDigest: string;
  readonly title: string;
  readonly truncated: boolean;
  readonly kept: readonly {
    quote: string; subject: string; predicate: string; value: string; mode: string;
  }[];
  readonly unread: readonly { quote: string; reason: string }[];
}
```

The preview route uses the same body limit as private ingest, applies the existing private read limiter rather than the write quota, and returns `Cache-Control: no-store`.

- [ ] **Step 5: Make ingest consume `PreparedSourceInput`**

Keep the exported `ingestSource` signature compatible, but have it call `prepareSourceInput` before extraction. Add an internal `ingestPreparedSource` function so connector and onboarding code can prove preview/store digest parity without duplicating normalization.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/onboarding-api.test.ts tests/unit/ingest-source.test.ts tests/unit/extract.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 7: Commit the preview boundary**

```bash
git add src/api/extraction-preview.ts src/api/ingest.ts src/api/router.ts tests/unit/onboarding-api.test.ts tests/unit/ingest-source.test.ts
git commit -m "feat(onboarding): preview private memory before ingest"
```

---

### Task 2: Searchability and real suggested-question readiness

**Files:**
- Modify: `src/api/ingest.ts`
- Modify: `src/api/router.ts`
- Test: `tests/unit/ingest-source.test.ts`
- Test: `tests/unit/onboarding-api.test.ts`

**Interfaces:**
- Adds: `IngestOptions.awaitSearchable?: boolean`
- Adds: `IngestReport.searchable: boolean`
- Adds: `IngestReport.indexing: readonly { id: string; status: string }[]`
- Consumes: `HydraCloud.waitForIndexing(ids, options)`

- [ ] **Step 1: Add a queued-receipt readiness regression**

Use a fake cloud that returns accepted `queued` receipts and later terminal `completed` statuses. Assert `awaitSearchable: true` polls and reports `searchable: true`. Add a deadline case that reports `searchable: false` without claiming the write failed.

- [ ] **Step 2: Add an API regression for delayed suggestions**

After a private ingest whose searchability deadline expires, assert the response is successful with `searchable: false` and the UI-facing message can say indexing continues. After terminal completion, assert `GET /api/workspace/questions` returns real subject/predicate entries and private Ask returns evidence.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/ingest-source.test.ts tests/unit/onboarding-api.test.ts --maxWorkers=1`

Expected: missing options/report fields.

- [ ] **Step 4: Implement bounded indexing readiness**

Collect accepted record ids already validated by `assertCompleteReceipts`. When `awaitSearchable` is true, call `waitForIndexing` with a 45-second deadline and 1-second interval. Mark `searchable` only when every accepted id has terminal status `completed`; keep queued/time-limited writes successful but not searchable. Never return internal collection names in the router JSON.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/ingest-source.test.ts tests/unit/onboarding-api.test.ts tests/unit/context-failure-api.test.ts --maxWorkers=1`

Expected: all tests pass and private context failures remain fail-closed.

- [ ] **Step 6: Commit searchability readiness**

```bash
git add src/api/ingest.ts src/api/router.ts tests/unit/ingest-source.test.ts tests/unit/onboarding-api.test.ts
git commit -m "feat(onboarding): wait for first memory to become searchable"
```

---

### Task 3: Resumable three-phase onboarding state machine

**Files:**
- Create: `web/src/onboarding/state.ts`
- Modify: `web/src/onboarding/Onboarding.tsx`
- Modify: `web/src/api/session.tsx`
- Test: `tests/unit/onboarding-state.test.ts`
- Test: `tests/unit/web-product-contracts.test.ts`

**Interfaces:**
- Produces: `OnboardingPhase = 'workspace' | 'memory' | 'ask' | 'complete'`
- Produces: `initialOnboardingState(session, questions): OnboardingState`
- Produces: pure `advanceOnboarding(state, event): OnboardingState`
- Consumes: `/api/workspace`, `/api/workspace/ingest/preview`, `/api/workspace/ingest`, `/api/workspace/questions`

- [ ] **Step 1: Write state-machine regressions**

```ts
it('does not recreate a durable workspace after ingest failure', () => {
  let state = initialOnboardingState({ workspace: null }, []);
  state = advanceOnboarding(state, { type: 'workspace_created', name: 'Atlas' });
  state = advanceOnboarding(state, { type: 'ingest_failed', message: 'retry' });
  expect(state.phase).toBe('memory');
  expect(state.workspaceCreated).toBe(true);
});

it('resumes at Ask when a workspace already has real questions', () => {
  const state = initialOnboardingState({ workspace: 'Atlas' }, [QUESTION]);
  expect(state.phase).toBe('ask');
});
```

Cover empty-workspace resume, explicit skip, example insertion without storage, preview success, indexing pending, and answer completion.

- [ ] **Step 2: Update source-contract tests for consequential steps**

Remove assertions for the old five status slides. Require `CREATE WORKSPACE`, `ADD FIRST MEMORY`, `ASK WITH EVIDENCE`, explicit `USE AN EXAMPLE`, and explicit `SKIP FOR NOW`. Forbid any effect that posts the example on mount.

- [ ] **Step 3: Run state/UI tests and verify RED**

Run: `npx vitest run tests/unit/onboarding-state.test.ts tests/unit/web-product-contracts.test.ts --maxWorkers=1`

Expected: state module and new UI contract are absent.

- [ ] **Step 4: Implement phase one and durable resume**

Post the workspace once, await `session.refresh()`, and transition to memory. On mount, if session workspace is non-null, fetch questions: non-empty resumes at ask, empty resumes at memory. Workspace failure stays in workspace; later failures never call workspace creation again.

- [ ] **Step 5: Implement paste preview and explicit store**

Keep title/text locally, call preview, render kept and unread sentences, and enable `STORE THIS MEMORY` only when preview has at least one kept statement. Send the same title/text plus expected `inputDigest` to private ingest with `awaitSearchable: true`. If the request times out, retain the text and say the save may still finish.

`USE AN EXAMPLE` inserts labelled editable text only. `SKIP FOR NOW` transitions to a truthful empty state and offers Memory or Connectors navigation.

- [ ] **Step 6: Integrate file preparation from the connector plan**

Keep the selected `File` object in component state. Call `/api/workspace/connectors/file/preview`, render its extraction preview, then resend the same file and expected SHA-256 digest to `/api/workspace/connectors/file/import` only after explicit confirmation. Do not create a second parser or upload contract.

- [ ] **Step 7: Fetch at most three real suggestions**

After searchable ingest, poll `/api/workspace/questions` for up to 15 seconds with capped backoff. Store at most three returned entries; if none arrive, show Memory navigation without inventing a question.

- [ ] **Step 8: Run state/UI tests and verify GREEN**

Run: `npx vitest run tests/unit/onboarding-state.test.ts tests/unit/web-product-contracts.test.ts tests/unit/web-auth-client.test.ts --maxWorkers=1`

Expected: all tests pass.

- [ ] **Step 9: Commit the three-phase flow**

```bash
git add web/src/onboarding/state.ts web/src/onboarding/Onboarding.tsx web/src/api/session.tsx tests/unit/onboarding-state.test.ts tests/unit/web-product-contracts.test.ts
git commit -m "feat(onboarding): guide first memory into a real answer"
```

---

### Task 4: Inline private answer and evidence

**Files:**
- Create: `web/src/app/AnswerEvidence.tsx`
- Modify: `web/src/app/routes/Ask.tsx`
- Modify: `web/src/onboarding/Onboarding.tsx`
- Test: `tests/unit/web-product-contracts.test.ts`
- Test: `tests/unit/onboarding-state.test.ts`

**Interfaces:**
- Produces: shared `AnswerEnvelope`, `AnswerEvidenceItem`, and `AnswerEvidence` component
- Consumes: existing structured `/api/ask` envelope
- Requires: evidence `quote`, `source`, `meta`, and `standing`

- [ ] **Step 1: Add shared-evidence contract assertions**

Require Ask and Onboarding to import the same component. Require the client evidence type to include `quote`, and require the rendered evidence card to show that quote rather than only source metadata.

- [ ] **Step 2: Run the UI contracts and verify RED**

Run: `npx vitest run tests/unit/web-product-contracts.test.ts tests/unit/onboarding-state.test.ts --maxWorkers=1`

Expected: shared answer component and quote field are absent.

- [ ] **Step 3: Extract the answer renderer**

Move status, answer, abstention/conflict copy, evidence toggle, citations, revisions, and trace metadata from `Ask.tsx` into `AnswerEvidence.tsx`. Preserve current Ask behavior. Add the evidence quote to the typed envelope and render it as text.

- [ ] **Step 4: Execute a suggestion inside onboarding**

Post `{ subject, predicate, via }` from the selected server suggestion to `/api/ask`. Render loading, answer, abstention, conflict, or fail-closed system error through `AnswerEvidence`. Only show `OPEN LACUNA` after a terminal response; completion navigates to the relevant Ask or Memory route.

- [ ] **Step 5: Run all onboarding and Ask regressions**

Run: `npx vitest run tests/unit/onboarding-api.test.ts tests/unit/onboarding-state.test.ts tests/unit/web-product-contracts.test.ts tests/unit/workspace-memory-standing.test.ts --maxWorkers=1`

Expected: all tests pass.

- [ ] **Step 6: Commit shared evidence**

```bash
git add web/src/app/AnswerEvidence.tsx web/src/app/routes/Ask.tsx web/src/onboarding/Onboarding.tsx tests/unit/web-product-contracts.test.ts tests/unit/onboarding-state.test.ts
git commit -m "feat(onboarding): show first private answer with evidence"
```

---

### Task 5: Workspace routing and production first-run proof

**Files:**
- Create: `web/src/app/RequireWorkspace.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/auth/SignIn.tsx`
- Modify: `web/src/auth/SignUp.tsx`
- Modify: `web/src/auth/Recovery.tsx`
- Modify: `web/src/app/routes/Dashboard.tsx`
- Create: `scripts/smoke-onboarding.ts`
- Test: `tests/unit/web-product-contracts.test.ts`
- Test: `tests/unit/auth-api.test.ts`

**Interfaces:**
- Produces: `RequireWorkspace` redirect for authenticated sessions with `workspace === null`
- Produces: `npm run smoke:onboarding`

- [ ] **Step 1: Add routing regressions**

Require authenticated workspace-null sessions to reach `/onboarding`; require existing workspace sessions to keep `/app/*`; require sign-in/recovery success to choose onboarding only when session workspace is null.

- [ ] **Step 2: Run routing tests and verify RED**

Run: `npx vitest run tests/unit/web-product-contracts.test.ts tests/unit/auth-api.test.ts --maxWorkers=1`

Expected: the workspace guard is absent and success paths still route directly to dashboard.

- [ ] **Step 3: Implement the workspace guard and empty-state links**

Wrap `/app/:route` with `RequireWorkspace`. Preserve `/onboarding` for workspace-null users and permit existing users to open it deliberately. Update dashboard empty actions to real Memory and Connectors routes only after those surfaces exist.

- [ ] **Step 4: Add the serial smoke script**

The script accepts a base URL and test credentials from environment, then performs session read, workspace create, source preview, source ingest with readiness, question fetch, structured private Ask, evidence assertion, and a second session read. It must redact cookies, CSRF values, emails, collection names, and provider bodies from output.

Add `"smoke:onboarding": "tsx scripts/smoke-onboarding.ts"` to root `package.json`.

- [ ] **Step 5: Run local gates**

Run: `npm run typecheck`

Run: `npm --prefix web run typecheck`

Run: `npm run build`

Run: `npx vitest run tests/unit/onboarding-api.test.ts tests/unit/onboarding-state.test.ts tests/unit/auth-api.test.ts tests/unit/web-product-contracts.test.ts --maxWorkers=1`

Expected: all commands exit zero.

- [ ] **Step 6: Production-test after the combined preview deployment**

Use a fresh authorized test identity or a clean dedicated test account. Complete workspace creation, preview, explicit store, suggested Ask, evidence display, refresh, and session revalidation in the browser. Run the smoke script against the immutable deployment and capture only redacted states/statuses.

- [ ] **Step 7: Commit the first-run gate**

```bash
git add web/src/app/RequireWorkspace.tsx web/src/App.tsx web/src/auth/SignIn.tsx web/src/auth/SignUp.tsx web/src/auth/Recovery.tsx web/src/app/routes/Dashboard.tsx scripts/smoke-onboarding.ts package.json tests/unit/web-product-contracts.test.ts tests/unit/auth-api.test.ts
git commit -m "feat(onboarding): enforce and verify first workspace setup"
```
