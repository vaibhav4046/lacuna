# First-Run Private Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a newly authenticated user create a workspace, preview and store a real first source, and execute a suggested private question with evidence before entering the main shell.

**Architecture:** A pure onboarding state machine derives its resume phase from a durable account completion bit and a real workspace question index. A new authenticated preview route shares normalization and extraction with private ingest but never writes, then issues a short-lived session/workspace/input-bound token that the store route must consume. Authenticated reads always use `workspaceCollection(account.email)`; the user-chosen workspace label is presentation only, and only explicit `/api/explore/*` routes may access the public corpus. The onboarding UI reuses the connector file-preparation path and explicit private question/Ask APIs rather than creating a second memory system.

**Tech Stack:** TypeScript, React, HydraDB Cloud, existing JSON/CSRF client, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-production-convergence-design.md`

## Global Constraints

- Workspace identity comes only from the authenticated account.
- A workspace label never selects data. Authenticated reads/writes always use the current account collection; only `/api/explore/*` may use bundled/public data.
- Workspace creation, preview, ingest, and Ask are separate durable operations.
- Workspace creation does not complete onboarding. Completion is an exact-readback account mutation after a qualifying evidence-backed private Ask or explicit Skip; guards use `session.onboarded`.
- No sample fact is stored without an explicit `Use an example` and `Store` action.
- Preview and store share title/text normalization and a short-lived token bound to the current session binding, workspace digest, normalized input digest, version, and nonce. It is process-locally consumed and cross-instance retries rely only on deterministic upsert convergence; no global one-time claim is made.
- A timed-out write is reported as ambiguous, not as definitely absent.
- Existing legacy accounts already marked `onboarded: true` must not be forced through onboarding again.
- Session/account-binding changes abort and discard every pending preview, ingest, file, question, and answer result before it can update UI or write.
- Heavy verification runs with one worker.

---

### Task 1: Shared source preparation and authenticated preview API

**Files:**
- Create: `src/api/extraction-preview.ts`
- Create: `src/api/onboarding-preview-token.ts`
- Modify: `src/api/ingest.ts`
- Modify: `src/api/workspace.ts`
- Modify: `src/api/router.ts`
- Modify: `api/index.ts`
- Modify: `web/src/app/routes/ingest.tsx`
- Modify: `web/src/app/routes/context.tsx`
- Test: `tests/unit/onboarding-api.test.ts`
- Test: `tests/unit/ingest-source.test.ts`
- Create: `tests/unit/workspace-api.test.ts`
- Test: `tests/unit/web-product-contracts.test.ts`

**Interfaces:**
- Produces: `prepareSourceInput(title, rawText): PreparedSourceInput | IngestFailure`
- Produces: `previewSource(prepared): ExtractionPreview`
- Adds: `POST /api/workspace/ingest/preview`
- Adds: a dedicated onboarding preview-token service derived with exact domain `lacuna:onboarding-preview:v1\0`
- Reuses: `workspaceCollection(account.email)` plus exact Origin/CSRF/current-session/session-binding checks

- [ ] **Step 0: Write and fix the private/public isolation regression**

Prove an authenticated account whose presentation label is literally
`acme / backend` still reads only `workspaceCollection(account.email)`. Prove an
expired session and an account swap can never return public/demo questions,
answers, evidence, or source rows through a private route. Remove every
label-based data branch from `ApiRouter.#viewFor` and `src/api/workspace.ts`; a
missing private session returns `401`, not an empty view or public fallback.
Keep public data reachable only through explicit `/api/explore/*` routes.

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

Require exact configured Origin, valid CSRF, current session, and session binding
before body/extraction: `401` without/currently-invalid session, `403` for wrong
Origin/CSRF/binding, `400` for malformed input, `429` for a dedicated
workspace-keyed preview quota, `503` when the complete token service is absent,
and `200` for a real statement. Inject extraction,
quota, and ingest spies to prove every refusal performs zero extraction/write.
Reject—not ignore—`workspace`, `collection`, and every unknown body field. An
account swap during extraction discards the response. Require the existing
signed-in Memory `AddSource` surface to use this same preview/token/review/
explicit-confirm flow; no current caller may remain on a legacy `{title,text}`
write after the server route requires a token.

- [ ] **Step 3: Run the preview tests and verify RED**

Run: `npx vitest run tests/unit/onboarding-api.test.ts tests/unit/workspace-api.test.ts tests/unit/ingest-source.test.ts --maxWorkers=1`

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

interface AuthenticatedExtractionPreview extends ExtractionPreview {
  readonly previewToken: string;
  readonly expiresAt: string;
}
```

`previewSource` remains pure and returns `ExtractionPreview`; the authenticated
route wraps it as `AuthenticatedExtractionPreview`. The token is an
authenticated, expiring capability bound to the current session
token hash, server-derived workspace digest, normalized title/text digest,
exact purpose `onboarding | memory`, schema version, and a random nonce. Derive its signing subkey from the validated
file-preview root key with the exact domain above; never reuse the file-token
MAC domain or fall back to Hydra/session/OAuth material. Its replay cache is
explicitly bounded/process-local; a cross-instance
retry is not globally prevented and must converge through deterministic upsert.
Never store it in browser persistence or logs. The route uses the same
body limit as private ingest, a new bounded workspace-keyed preview quota (not
the public address limiter), and returns `Cache-Control: no-store` plus `nosniff`.

- [ ] **Step 5: Make ingest consume `PreparedSourceInput`**

Keep the exported `ingestSource` signature compatible, but have it call
`prepareSourceInput` before extraction. Add an internal `ingestPreparedSource`
function so connector and onboarding code can prove preview/store digest parity
without duplicating normalization. Preview and store accept the same exact
purpose. The private store route accepts exact
`{ title, text, previewToken, awaitSearchable: true, purpose: 'onboarding' | 'memory' }`, reparses/reprepares the
input, verifies the current session/workspace/digest/expiry/nonce binding, then
acquires the private write quota and revalidates the session immediately before
the first durable write. A used/replayed/foreign/stale token performs zero writes.

Migrate `web/src/app/routes/ingest.tsx` (as mounted by `context.tsx`) to the same
two-phase client contract in this task: preview, render kept/unread, then distinct
confirmation with the exact title/text/token and `purpose: 'memory'`. Preserve its Memory-page UX and
the accepted/searchable/indeterminate truth; remove every direct legacy
`{title,text}` POST. Test both Memory and onboarding callers so the server change
cannot strand an existing product route.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/onboarding-api.test.ts tests/unit/workspace-api.test.ts tests/unit/ingest-source.test.ts tests/unit/extract.test.ts tests/unit/web-product-contracts.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 7: Commit the preview boundary**

```bash
git add src/api/extraction-preview.ts src/api/onboarding-preview-token.ts src/api/ingest.ts src/api/workspace.ts src/api/router.ts api/index.ts web/src/app/routes/ingest.tsx web/src/app/routes/context.tsx tests/unit/onboarding-api.test.ts tests/unit/workspace-api.test.ts tests/unit/ingest-source.test.ts tests/unit/web-product-contracts.test.ts
git commit -m "feat(onboarding): preview private memory before ingest"
```

---

### Task 2: Searchability and real suggested-question readiness

**Files:**
- Create: `src/api/onboarding-attempt-store.ts`
- Modify: `src/api/ingest.ts`
- Modify: `src/api/workspace.ts`
- Modify: `src/api/router.ts`
- Modify: `src/connectors/files.ts`
- Modify: `api/index.ts`
- Modify: `web/src/api/client.ts`
- Test: `tests/unit/ingest-source.test.ts`
- Test: `tests/unit/onboarding-api.test.ts`
- Test: `tests/unit/workspace-api.test.ts`
- Create: `tests/unit/onboarding-attempt-store.test.ts`
- Test: `tests/unit/connectors-files.test.ts`

**Interfaces:**
- Extends: existing `IngestPreparedOptions` with one absolute deadline and `maxRecords: 25`
- Reuses: aggregate `IngestPreparedReport.searchable` / `indexing` without exposing Hydra ids
- Adds: `GET /api/workspace/questions` backed by bounded live workspace claims
- Adds: `GET /api/workspace/onboarding/attempt` backed by a durable active-attempt pointer
- Consumes: `HydraCloud.waitForIndexing(ids, options)` under the same settlement deadline

- [ ] **Step 1: Add a queued-receipt readiness regression**

Use a fake cloud that returns accepted `queued` receipts and later terminal
`completed` statuses. Assert `awaitSearchable: true` polls and reports
`searchable: true`. Add an accepted-but-readiness-deadline case that reports
`searchable: false` without claiming the write failed, and a submitted-write
transport-loss case that reports `indeterminate` rather than known zero. Prove
graph output above 25 records refuses before any write and every local queue or
Hydra call ends by the absolute deadline.

Write a dedicated attempt-store regression. Before the first workspace POST,
persist/read back a strict active pointer and attempt record keyed by a full
server-keyed owner digest and random opaque attempt id. Store only version,
keyed input digest, source kind, bounded internal expected record ids, state
`pending | indeterminate | searchable | failed`, safe counts/failure code, and
canonical timestamps in a dedicated non-workspace collection—never raw
workspace/email/title/text/file/token. Prove exact readback, account isolation,
malformed-record refusal, stale-update refusal, and that no workspace write runs
when the pending record cannot be confirmed.

- [ ] **Step 2: Add an API regression for delayed suggestions**

After a private ingest whose searchability deadline expires, assert the response
preserves accepted counts with `searchable: false` and UI-safe reconciliation
state. A submitted write with no exact receipt returns an explicit ambiguous
state. In either case the client disables Store for that digest and never
automatically resubmits. After terminal completion, assert
`GET /api/workspace/questions` returns at most three deterministic suggestions
from real live non-slot claims. Distinguish `401` session loss,
`503` provider/indexing uncertainty, and an honest `200 []`; never turn failure
into empty. Private Ask must return evidence only through the authenticated
workspace route.

Resume must first call `GET /api/workspace/onboarding/attempt`. A visible
pending/indeterminate attempt disables Store even after refresh, bfcache,
another tab, or server process loss. The status route rechecks its bounded
internal expected ids in the current account collection under one deadline:
all completed becomes `searchable`; a known pre-submit/refused zero becomes
`failed`; missing/partial state after a possibly dispatched POST remains
`indeterminate`, never empty/failed. Only a conclusively failed attempt may
enable a new Store automatically; ambiguous retry requires a new explicit user
confirmation and deterministic-upsert copy, never an automatic request.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/ingest-source.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/workspace-api.test.ts tests/unit/connectors-files.test.ts --maxWorkers=1`

Expected: missing options/report fields.

- [ ] **Step 4: Implement bounded indexing readiness**

Capture one 235-second server settlement deadline before body acquisition and
schedule backward: reserve the final 20 seconds for attempt-state update/exact
readback, the preceding 30 seconds for readiness, at most 120 seconds for the
single workspace Hydra POST, the preceding 20 seconds for pending attempt+
pointer writes/exact readback, and 20 seconds for the bounded workspace queue
plus pre-write index/entity reads. Body/token/quota/local preparation is at most
10 seconds; 15 seconds remain as internal scheduling margin. No phase borrows a
reserved tail, and workspace submission is refused unless at least 170 seconds
remain. Pass the remaining budget/signal through production composition in
`api/index.ts`. Set the browser mutation timeout above the complete server
budget (250 seconds), while keeping
abort/account-swap cancellation distinct from a server-side indeterminate
receipt. Collect accepted record ids only internally and validate complete
receipts. Mark `searchable` only when every accepted id reaches `completed`;
keep confirmed queued/time-limited writes accepted but not searchable. Return
only aggregate counts/state—never Hydra ids or collection names.

Implement the question index in `src/api/workspace.ts` from the exact
workspace-scoped current claim views used by Ask. Exclude slot/synthetic,
historical, retracted, contradicted, malformed, and missing-evidence claims;
stable-sort and cap the provider reads and serialized response at three items.

Implement `CloudOnboardingAttemptStore` with bounded process-local mutation
ordering and exact Hydra readback; do not claim cross-instance CAS. Derive
record addresses with a separate HMAC domain from the validated preview root
key. The text store and onboarding-marked file import prepare their deterministic
graph ids, persist/read back `pending`, then submit. They update the attempt
after exact receipt/readiness; transport uncertainty writes `indeterminate` if
possible but never downgrades confirmed acceptance. If handler settlement is
lost, the pre-existing pending record remains the recovery source. File
multipart gains only one exact bounded onboarding-purpose marker; normal
connector imports do not replace the onboarding active pointer.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/ingest-source.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/workspace-api.test.ts tests/unit/connectors-files.test.ts tests/unit/context-failure-api.test.ts --maxWorkers=1`

Expected: all tests pass and private context failures remain fail-closed.

- [ ] **Step 6: Commit searchability readiness**

```bash
git add src/api/onboarding-attempt-store.ts src/api/ingest.ts src/api/workspace.ts src/api/router.ts src/connectors/files.ts api/index.ts web/src/api/client.ts tests/unit/ingest-source.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/workspace-api.test.ts tests/unit/connectors-files.test.ts
git commit -m "feat(onboarding): wait for first memory to become searchable"
```

---

### Task 3: Resumable three-phase onboarding state machine

**Files:**
- Modify: `src/auth/accounts.ts`
- Modify: `src/auth/store.ts`
- Modify: `src/api/router.ts`
- Create: `web/src/onboarding/state.ts`
- Modify: `web/src/onboarding/Onboarding.tsx`
- Modify: `web/src/api/session.tsx`
- Modify: `web/src/landing/account-actions.ts`
- Test: `tests/unit/onboarding-state.test.ts`
- Test: `tests/unit/web-product-contracts.test.ts`
- Test: `tests/unit/landing-session.test.ts`
- Test: `tests/unit/auth-api.test.ts`
- Test: `tests/unit/web-auth-client.test.ts`

**Interfaces:**
- Produces: `OnboardingPhase = 'workspace' | 'memory' | 'ask' | 'complete'`
- Produces: `initialOnboardingState(session, questions): OnboardingState`
- Produces: pure `advanceOnboarding(state, event): OnboardingState`
- Adds: `POST /api/workspace/onboarding/complete` with exact readback
- Consumes: `/api/workspace`, `/api/workspace/ingest/preview`, `/api/workspace/ingest`, `/api/workspace/questions`

- [ ] **Step 1: Write state-machine regressions**

```ts
it('does not recreate a durable workspace after ingest failure', () => {
  let state = initialOnboardingState({ workspace: null, onboarded: false }, []);
  state = advanceOnboarding(state, { type: 'workspace_created', name: 'Atlas' });
  state = advanceOnboarding(state, { type: 'ingest_failed', message: 'retry' });
  expect(state.phase).toBe('memory');
  expect(state.workspaceCreated).toBe(true);
});

it('resumes at Ask when an unfinished workspace has real questions', () => {
  const state = initialOnboardingState({ workspace: 'Atlas', onboarded: false }, [QUESTION]);
  expect(state.phase).toBe('ask');
});
```

Cover empty-workspace resume, durable completed legacy/current accounts, explicit
skip before and after refresh, example insertion without storage, preview
success, `indexing_pending`, ambiguous ingest, terminal answer completion, Back,
refresh, and account-binding change. A session with `onboarded: true` is complete;
workspace presence alone never is.

- [ ] **Step 2: Update source-contract tests for consequential steps**

Remove assertions for the old five status slides. Require `CREATE WORKSPACE`,
`ADD FIRST MEMORY`, `ASK WITH EVIDENCE`, explicit `USE AN EXAMPLE`, and explicit
`SKIP FOR NOW`. Forbid any effect that posts the example on mount. Add rendered
tests for semantic labels/forms, `aria-live` progress/errors, deterministic
focus after phase/error changes, keyboard Back/Skip/Store/Ask, disabled/busy
double-submit protection, and no horizontal blocking at 320 CSS pixels.

- [ ] **Step 3: Run state/UI tests and verify RED**

Run: `npx vitest run tests/unit/onboarding-state.test.ts tests/unit/web-product-contracts.test.ts --maxWorkers=1`

Expected: state module and new UI contract are absent.

- [ ] **Step 4: Implement phase one and durable resume**

Change workspace creation so it never flips `onboarded` to true. Preserve legacy
accounts that already have `onboarded: true`. Post the workspace once, await a
`session.refresh()` that returns the validated new `SessionState`, and transition
to memory. On mount: `onboarded: true` is complete; otherwise workspace-null is
workspace, and workspace-present first reads the durable active attempt.
Pending/indeterminate resumes at reconciliation with Store disabled; searchable
then fetches questions and resumes Ask; conclusively failed/no attempt resumes
Memory; store/provider failure is an explicit retryable system state, never
empty. Workspace failure stays in workspace; later
failures never call workspace creation again.

Harden workspace creation itself with configured exact Origin, CSRF, current
session, matching session binding, exact body, and a bounded workspace-keyed
mutation quota before parsing/mutation; revalidate the account immediately
before its exact-readback write. Wrong Origin, stale binding, quota exhaustion,
or account swap performs zero mutation.

Add exact `POST /api/workspace/onboarding/complete` body
`{ outcome: 'asked' | 'skipped' }`. Require configured exact Origin, CSRF,
current session, session binding, and a bounded account mutation; persist
`onboarded: true`, perform exact readback, then refresh. The UI calls it only
after a qualifying evidence-backed private Ask or an explicit Skip and does not render completion
until readback succeeds.

- [ ] **Step 5: Implement paste preview and explicit store**

Keep title/text and the preview token in component memory only, call preview,
render kept and unread sentences, and enable `STORE THIS MEMORY` only when the
latest binding-matched preview has at least one kept statement. Send the exact
same title/text plus `previewToken` to private ingest with
`awaitSearchable: true` and `purpose: 'onboarding'`. For accepted-but-unsearchable or indeterminate results,
retain the text, disable Store for that digest, enter a visible reconciliation
state, and never automatically resubmit.

`USE AN EXAMPLE` inserts labelled editable text only. `SKIP FOR NOW` calls the
durable completion endpoint; only its exact-readback success transitions to a
truthful empty state with Memory or Connectors navigation.

- [ ] **Step 6: Integrate file preparation from the connector plan**

Keep the selected `File` object in component state. Call
`/api/workspace/connectors/file/preview`, render its extraction preview, then
resend the same file and server-issued file preview token to
`/api/workspace/connectors/file/import` with the one exact bounded
`purpose=onboarding` multipart marker only after explicit confirmation. Apply
the same accepted/unsearchable/indeterminate reconciliation state and never
automatic retry. Do not create a second parser/upload contract. On refresh,
state plainly that a local file must be selected again.

- [ ] **Step 7: Fetch at most three real suggestions**

After searchable ingest, poll `/api/workspace/questions` for up to 15 seconds
with capped backoff. Store at most three returned entries; if none arrive,
distinguish honest empty from provider/indexing failure and never invent a
question or invite a duplicate write.

- [ ] **Step 7a: Make session and cross-tab changes monotonic**

Make `refresh()` return the validated `SessionState`; serialize or
generation-guard overlapping reads so an older response cannot overwrite a
newer account. Refresh on `visibilitychange`/`pageshow` and a payload-free auth
`BroadcastChannel` event. Key the onboarding subtree by `session.binding`.
Abort and discard every preview, ingest, file, question, and answer operation
when that binding changes; clear all local source/file/token/suggestion state.
Test swap during preview/ingest/question, two-tab sign-out/sign-in, stale
response, browser Back, and bfcache restore.

- [ ] **Step 8: Run state/UI tests and verify GREEN**

Run: `npx vitest run tests/unit/onboarding-state.test.ts tests/unit/web-product-contracts.test.ts tests/unit/web-auth-client.test.ts tests/unit/landing-session.test.ts tests/unit/auth-api.test.ts --maxWorkers=1`

Expected: all tests pass.

- [ ] **Step 9: Commit the three-phase flow**

```bash
git add src/auth/accounts.ts src/auth/store.ts src/api/router.ts web/src/onboarding/state.ts web/src/onboarding/Onboarding.tsx web/src/api/session.tsx web/src/landing/account-actions.ts tests/unit/onboarding-state.test.ts tests/unit/web-product-contracts.test.ts tests/unit/landing-session.test.ts tests/unit/auth-api.test.ts tests/unit/web-auth-client.test.ts
git commit -m "feat(onboarding): guide first memory into a real answer"
```

---

### Task 4: Inline private answer and evidence

**Files:**
- Modify: `src/api/router.ts`
- Modify: `api/index.ts`
- Create: `web/src/app/AnswerEvidence.tsx`
- Modify: `web/src/app/routes/Ask.tsx`
- Modify: `web/src/onboarding/Onboarding.tsx`
- Modify: `web/src/api/client.ts`
- Test: `tests/unit/web-product-contracts.test.ts`
- Test: `tests/unit/onboarding-state.test.ts`
- Test: `tests/unit/workspace-api.test.ts`

**Interfaces:**
- Produces: shared `AnswerEnvelope`, `AnswerEvidenceItem`, and `AnswerEvidence` component
- Adds: authenticated `POST /api/workspace/ask` and public `POST /api/explore/ask`
- Removes: ambiguous `/api/ask` fallback behavior
- Requires: evidence `quote`, `source`, `meta`, and `standing`

- [ ] **Step 1: Add shared-evidence contract assertions**

Require Ask and Onboarding to import the same component. Require the client
evidence type to include `quote`, and require the rendered evidence card to show
that quote rather than only source metadata. Prove `/api/workspace/ask` requires
exact configured Origin, CSRF, current session, matching session binding, and a
dedicated workspace-keyed Ask quota before body/query. An expired session,
workspace label `acme / backend`, or account swap must never return public
answers/evidence. `/api/explore/ask` is the only public Ask boundary; legacy
`/api/ask` refuses rather than guessing scope.

Add completion-predicate tests: `ANSWERED`, `PARTIAL`, and evidence-backed
`CONFLICT` with nonempty strictly decoded evidence may complete; `SYSTEM_ERROR`,
`NO_EVIDENCE`, empty/malformed evidence, transport/decode failure, and discarded
account epochs must make zero completion calls.

- [ ] **Step 2: Run the UI contracts and verify RED**

Run: `npx vitest run tests/unit/web-product-contracts.test.ts tests/unit/onboarding-state.test.ts tests/unit/workspace-api.test.ts --maxWorkers=1`

Expected: shared answer component and quote field are absent.

- [ ] **Step 3: Extract the answer renderer**

Move status, answer, abstention/conflict copy, evidence toggle, citations,
revisions, and trace metadata from `Ask.tsx` into `AnswerEvidence.tsx`. Preserve
the explicit private/public UX while routing by scope to
`/api/workspace/ask` or `/api/explore/ask`. Add the evidence quote to the typed
envelope and render it as inert text. Every response is generation/binding
checked before render.

- [ ] **Step 4: Execute a suggestion inside onboarding**

Post `{ subject, predicate, via }` from the selected server suggestion to
`/api/workspace/ask` with the current binding. Render loading, answer,
abstention, conflict, or fail-closed system error through `AnswerEvidence`.
Only a binding-matched authenticated 2xx envelope with status `ANSWERED` or
`PARTIAL`, or an evidence-backed `CONFLICT`, and at least one strictly decoded
nonempty evidence item qualifies. Then call the durable onboarding-complete
endpoint with `outcome: 'asked'`; only exact readback exposes `OPEN LACUNA`.
`SYSTEM_ERROR`, `NO_EVIDENCE`, transport/decode failure, empty evidence, or a
discarded epoch never calls completion and keeps Ask retry/explicit Skip visible.
Completion navigates to the relevant Ask or Memory route. Session loss/account
swap aborts and discards the answer and completion call.

- [ ] **Step 5: Run all onboarding and Ask regressions**

Run: `npx vitest run tests/unit/onboarding-api.test.ts tests/unit/onboarding-state.test.ts tests/unit/workspace-api.test.ts tests/unit/web-product-contracts.test.ts tests/unit/workspace-memory-standing.test.ts --maxWorkers=1`

Expected: all tests pass.

- [ ] **Step 6: Commit shared evidence**

```bash
git add src/api/router.ts api/index.ts web/src/app/AnswerEvidence.tsx web/src/app/routes/Ask.tsx web/src/onboarding/Onboarding.tsx web/src/api/client.ts tests/unit/workspace-api.test.ts tests/unit/web-product-contracts.test.ts tests/unit/onboarding-state.test.ts
git commit -m "feat(onboarding): show first private answer with evidence"
```

---

### Task 5: Workspace routing and production first-run proof

**Files:**
- Create: `web/src/app/RequireWorkspace.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/auth/SignIn.tsx`
- Modify: `web/src/auth/SignUp.tsx`
- Modify: `web/src/auth/Forgot.tsx`
- Modify: `web/src/landing/account-actions.ts`
- Modify: `web/src/app/routes/Dashboard.tsx`
- Create: `scripts/smoke-onboarding.ts`
- Test: `tests/unit/web-product-contracts.test.ts`
- Test: `tests/unit/auth-api.test.ts`

**Interfaces:**
- Produces: `RequireWorkspace` redirect for authenticated sessions with `onboarded === false`
- Produces: `npm run smoke:onboarding`

- [ ] **Step 1: Add routing regressions**

Require every authenticated `onboarded: false` session—workspace null or
present—to reach `/onboarding`; require `onboarded: true` legacy/current sessions
to keep `/app/*`. Require password sign-in, Google callback, recovery, landing,
home return, and direct `/app/*` navigation to choose from the refreshed
`session.onboarded` value, never workspace presence or a cached browser flag.

- [ ] **Step 2: Run routing tests and verify RED**

Run: `npx vitest run tests/unit/web-product-contracts.test.ts tests/unit/auth-api.test.ts --maxWorkers=1`

Expected: the workspace guard is absent and success paths still route directly to dashboard.

- [ ] **Step 3: Implement the workspace guard and empty-state links**

Wrap `/app` and `/app/:route` with `RequireWorkspace`. Hold while session is
loading/failed; redirect current unfinished sessions to `/onboarding`; allow
completed sessions through. Preserve `/onboarding` for unfinished users and
permit completed users to open it deliberately without resetting durable state.
Key the guarded onboarding element by session binding so account swaps remount
cleanly. Update dashboard empty actions to real Memory and Connectors routes
only after those surfaces exist.

- [ ] **Step 4: Add the serial smoke script**

The script accepts a base URL and disposable test credentials from environment,
then performs session read, workspace create with the literal label
`acme / backend`, source preview/token, explicit source ingest with readiness,
question fetch, structured `/api/workspace/ask`, evidence assertion, durable
completion, homepage return, and a fresh second session read. It also proves an
expired session cannot access private questions/Ask and, when a second disposable
identity is supplied, an account swap sees no first-account data. It must redact
cookies, CSRF/session-binding values, emails, collection names, source bodies,
tokens, and provider responses from output.

Add `"smoke:onboarding": "tsx scripts/smoke-onboarding.ts"` to root `package.json`.

- [ ] **Step 5: Run local gates**

Run: `npm run typecheck`

Run: `npm --prefix web run typecheck`

Run: `npm run build`

Run: `npx vitest run tests/unit/onboarding-api.test.ts tests/unit/onboarding-state.test.ts tests/unit/workspace-api.test.ts tests/unit/auth-api.test.ts tests/unit/landing-session.test.ts tests/unit/web-auth-client.test.ts tests/unit/web-product-contracts.test.ts --maxWorkers=1`

Expected: all commands exit zero.

- [ ] **Step 6: Production-test after the combined preview deployment**

Use a fresh authorized test identity or a clean dedicated test account. Complete
Google/password entry as applicable, workspace creation, preview, explicit
store, suggested private Ask, evidence display, completion, homepage return,
hard refresh, bfcache Back/Forward, visibility restore, and a second-tab session
revalidation in the browser at desktop and 320 CSS-pixel layouts. Verify focus,
keyboard operation, live errors, and file-reselection disclosure. Run the smoke
script against the immutable deployment and capture only redacted states/statuses.

- [ ] **Step 7: Commit the first-run gate**

```bash
git add web/src/app/RequireWorkspace.tsx web/src/App.tsx web/src/auth/SignIn.tsx web/src/auth/SignUp.tsx web/src/auth/Forgot.tsx web/src/landing/account-actions.ts web/src/app/routes/Dashboard.tsx scripts/smoke-onboarding.ts package.json tests/unit/web-product-contracts.test.ts tests/unit/auth-api.test.ts tests/unit/landing-session.test.ts tests/unit/web-auth-client.test.ts
git commit -m "feat(onboarding): enforce and verify first workspace setup"
```
