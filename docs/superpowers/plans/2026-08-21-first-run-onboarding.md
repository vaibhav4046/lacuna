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
- Every possibly dispatched onboarding write has a bounded Redis outbox/receipt entry keyed by owner generation plus random dispatch id before the Hydra call. That durable reservation is bound to the exact canonical payload, record kind, and provenance identity of every expected id; reconciliation never promotes mere id existence or provider status. Exact receipts and later byte-equivalent deterministic-record reads are monotonic accepted truth across every original/retry dispatch; a missing or mismatching record is never treated as proof that a dispatched write failed.
- Onboarding attempt state uses a dedicated authenticated-TLS Redis service with persistence enabled and `noeviction`; runtime never creates or repairs its administrative metadata automatically.
- Retry/maintenance lease timestamps and expiries come only from Redis `TIME` inside Lua. Application clocks and caller-supplied absolute timestamps never participate in Redis arbitration.
- Security maintenance may globally retire an abandoned owner epoch only after a fail-closed drain longer than the complete request budget. It is explicit, audited, user-visible, and never authorizes an automatic resend.
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
- Modify: `src/auth/accounts.ts`
- Modify: `src/auth/store.ts`
- Modify: `src/api/ingest.ts`
- Modify: `src/api/workspace.ts`
- Modify: `src/api/router.ts`
- Modify: `src/hydra/cloud.ts`
- Modify: `src/hydra/cloud-graph.ts`
- Modify: `src/connectors/files.ts`
- Modify: `src/connectors/preview-token.ts`
- Modify: `api/index.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/connectors.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/onboarding-redis-admin.ts`
- Create: `scripts/onboarding-secret-promote.ts`
- Test: `tests/unit/ingest-source.test.ts`
- Test: `tests/unit/cloud-source.test.ts`
- Test: `tests/unit/onboarding-api.test.ts`
- Test: `tests/unit/workspace-api.test.ts`
- Create: `tests/unit/onboarding-attempt-store.test.ts`
- Create: `tests/unit/onboarding-redis-admin.test.ts`
- Create: `tests/unit/onboarding-secret-promote.test.ts`
- Create: `tests/integration/onboarding-attempt-redis.test.ts`
- Test: `tests/unit/auth-api.test.ts`
- Test: `tests/unit/connectors-files.test.ts`
- Test: `tests/unit/web-connectors-client.test.ts`

**Interfaces:**
- Extends: existing `IngestPreparedOptions` with one absolute deadline and `maxRecords: 25`
- Reuses: aggregate `IngestPreparedReport.searchable` / `indexing` without exposing Hydra ids
- Adds: `GET /api/workspace/questions` backed by bounded live workspace claims
- Adds: `GET /api/workspace/onboarding/attempt` backed by a durable active-attempt pointer
- Produces: one atomic fixed-size per-owner `RedisOnboardingAttemptStore`
- Produces: atomic `begin`, `markDispatched`, `retryIndeterminate`, `finalizeDispatch`, `reconcile`, and `retireIfActive` scripts over one owner record plus one fixed metadata record
- Produces: `ExpectedRecordProof` and one strict bounded Hydra inspect-envelope decoder shared by ingestion and reconciliation
- Produces: a bounded generation+dispatch Redis outbox/receipt ledger whose input-bound Hydra point-read reconciliation closes the post-receipt/pre-finalize crash gap without claiming Hydra CAS
- Produces: `npm run onboarding:redis:keygen|init|audit|maintenance:enter|maintenance:force-retire|maintenance:exit|rotate` through one redacting administration CLI, plus one pinned, journaled secret-promotion driver
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
fingerprint and count of non-retired owner records in the current owner epoch. Every mutation is one Lua
compare-and-set over those two keys, which share one Redis cluster hash tag. The
owner record stores only schema version, full keyed owner/input digests, random
opaque attempt id, exact purpose/source kind, at most 25 internal expected record
proofs, one server-random 128-bit generation commit nonce, owner epoch,
generation/attempt count, state `pending | indeterminate |
accepted | searchable | failed | retired`, safe counts/failure code, an optional
bounded retry lease, and canonical Redis timestamps—never raw workspace/email/
title/text/file/token. It also holds a maximum-eight-entry outbox/receipt ledger.
Each entry is addressed by exact `(generation, dispatchId)`, where `dispatchId`
is a fresh random 128-bit lowercase-hex value, and contains only state `reserved
| dispatched | exact_receipt | reconciled`, the exact shared `proofSetDigest`,
Redis-time observations, and bounded
accepted/refused bitmaps indexing the shared proof array. Provider error text is
never stored. The complete owner JSON, including 25 worst-case proofs and eight
ledger entries, must encode to at most 16 KiB before Lua receives it; no script
may truncate it. `retired` is a permanent minimal tombstone that drops the input
digest, expected proofs, commit nonce, lease, counts, failure detail, and dispatch details
but preserves owner digest/epoch, generation, lifetime attempt count, monotonic
retired-through generation, reason, and Redis retirement time.

Define each sorted, unique `ExpectedRecordProof` as exactly
`{ id, kind, provenanceDigest, commitDigest, payloadDigest }`, where `id` must match exactly
`lacuna:index | lacuna:entity:[0-9a-f]{32} | lacuna:session:[1-9][0-9]{0,15}`
and is therefore at most 46 ASCII bytes, `kind` is the strict enum
`index | entity | session`, `payloadDigest` is 64 lowercase hexadecimal SHA-256,
and `provenanceDigest` and `commitDigest` are 64 lowercase hexadecimal
HMAC-SHA-256 under the current
onboarding key. Immediately after the bounded pre-write merge, build the final
`AppRecord` values. First HMAC the fixed-order canonical source identity and
connector-evidence fields under `lacuna:onboarding:record-provenance:v1\0`; for
shared index/entity records use the server-derived collection identity, record
kind, and deterministic record id. Before `begin`, generate one server-random
128-bit lowercase-hex commit nonce and HMAC, under
`lacuna:onboarding:record-commit:v1\0`, the owner/input digests, purpose, source
kind, opaque attempt id, commit nonce, record id/kind/provenance digest, and the
canonical pre-marker record digest. Add only those two digests as mandatory
metadata keys `lacuna_provenance_digest` and `lacuna_onboarding_commit` to the
final record. This input- and attempt-bound marker makes an otherwise identical
record left by an earlier generation ineligible to prove that the current POST
happened. Then canonicalize the
application record as UTF-8 JSON under domain
`lacuna:onboarding:record-payload:v1\0`: the object has only keys `id`, `title`,
`type`, `timestamp`, `text`, `metadata`, and `relations` in that order; the
inspect decoder maps Hydra `content.text`, `additional_metadata`, and
`relations.ids` into those application fields before canonicalization. Metadata
keys are unique and sorted by Unicode code point and values are only strings or
finite numbers, absent metadata normalizes to `{}`, absent relations to `[]`, relations are
unique and code-point sorted, strings are valid Unicode without lone surrogates,
and JSON contains no insignificant whitespace. Reject unknown/non-canonical
values before Redis or Hydra. `payloadDigest` hashes those exact domain-separated
bytes. `kind` must equal decoded `metadata.lacuna_record`, decoded
`metadata.lacuna_provenance_digest` must equal `provenanceDigest`, and decoded
`metadata.lacuna_onboarding_commit` must equal `commitDigest`. Neither marker may
be caller supplied or overwritten. Never persist raw provenance, URLs,
titles, or text in Redis. The proof array is id-sorted and itself has one
SHA-256 `proofSetDigest` over `lacuna:onboarding:proof-set:v1\0` plus its
canonical bytes; tests pin canonical vectors and prove the
worst-case owner encoding stays within 16 KiB/25 records/eight dispatches. Every
mark/finalize/reconcile script requires its dispatch's digest to equal the owner
proof-set digest before changing a bit.

The strict bounded inspect decoder in `src/hydra/cloud.ts` must decode the actual
provider-returned record id and all canonical payload fields from the envelope,
not substitute the requested id. It rejects a body/envelope above the existing
response cap, duplicate or unknown fields, wrong types, invalid Unicode,
non-finite numbers, unsupported metadata, an absent record kind/provenance
identity, and any envelope that cannot round-trip to the same canonical bytes.
`src/hydra/cloud-graph.ts` uses that decoder rather than a permissive parallel
shape. If the production inspect API does not return enough information to
reconstruct these exact bytes, reconciliation remains indeterminate and the live
gate fails; status or existence is never a substitute.

`begin` durably creates/read-backs the generation, its exact proof array and
`proofSetDigest`, and its first `reserved` dispatch after the bounded pre-write
merge has produced the final records but before any Hydra POST. Immediately
before the network call,
`markDispatched(owner, ownerEpoch, generation, attemptId, dispatchId)` atomically
records `dispatched` using Redis `TIME`; failure/refusal means zero Hydra calls.
After dispatch, absence of a receipt or process loss can only leave that entry
`dispatched` and the owner `indeterminate`. An exact complete Hydra receipt is
converted to accepted/refused bitmaps and passed to idempotent
`finalizeDispatch`; its Lua arbitration and exact owner readback are the durable
receipt. If the process dies after Hydra returns the exact receipt but before
that Lua call, or if the Lua response is lost, resume queries each deterministic
expected id with bounded `HydraCloud.inspect`, canonicalizes the decoded stored
record, and requires exact response id, kind, provenance digest, and payload
digest equality with its durable proof, including the current-generation commit
marker. Only that full match is durable
acceptance evidence and `reconcile` monotonically records it against that
dispatch;
missing, partial, malformed, timed-out, or failed reads remain uncertain and
can never prove refusal. This is a Redis outbox plus deterministic-upsert
reconciliation boundary, not a Hydra transaction/CAS or exactly-once claim.

Owner and per-dispatch transitions are atomic and monotonic. The only ordinary owner transitions are
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
purpose, sourceKind, expectedProofs, proofSetDigest, dispatchId, leaseId)`. It
requires a newly
issued and consumed preview token whose current session/workspace/purpose/input
binding matches the unresolved record exactly, preserves the same generation,
attempt id and exact proof set, increments the attempt count, and installs one
random retry lease plus `reserved` outbox entry. The script accepts no timestamp
or expiry argument: it calls Redis `TIME`, derives canonical integer
milliseconds, and sets the lease expiry to exactly 165,000 ms later. The route
may call it only while its own admission check has at least 170 seconds left, so
the five-second finalize reserve remains, but every lease comparison is solely
Redis-time based. While an unexpired lease exists every competing retry refuses;
after expiry a fresh token may acquire a new lease. `markDispatched` rechecks the
owner/lease immediately before the retry POST; if any dispatch has already
promoted the owner to accepted/searchable, it refuses with zero Hydra calls.
Before `retryIndeterminate`, the route reruns the same bounded merge and
canonicalization and requires every recomputed proof plus `proofSetDigest` to
equal the original Redis record. Any concurrent shared-record change or decode
ambiguity refuses the retry and leaves the attempt indeterminate; the route may
not update proofs, substitute a merely matching id set, or POST a different
payload under the old reservation.
Once two calls are actually dispatched, either may settle first. Accepted ids
from any original/retry dispatch are unioned and accepted always wins. An exact
all-refused retry is recorded only for that dispatch and leaves the owner
`indeterminate` while any earlier/later marked-dispatched entry lacks an exact
all-refused outcome; it may set owner `failed` only when every dispatched entry
is exact-all-refused, no positive record reconciliation exists, and no dispatch
can still report acceptance. Another uncertain result clears only its matching
lease and may not alter confirmed counts.

Never replace an unresolved generation. Completion/explicit Skip atomically
retires it and decrements metadata `activeCount` exactly once; owner records are
never deleted during normal runtime and have no TTL. Test cross-instance
interleavings so accepted always wins an accepted-vs-indeterminate race, late
failed/indeterminate updates cannot downgrade accepted/searchable, concurrent
begin has one visible winner, only one retry lease is live, expired-lease retry
requires a fresh matching token, Redis `TIME` rather than process time controls
lease acquisition/expiry, a retry preserves ids, attempt N+1 refuses, an
unresolved attempt cannot be displaced, retirement is idempotent, late finalize
against a missing/retired/wrong-owner-epoch/wrong-generation/unknown-dispatch
record refuses without recreation or metadata change, malformed/oversized
records fail closed, and pending creation plus `markDispatched` must be confirmed
before any workspace write. Fault-inject both (a) process death after an exact
Hydra receipt but before Redis finalization and (b) a successfully applied
`finalizeDispatch` whose response is lost. Resume must recover accepted truth by
exact proof-bound point reads or exact owner readback respectively, must keep Store
disabled throughout, and must never demote or automatically resubmit. Test both
orders of a late accepted original versus an exact-all-refused retry and prove
the final owner is accepted in each order. Add a regression in which a shared
index/entity record already exists, `markDispatched` is durable, but a fault
occurs before the Hydra POST (the POST spy remains zero): inspecting that
pre-existing record must not promote any bit and the attempt remains
indeterminate—even when every underlying shared-record field is identical except
for the prior generation's commit marker. Also cover same id with wrong kind,
provenance, commit marker, or one-byte payload
change; missing provenance; duplicate/unknown envelope fields; malformed,
oversized, or non-canonical UTF-8/JSON; and corrupt stored proof/digest. Every
case stays indeterminate/fail-closed with no accepted count. Only an exact
id+kind+provenance+payload match promotes, and canonical-vector tests prevent
writer/reader drift.

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
bounded generation+dispatch ledger and internal accepted/expected ids in the
current account collection under one deadline. Those ids come only from the
owner's durable proof array. It first exact-reads the owner;
then, only for `dispatched` entries without a durable receipt, performs capped
positive `inspect` reads. All accepted ids completed becomes `searchable`; an
exact receipt or a stored record whose decoded id, kind, provenance digest, and
current-generation commit marker and canonical payload digest all match its
durable proof remains
`accepted` while indexing is incomplete; a `reserved` entry never marked
dispatched or an exact all-refused set with no unresolved dispatch becomes
`failed`. Missing records after a marked dispatch, partial/provider failure, or
a lost reconciliation response remains `indeterminate` and can never demote
`accepted`. Only a conclusively failed attempt may enable a new generation
automatically. An ambiguous retry is a distinct explicit action:
re-preview the retained text or reselected file, require a fresh matching token,
acquire `retryIndeterminate` for the same record, and make one deterministic-
upsert copy. It is never an automatic request and never replaces the unresolved
record. Every retry runs reconciliation before lease acquisition and
`markDispatched` immediately before Hydra; a concurrent late acceptance may make
either gate refuse. If it races after dispatch, deterministic upsert convergence
and accepted-wins Lua arbitration preserve truth without a CAS claim.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/ingest-source.test.ts tests/unit/cloud-source.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/onboarding-redis-admin.test.ts tests/unit/onboarding-secret-promote.test.ts tests/unit/workspace-api.test.ts tests/unit/auth-api.test.ts tests/unit/connectors-files.test.ts tests/unit/web-connectors-client.test.ts --maxWorkers=1`

Expected: missing options/report fields, Redis store, and administration CLI.

- [ ] **Step 3a: Install the reviewed Redis and deployment clients and lock them exactly**

Run: `npm install --save-exact @redis/client@6.2.1`

Run: `npm install --save-dev --save-exact vercel@48.10.0`

Require root `package.json` to contain exactly `"@redis/client": "6.2.1"`
without `^`, `~`, tag, alias, or workspace indirection, and require
`package-lock.json` to lock that package and its reviewed transitive
`cluster-key-slot@1.1.2` with registry integrity. Do not add the aggregate
`redis` package or unused module clients. Require `devDependencies.vercel` to be
exactly `48.10.0`, with its complete registry-integrity-locked transitive graph.
All production-promotion commands resolve the repository-local
`node_modules/.bin/vercel`, require `vercel --version` to return exactly
`48.10.0`, record the package-lock entry/integrity digest in the promotion
journal, and refuse `npx`, PATH/global binaries, tags, or a dirty/mismatching
lock/install tree.

Run: `npm ci`

Expected: clean installation from the lock succeeds under the repository's
Node 20+ engine before implementation continues.

- [ ] **Step 4: Implement bounded indexing readiness**

Capture one 210-second server settlement deadline before body acquisition and
schedule backward: reserve the final five seconds for the atomic attempt-state
transition/readback, the preceding 30 seconds for readiness, at most 120 seconds
for the single workspace Hydra POST, the preceding five seconds for atomic
proof-bound pending-attempt creation/readback, and before it 20 seconds for the
bounded workspace queue plus pre-write index/entity reads and canonical proof
construction. Body/token/quota/local preparation is
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
hash tag keeps every meta+owner Lua mutation co-located, although production
deliberately refuses cluster/proxy mode for auditable `FLUSHDB SYNC` rotation.
No route/client supplies a Redis key. Define HMAC framing as UTF-8 domain followed
by each UTF-8 field prefixed with an unsigned four-byte big-endian byte length.
Use exact independent domains `lacuna:onboarding:owner:v1\0`,
`lacuna:onboarding:input:v1\0`, `lacuna:onboarding:key-fingerprint:v1\0`,
`lacuna:onboarding:record-provenance:v1\0`, and
`lacuna:onboarding:record-commit:v1\0`; the fingerprint is the lowercase-hex
HMAC of the zero-field fingerprint frame. The owner frame has exactly the
trimmed/lowercased authenticated account email. The input frame has exactly
purpose, source kind, and canonical token-bound input digest: text uses
`sourceInputDigest(prepared)`, while file uses the SHA-256 of the same framed raw
digest, normalized digest, parser version, type, and title carried by
`FilePreviewBinding`. Workspace labels and all caller-provided owner identifiers
are excluded.

The meta value is a strict at-most-2-KiB record
`{ schema: 1, status: 'ready' | 'maintenance' | 'maintenance_retired' |
'rotation_pending', keyFingerprint, activeCount, keyEpoch, ownerEpoch,
forcedRetiredThroughOwnerEpoch, createdAtRedisMs, updatedAtRedisMs,
maintenanceNonce?, maintenanceStartedAtRedisMs?, maintenanceDrainUntilRedisMs?,
lastMaintenanceNonce?, lastMaintenanceOutcome?, lastMaintenanceAtRedisMs?,
rotationNonce?, nextKeyFingerprint?, nextKeyEpoch? }`. Counters/epochs are
canonical safe nonnegative integers mutated only inside Lua; every timestamp and
lease/drain comparison is derived inside Lua from Redis `TIME`. `activeCount` is
the number of non-retired owner records in the current owner epoch. Begin from a
missing owner increments it; idempotent retirement
decrements it once and replaces the owner value with its minimal permanent
tombstone. Every runtime script first validates that meta exists, is schema 1/
`ready`, has the current key fingerprint/owner epoch and a safe nonnegative
count. Only finalize/reconcile/retire for a dispatch marked before maintenance
may run while status is `maintenance`; all other non-`ready` operations refuse.
Missing, malformed, fingerprint-mismatched, `maintenance_retired`, or
`rotation_pending` meta is catastrophic operational unavailability:
attempt-dependent routes return `503`, perform zero workspace writes, never
synthesize/reset meta, and never treat the owner as absent. A completed
account's session read remains authoritative and returns normally when its
bounded cleanup observes this unavailability.

Parse only a dedicated `LACUNA_ONBOARDING_REDIS_URL`: require authenticated
`rediss:`, normal certificate/hostname validation, and a standalone database-0
service dedicated to this feature; never fall back to generic/local Redis,
Hydra, session, or preview
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

Use only the exact pinned `@redis/client@6.2.1` API. Construct one lazy singleton
with `disableOfflineQueue: true`, a 5,000 ms TLS connect timeout,
`socket.reconnectStrategy: false`, no command retry, and a redacting error
listener; an ended/error connection is unavailable for that request and is
never backed by an in-memory queue. Load the reviewed scripts once and invoke
only their server-returned SHA-1 identifiers through fixed `EVALSHA` key counts
(SHA-1 is only Redis's script cache address, never an authentication primitive). Production supports only
a dedicated standalone Redis service on database 0: the URL must contain
nonempty authentication, use `rediss:`, select `/0`, and pass normal hostname/
certificate verification. Cluster/proxy modes, a shared logical database, and
any service whose administrative probes are denied are unsupported and fail
closed.

The init, audit, rotation, integration, and bounded runtime-start probes use the
same strict decoder and exact pass criteria: `PING` is exactly `PONG`;
`CONFIG GET maxmemory-policy appendonly appendfsync` returns exactly
`noeviction`, `yes`, and `always`; `INFO server` has exactly one parseable
`redis_version` at least 7.2.0 and `redis_mode:standalone`; `INFO persistence`
has `loading:0`, `aof_enabled:1`, `aof_last_write_status:ok`, and
`aof_last_bgrewrite_status:ok`; and `TIME`
returns exactly two canonical decimal fields with seconds nonnegative,
microseconds in `0..999999`, and a nondecreasing second observation. `PTTL` for
meta and every owner key addressed by a bounded operation must be exactly `-1`;
`-2` is allowed only for an expected absent owner/meta case explicitly handled
by begin/init/rotation, while every nonnegative TTL is corruption. Runtime may cache a successful infrastructure
probe only for the life of the healthy connection, but every Lua mutation still
validates meta/fingerprint/status/epoch and exact-reads both values plus their
`PTTL` before success. `CONFIG SET`, implicit repair, and a degraded-warning mode
are forbidden.

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

Extend the strict account schema with nullable server-owned
`onboardingAttemptOwnerEpoch`, `onboardingAttemptKeyEpoch`, and
`onboardingCleanupKeyEpoch`; legacy absence decodes as null. Before the first
`begin` in an owner epoch, persist and exact-read back both current epochs on the
authenticated account. This may
conservatively record an epoch before a crash that performed no Redis begin, but
may never lag an active owner. After successful retirement, exact-read back the
meta key epoch into `onboardingCleanupKeyEpoch`. For `onboarded: true`, a missing
owner is cleanup success only when no attempt epoch was ever recorded or current
meta `keyEpoch` is strictly newer than the recorded attempt key epoch and is at
least the recorded cleanup epoch (when present); it must not
create a tombstone or decrement `activeCount`, and the account cleanup epoch is
advanced idempotently. Missing owner in the same key epoch remains corruption.
This makes completion -> zero-active rotation -> later session cleanup truthful
after the audited flush instead of turning a completed user into `503`.

Implement `scripts/onboarding-redis-admin.ts` with redacted, noninteractive
`keygen`, `init --confirm-dedicated-empty`, `audit`,
`maintenance-enter --confirm-block-onboarding`,
`maintenance-force-retire --confirm-ambiguous`,
`maintenance-exit --confirm-resume`, and `rotate --confirm-destructive`
subcommands. Implement `scripts/onboarding-secret-promote.ts` as the only allowed
production environment/deployment promotion driver. Add these exact package scripts:

```json
{
  "onboarding:redis:keygen": "tsx scripts/onboarding-redis-admin.ts keygen",
  "onboarding:redis:init": "tsx scripts/onboarding-redis-admin.ts init",
  "onboarding:redis:audit": "tsx scripts/onboarding-redis-admin.ts audit",
  "onboarding:redis:maintenance:enter": "tsx scripts/onboarding-redis-admin.ts maintenance-enter",
  "onboarding:redis:maintenance:force-retire": "tsx scripts/onboarding-redis-admin.ts maintenance-force-retire",
  "onboarding:redis:maintenance:exit": "tsx scripts/onboarding-redis-admin.ts maintenance-exit",
  "onboarding:redis:rotate": "tsx scripts/onboarding-redis-admin.ts rotate",
  "onboarding:secret:promote": "tsx scripts/onboarding-secret-promote.ts",
  "test:onboarding-redis": "vitest run tests/integration/onboarding-attempt-redis.test.ts --maxWorkers=1"
}
```

`init` refuses unless
the dedicated database is empty, TLS/auth/persistence/noeviction checks pass, and
the fixed meta `SET NX` exact readback succeeds; runtime never calls it. `audit`
does no scan and reports only schema/status, fingerprint match, active count,
key/owner/forced-retirement epochs, Redis-time drain remaining, and the exact
policy/persistence/TTL health booleans above. It always requires an exact
`--key-file` plus exactly one expected-state flag. Maintenance/retired/rotated
expectations additionally require the exact absolute `--journal` whose MAC,
scope, nonce, expected epochs, and terminal observed section must match meta;
`audit` never infers success from a status word alone.

Every maintenance command requires the same caller-supplied absolute `--journal`
path. Before the first Redis mutation, `maintenance-enter` exclusively creates
that regular file with mode 0600, verifies owner/no symlink, writes a canonical
schema-1 header containing a fresh random 128-bit lowercase-hex `clientNonce`,
the command/scope/key fingerprint and expected starting meta state, authenticates
it under domain `lacuna:onboarding:maintenance-journal:v1\0` with the current
key, then fsyncs the file and parent directory. Before **every** later mutation,
including enter, force-retire, and exit, the CLI appends an authenticated,
sequence-numbered intent section containing the exact prior readback and intended
transition, fsyncs the file and directory, and only then invokes Lua. Afterward it
exact-reads meta and appends/fsyncs an observed-outcome section. Sections contain
no endpoint, key bytes, owner/input ids, or record content; invalid MAC, sequence,
permissions, scope, fingerprint, nonce, or expected state refuses before a
mutation. Cap the journal at 64 KiB/48 sections and each subcommand invocation at
one Lua attempt; exhaustion blocks for incident review. An ambiguous command response never authorizes a guessed journal
advance: rerunning the exact command first reads meta and either proves the
same-nonce transition already happened or safely invokes the idempotent Lua.
Journal creation and every logical append use the same helper: write the complete
next canonical image to a same-directory `O_EXCL` mode-0600 regular temp file,
fsync it, atomically install/replace the journal without following links, then
fsync the directory. Thus a crash exposes either the prior or next fully MACed
sequence; a partial/unowned target fails closed, and an orphan temp can be
removed only by a separate audited incident cleanup after the canonical target
and Redis state are validated unchanged.

Maintenance entry is one Lua transition from matching `ready` meta. It accepts
the journal's client nonce as an exact argument, obtains
`maintenanceStartedAtRedisMs` from Redis `TIME`, stores/read-backs that nonce,
and sets `maintenanceDrainUntilRedisMs` to exactly 240,000 ms later. A matching
`maintenance` record returns `already_entered` only when nonce, key/owner epoch,
start and drain fields equal the journal; a different nonce or partial match
refuses. A `ready` meta whose `lastMaintenanceNonce` is the same nonce and whose
outcome is `exited` returns `operation_closed` and can never re-enter; only a new
exclusive journal/nonce may start a later maintenance cycle. It
immediately blocks begin/retry and any `reserved` dispatch from becoming
`dispatched`, while allowing bounded finalize/reconcile/retire for dispatches
already marked before entry. `maintenance-exit` may return to `ready` only before
forced retirement and with the matching nonce. Its Lua stores
`lastMaintenanceNonce`, `lastMaintenanceOutcome: 'exited'`, and Redis time in the
ready meta; the exact same journal/nonce then returns `already_exited`, so a lost
exit response is recoverable, while another nonce refuses. After the Redis-time drain,
`maintenance-force-retire` serializes against those allowed finalizers. If the
finalizer wins, its accepted truth is stored before retirement; if force wins,
the late finalizer is refused. The force transition atomically sets
`forcedRetiredThroughOwnerEpoch` to the old epoch, increments `ownerEpoch`, sets
`activeCount` to zero, and enters `maintenance_retired` without reading or
deleting owner keys. It also preserves the maintenance nonce and records
`lastMaintenanceOutcome: 'forced_retired'`; an exact same-nonce rerun returns
`already_forced`, while a different nonce, early Redis time, or journal/meta
mismatch refuses. It cannot run early and cannot return to `ready`; rotation
must follow. Thus no scan is needed and no request can remain live beyond the
210-second handler budget when the 240-second drain expires.

An unfinished account whose recorded attempt epoch is at/below the forced
cutoff and whose owner is missing or stale receives an exact user-visible
`security_maintenance_retired` state. Store/retry remain disabled; copy states
that the prior write may have reached Memory. Its only progress action is
`SKIP AND REVIEW MEMORY`, which exact-readback completes with outcome `skipped`
before navigating to ordinary Memory; a direct pre-completion `/app` link is not
offered because the workspace guard would reject it. Forced retirement never
reopens Store or resets the lifetime eight-attempt counter. Completed accounts
remain complete.
Test two-client maintenance/finalize ordering, early force refusal, blocked new
dispatch, forced stale-owner migration, exact-readback Skip, and late
old-epoch finalizer refusal with zero owner/meta recreation. Fault-inject a crash
or lost response immediately before and after each journal fsync, enter Lua,
enter readback, force-retire Lua, force readback, exit Lua, and exit readback.
Reruns must yield only `already_entered`, `already_forced`, `already_exited`, or
the terminal `operation_closed`
for the same nonce/state, never repeat an epoch/count mutation, and corruption,
truncation, wrong key/scope/nonce, or absent pre-mutation intent must fail closed.

Ordinary rotation reads the next key only from an absolute mode-0600 key file
passed as `--next-key-file`; runtime never reads `LACUNA_ONBOARDING_NEXT_KEY`.
One Lua step enters `rotation_pending` only when fingerprint/version match and
`activeCount === 0` (naturally or after forced maintenance). Before that step,
the CLI atomically creates and fsyncs an exclusive mode-0600 rotation journal at
the caller-supplied absolute `--journal` path. It contains the nonce, old/new
key/owner epochs, forced cutoff, and old/next fingerprints authenticated by the
old key, but no key bytes. A forced path additionally requires the exact
mode-0600 MAC-valid `--maintenance-journal` and binds its client nonce, forced
outcome, epochs, cutoff, and digest into the rotation header; a routine path
refuses that flag. Before the rotation-pending Lua, `FLUSHDB SYNC`, and fresh-meta
`SET NX`, append and fsync a distinct authenticated intent, then append/fsync its
strict readback before the next mutation. After new-meta exact readback, the CLI atomically
appends/fsyncs a completion section authenticated by the next key; a rerun that
finds ready-next meta may repair only that missing completion section while both
key files are present. Because the Redis service is dedicated, the confirmed
command uses `FLUSHDB SYNC` (never a scan), verifies `DBSIZE 0`, creates with
`SET NX` and exact-reads fresh schema-1 `ready` meta carrying the incremented key
epoch, current/forced owner epochs, next fingerprint, and `activeCount: 0`, then
zeroizes in-process key buffers. Retired tombstones are permanent during normal
runtime; this audited rotation is their only deletion path.

A rerun with the same two key files and journal is idempotent: matching
`rotation_pending` resumes; missing meta is recoverable only when the journal
MAC/epochs/nonces validate and `DBSIZE` is exactly zero; and already-`ready` meta
with the exact next fingerprint, next key epoch, carried owner epoch/cutoff, and
`activeCount: 0` returns `already_complete` without another flush. Every other
missing/mismatched state stays `503` and requires an incident decision. No
automatic init/recovery is permitted.

`keygen --out <absolute-path>` creates a new file exclusively with mode 0600,
writes exactly 64 lowercase hex plus LF, fsyncs it, and prints only `created`;
`audit --key-file --expect-* [--journal]` and
`rotate --current-key-file --next-key-file --journal [--maintenance-journal]`
reject relative paths, symlinks, wrong ownership/permissions, and malformed key
files. The admin key-file parser accepts exactly those 65 bytes and removes only
the one mandatory final LF before passing the same 64-byte hex string to the
strict decoder; this does not relax the no-trim environment parser. The exact
first initialization is:

```bash
npm run onboarding:redis:keygen -- --out /secure/lacuna/onboarding-current.key
npm run onboarding:redis:init -- --key-file /secure/lacuna/onboarding-current.key --confirm-dedicated-empty
npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-current.key --expect-ready
```

The `/secure/lacuna` paths below represent an encrypted operator volume outside
the repository; commands refuse otherwise. For routine rotation, wait for
natural `activeCount: 0` and use exactly:

```bash
npm run onboarding:redis:keygen -- --out /secure/lacuna/onboarding-next.key
npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-current.key --expect-ready-zero-active
npm run onboarding:redis:rotate -- --current-key-file /secure/lacuna/onboarding-current.key --next-key-file /secure/lacuna/onboarding-next.key --journal /secure/lacuna/onboarding-rotation.json --confirm-destructive
npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-next.key --journal /secure/lacuna/onboarding-rotation.json --expect-ready-after-rotation
```

For a compromise rotation that cannot wait for abandoned active records, use
exactly the maintenance sequence below and wait until audit reports exactly zero
drain milliseconds before force-retire. If the incident is cancelled before
force-retire, the only valid rollback is the shown nonce/journal-bound
`maintenance-exit`; after force-retire no exit is permitted and rotation must
finish.

```bash
npm run onboarding:redis:keygen -- --out /secure/lacuna/onboarding-next.key
npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-current.key --expect-ready
npm run onboarding:redis:maintenance:enter -- --key-file /secure/lacuna/onboarding-current.key --journal /secure/lacuna/onboarding-maintenance.json --confirm-block-onboarding
npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-current.key --journal /secure/lacuna/onboarding-maintenance.json --expect-maintenance
npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-current.key --journal /secure/lacuna/onboarding-maintenance.json --expect-maintenance-drained
npm run onboarding:redis:maintenance:force-retire -- --key-file /secure/lacuna/onboarding-current.key --journal /secure/lacuna/onboarding-maintenance.json --confirm-ambiguous
npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-current.key --journal /secure/lacuna/onboarding-maintenance.json --expect-maintenance-retired
npm run onboarding:redis:rotate -- --current-key-file /secure/lacuna/onboarding-current.key --next-key-file /secure/lacuna/onboarding-next.key --maintenance-journal /secure/lacuna/onboarding-maintenance.json --journal /secure/lacuna/onboarding-rotation.json --confirm-destructive
npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-next.key --journal /secure/lacuna/onboarding-rotation.json --expect-ready-after-rotation
```

The pre-force incident-cancellation command is:

```bash
npm run onboarding:redis:maintenance:exit -- --key-file /secure/lacuna/onboarding-current.key --journal /secure/lacuna/onboarding-maintenance.json --confirm-resume
npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-current.key --journal /secure/lacuna/onboarding-maintenance.json --expect-ready-after-maintenance-exit
```

After either successful rotate path, promote the already-ready next fingerprint
with exactly this resumable command (the project/team ids and origin are literal
operator-approved production values, never inferred from a mutable local link):

```bash
npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-next.key --journal /secure/lacuna/onboarding-rotation.json --expect-ready-after-rotation
npm run onboarding:secret:promote -- --current-key-file /secure/lacuna/onboarding-current.key --next-key-file /secure/lacuna/onboarding-next.key --rotation-journal /secure/lacuna/onboarding-rotation.json --journal /secure/lacuna/onboarding-promotion.json --project-id '<exact-vercel-project-id>' --team-id '<exact-vercel-team-id>' --production-origin 'https://<exact-production-host>' --git-commit '<reviewed-clean-commit-sha>' --old-deployment-id '<currently-promoted-deployment-id>' --confirm-production
npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-next.key --journal /secure/lacuna/onboarding-rotation.json --expect-ready-after-rotation
```

On a lost/empty rotate response, rerun the identical `rotate` command before
promotion; the `already_complete` case above is success. The promotion driver
refuses a dirty/unexpected Git commit, mutable project linking, a non-exact
origin, missing Vercel authentication, or any CLI other than the repository-local
integrity-locked `vercel@48.10.0` described above. It exclusively creates its
absolute regular mode-0600 promotion journal before the first external mutation,
with a fresh 128-bit client nonce, exact project/team/origin/commit, rotation
journal digest, old/next key fingerprints, caller-supplied old deployment id,
and the strict read-only preflight's exactly-one current production environment
record identity `{ id, updatedAt, target: 'production', type, gitBranch: null }`
and production-alias deployment id, plus CLI version and
package-lock integrity. Preflight must prove both deployment ids agree and block
on absent/duplicate/mismatching state. The header and every fixed-order stage section are
canonical, sequence-numbered, MACed under
`lacuna:onboarding:promotion-journal:v1\0`, fsynced with the containing directory,
and contain no token, key, cookie, credential, response body, or smoke data.
It uses the same atomic whole-image journal helper and orphan rule as maintenance.
Before **each** external or local mutation—including environment replacement,
deployment creation/promotion/removal, alias change, and old-key retirement—the
driver appends and fsyncs an intent section; after a strict bounded readback it
appends/fsyncs the observed outcome. It does not proceed while an outcome is
ambiguous.

Spawn the pinned executable directly with `shell: false` and fixed argument
arrays; pass the next key only on a dedicated stdin pipe, close/zeroize it, and
never place it in argv, environment, output, or a command transcript. Cap each
stdout/stderr stream at 1 MiB and accept only the pinned JSON schemas. Bound
metadata list/read/promote/remove calls to 120 seconds and ten pages/100 entries,
candidate deployment to 15 minutes, each smoke to 240 seconds, and the complete
resumable invocation to 45 minutes including the 270-second drain; timeout/limit
breach is ambiguous and stops after an fsynced outcome. The driver holds an
exclusive lock adjacent to the exact command's canonical promotion journal for
the complete run and refuses to create a new nonce while a valid nonterminal
journal exists; a stale lock is recoverable only by validating that journal then
proving the prior process is absent.
Cap the promotion journal at 256 KiB/128 sections and each mutating stage at
three lifetime attempts across resumes; exhaustion blocks rather than starting a
new journal or nonce.

The journaled state machine is exactly: (1) revalidate the rotation journal and
ready-next Redis audit; (2) idempotently set the single production-scoped
`LACUNA_ONBOARDING_KEY` environment record to the exact next key, then list and
read back exactly one matching name/target/project environment record and record
its strict new identity tuple and digest (never its value); (3) create an immutable
candidate deployment of the reviewed commit, tagged with the client nonce and
environment-identity digest, and strictly read back its deployment id, commit,
project, team, ready status, aliases, and exact tags before accepting
it; (4) run the redacting onboarding smoke against that unaliased deployment,
where successful Redis fingerprint probing plus the end-to-end write proves the
deployed secret value matches ready-next; (5) promote that exact deployment id
to the production alias and read back that the exact origin resolves to it; (6)
run the same redacting smoke through the production origin; (7) wait at least
270 seconds from the server-observed alias switch while repeatedly proving the
alias remains on the new id, then remove the recorded old deployment and require
strict inspect to report it absent;
(8) perform and journal the final exact ready-next Redis audit; and only then (9)
exact-read that the pre-operation old environment identity is absent,
the sole production record has the journaled next identity tuple, and the removed old
deployment cannot retain an executable old-key snapshot; then invalidate/destroy
the old local key through the audited operator procedure. Immediately before
that irreversible step, append/fsync a full-chain handoff section authenticated
by both old and next keys plus a next-key-MACed destruction intent. Append a
next-key-MACed `old_secret_retired` terminal section after the path is proved
absent. The
rotation and maintenance journals are retained per incident policy; their MACed
audit history is not silently deleted.

Each stage is idempotent and recovery is readback-first. A lost environment-set
response is reconciled by exact project/name/target record identity, then the
same next value may be convergently set again; it is not considered verified
until candidate fingerprint smoke succeeds. A lost deploy response is recovered
only by exactly one deployment with the journal nonce, commit,
environment-identity digest, project, and team; zero permits a retry and
multiple/mismatch blocks.
A lost promote response is recovered only when the production alias readback
points to the journaled deployment id. Smoke, drain, final audit, disablement,
and retirement each require their own readback/observed section; a failed or
unknown result blocks the next stage. Rerunning the identical promotion command
resumes at the first unproved stage and never repeats an environment replacement,
deployment, promotion, or retirement for an already-proved outcome. Before the
dual-MAC handoff, an absent current-key file always blocks. After a valid handoff
and destruction intent, a lost response/crash may be recovered with the next key
alone only when every external retirement readback still matches and the old path
is absent; the driver then appends the missing terminal instead of recreating the
old key. Never restore
the old key or deploy it as rollback. `LACUNA_ONBOARDING_NEXT_KEY` is rejected by
runtime and admin composition so a warm instance cannot accidentally select it.

Consume Task 6's deadline-aware `HydraCloud.ingestApp`, `ConnectorRunner`,
readiness, `maxRecords: 25`, and indeterminate-submission controls. The text
store and onboarding-marked file import prepare deterministic graph ids,
finish their bounded pre-write merge, canonicalize the exact final records,
atomically begin/read back `pending` with those proofs, reserve/read back its
dispatch, and mark it dispatched immediately before the one POST. A complete exact receipt first
finalizes that dispatch and the accepted ids/counts; readiness may then promote
the owner to `searchable`. Transport uncertainty may move only a marked dispatch
to `indeterminate`. If handler settlement or Redis finalization is lost, its
bounded outbox entry plus deterministic expected proofs is the recovery source;
only positive strict point reads matching every stored proof field create
accepted truth. Hydra remains an
unconditional deterministic upsert with no CAS, transaction, or negative-read
guarantee. File preview and import both require one exact purpose
`onboarding | connector`, authenticated inside `FilePreviewBinding`; cross-
purpose reuse refuses before runner/state work. Normal connector imports never
replace the onboarding owner record.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/ingest-source.test.ts tests/unit/cloud-source.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/onboarding-redis-admin.test.ts tests/unit/onboarding-secret-promote.test.ts tests/unit/workspace-api.test.ts tests/unit/auth-api.test.ts tests/unit/connectors-files.test.ts tests/unit/web-connectors-client.test.ts tests/unit/context-failure-api.test.ts --maxWorkers=1`

Run against a disposable dedicated persistence/noeviction Redis configured in
`LACUNA_TEST_ONBOARDING_REDIS_URL`:

`npm run test:onboarding-redis`

The integration test executes the production Lua, uses two independent clients,
and covers meta absence/mismatch, begin/mark-dispatched/finalize/reconcile races,
exact-receipt-before-finalize crash, lost successful-finalize response, accepted
versus indeterminate ordering, original-accepted versus retry-all-refused in both
orders, Redis-TIME lease expiry/contention, retirement/late finalize, N+1 refusal,
pre-existing shared record with no Hydra POST, exact proof reconciliation,
id/kind/provenance/payload mismatch and malformed/corrupt proof refusal,
worst-case 16-KiB/25-proof/eight-dispatch bounds,
strict CONFIG/INFO/TIME/PTTL decoding, TTL corruption, persistence/noeviction/
standalone probe failure, init/audit, completion -> zero-active rotation -> later
session cleanup, routine zero-active rotation, active-count refusal, maintenance
drain/forced owner-epoch retirement/finalizer concurrency, user-visible stale
owner migration, every maintenance journal/Lua/readback crash boundary with
same-nonce enter/force/exit recovery, and every pre-flush/post-flush/already-ready
rotation resume state. Unit tests use a fake pinned Vercel executable to fault at
every promotion intent, mutation, response, readback, smoke, alias, drain, final
audit, disablement, and retirement boundary; reruns must resume once, while
wrong tool/version/commit/scope, duplicate deployments, bad journal MAC/mode,
either key/token appearing in journal/argv/stdout/stderr/errors, an absent-key
crash without the dual-MAC handoff, or ambiguous readback blocks. Missing test Redis
configuration fails this explicit gate rather than
silently skipping.

Expected: all tests pass and private context/Redis failures remain fail-closed.

- [ ] **Step 6: Commit searchability readiness**

```bash
git add src/api/onboarding-attempt-store.ts src/api/onboarding-attempt-redis.ts src/auth/accounts.ts src/auth/store.ts src/api/ingest.ts src/api/workspace.ts src/api/router.ts src/hydra/cloud.ts src/hydra/cloud-graph.ts src/connectors/files.ts src/connectors/preview-token.ts api/index.ts web/src/api/client.ts web/src/api/connectors.ts scripts/onboarding-redis-admin.ts scripts/onboarding-secret-promote.ts .env.example package.json package-lock.json tests/unit/ingest-source.test.ts tests/unit/cloud-source.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/onboarding-redis-admin.test.ts tests/unit/onboarding-secret-promote.test.ts tests/integration/onboarding-attempt-redis.test.ts tests/unit/workspace-api.test.ts tests/unit/auth-api.test.ts tests/unit/connectors-files.test.ts tests/unit/web-connectors-client.test.ts
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
retirement. Add completion -> successful retire -> zero-active key rotation ->
fresh-session coverage: newer key epoch plus absent owner is idempotent cleanup
success, never owner recreation, decrement, `503`, or onboarding downgrade. Also
cover the unfinished `security_maintenance_retired` state, its warning, disabled
Store/retry, and exact-readback `SKIP AND REVIEW MEMORY`. A
session with `onboarded: true` is complete; workspace presence alone never is.

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
A forced-retirement cutoff matching the account's recorded owner epoch renders
the dedicated maintenance consequence rather than generic absence and cannot
enable onboarding Store/retry again; it offers only exact-readback
`SKIP AND REVIEW MEMORY`, so an accepted-but-unrecorded write is never silently
resubmitted.
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
After an audited zero-active rotation has deleted tombstones, cleanup for a
completed account treats missing owner plus a strictly newer validated meta key
epoch as `already_clean_by_rotation`, advances the account cleanup epoch by an
exact-readback bounded mutation, and never touches `activeCount`. Same-epoch
absence, stale/unknown account epochs, and malformed meta still fail closed.

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
- Modify: `package.json`
- Create: `scripts/smoke-onboarding.ts`
- Test: `tests/unit/web-product-contracts.test.ts`
- Test: `tests/unit/auth-api.test.ts`
- Test: `tests/unit/landing-session.test.ts`
- Test: `tests/unit/web-auth-client.test.ts`

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

Run: `npm ci`

Run: `npm run typecheck`

Run: `npm --prefix web run typecheck`

Run: `npm run build`

Run: `npx vitest run tests/unit/cloud-source.test.ts tests/unit/onboarding-api.test.ts tests/unit/onboarding-attempt-store.test.ts tests/unit/onboarding-redis-admin.test.ts tests/unit/onboarding-secret-promote.test.ts tests/unit/onboarding-state.test.ts tests/unit/workspace-api.test.ts tests/unit/auth-api.test.ts tests/unit/landing-session.test.ts tests/unit/web-auth-client.test.ts tests/unit/web-connectors-client.test.ts tests/unit/web-product-contracts.test.ts --maxWorkers=1`

Run with `LACUNA_TEST_ONBOARDING_REDIS_URL` pointing only at the disposable
strictly configured service: `npm run test:onboarding-redis`

Expected: all commands exit zero.

- [ ] **Step 6: Production-test after the combined preview deployment**

Use a fresh authorized test identity or a clean dedicated test account. Complete
Google/password entry as applicable, workspace creation, preview, explicit
store, suggested private Ask, evidence display, completion, homepage return,
hard refresh, bfcache Back/Forward, visibility restore, and a second-tab session
revalidation in the browser at desktop and 320 CSS-pixel layouts. Verify focus,
keyboard operation, live errors, and file-reselection disclosure. Run the smoke
script against the immutable deployment and capture only redacted states/statuses.
Before the smoke, run
`npm run onboarding:redis:audit -- --key-file /secure/lacuna/onboarding-next.key --journal /secure/lacuna/onboarding-rotation.json --expect-ready-after-rotation`
against the exact deployment configuration and `npm run test:onboarding-redis`
against a disposable equivalent
Redis; neither command may print endpoints, credentials, fingerprints, owner ids,
input ids, or record bodies. Exercise a deployment with missing meta and prove
onboarding mutation routes return `503` with zero workspace writes; restore only
through the explicit audited administration command, never runtime initialization.

- [ ] **Step 7: Commit the first-run gate**

```bash
git add web/src/app/RequireWorkspace.tsx web/src/App.tsx web/src/auth/SignIn.tsx web/src/auth/SignUp.tsx web/src/auth/Forgot.tsx web/src/landing/account-actions.ts web/src/app/routes/Dashboard.tsx scripts/smoke-onboarding.ts package.json tests/unit/web-product-contracts.test.ts tests/unit/auth-api.test.ts tests/unit/landing-session.test.ts tests/unit/web-auth-client.test.ts
git commit -m "feat(onboarding): enforce and verify first workspace setup"
```
