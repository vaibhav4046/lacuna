# First-Run Private Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a newly authenticated user create a workspace, preview and store a real first source, and execute a suggested private question with evidence before entering the main shell.

**Architecture:** A pure onboarding state machine derives its resume phase from a durable account completion bit and a real workspace question index. A new authenticated preview route shares normalization and extraction with private ingest but never writes, then issues a short-lived session/workspace/input-bound token that the store route must consume. Authenticated reads always use `workspaceCollection(account.email)`; the user-chosen workspace label is presentation only, and only explicit `/api/explore/*` routes may access the public corpus. The onboarding UI reuses the connector file-preparation path and explicit private question/Ask APIs rather than creating a second memory system.

**Tech Stack:** TypeScript, React, HydraDB Cloud, a dedicated persistence-backed Redis service, existing JSON/CSRF client, Vitest.

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
- Task 2 starts only after connector Task 6 is complete: it consumes the reviewed deadline-aware `HydraCloud.ingestApp`, `ConnectorRunner`, readiness/max-record, and indeterminate-receipt controls rather than reimplementing them.
- An exact Hydra receipt is durable `accepted` truth even before indexing completes; timeout or transport uncertainty can never downgrade it to `indeterminate` or `failed`.
- Onboarding attempt state uses a dedicated authenticated-TLS Redis database with persistence enabled and `noeviction`; runtime never creates or repairs its administrative metadata automatically.
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
- Create: `src/api/onboarding-attempt-redis.ts`
- Modify: `src/api/ingest.ts`
- Modify: `src/api/workspace.ts`
- Modify: `src/api/router.ts`
- Modify: `src/connectors/files.ts`
- Modify: `src/connectors/preview-token.ts`
- Modify: `api/index.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/connectors.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/onboarding-redis-admin.ts`
- Test: `tests/unit/ingest-source.test.ts`
- Test: `tests/unit/onboarding-api.test.ts`
- Test: `tests/unit/workspace-api.test.ts`
- Create: `tests/unit/onboarding-attempt-store.test.ts`
- Create: `tests/unit/onboarding-redis-admin.test.ts`
- Create: `tests/integration/onboarding-attempt-redis.test.ts`
- Test: `tests/unit/connectors-files.test.ts`
- Test: `tests/unit/web-connectors-client.test.ts`

**Interfaces:**
- Extends: existing `IngestPreparedOptions` with one absolute deadline and `maxRecords: 25`
- Reuses: aggregate `IngestPreparedReport.searchable` / `indexing` without exposing Hydra ids
- Adds: `GET /api/workspace/questions` backed by bounded live workspace claims
- Adds: `GET /api/workspace/onboarding/attempt` backed by a durable active-attempt pointer
- Produces: one atomic fixed-size per-owner `RedisOnboardingAttemptStore`
- Produces: atomic `begin`, `retryIndeterminate`, `finalize`, `reconcile`, and `retireIfActive` scripts over one owner record plus one fixed metadata record
- Produces: `npm run onboarding:redis:init|audit|rotate` through one redacting administration CLI
- Consumes: Task 6 absolute deadline/readiness/max-record controls through `ConnectorRunner`
- Consumes: `HydraCloud.waitForIndexing(ids, options)` under the same settlement deadline

- [ ] **Step 1: Add a queued-receipt readiness regression**

Use a fake cloud that returns accepted `queued` receipts and later terminal
`completed` statuses. Assert `awaitSearchable: true` polls and reports
`searchable: true`. Add an accepted-but-readiness-deadline case that reports
`searchable: false` without claiming the write failed, and a submitted-write
transport-loss case that reports `indeterminate` rather than known zero. Prove
graph output above 25 records refuses before any write and every local queue or
Hydra call ends by the absolute deadline.

Write a dedicated attempt-store regression against two independent store
instances. Production uses one authenticated TLS Redis connection dedicated to
onboarding operational state; missing/invalid configuration returns `503` and
performs zero workspace writes. One fixed owner-keyed record is both active
pointer and state, and one fixed versioned metadata record tracks the exact key
fingerprint and count of non-retired owner records. Every mutation is one Lua
compare-and-set over those two keys, which share one Redis cluster hash tag. The
owner record stores only schema version, full keyed owner/input digests, random
opaque attempt id, exact purpose/source kind, at most 25 internal expected record
ids, generation/attempt count, state `pending | indeterminate | accepted |
searchable | failed | retired`, safe counts/failure code, an optional bounded
retry lease, and canonical timestamps—never raw workspace/email/title/text/file/
token. `retired` is a permanent minimal tombstone that drops the input digest,
expected ids, lease, counts, and failure detail but preserves owner digest,
generation, attempt count, and retirement time.

Transitions are atomic and monotonic. The only ordinary transitions are
`pending -> failed | indeterminate | accepted | searchable`, `indeterminate ->
accepted | searchable`, `accepted -> searchable`, and any non-retired state to
`retired`; `searchable` and `retired` otherwise reject finalization. An exact,
complete Hydra receipt first writes `accepted` plus the accepted-id subset and
safe accepted/refused counts before readiness is reported. `accepted` remains
accepted on readiness timeout/error and rejects every late `indeterminate` or
`failed` write. `failed` may begin a new generation only through explicit
confirmation. Keep exactly one fixed-size record per owner, count the initial
begin, every failed-generation begin, and every indeterminate retry toward one
lifetime maximum of eight, and refuse N+1.

Define atomic `retryIndeterminate(owner, generation, attemptId, inputDigest,
purpose, sourceKind, expectedIds, leaseId, leaseExpiresAt)`. It requires a newly
issued and consumed preview token whose current session/workspace/purpose/input
binding matches the unresolved record exactly, preserves the same generation,
attempt id and expected ids, increments the attempt count, and installs one
random retry lease ending no later than the request settlement deadline. While
an unexpired lease exists every competing retry refuses; after expiry a fresh
token may acquire a new lease. Retry submission keeps state `indeterminate`
until an exact receipt promotes it to `accepted/searchable`; another uncertain
result only clears its matching lease and may not alter confirmed counts.

Never replace an unresolved generation. Completion/explicit Skip atomically
retires it and decrements metadata `activeCount` exactly once; owner records are
never deleted during normal runtime and have no TTL. Test cross-instance
interleavings so accepted always wins an accepted-vs-indeterminate race, late
failed/indeterminate updates cannot downgrade accepted/searchable, concurrent
begin has one visible winner, only one retry lease is live, expired-lease retry
requires a fresh matching token, a retry preserves ids, attempt N+1 refuses, an
unresolved attempt cannot be displaced, retirement is idempotent, late finalize
against a missing/retired/wrong-generation record refuses without recreation or
metadata change, malformed/oversized records fail closed, and pending creation
must be confirmed before any workspace write.

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
pending/indeterminate/accepted attempt disables Store even after refresh,
bfcache, another tab, or server process loss. The status route rechecks its
bounded internal accepted/expected ids in the current account collection under
one deadline: all accepted ids completed becomes `searchable`; an exact receipt
or provider status proving acceptance remains `accepted` while indexing is
incomplete; a known pre-submit/refused zero becomes `failed`; missing/partial
state after a possibly dispatched POST may promote `pending` to `indeterminate`
but can never demote `accepted`. Only a conclusively failed attempt may enable a
new generation automatically. An ambiguous retry is a distinct explicit action:
re-preview the retained text or reselected file, require a fresh matching token,
acquire `retryIndeterminate` for the same record, and make one deterministic-
upsert copy. It is never an automatic request and never replaces the unresolved
record.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/ingest-source.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/onboarding-redis-admin.test.ts tests/unit/workspace-api.test.ts tests/unit/connectors-files.test.ts tests/unit/web-connectors-client.test.ts --maxWorkers=1`

Expected: missing options/report fields, Redis store, and administration CLI.

- [ ] **Step 4: Implement bounded indexing readiness**

Capture one 210-second server settlement deadline before body acquisition and
schedule backward: reserve the final five seconds for the atomic attempt-state
transition/readback, the preceding 30 seconds for readiness, at most 120 seconds
for the single workspace Hydra POST, the preceding five seconds for atomic
pending-attempt creation/readback, and 20 seconds for the bounded workspace
queue plus pre-write index/entity reads. Body/token/quota/local preparation is
at most 10 seconds; 20 seconds remain as internal scheduling margin. No phase borrows a
reserved tail, and workspace submission is refused unless at least 170 seconds
remain. Pass the remaining budget/signal through production composition in
`api/index.ts`. Set the browser mutation timeout above the complete server
budget (225 seconds) in both JSON and file connector clients, while keeping
abort/account-swap cancellation distinct from a server-side indeterminate
receipt. Collect accepted record ids only internally and validate complete
receipts. Mark `searchable` only when every accepted id reaches `completed`;
keep confirmed queued/time-limited writes accepted but not searchable. Return
only aggregate counts/state—never Hydra ids or collection names.

Implement the question index in `src/api/workspace.ts` from the exact
workspace-scoped current claim views used by Ask. Exclude slot/synthetic,
historical, retracted, contradicted, malformed, and missing-evidence claims;
stable-sort and cap the provider reads and serialized response at three items.

Implement `RedisOnboardingAttemptStore` through audited atomic scripts and
bounded abort/deadline-aware calls; every call must end inside its five-second
phase. The only Redis keys are exact fixed meta key
`lacuna:onboarding:{attempt-v1}:meta` and server-derived owner key
`lacuna:onboarding:{attempt-v1}:owner:<64-lowercase-hex-owner-digest>`. The common
hash tag makes every meta+owner Lua mutation single-slot even on Redis Cluster.
No route/client supplies a Redis key. Define HMAC framing as UTF-8 domain followed
by each UTF-8 field prefixed with an unsigned four-byte big-endian byte length.
Use exact independent domains `lacuna:onboarding:owner:v1\0`,
`lacuna:onboarding:input:v1\0`, and
`lacuna:onboarding:key-fingerprint:v1\0`; the fingerprint is the lowercase-hex
HMAC of the zero-field fingerprint frame. The owner frame has exactly the
trimmed/lowercased authenticated account email. The input frame has exactly
purpose, source kind, and canonical token-bound input digest: text uses
`sourceInputDigest(prepared)`, while file uses the SHA-256 of the same framed raw
digest, normalized digest, parser version, type, and title carried by
`FilePreviewBinding`. Workspace labels and all caller-provided owner identifiers
are excluded.

The meta value is a strict at-most-2-KiB record
`{ schema: 1, status: 'ready' | 'rotation_pending', keyFingerprint,
activeCount, keyEpoch, createdAt, updatedAt, rotationNonce?,
nextKeyFingerprint?, nextKeyEpoch? }`. `activeCount` is
the number of non-retired owner records. Begin from a missing owner increments it;
idempotent retirement decrements it once and replaces the owner value with its
minimal permanent tombstone. Every runtime script first validates that meta
exists, is schema 1/`ready`, has the current key fingerprint and a safe nonnegative
count. Missing, malformed, fingerprint-mismatched, or `rotation_pending` meta is
catastrophic operational unavailability: attempt-dependent routes return `503`,
perform zero workspace writes, never synthesize/reset meta, and never treat the
owner as absent. A completed account's session read remains authoritative and
returns normally when its bounded cleanup observes this unavailability.

Parse only a dedicated `LACUNA_ONBOARDING_REDIS_URL`: require authenticated
`rediss:`, normal certificate/hostname validation, and a database dedicated to
this feature; never fall back to generic/local Redis, Hydra, session, or preview
credentials. The deployment must prove `maxmemory-policy=noeviction`, AOF enabled
with `appendfsync=always`, and healthy persistence before initialization. Runtime
performs a bounded five-second connect/auth/TLS, `PING`, persistence/policy, and
meta/fingerprint probe before exposing mutation routes; probe failure leaves the
complete onboarding service unavailable and never auto-initializes it. Use one
bounded singleton connection, fixed-key commands and audited scripts only—no
`KEYS`, `SCAN`, pub/sub, caller-supplied key, unbounded command retry, offline
queue, or reconnect queue. Cap an owner value at 16 KiB and a meta value at 2 KiB,
and redact URL/host/credentials, secrets/fingerprints, script arguments, owner/
workspace ids, and expected record ids from responses/logs/errors.

Parse `LACUNA_ONBOARDING_KEY` with no trimming: it is valid only when the source
string is exactly 64 lowercase hexadecimal characters and decodes/round-trips to
exactly 32 bytes. Reject uppercase, whitespace, prefixes, padding, base64, short,
long, or ambiguous forms. `.env.example` documents it as server-only and gives
the exact generation command:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex') + '\\n')"
```

It also documents destructive rotation and never contains a value.
The complete onboarding service is absent unless Redis, meta probe, onboarding
key, preview-token service, governed runner, and site origin are all valid.

Implement `scripts/onboarding-redis-admin.ts` with redacted, noninteractive
`keygen`, `init --confirm-dedicated-empty`, `audit`, and
`rotate --confirm-destructive` subcommands and expose them as
`onboarding:redis:keygen|init|audit|rotate` package scripts. Add
`test:onboarding-redis` for the explicit production-script integration test.
`init` refuses unless
the dedicated database is empty, TLS/auth/persistence/noeviction checks pass, and
the fixed meta `SET NX` exact readback succeeds; runtime never calls it. `audit`
does no scan and reports only schema/status, key-fingerprint match, active count,
key epoch, and policy/persistence health. Rotation reads a separate exact-format
`LACUNA_ONBOARDING_NEXT_KEY`, and one Lua step changes meta to
`rotation_pending` only when current fingerprint/version match and
`activeCount === 0`; otherwise it atomically refuses. That state blocks all
runtime operations. Because the service is dedicated, the confirmed command then
uses `FLUSHDB SYNC` (not a scan), creates/read-backs fresh schema-1 `ready` meta
with the next fingerprint and incremented key epoch, and zeroizes in-process old/
next key buffers. Retired tombstones are permanent during normal operation; this
audited zero-active destructive rotation is their only deletion path. A crash
before or during reset leaves `rotation_pending` or missing meta and therefore
runtime `503`; rerunning the explicit rotate command with both keys resumes by
rotation nonce. No automatic init/recovery is permitted.

The exact operator sequence is:

```bash
npm run onboarding:redis:init -- --confirm-dedicated-empty
npm run onboarding:redis:audit
LACUNA_ONBOARDING_NEXT_KEY=<64-lowercase-hex> npm run onboarding:redis:rotate -- --confirm-destructive
npm run onboarding:redis:audit
```

`LACUNA_ONBOARDING_NEXT_KEY` is accepted only by the administration process,
never by runtime composition, and is never printed. A rotation resume uses the
same rotate command with current and next keys; `rotation_pending` validates its
stored nonce/next fingerprint, while a post-flush missing-meta resume additionally
requires an empty dedicated database. Any other missing-meta state requires an
explicit incident decision and remains `503`.

Consume Task 6's deadline-aware `HydraCloud.ingestApp`, `ConnectorRunner`,
readiness, `maxRecords: 25`, and indeterminate-submission controls. The text
store and onboarding-marked file import prepare deterministic graph ids,
atomically begin/read back `pending`, then submit. A complete exact receipt first
finalizes `accepted` with accepted ids/counts; readiness may then promote it to
`searchable`. Transport uncertainty may move only `pending` to `indeterminate`.
If handler settlement is lost, the pre-existing pending record remains the
recovery source. File preview and import both require one exact purpose
`onboarding | connector`, authenticated inside `FilePreviewBinding`; cross-
purpose reuse refuses before runner/state work. Normal connector imports never
replace the onboarding owner record.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/ingest-source.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/onboarding-redis-admin.test.ts tests/unit/workspace-api.test.ts tests/unit/connectors-files.test.ts tests/unit/web-connectors-client.test.ts tests/unit/context-failure-api.test.ts --maxWorkers=1`

Run against a disposable dedicated persistence/noeviction Redis configured in
`LACUNA_TEST_ONBOARDING_REDIS_URL`:

`npm run test:onboarding-redis`

The integration test executes the production Lua, uses two independent clients,
and covers meta absence/mismatch, begin/finalize/reconcile races, accepted versus
indeterminate ordering, retry lease expiry/contention, retirement/late finalize,
N+1 refusal, persistence/noeviction probe failure, init/audit, zero-active
rotation, active-count rotation refusal, and crash/resume rotation states. Missing
test Redis configuration fails this explicit gate rather than silently skipping.

Expected: all tests pass and private context/Redis failures remain fail-closed.

- [ ] **Step 6: Commit searchability readiness**

```bash
git add src/api/onboarding-attempt-store.ts src/api/onboarding-attempt-redis.ts src/api/ingest.ts src/api/workspace.ts src/api/router.ts src/connectors/files.ts src/connectors/preview-token.ts api/index.ts web/src/api/client.ts web/src/api/connectors.ts scripts/onboarding-redis-admin.ts .env.example package.json package-lock.json tests/unit/ingest-source.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/onboarding-redis-admin.test.ts tests/integration/onboarding-attempt-redis.test.ts tests/unit/workspace-api.test.ts tests/unit/connectors-files.test.ts tests/unit/web-connectors-client.test.ts
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
- Test: `tests/unit/onboarding-api.test.ts`
- Test: `tests/unit/onboarding-attempt-store.test.ts`

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
success, durable `accepted` indexing, ambiguous ingest and same-generation retry,
terminal answer completion, Back, refresh, and account-binding change. Cover
completion cleanup failure followed by idempotent cleanup from a fresh process/
session, permanent tombstone readback, and refusal of a late finalizer after
retirement. A session with `onboarded: true` is complete; workspace presence
alone never is.

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
Pending/indeterminate/accepted resumes at reconciliation with Store disabled;
searchable then fetches questions and resumes Ask; conclusively failed/no
attempt resumes Memory; retired while `onboarded: false`, missing/malformed meta,
or store/provider failure is an explicit fail-closed system state, never empty.
Workspace failure stays in workspace; later
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
until readback succeeds. After the account readback, atomically
`retireIfActive` into the permanent owner tombstone and decrement meta active
count exactly once. If retirement is temporarily unavailable, the account's
durable completed bit remains authoritative. The completion request makes at
most one bounded retry; every later authenticated session read/refresh for that
completed account idempotently retries the same five-second cleanup until it
observes the tombstone. Cleanup failure never changes the completed session
response and never launches a detached background promise. A late ingestion
finalizer for a missing, retired, wrong-attempt, or wrong-generation record must
refuse and must never recreate the owner record or alter meta.

- [ ] **Step 5: Implement paste preview and explicit store**

Keep title/text and the preview token in component memory only, call preview,
render kept and unread sentences, and enable `STORE THIS MEMORY` only when the
latest binding-matched preview has at least one kept statement. Send the exact
same title/text plus `previewToken` to private ingest with
`awaitSearchable: true` and `purpose: 'onboarding'`. For accepted-but-unsearchable
or indeterminate results, retain the text, disable Store for that digest, enter a
visible reconciliation state, and never automatically resubmit. A user-selected
indeterminate retry first obtains a fresh same-purpose/input preview token, then
acquires the bounded same-generation retry lease; token, digest, purpose, ids,
generation, or lease mismatch performs zero workspace writes.

`USE AN EXAMPLE` inserts labelled editable text only. `SKIP FOR NOW` calls the
durable completion endpoint; only its exact-readback success transitions to a
truthful empty state with Memory or Connectors navigation.

- [ ] **Step 6: Integrate file preparation from the connector plan**

Keep the selected `File` object in component state. Call
`/api/workspace/connectors/file/preview` with exact multipart
`purpose=onboarding`, render its extraction preview, then
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

Run: `npx vitest run tests/unit/onboarding-state.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/web-product-contracts.test.ts tests/unit/web-auth-client.test.ts tests/unit/landing-session.test.ts tests/unit/auth-api.test.ts --maxWorkers=1`

Expected: all tests pass.

- [ ] **Step 9: Commit the three-phase flow**

```bash
git add src/auth/accounts.ts src/auth/store.ts src/api/router.ts web/src/onboarding/state.ts web/src/onboarding/Onboarding.tsx web/src/api/session.tsx web/src/landing/account-actions.ts tests/unit/onboarding-state.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/web-product-contracts.test.ts tests/unit/landing-session.test.ts tests/unit/auth-api.test.ts tests/unit/web-auth-client.test.ts
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

Run: `npx vitest run tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/onboarding-redis-admin.test.ts tests/unit/onboarding-state.test.ts tests/unit/workspace-api.test.ts tests/unit/auth-api.test.ts tests/unit/landing-session.test.ts tests/unit/web-auth-client.test.ts tests/unit/web-connectors-client.test.ts tests/unit/web-product-contracts.test.ts --maxWorkers=1`

Expected: all commands exit zero.

- [ ] **Step 6: Production-test after the combined preview deployment**

Use a fresh authorized test identity or a clean dedicated test account. Complete
Google/password entry as applicable, workspace creation, preview, explicit
store, suggested private Ask, evidence display, completion, homepage return,
hard refresh, bfcache Back/Forward, visibility restore, and a second-tab session
revalidation in the browser at desktop and 320 CSS-pixel layouts. Verify focus,
keyboard operation, live errors, and file-reselection disclosure. Run the smoke
script against the immutable deployment and capture only redacted states/statuses.
Before the smoke, run `npm run onboarding:redis:audit` against the exact deployment
configuration and `npm run test:onboarding-redis` against a disposable equivalent
Redis; neither command may print endpoints, credentials, fingerprints, owner ids,
input ids, or record bodies. Exercise a deployment with missing meta and prove
onboarding mutation routes return `503` with zero workspace writes; restore only
through the explicit audited administration command, never runtime initialization.

- [ ] **Step 7: Commit the first-run gate**

```bash
git add web/src/app/RequireWorkspace.tsx web/src/App.tsx web/src/auth/SignIn.tsx web/src/auth/SignUp.tsx web/src/auth/Forgot.tsx web/src/landing/account-actions.ts web/src/app/routes/Dashboard.tsx scripts/smoke-onboarding.ts package.json tests/unit/web-product-contracts.test.ts tests/unit/auth-api.test.ts tests/unit/landing-session.test.ts tests/unit/web-auth-client.test.ts
git commit -m "feat(onboarding): enforce and verify first workspace setup"
```
