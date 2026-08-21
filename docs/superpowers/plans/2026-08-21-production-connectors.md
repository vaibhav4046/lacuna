# Production Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn GitHub, Markdown/Text, PDF, DOCX, HTTPS API, and signed webhooks into real private-workspace ingestion paths whose persisted status, provenance, and failures are truthful.

**Architecture:** One server-owned connector catalogue and one `ConnectorRunner` normalize every supported source into `PreparedConnectorDocument` records before calling the existing governed `ingestSource` path for the authenticated workspace collection. Durable connector configuration lives in a separate HydraDB collection keyed by an opaque workspace digest; it never enters workspace retrieval. Network and upload adapters enforce hard budgets before extraction, and the private React surface renders only server-observed state.

**Tech Stack:** TypeScript, React, HydraDB Cloud, Node `https`/DNS primitives, `@fastify/busboy`, `pdfjs-dist`, `mammoth`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-production-convergence-design.md`

## Global Constraints

- `workspaceCollection(account.email)` is the only tenant-boundary derivation; no route accepts a workspace or collection from the client.
- Imported content reaches the same extractor, temporal merge, graph-edge, receipt-validation, and indexing-readiness path as private paste ingestion.
- Connector configuration records stay in `lacuna-connectors`, never in a workspace memory collection.
- No OAuth provider is claimed. GitHub supports public repositories only; API supports public HTTPS GET only; file import is an explicit upload; webhooks are Lacuna-issued HMAC endpoints.
- Every adapter has byte, item, time, and concurrency limits and returns redacted, stable errors.
- SSRF protection pins a validated public IP through the TLS request; it does not validate with DNS and then call ordinary `fetch`.
- A timed-out or queued Hydra write remains `accepted`/`indexing`, never `failed` or `connected`.
- Heavy verification runs with one worker.

---

### Task 1: Authoritative catalogue, state vocabulary, and durable store

**Files:**
- Create: `src/connectors/types.ts`
- Create: `src/connectors/catalog.ts`
- Create: `src/connectors/store.ts`
- Modify: `src/api/router.ts`
- Modify: `api/index.ts`
- Test: `tests/unit/connectors-catalog.test.ts`
- Test: `tests/unit/connectors-store.test.ts`
- Test: `tests/unit/connectors-api.test.ts`

**Interfaces:**
- Produces: `ConnectorId = 'github' | 'markdown' | 'text' | 'pdf' | 'docx' | 'https_api' | 'webhook'`
- Produces: `ConnectorAvailability = 'available' | 'unavailable'`
- Produces: `ConnectorRunState = 'idle' | 'syncing' | 'connected' | 'failed'`
- Produces: `ConnectorStore.get(workspace): Promise<ConnectorWorkspaceState>`
- Produces: `ConnectorStore.put(workspace, next): Promise<void>`
- Adds: `GET /api/workspace/connectors`

- [ ] **Step 1: Write catalogue invariants**

Assert every id is unique, labels/groups are non-empty, only implemented connector ids are `available`, GitLab/Slack/Notion/Gmail/Linear/Jira/Confluence remain `planned` in the public design catalogue, and webhook availability is false when its signing key is absent.

```ts
expect(catalogue({ webhookKey: undefined }).find((x) => x.id === 'webhook'))
  .toMatchObject({ availability: 'unavailable', reason: 'signing_not_configured' });
```

- [ ] **Step 2: Write store isolation and parser tests**

Use a fake `HydraCloud` and assert `CloudConnectorStore` writes deterministic ids under collection `lacuna-connectors`, stores only the opaque digest of the server-derived workspace id, uses `metadata.lacuna_record = 'connector_state'`, rejects malformed/version-foreign records, and never includes email, cookie, secret, webhook raw token, imported text, or workspace collection in returned client state.

- [ ] **Step 3: Write the authenticated catalogue route tests**

Require `401` without a session, `200` plus `Cache-Control: no-store` with a session, an ignored client `workspace` query/body field, and a response whose state is the catalogue merged with stored observations. Assert one-off import connectors remain `available`; only a valid persisted webhook configuration may be `connected`; no stale process can persist `syncing`.

- [ ] **Step 4: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/connectors-catalog.test.ts tests/unit/connectors-store.test.ts tests/unit/connectors-api.test.ts --maxWorkers=1`

Expected: modules, injected store, and route are absent.

- [ ] **Step 5: Implement the catalogue and versioned store**

Use the existing `CloudMcpCapabilities` exact-id/`inspect`/`ingestApp` pattern. Derive `workspaceDigest` with SHA-256 and retain 32 hex characters. Persist this shape:

```ts
interface StoredConnectorWorkspaceState {
  readonly version: 1;
  readonly workspaceDigest: string;
  readonly connectors: Readonly<Record<string, {
    readonly configuredAt: string | null;
    readonly lastAttemptAt: string | null;
    readonly lastSuccessAt: string | null;
    readonly lastFailure: ConnectorFailureCode | null;
    readonly importedDocuments: number;
  }>>;
}
```

Make store updates deterministic upserts. Do not promise cross-instance compare-and-swap; each completed operation writes a convergent summary derived from its own result. Map stored observations to client state at read time, and never persist `syncing`.

- [ ] **Step 6: Inject the store in production only when Hydra is configured**

Add `connectorStore?: ConnectorStore` and `connectorCatalog?: () => readonly ConnectorDescriptor[]` to `ApiOptions`. In `api/index.ts`, construct `new CloudConnectorStore(cloud)` next to the existing account/MCP stores. In the local node server, leave the store absent so the API answers `503` for connector writes rather than persisting misleading process-local state.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/connectors-catalog.test.ts tests/unit/connectors-store.test.ts tests/unit/connectors-api.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 8: Commit the state boundary**

```bash
git add src/connectors/types.ts src/connectors/catalog.ts src/connectors/store.ts src/api/router.ts api/index.ts tests/unit/connectors-catalog.test.ts tests/unit/connectors-store.test.ts tests/unit/connectors-api.test.ts
git commit -m "feat(connectors): persist truthful workspace connector state"
```

---

### Task 2: Shared normalization and governed connector runner

**Files:**
- Create: `src/connectors/normalize.ts`
- Create: `src/connectors/run.ts`
- Modify: `src/api/ingest.ts`
- Test: `tests/unit/connectors-normalize.test.ts`
- Test: `tests/unit/connectors-run.test.ts`
- Test: `tests/unit/ingest-source.test.ts`

**Interfaces:**
- Produces: `PreparedConnectorDocument`
- Produces: `ConnectorRunResult`
- Produces: `ConnectorRunner.run(workspace, request): Promise<ConnectorRunResult>`
- Consumes: `ingestPreparedSource(cloud, workspace, prepared, { awaitSearchable })`

- [ ] **Step 1: Write normalization limits and determinism tests**

Cover BOM/CRLF/NUL normalization, UTF-8 validity, title normalization, source URL canonicalization, stable SHA-256 content digest, duplicate documents, maximum 30 documents, maximum 4 MiB aggregate normalized text, and provenance headers. Require an identical input to produce an identical source key and Hydra record ids.

```ts
expect(prepareConnectorDocument({ title: ' README ', text: '\ufeffA\r\nB', provenance }))
  .toMatchObject({ title: 'README', text: 'A\nB' });
```

- [ ] **Step 2: Write runner receipt/readiness tests**

Inject a fake ingest boundary. Assert the runner sends only normalized documents into the authenticated workspace, caps concurrency at two, counts deduplicated documents once, waits for searchability when requested, distinguishes `accepted` from `searchable`, updates connector observations only after the result is known, and never returns `collection` or raw source bodies.

- [ ] **Step 3: Run tests and verify RED**

Run: `npx vitest run tests/unit/connectors-normalize.test.ts tests/unit/connectors-run.test.ts tests/unit/ingest-source.test.ts --maxWorkers=1`

Expected: shared connector document and runner contracts are absent.

- [ ] **Step 4: Expose a prepared-source ingest seam**

Retain the public `ingestSource(cloud, collection, title, rawText)` signature. Add `ingestPreparedSource` behind the same extractor/merge/index logic, accept an optional idempotent provenance key, and return a router-safe result through a dedicated serializer that omits `collection`. Do not fork temporal or graph logic into connectors.

- [ ] **Step 5: Implement the runner**

Normalize before any write, deduplicate by content digest plus canonical provenance, and execute at most two document ingests concurrently. Convert transport, parse, validation, refused-receipt, and readiness failures into the closed `ConnectorFailureCode` union. Store counts/timestamps/codes, never thrown provider bodies. Mark `connected` only for persisted recurring configuration; one-off successful imports remain `available` with `lastSuccessAt`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/connectors-normalize.test.ts tests/unit/connectors-run.test.ts tests/unit/ingest-source.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 7: Commit the shared ingestion boundary**

```bash
git add src/connectors/normalize.ts src/connectors/run.ts src/api/ingest.ts tests/unit/connectors-normalize.test.ts tests/unit/connectors-run.test.ts tests/unit/ingest-source.test.ts
git commit -m "feat(connectors): converge imports through governed ingestion"
```

---

### Task 3: Markdown, text, PDF, and DOCX preview/import

**Files:**
- Create: `src/connectors/files.ts`
- Modify: `src/api/router.ts`
- Modify: `api/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `web/src/api/connectors.ts`
- Test: `tests/unit/connectors-files.test.ts`
- Test: `tests/unit/connectors-api.test.ts`

**Interfaces:**
- Adds: `POST /api/workspace/connectors/file/preview`
- Adds: `POST /api/workspace/connectors/file/import`
- Produces: `parseUploadedFile(stream, headers): Promise<PreparedFile>`
- Produces: `previewUploadedFile(prepared): FilePreview`

- [ ] **Step 1: Install bounded parsers**

Run: `npm install @fastify/busboy pdfjs-dist mammoth`

Expected: root `package.json` and lockfile record runtime dependencies available to the Vercel function.

- [ ] **Step 2: Add fixture-driven parser tests**

Create small test fixtures in `tests/fixtures/connectors/` for UTF-8 text, Markdown, text PDF, image-only PDF, valid DOCX, and corrupt/polyglot files. Cover an 8 MiB upload cap, one file only, extension/MIME/magic agreement, filename sanitization, BOM handling, PDF page order, DOCX paragraph/table text, no media/macro extraction, empty-result rejection, and SHA-256 digest stability.

- [ ] **Step 3: Add route-security and preview/import parity tests**

Require session plus CSRF for both multipart routes. Assert preview performs zero Hydra writes and returns redacted extraction counts/kept/unread text plus file digest. Import must present that expected digest; a mismatch returns `409`. Assert multipart boundaries are accepted without a manually supplied JSON content type and malformed/oversized streams are terminated with stable `400`/`413` responses.

- [ ] **Step 4: Run tests and verify RED**

Run: `npx vitest run tests/unit/connectors-files.test.ts tests/unit/connectors-api.test.ts --maxWorkers=1`

Expected: parsers and routes are absent.

- [ ] **Step 5: Implement streaming multipart and file extraction**

Parse one stream with `@fastify/busboy` and stop reading at 8 MiB. Accept `.txt`, `.md`, `.markdown`, `.pdf`, `.docx`; use UTF-8 fatal decoding for text, `pdfjs-dist` text items for PDF, and `mammoth.extractRawText({ buffer })` for DOCX. Normalize output once through `prepareConnectorDocument`. Preview invokes the shared extraction preview but never the runner; import verifies the digest then invokes the runner with `awaitSearchable: true`.

- [ ] **Step 6: Add the browser multipart client**

Implement `previewFile(file, csrf)` and `importFile(file, digest, csrf)` with `FormData`, the existing request timeout/abort discipline, and `X-CSRF-Token`. Do not set `Content-Type`; the browser owns the multipart boundary. Never log file content.

- [ ] **Step 7: Verify Vercel packaging**

Run: `npm ci`

Run: `npm run typecheck`

Run: `npx vitest run tests/unit/connectors-files.test.ts tests/unit/connectors-api.test.ts --maxWorkers=1`

Expected: dependencies resolve from the root function package and all focused tests pass.

- [ ] **Step 8: Commit file connectors**

```bash
git add src/connectors/files.ts src/api/router.ts api/index.ts web/src/api/connectors.ts package.json package-lock.json tests/fixtures/connectors tests/unit/connectors-files.test.ts tests/unit/connectors-api.test.ts
git commit -m "feat(connectors): import real workspace files"
```

---

### Task 4: Bounded public GitHub repository import

**Files:**
- Create: `src/connectors/github.ts`
- Modify: `src/api/router.ts`
- Modify: `api/index.ts`
- Test: `tests/unit/connectors-github.test.ts`
- Test: `tests/unit/connectors-api.test.ts`

**Interfaces:**
- Adds: `POST /api/workspace/connectors/github/import`
- Produces: `GitHubImporter.importPublicRepo(url, signal): Promise<PreparedConnectorBatch>`

- [ ] **Step 1: Write GitHub URL and budget tests**

Accept only canonical `https://github.com/<owner>/<repo>` public repository URLs with optional `/tree/<ref>/<path>`. Reject credentials, query/fragment ambiguity, non-GitHub hosts, non-HTTPS, Unicode host tricks, and API redirects to another origin. Use fake GitHub responses to enforce 20 seconds total, 100 tree entries considered, 30 imported files, 512 KiB per file, and 4 MiB aggregate normalized text.

- [ ] **Step 2: Write provenance and filtering tests**

Require the resolved commit SHA, canonical repository URL, relative path, blob SHA, and retrieval timestamp in each prepared document. Skip symlinks, submodules, binary files, vendored/build directories, secrets by filename, and unsupported extensions. A skipped file appears only as a reason/count, never as an empty stored memory.

- [ ] **Step 3: Write the route tests and verify RED**

Require session, CSRF, private ingest quota, ignored client workspace, `501` when the importer is not injected, redacted GitHub failures, and a successful response that exposes counts/digest/searchability but not collection names or source bodies.

Run: `npx vitest run tests/unit/connectors-github.test.ts tests/unit/connectors-api.test.ts --maxWorkers=1`

Expected: GitHub adapter and route are absent.

- [ ] **Step 4: Implement the public GitHub adapter**

Call only GitHub's public REST endpoints with fixed `Accept`, `User-Agent`, and `X-GitHub-Api-Version` headers. Resolve the ref to one commit before listing/reading blobs so the batch is immutable. Do not accept or read a user token. Use the shared normalization and runner; do not clone or execute repository content.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/connectors-github.test.ts tests/unit/connectors-run.test.ts tests/unit/connectors-api.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 6: Commit GitHub import**

```bash
git add src/connectors/github.ts src/api/router.ts api/index.ts tests/unit/connectors-github.test.ts tests/unit/connectors-api.test.ts
git commit -m "feat(connectors): import bounded public GitHub context"
```

---

### Task 5: SSRF-safe public HTTPS JSON/text import

**Files:**
- Create: `src/connectors/https.ts`
- Modify: `src/connectors/normalize.ts`
- Modify: `src/api/router.ts`
- Modify: `api/index.ts`
- Test: `tests/unit/connectors-https.test.ts`
- Test: `tests/unit/connectors-api.test.ts`

**Interfaces:**
- Adds: `POST /api/workspace/connectors/api/import`
- Produces: `PinnedHttpsReader.read(url, signal): Promise<PreparedConnectorDocument>`

- [ ] **Step 1: Write URL/DNS/IP rejection tests**

Reject all schemes except HTTPS, ports except 443, credentials, fragments, more than 2,048 URL characters, localhost names, numeric/octal/hex IP spellings, and DNS results in loopback, private, link-local, multicast, carrier-grade NAT, documentation, benchmark, unspecified, or reserved IPv4/IPv6 ranges. Reject mixed public/private DNS answers rather than choosing the public one.

- [ ] **Step 2: Write DNS-rebinding, cancellation, concurrency, and response-budget tests**

Inject a cancellable complete A+AAAA resolver and `https.request`. Assert the request's custom `lookup` returns the exact validated address while retaining the original hostname for SNI/certificate checks. Disable agents/keep-alive and redirects. Enforce one 10-second deadline, at most three active reads, a 1 MiB de-chunked entity-body budget with no decompression path, at most 100 JSON scalar leaves plus 512 total nodes/100 members per container, depth 8, and only `application/json`, `text/plain`, or `text/markdown` UTF-8 content. Persist only origin plus a pathname digest; never persist the path or query.

- [ ] **Step 3: Write canonicalization/redaction tests**

Flatten JSON with sorted object keys and stable array indexes. Store provenance with origin/path and a SHA-256 digest, but redact the query string from client responses, durable state, errors, and logs. Never accept caller-supplied headers, cookies, methods, request bodies, or redirect permission.

- [ ] **Step 4: Write route tests and verify RED**

Run: `npx vitest run tests/unit/connectors-https.test.ts tests/unit/connectors-api.test.ts --maxWorkers=1`

Expected: safe HTTPS reader and route are absent.

- [ ] **Step 5: Implement pinned HTTPS transport**

Use a per-read cancellable resolver from `node:dns/promises`, plus `node:net` and `node:https`. Resolve A+AAAA once, validate every answer, choose a deterministic public address, and pass a custom `lookup` to `https.request` while leaving `hostname` unchanged. Set `servername` to the hostname, `rejectUnauthorized: true`, `agent: false`, no redirect behavior by construction, and abort/tear down DNS/request/response/socket work on every limit violation. Bind typed HTTPS provenance into normalization/source identity and fail closed when the real reader is not injected.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/connectors-https.test.ts tests/unit/connectors-run.test.ts tests/unit/connectors-api.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 7: Commit public HTTPS import**

```bash
git add src/connectors/https.ts src/connectors/normalize.ts src/api/router.ts api/index.ts tests/unit/connectors-https.test.ts tests/unit/connectors-normalize.test.ts tests/unit/connectors-api.test.ts
git commit -m "feat(connectors): import pinned public HTTPS sources"
```

---

### Task 6: Signed webhook lifecycle with bounded at-least-once convergence

**Files:**
- Create: `src/connectors/webhook.ts`
- Create: `src/connectors/webhook-store.ts`
- Modify: `src/hydra/cloud.ts`
- Modify: `src/connectors/store.ts`
- Modify: `src/connectors/normalize.ts`
- Modify: `src/connectors/types.ts`
- Modify: `src/connectors/catalog.ts`
- Modify: `src/connectors/run.ts`
- Modify: `src/api/ingest.ts`
- Modify: `src/api/router.ts`
- Modify: `api/index.ts`
- Modify: `src/server/server.ts`
- Modify: `vercel.json`
- Modify: `.env.example`
- Test: `tests/unit/connectors-webhook.test.ts`
- Test: `tests/unit/connectors-api.test.ts`
- Test: `tests/unit/connectors-store.test.ts`
- Test: `tests/unit/connectors-normalize.test.ts`
- Test: `tests/unit/connectors-catalog.test.ts`
- Test: `tests/unit/connectors-run.test.ts`
- Test: `tests/unit/ingest-source.test.ts`

**Interfaces:**
- Adds: `POST /api/workspace/connectors/webhook`
- Adds: `GET /api/workspace/connectors/webhook`
- Adds: `DELETE /api/workspace/connectors/webhook/:id`
- Adds: `POST /api/connectors/webhook/:id`
- Produces: `WebhookService.issue(workspace): Promise<IssuedWebhook>`
- Produces: `WebhookService.accept(id, headers, rawBody, control): Promise<WebhookReceipt>`
- Produces: `WebhookRequestControl { requestSignal, startedAtMs, settlementDeadlineMs }`
- Extends: `HydraCloud.ingestApp(records, collection, control?)` and connector-store operations with bounded signal/deadline controls

- [ ] **Step 1: Write issuance and secret-storage tests**

Require authenticated state/issuance/revocation routes with CSRF on mutations,
an endpoint id encoded from exactly 16 random bytes, and one-time return of a
256-bit signing secret. Use the exact domain-separated HMAC/AES-GCM formats in
the Task 6 brief. Persist a strict encrypted workspace binding, keyed owner
digest, lifecycle record, authoritative active pointer, and one bounded replay
window; never persist or redisplay the signing secret. Return
`503 signing_not_configured` unless the complete service was instantiated from
one exact 32-byte dedicated key, store, runner, origin, and runtime boundary.

- [ ] **Step 2: Write verification/replay tests**

Define headers `X-Lacuna-Timestamp`, `X-Lacuna-Event-Id`, and
`X-Lacuna-Signature: v1=<hex>`. Sign
`timestamp + '.' + eventId + '.' + rawBody` with HMAC-SHA-256. Use
constant-time comparison, a five-minute clock window, event ids of 16–128 safe
characters excluding `.`, a 256 KiB de-chunked entity-body cap, and a bounded
best-effort replay window. Reject
missing/duplicate headers, malformed JSON, revoked ids, bad signatures,
stale/future timestamps, and visible repeated/conflicting event ids before
ingestion. Require signed canonical `observed_at` so retries preserve temporal
evidence.

- [ ] **Step 3: Write at-least-once convergence tests**

Simulate a timeout after Hydra accepts an event, then retry the same signed body. Assert deterministic source records converge and the response preserves accepted/searchability uncertainty. Test two independent service instances and explicitly record that Hydra has no CAS: visible-window duplicate/conflict detection, issuance serialization, and revocation cutoff are not globally linearizable. Never claim exactly-once or globally replay-proof delivery.

Also prove every queue acquisition, Hydra read, workspace pre-write merge, submitted
Hydra write, readiness poll, connector-observation read/write/readback, and replay
finalization is clipped by one absolute handler deadline. A request disconnect before
the workspace write is submitted must produce zero ingest; after submission it must
not cancel the settlement attempt or turn a missing exact receipt into a known-zero
failure. Extend the runner result with an allowlisted indeterminate-submission fact
so the webhook serializer can distinguish a confirmed refusal from a write whose
receipt was lost.

- [ ] **Step 4: Run tests and verify RED**

Run: `npx vitest run tests/unit/connectors-webhook.test.ts tests/unit/connectors-api.test.ts --maxWorkers=1`

Expected: webhook service and routes are absent.

- [ ] **Step 5: Implement lifecycle and raw-body routing**

Use a dedicated exact-readback webhook record store. Persist endpoint first and active pointer second; stale pointers are inert. Maintain at most 256 keyed event markers in one bounded per-hook replay-window record through a process-local queue, acknowledging cross-instance lost updates. The public receiver uses a strict raw-body/framing reader, verifies exact bytes before fatal UTF-8/JSON parsing, then accepts exact `{ title, text, observed_at }`. Recheck visible lifecycle immediately before runner submission. Delete marks the endpoint revoked; it does not erase audit state and cannot cancel a different instance already past the commit boundary.

Capture `startedAtMs` before body acquisition and pass the request-disconnect signal
plus exact `settlementDeadlineMs = startedAtMs + 240_000` through the body reader and
`WebhookService.accept`. Before the workspace write is submitted, request disconnect
or deadline aborts all work. Once submitted, ignore only the client-disconnect signal,
continue under the internal phase deadline, and classify every missing/invalid exact
Hydra receipt as indeterminate. Add deadline-aware/cancellable controls to
`HydraCloud.ingestApp`, workspace mutation acquisition, `ConnectorRunner`, and
`CloudConnectorStore` get/put/readback; queued work may not outlive its caller.

- [ ] **Step 6: Document configuration without a fallback secret**

Add `LACUNA_WEBHOOK_KEY=` to `.env.example` with a generation command and explicit server-only/destructive-rotation note. A retired key must never be restored. In `api/index.ts`, instantiate the service only for a valid key and complete dependencies. Do not fall back to `HYDRA_TOKEN`, OAuth credentials, or a source-controlled constant. Redact webhook ids from application request/error paths. The linked project was verified with Fluid Compute enabled and a current 300-second maximum; configure `api/index.ts` `maxDuration` to 270 seconds around a 240-second internal settlement budget and re-verify after deployment.

Make the budget executable by scheduling backward from the absolute settlement
deadline: reserve the final 10 seconds for accepted-only replay merge/readback, the
preceding 20 seconds for connector-observation get/put/exact-readback, the preceding
30 seconds for readiness, up to 120 seconds for the single submitted Hydra ingest,
and up to 20 seconds for bounded workspace-queue acquisition plus all pre-write
index/entity reads. Therefore do not enter the runner unless at least 200 seconds
remain. Body acquisition is at most five seconds; endpoint/index authorization,
the owner-lock wait, replay lookup, and final lifecycle recheck must finish before
that admission point. Each phase receives the earlier of its local cap or its
backward-derived absolute deadline, and no later phase may borrow a reserved tail.
Cap webhook graph output at one 25-record batch before any write. An observation
timeout cannot erase a confirmed accepted receipt, and replay finalization never
runs past the hard deadline. Stage a generous POST+webhook-path WAF rate-limit in
log-only mode for traffic review; do not describe it as enforced until the staged
rule is reviewed and published.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/connectors-webhook.test.ts tests/unit/connectors-api.test.ts tests/unit/connectors-store.test.ts tests/unit/connectors-normalize.test.ts tests/unit/connectors-catalog.test.ts tests/unit/connectors-run.test.ts tests/unit/ingest-source.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 8: Commit signed webhooks**

```bash
git add src/connectors/webhook.ts src/connectors/webhook-store.ts src/hydra/cloud.ts src/connectors/store.ts src/connectors/normalize.ts src/connectors/types.ts src/connectors/catalog.ts src/connectors/run.ts src/api/ingest.ts src/api/router.ts api/index.ts src/server/server.ts vercel.json .env.example tests/unit/connectors-webhook.test.ts tests/unit/connectors-api.test.ts tests/unit/connectors-store.test.ts tests/unit/connectors-normalize.test.ts tests/unit/connectors-catalog.test.ts tests/unit/connectors-run.test.ts tests/unit/ingest-source.test.ts
git commit -m "feat(connectors): accept signed at-least-once webhooks"
```

---

### Task 7: Real connector product surface

**Files:**
- Modify: `src/api/router.ts`
- Modify: `src/auth/voice-binding.ts` only if the existing exact-session primitive needs a connector-safe export
- Create: `web/src/app/routes/connectors.tsx`
- Modify: `web/src/app/routes/developers.tsx`
- Modify: `web/src/app/RouteBody.tsx`
- Modify: `web/src/app/routes.ts`
- Modify: `web/src/app/Shell.tsx`
- Modify: `web/src/app/product-contracts.ts`
- Modify: `web/src/api/session-state.ts`
- Modify: `web/src/api/session.tsx`
- Modify: `web/src/api/auth.ts`
- Modify: `web/src/design/connectors.ts`
- Modify: `web/src/landing/Conn.tsx`
- Modify: `web/src/app/routes/context.tsx`
- Modify: `web/src/onboarding/Onboarding.tsx`
- Modify: `web/src/app/routes/Dashboard.tsx`
- Modify: `web/src/app/routes/system.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api/connectors.ts`
- Modify: `web/src/styles.css`
- Test: `tests/unit/web-connectors.test.ts`
- Test: `tests/unit/web-connectors-client.test.ts`
- Test: `tests/unit/web-product-contracts.test.ts`
- Test: `tests/unit/web-auth-client.test.ts`
- Test: `tests/unit/connectors-api.test.ts`

**Interfaces:**
- Consumes: all private connector routes with the current non-secret exact-session binding
- Produces: real forms for file, GitHub, HTTPS API, and webhook setup/revocation
- Produces: closed client outcomes `receipt | known_refusal | indeterminate | discarded`
- Produces: one generation-monotonic, cross-tab session invalidation epoch that unmounts private connector state before revalidation

- [ ] **Step 1: Write product-contract tests**

Require every private connector GET/POST/DELETE to carry the current non-secret
exact-session binding and prove mismatch before catalogue/store/importer/runner
work. Key client state by `session.binding + workspace`, generation-guard every
response, and test A request followed by cookie/session B: the server returns
`401` with zero work and a delayed A response can neither render nor authorize a
B revoke. On any epoch change synchronously clear/abort files, preview tokens,
URLs, receipts, errors, endpoint ids, and secrets.

Make that epoch executable across the whole browser, not only inside the
connector component. Test `SessionProvider` with overlapping reads whose A
response settles after B: latest-started wins, an older generation never enters
context, and a superseded `refresh()` does not release its caller before the
current generation settles. Use one versioned, non-sensitive cross-tab
invalidation message containing only a fresh random nonce—never email,
workspace, binding, cookie, token, endpoint, receipt, or secret—over both
`BroadcastChannel('lacuna-session-epoch-v1')` and the
`lacuna_session_epoch_v1` storage-event fallback; the message is exactly
`{ version: 1, nonce: <32 lowercase hex> }`, with the nonce generated from 16
bytes of `crypto.getRandomValues`. Accept only that closed object (no extra
keys), ignore malformed or already-seen messages, and never let an invalid
message start a session read. Successful sign-in, sign-up,
recovery, sign-out, and every newly observed validated session/binding/workspace
transition publish once. Retain the last validated signed-out or binding/workspace
tuple across the temporary `loading` state: a remote-event revalidation never
rebroadcasts, and a focus/pageshow revalidation publishes only if that retained
tuple actually changed. Deduplicate the same nonce across both transports and
record the trigger cause so no receive/revalidate path can form a new-nonce
loop. A remote event, `pageshow`, or window focus must synchronously increment
the local generation, abort the active session read, set session state to
`loading` so `RequireSession` unmounts the private Shell/portal, and only then
start one no-store `/api/session` revalidation. The Shell keys its private route
body by the exact validated binding/workspace tuple, so applying B cannot render
one frame of A component state. Close channels and remove storage/pageshow/focus
listeners on cleanup. Cover two-tab sign-out/sign-in and account swap while the
one-time webhook modal is open: A's portal/secret disappear before B renders and
no A request/result is reused.

Require hash-preserving `/app/connectors -> /app/conn` and
`/explore/connectors -> /explore/conn` aliases with only `#file`, `#github`,
`#https-api`, and `#webhook`. Private and public-read-only components are
structurally separate; Explore performs zero `/api/workspace/*` requests, and
direct refresh of every alias/hash resolves correctly.

Require strict catalogue, receipt, and webhook-state decoders plus exactly one
fetch/no retry. Test file select -> preview -> review -> distinct confirm with
the identical `File`/token; file/epoch/unmount/409 invalidation; GitHub/HTTPS
review then one confirmed POST; query redaction; accepted 1/searchable 0;
accepted with failed/stale observation write; duplicate-only; known refusal;
invalid 2xx; timeout/lost response after dispatch; refresh and concurrent newer
catalogue observation. Missing/invalid/lost mutation responses are
`indeterminate`, never zero/failed and never automatically retried.

The catalogue is a durable recorded observation, not an authoritative inventory
or cross-instance counter. Add two independent-instance regressions in which
both runs read the same prior observation and one accepted-document delta is
lost, plus an accepted receipt whose observation write is `failed` followed by
refresh. In both cases the in-memory receipt preserves the exact acceptance,
while refreshed catalogue copy uses exactly `RECORDED ACCEPTED DOCUMENTS` and
`LAST RECORDED ACCEPTANCE`, explicitly says the observation may lag because it
was stale, concurrent, or failed to persist, and never says cumulative, total,
latest, or reconstructs the missing acceptance.

Test webhook authoritative-state load, issue-response loss followed by refetch,
configured-without-secret recovery through explicit revoke then issue,
acknowledgement, revoke-response loss/refetch, and reissue. Planned controls are
absent/inert. Test focus containment/return, concise secret-free live regions,
secret absence from attributes/storage/history/analytics/console, listener/timer
cleanup, and the 320px card/no-overflow/VoiceDock-clearance contract. Forbid
source bodies, collection ids, secret redisplay, `OAuth`, persisted `syncing`,
or any durable status derived from a timer.

Pin the webhook lifecycle wire contract in those tests. Issue is exactly one
`POST /api/workspace/connectors/webhook` with no request body and no
`Content-Type`; a valid new issue is status `201` with the exact closed shape
`{ created: true, endpointId, endpoint, secret, configuredAt }`, while an
already-configured result is status `200` with the same keys, `created: false`,
and `secret: null`. The id is exactly 22 canonical base64url characters and a
created secret exactly 43 canonical base64url characters. Any other status/body
pairing or extra/missing field is
invalid. Before revealing a `201` secret, perform one authoritative no-store
`GET /api/workspace/connectors/webhook` and require strict configured-state
agreement on endpoint id, same-origin endpoint path, and canonical configured
time. If E1's issue response arrives after another instance makes E2 active,
discard E1's secret before it reaches the DOM/clipboard and render E2 as
configured with secret unavailable. Unavailable/invalid readback is
`indeterminate`, clears the secret, and never claims connected. Revoke captures
only the latest generation's validated authoritative id; `200 { revoked: true }`
is the sole valid success, and `404`, loss, or invalid response triggers one GET
without retrying DELETE. Test E1-late/E2-active, readback mismatch/unavailability,
and a stale confirmation that cannot revoke E2.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npx vitest run tests/unit/connectors-api.test.ts tests/unit/web-connectors-client.test.ts tests/unit/web-connectors.test.ts tests/unit/web-product-contracts.test.ts tests/unit/web-auth-client.test.ts --maxWorkers=1`

Expected: the current developers page is a static list and has no real route/forms.

- [ ] **Step 3: Build the route from server state**

Build a generation-bound coordinator with two separate models. The durable
catalogue comes from no-store `GET /api/workspace/connectors`; label
`lastSuccessAt` as `LAST RECORDED ACCEPTANCE`, show `RECORDED ACCEPTED DOCUMENTS`
and last failure, and place stable copy beside those fields that they may lag
when a concurrent/stale update wins or observation persistence fails. Never call
them cumulative, total, latest, or an authoritative inventory, and never
reconstruct searchable counts after refresh. The
in-memory validated operation receipt alone shows exact accepted/searchable/
duplicate/failed counts and a safe digest/reference; accepted truth survives
readiness or observation-write failure/staleness. Every settled mutation causes
an authoritative no-store refetch without overwriting its validated receipt.

Use dedicated closed connector clients, not generic retrying `postJson`. Every
request has a hardwired same-origin path, credentials, `Accept`, exact-session
binding, CSRF for mutations, caller signal, endpoint-aware timeout, and exactly
one fetch. External URLs appear only in exact JSON bodies. Invalid successful
mutation responses are indeterminate. The webhook endpoint is text/copy only,
never a response-controlled link.

Webhook issue is the one non-JSON mutation request: send no body and no
`Content-Type`. Decode the exact `201 created:true + secret` and
`200 created:false + null` shapes above, and decode state as either exact
`configured:false` with all nullable fields null or exact `configured:true` with
a 22-character id, canonical instant, and endpoint equal to
`window.location.origin + '/api/connectors/webhook/' + endpointId`. The state
GET, not an issuance response, selects the active id. An exact import operation
receipt remains visible across ordinary catalogue refresh, but a lifecycle
response may never override a newer authoritative webhook pointer.

Implement explicit state machines. File: select exact object -> preview ->
review -> distinct confirm reusing object/token; any file event, epoch change,
unmount, or server replay refusal clears preview/token. Expiry is server-decided;
no countdown, auto-preview, import, or retry. GitHub/HTTPS: local review then one
distinct confirmed POST; never repeat/redeliver an HTTPS query. A lost import
response clears consumed credentials and shows indeterminate/check-memory
guidance. Webhook loads both catalogue and authoritative dedicated state. A lost
issue response refetches; configured-without-secret requires explicit revoke then
issue. Lost revoke refetches and never retries automatically.

For issue, hold the decoded secret in a non-rendered provisional local until the
one mandatory state GET confirms the exact same id/endpoint/configured time;
only then open the acknowledgement modal. A different active pointer wins and
destroys the provisional secret. A state error destroys it and renders
indeterminate guidance. This is point-in-time visible-state arbitration only:
copy must retain Task 6's truthful process-local issuance/revocation limits and
must not imply globally linearizable setup.

Show the one-time webhook endpoint and secret in a portalled modal with separate
COPY controls and explicit acknowledgement. Contain focus; make Shell navigation
and voice launcher inert; do not allow backdrop/Escape dismissal before
acknowledgement; restore focus exactly; keep the secret out of attributes/live
regions/storage/history/logs. Best-effort navigation/beforeunload protection is
allowed, but forced close is truthfully recovered as configured-without-secret.

- [ ] **Step 4: Keep signed-out and planned catalogue truthful**

Change `web/src/design/connectors.ts` to presentation metadata only and define
one exact final server-id mapping. Four file ids remain four observations inside
one file workflow; do not aggregate their durable counts. Runtime availability
or connection state is never hard-coded, and only authoritative active webhook
state may say `CONNECTED`. Keep every unimplemented integration disabled,
`PLANNED`, noninteractive, and handler-free.

Render structurally separate private and Explore read-only surfaces. Update
landing, onboarding, Memory/context, Dashboard, RouteBody, and deep links so no
copy still calls implemented GitHub/HTTPS/file/webhook planned, and no public
page renders a private form. Planned/presentation copy remains truthful to the
server mapping. Preserve explicit limits: manual public one-off GitHub/HTTPS,
bounded at-least-once webhook with process-local limits, and process-local file
preview replay protection. Do not say live-verified before disposable deployed
smoke evidence exists.

- [ ] **Step 5: Run UI, accessibility, and build gates**

Run: `npx vitest run tests/unit/connectors-api.test.ts tests/unit/web-connectors-client.test.ts tests/unit/web-connectors.test.ts tests/unit/web-product-contracts.test.ts tests/unit/web-auth-client.test.ts --maxWorkers=1`

Run: `npm --prefix web run typecheck`

Run: `npm --prefix web run build`

Expected: tests/build pass; every input has a label/error association, status is
text as well as colour, result/error focus transfer and modal focus return are
exact, reduced motion is honored, listeners/timers are cleaned up, and no secret
or query reaches local/session storage, history, analytics, console, attributes,
or a live region. At 320px use labelled cards, `minmax(0,1fr)`, wrapping safe
filenames/digests/endpoint text, 44px controls, and enough bottom clearance for
VoiceDock with no horizontal overflow.

- [ ] **Step 6: Commit the real connector UI**

```bash
git add src/api/router.ts src/auth/voice-binding.ts web/src/app/routes/connectors.tsx web/src/app/routes/developers.tsx web/src/app/RouteBody.tsx web/src/app/routes.ts web/src/app/Shell.tsx web/src/app/product-contracts.ts web/src/api/session-state.ts web/src/api/session.tsx web/src/api/auth.ts web/src/design/connectors.ts web/src/landing/Conn.tsx web/src/app/routes/context.tsx web/src/onboarding/Onboarding.tsx web/src/app/routes/Dashboard.tsx web/src/app/routes/system.tsx web/src/App.tsx web/src/api/connectors.ts web/src/styles.css tests/unit/connectors-api.test.ts tests/unit/web-connectors-client.test.ts tests/unit/web-connectors.test.ts tests/unit/web-product-contracts.test.ts tests/unit/web-auth-client.test.ts
git commit -m "feat(connectors): expose truthful private import workflows"
```

---

### Task 8: Workspace-scoped Hydra graph impact over imported memory

**Files:**
- Modify: `src/retrieval/resolve.ts`
- Modify: `src/hydra/cloud.ts`
- Modify: `src/hydra/client.ts`
- Modify: `src/hydra/source.ts`
- Modify: `src/hydra/cloud-source.ts`
- Modify: `src/hydra/node-source.ts`
- Modify: `src/hydra/relations.ts`
- Modify: `src/api/graph.ts`
- Modify: `src/api/router.ts`
- Modify: `api/index.ts`
- Modify: `src/api/impact.ts`
- Modify: `web/src/app/routes/proof.tsx`
- Test: `tests/unit/graph-impact.test.ts`
- Test: `tests/unit/graph-api.test.ts`
- Test: `tests/unit/retrieval-resolve.test.ts`
- Test: `tests/unit/client.test.ts`
- Test: `tests/unit/cloud-source.test.ts`
- Test: `tests/unit/ingest-source.test.ts`
- Test: `tests/unit/relations.test.ts`
- Create: `tests/unit/hydra-cloud-impact-transport.test.ts`
- Create: `tests/unit/workspace-impact-api.test.ts`
- Create: `tests/unit/workspace-impact-ui.test.tsx`
- Test: `tests/unit/web-product-contracts.test.ts`

**Interfaces:**
- Adds: `GET /api/workspace/impact?subject=<bounded-name>`
- Adds: required `HydraReadControl { signal, deadlineMs, maxResponseBytes,
  byteBudget }` on
  `HydraCloud.query`, `relations`, and `inspect`, and on
  `HydraSource.subject` plus both source implementations and every typed fake
- Consumes: workspace-scoped `HydraCloud.withCollection(collection).query(...,
  { type: 'all', maxResults: 6 }, control)`, `.relations(128, control)`, and
  `HydraSource.subject(..., control)` views
- Produces: one target-level `evaluateTargetStanding` policy consumed by
  `resolve.ts`, `impact.ts`, and both public/private proof construction in
  `src/api/graph.ts`
- Produces: bounded raw Hydra relationship/chunk/source provenance plus
  accepted, rejected, duplicate, affected, depth, elapsed, and exact reached
  accounting; it never returns a provider envelope or workspace identifier

- [ ] **Step 1: Write the private-scope, transport, and accounting regressions**

Require `401` before constructing a Hydra client, derive the collection only
from the authenticated account on every call, and never accept a collection,
database, workspace, source id, or provider option from the query string. A
session/account change aborts the read and its epoch cannot update the new
scope. Reject a missing, repeated, empty, malformed, or over-cap `subject`
before Hydra. Return `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff` on success and error. Use two fake accounts
with the same subject to prove query, relation, inspect, cache keys, response,
and retry cannot cross collections. The route returns generic bounded errors;
it never leaks collection, database, workspace, email, token, request body,
provider body, provider URL, or provider error text.

Name the transport suite `hydra-cloud-impact-transport.test.ts`. It must prove:
the absolute deadline is not reset between reads; caller abort reaches query,
relations, inspect, cloud subject, and node subject; query/relations siblings
abort each other on either failure; the implementation awaits both with
`Promise.allSettled` semantics and removes caller listeners/timers; success and
error bodies stop at the streamed byte cap before UTF-8/JSON decode; exact-cap
bodies pass; truncated, invalid UTF-8, duplicate-key JSON, wrong-type, extra-key,
and over-row responses fail closed; a schema-valid empty response is distinct
from malformed. Cover a normal close immediately before and after caller abort
and assert no surviving fetch/read/subject promise after route settlement.

Do not let the wire decoder erase provenance or duplicates. A query chunk is
strictly `{ chunkId, text, score, sourceIds, sourceTitle, sourceType,
observedAt }`: `chunkId` comes only from the provider chunk `id`; `sourceIds`
is the bounded stable union of independently supplied `source_id` followed by
`source_ids[]` and never substitutes the chunk id. A relation is strictly
`{ relationshipId, source, target, predicate, chunkId, context }`:
`chunkId` comes only from provider `chunk_id`. Test singular source id, array
source ids, both, neither, relationship/chunk id present and absent, and the
same exact duplicate occurrence twice. Preserve every occurrence until schema
validation, repeated-id consistency checking, canonical ordering, and
accounting are complete.

Cover shuffled claims and candidates, current/historical/retracted/negative
standing, single-value contradiction, multi-value predicates, matching and
missing mentions, unrelated predicates, every allowed forward/inverse
predicate, an unknown near-match, cycles, exact caps and cap+1 for every
numeric/string/byte budget, peer cancellation, and empty-versus-malformed
decoding. Assert for every successful response:
`reached === accepted.length + rejected.length + duplicates` and every reached
occurrence has exactly one outcome. Provider/schema over-cap is a generic
request failure, while a valid candidate excluded by a traversal budget is a
`budget_excluded` rejection and participates in that arithmetic.

- [ ] **Step 2: Run focused graph tests and verify RED**

Run: `npx vitest run tests/unit/retrieval-resolve.test.ts tests/unit/client.test.ts tests/unit/relations.test.ts tests/unit/hydra-cloud-impact-transport.test.ts tests/unit/graph-impact.test.ts tests/unit/graph-api.test.ts tests/unit/workspace-impact-api.test.ts tests/unit/workspace-impact-ui.test.tsx --maxWorkers=1`

Expected: the shared target policy, strict bounded transport, private endpoint,
and scope-aware proof fixture are absent.

- [ ] **Step 3: Extract one canonical entity and target-standing policy**

Expose one `canonicalEntityName(raw)` helper and one pure
`evaluateTargetStanding(subjectView, internalPredicate, targetKey)` evaluator
from the resolver policy module. `resolve.ts`, `impact.ts`, and
`src/api/graph.ts` must call these helpers; remove their local first-match,
contradiction, mention, case, and whitespace variants. This is a target-level
decision, not “the predicate has some current claim.”

The entity grammar is exact. Reject unpaired surrogates, NUL, C0/C1 controls,
and U+202A..U+202E/U+2066..U+2069 bidi controls. NFC-normalize; map each
remaining Unicode `White_Space` run to U+0020; trim/collapse U+0020; then require
1..160 Unicode scalar values and at most 512 UTF-8 bytes. The canonical key is
that normalized display value's locale-independent ECMAScript `toLowerCase()`;
reapply the same scalar/byte caps after lowercasing because Unicode lowercase
can expand. No NFKC, locale fold, filesystem fold, or provider id participates.
Preserve the validated display spelling separately and choose the first
spelling in canonical candidate order, never arrival order.

The closed provider-predicate map is:

| Provider predicate after ASCII trim/collapse and lowercase | Internal predicate | Direction |
|---|---|---|
| `depends_on`, `depends on`, `depended on`, `requires`, `uses`, `calls` | `depends_on` | provider source → provider target |
| `required by`, `used by`, `called by` | `depends_on` | provider target → provider source |

Predicate input is at most 64 UTF-8 bytes and ASCII whitespace is only U+0020,
TAB, CR, or LF. Anything else is `not_structural`; it is never guessed,
stemmed, or reversed merely because the traversal reached the provider target.

Evaluate every claim of the exact internal predicate in the resolver's
canonical order: `validFrom` ascending, then numeric claim id. “Live” has the
existing exact meaning `supersededBy.length === 0`; polarity is evaluated
separately. For a single-valued predicate, two distinct live-positive canonical
targets make every target `contradicted`; a multi-valued predicate evaluates
each target independently. A candidate is `current` only if (a) one
live-positive claim has `objectText` equal to the canonical target and (b) one
`Mention` names that same canonical target and carries that exact claim id and
predicate. Where several equivalent claims support the same target, select the
newest by `validFrom` then id, exactly as resolver citation does. A matching
live claim without that mention is `missing_mention`. With no live positive, an
applicable live negative is `retracted`. A target present only in a superseded
positive while another live target exists is `historical`. Otherwise it is
`unstated`. Return the selected claim and mention with `current` so
accepted-edge provenance cannot drift to a different claim, predicate, target,
or display name.

- [ ] **Step 4: Make every Hydra read bounded, abortable, and strictly decoded**

Define one required read-control shape:

```ts
interface HydraReadControl {
  readonly signal: AbortSignal;
  readonly deadlineMs: number;       // absolute Date.now() deadline
  readonly maxResponseBytes: number; // endpoint body, success or error
  readonly byteBudget: {
    consume(chunkBytes: number): void; // one shared monotonic request counter
  };
}
```

Thread it through `HydraCloud.query`, `relations`, and `inspect`,
`HydraSource.subject`, `CloudSource`, `NodeSource`, and all fakes/callers
affected by the interface. Pass it into the node `HydraClient.query` transport
used by NodeSource as well; the old timeout field alone is insufficient.
Existing ingest/status controls remain separate.
The cloud sender clips its timer to `deadlineMs - Date.now()`, checks an already
aborted signal before dispatch, streams and counts response bytes before fatal
UTF-8 and strict JSON decode, enforces the same ceiling on non-2xx error bodies
without returning those bytes, and cleans its relay listener and timer on every
exit. For each stream chunk, check the per-response total and call the shared
`byteBudget.consume(chunk.byteLength)` before buffering it; either overflow
cancels/drains the reader and aborts peers. The node client does the same. The
node source checks abort/deadline before and after each store fan-out and drains
peer store operations before rejecting.

Use strict closed decoders, not `String(...)`, `asArray(...)`, filtering, or
“unknown means empty.” The query response permits at most 6 chunks, 8 source
ids per chunk, 32 `query_paths`, 8 triplets per path, and 128 triplets total.
The relation response permits at most 64 containers, 8 nested rows per
container, and 128 flattened rows total. Every id/title/type/timestamp is at
most 256 UTF-8 bytes, chunk text/context at most 2,048 UTF-8 bytes, and entity
strings follow the 512-byte entity grammar. Wrong types, unknown keys,
non-finite scores, inconsistent repeated relationship ids, or any cap+1 fail
the whole request. A schema-valid absent/empty chunks, paths, or relations
array is an honest empty result. A structurally valid relation occurrence with
a null/empty endpoint or predicate becomes one `malformed_candidate` rejection;
it is not silently dropped.

Expose separate collection-accepting graph functions from `api/index.ts`; do
not change the public demo closures. Construct all query/relation/source
closures from `cloud.withCollection(serverDerivedWorkspace)`. Query with
`type: 'all'` and `maxResults: 6`; the request boolean is
`graph_context: true`, while `graph_context` is never used as a context `type`.
Start query and relations under sibling controllers linked to the caller and
the one route deadline. On first failure/abort/over-cap, abort the peer, await
both with `Promise.allSettled`, detach every listener, and then return a generic
error. No successful or failed route may leave a fetch, stream reader, inspect,
subject, timer, or listener running.

- [ ] **Step 5: Implement canonical BFS and exact budget arithmetic**

Pin these constants in `src/api/impact.ts` and assert every exact value:

| Budget | Exact cap |
|---|---:|
| Absolute route deadline | 30,000 ms |
| Query `max_results` / decoded chunks | 6 / 6 |
| Relations request limit / decoded relation rows | 128 / 128 |
| Query paths / triplets per path / total triplets | 32 / 8 / 128 |
| Relation containers / nested rows / total rows | 64 / 8 / 128 |
| Query / relations / inspect response body | 1,048,576 / 1,048,576 / 524,288 bytes |
| Aggregate bytes across query, relations, and all subject inspections | 6,291,456 bytes |
| Candidate occurrences after the two bounded decoders | 256 |
| Subject reads / canonical entities | 40 / 40 |
| Concurrent query+relations peers / concurrent subject reads | 2 / 4 |
| Claims / mentions per subject; aggregate claim+mention rows | 128 / 128; 1,024 |
| Walk depth | 3 accepted edges from the root |
| Returned accepted+rejected edge entries | 256 |
| Serialized successful JSON body | 262,144 UTF-8 bytes |

The aggregate-byte and subject-row counters are shared monotonically across the
request; a cached subject consumes each once. A cap is inclusive. A raw body,
wire array, string, combined candidate set, per-subject row set, aggregate row
set, or output that is cap+1 fails the entire request generically—never truncate
or return partial proof. In contrast, a schema-valid candidate whose edge would
exceed depth 3 or add canonical entity 41 is retained as one
`budget_excluded` rejection. It does not enter `accepted`, `affected`, or a
later frontier and is included in `reached` arithmetic. A response-body
overflow discovered after construction also fails rather than slicing fields.

Retain the 128 query-triplet occurrences followed by the 128 inventory-row
occurrences before validation or deduplication. Normalize direction and entity
keys, validate all occurrences, and reject inconsistent reuse of a real
relationship id before walking. The identity key is the real relationship id
when present; otherwise it is the canonical tuple
`(effectiveSourceKey, effectiveTargetKey, internalPredicate, direction,
chunkId-or-empty, sha256(context-or-empty))`. A second identical occurrence is
`duplicates += 1` even if the first was rejected. Do not silently collapse it.

Canonical ordering is independent of provider/claim arrival: sort each
frontier by canonical entity key; sort candidates by effective source key,
effective target key, internal predicate, direction, relationship id or tuple
key, chunk id, context digest, origin (`query` before `inventory`), then original
path/row occurrence ordinal. Both query triplets and inventory rows are
considered exactly once, at the earliest depth at which their mapped effective
source is in the frontier; this preserves second and third hops already present
in `query_paths`. Rows whose effective source is never reached are not
`reached` and an incoming one-way row is never reversed to make it reachable.
For each reached occurrence, apply in order: duplicate,
malformed/non-structural, target-standing, then traversal budget. Accepted
edges alone enqueue their target. Cache one bounded subject view per canonical
key. Fetch uncached views for one frontier through a four-worker pool. The first
failure/abort stops new work, aborts every started peer, awaits all started
promises with all-settled semantics, and only then rejects; a later frontier
never overlaps it.

Every reached occurrence has exactly one stable outcome:
`malformed_candidate`, `not_structural`, `unstated`,
`historical`, `retracted`, `contradicted`, `missing_mention`,
`budget_excluded`, `accepted`, or `duplicate`. Therefore
`reached === accepted.length + rejected.length + duplicates` exactly.
`affected` is the unique canonical targets of accepted edges, excludes the
root even on a cycle, uses the deterministic preserved display spelling, and
is sorted by canonical key. `depth` is zero for no accepted edge and otherwise
the maximum accepted edge depth. Preserve relationship id, actual chunk id,
bounded source ids, context, selected claim id, mention identity, and display
names on accepted edges. Keep ordinary Ask graph context disabled: Hydra rows
are candidates until Lacuna proves current standing.

- [ ] **Step 6: Make the private proof UI demonstrate causal Hydra use**

`GraphImpact` consumes `useScope()`: public explore reads the existing fixed
demo impact; a private workspace offers a bounded subject field and reads only
`/api/workspace/impact`. Label reached candidates, duplicates, policy
rejections, and final affected nodes distinctly, with copy equivalent to
“HydraDB supplied candidate relations; Lacuna evaluated current standing.”
Render missing provenance, empty, error, and budget states explicitly and
accessibly. Never render rejected edges as proof or imply Hydra itself resolved
temporal standing. Task 7's exact-session/epoch client rules apply: account
swap or logout aborts and discards the response, refresh re-fetches private
truth, and no private response enters local/session storage. Public Explore
continues using only `/api/explore/impact` and its bundled fixture; it never
calls or displays the private workspace route.

Add a private UI fixture whose query graph contains both
`Root -> Superseded` and `Root -> Current`, whose workspace subject view marks
the first historical and supports the second with the exact live positive
claim plus matching `Mention`, and whose relation inventory contains
`Current -> SecondHop`. Assert the old edge is visibly rejected with its
provenance, the current and second-hop edges alone are accepted, the three
accounting terms balance, and affected/depth copy matches the JSON. Copy these
decisive metamorphic assertions into `graph-impact.test.ts` and
`workspace-impact-ui.test.tsx`:

1. Remove only the live current claim: `Current` and `SecondHop` disappear from
   accepted/affected and the first edge becomes `unstated` or `historical` as
   dictated by the remaining view.
2. Restore the claim but remove only its exact matching `Mention`: the edge is
   `missing_mention` and neither node appears as affected.
3. Restore the mention but remove only the query seed
   `Root -> Current`: neither `Current` nor `SecondHop` is reachable.
4. Restore the seed but remove only the inventory row
   `Current -> SecondHop`: `Current` remains and `SecondHop` disappears.
5. Shuffle every provider row and claim, then add an exact duplicate: accepted
   nodes/order remain byte-identical and only `duplicates` and `reached` rise
   by one.
6. Run the same private fixture beside public Explore: the public request,
   response, graph, copy, and endpoint remain byte-identical.

- [ ] **Step 7: Run focused graph/UI tests and verify GREEN**

Run: `npx vitest run tests/unit/retrieval-resolve.test.ts tests/unit/client.test.ts tests/unit/cloud-source.test.ts tests/unit/ingest-source.test.ts tests/unit/relations.test.ts tests/unit/hydra-cloud-impact-transport.test.ts tests/unit/graph-impact.test.ts tests/unit/graph-api.test.ts tests/unit/workspace-impact-api.test.ts tests/unit/workspace-impact-ui.test.tsx tests/unit/web-product-contracts.test.ts --maxWorkers=1`

Run: `npm run typecheck`

Run: `npm --prefix web run build`

Expected: exact-cap/cap+1, cancellation/drain, strict wire mapping, standing
metamorphics, two-account isolation, private UI causality, and unchanged public
Explore all pass; no request survives settlement.

- [ ] **Step 8: Commit the graph-native workspace feature**

```bash
git add src/retrieval/resolve.ts src/hydra/cloud.ts src/hydra/client.ts src/hydra/source.ts src/hydra/cloud-source.ts src/hydra/node-source.ts src/hydra/relations.ts src/api/graph.ts src/api/router.ts api/index.ts src/api/impact.ts web/src/app/routes/proof.tsx tests/unit/retrieval-resolve.test.ts tests/unit/client.test.ts tests/unit/cloud-source.test.ts tests/unit/ingest-source.test.ts tests/unit/relations.test.ts tests/unit/hydra-cloud-impact-transport.test.ts tests/unit/graph-impact.test.ts tests/unit/graph-api.test.ts tests/unit/workspace-impact-api.test.ts tests/unit/workspace-impact-ui.test.tsx tests/unit/web-product-contracts.test.ts
git commit -m "feat(hydra): scope native graph impact to private memory"
```

---

### Task 9: Connector security, Hydra, and production proof gate

**Files:**
- Create: `scripts/smoke-connectors.ts`
- Create: `scripts/soak-product.ts`
- Modify: `package.json`
- Create: `tests/unit/product-soak.test.ts`
- Modify only after proof: `docs/V10_RELEASE_STATUS.md`
- Create only after proof: `artifacts/verification/2026-08-21-convergence/connectors.json`
- Create only after proof: `artifacts/verification/2026-08-21-convergence/soak.json`

**Interfaces:**
- Produces: `npm run smoke:connectors`
- Produces: `npm run soak:product`
- Produces: redacted evidence for ingestion receipt, completed indexing, private retrieval, provenance, graph/temporal evidence, state persistence, and negative security cases
- Produces: bounded long-session latency/error/session-persistence evidence without unbounded writes

- [ ] **Step 1: Add a serial, redacted smoke runner**

The script accepts base URL/test credentials and safe fixture URLs from
environment. It exercises catalogue read, text/Markdown file preview+import, one
public GitHub import, one public HTTPS JSON import, webhook
issue+signed-delivery+replay-rejection+revoke, question retrieval, private Ask,
and the private Hydra graph-impact endpoint. It prints only route, status,
counts, digests, indexing state, Hydra relation ids, evidence source titles, and
failure codes; redact cookies, CSRF, email, workspace id, webhook
secret/signature, query strings, and provider bodies.

Add `"smoke:connectors": "tsx scripts/smoke-connectors.ts"` to `package.json`.
Add `"soak:product": "tsx scripts/soak-product.ts"` to `package.json`. Both
scripts require an explicit immutable preview origin, disposable test-session
inputs, and unique run id; refuse production aliases, missing caps, owner-data
credentials, or an origin that redirects. Never print credentials or full URLs.

- [ ] **Step 2: Run the complete local gate with one worker**

Run: `npm run typecheck`

Run: `npm --prefix web run typecheck`

Run: `npm run build`

Run: `npm run copy:lint`

Run: `npx vitest run tests/unit/connectors-catalog.test.ts tests/unit/connectors-store.test.ts tests/unit/connectors-normalize.test.ts tests/unit/connectors-run.test.ts tests/unit/connectors-files.test.ts tests/unit/connectors-github.test.ts tests/unit/connectors-https.test.ts tests/unit/connectors-webhook.test.ts tests/unit/connectors-api.test.ts tests/unit/web-connectors.test.ts tests/unit/product-soak.test.ts --maxWorkers=1`

Expected: every command exits zero with no connector test skipped.

- [ ] **Step 3: Run negative security probes against the immutable preview**

Verify unauthenticated and bad-CSRF private calls fail, file limits terminate, GitHub scope rejects private/tokenized URLs, HTTPS rejects redirects/private/DNS-rebinding targets, webhook bad/stale/replayed signatures fail, revoked hooks fail, client-supplied workspace fields are ignored, and no error leaks a URL query, secret, response body, collection, or email.

- [ ] **Step 4: Prove HydraDB is the product core**

For each successful source, record accepted receipts and terminal `completed`
indexing; retrieve it through the private question/Ask path; assert evidence
quotes and source titles; confirm temporal replacement/contradiction and graph
context remain visible where the imported content creates them. The decisive
fixture imports source A (`Atlas depends on cache-a`), then source B correcting
it (`Atlas now depends on cache-b`). Require the old claim to remain historical,
the supersession to be visible, private Ask to return `cache-b`, Hydra's native
walk to return raw candidate ids/context, the policy accounting to name every
accepted/rejected/duplicate edge, and a repeated import to converge without a
second live fact. Re-read connector and impact state in a fresh authenticated
session to prove durability. Do not call a successful one-off import
`connected`, and do not claim exactly-once delivery.

- [ ] **Step 5: Run a bounded long-lived product session**

Against the same immutable preview and a disposable account/namespace, run at
least 30 minutes of serial low-rate mixed work with an explicit maximum of 300
HTTP operations, 25 governed source writes, three concurrent requests in any
burst, and one active webhook. Mix catalogue/state reads, question/Ask/evidence,
connector refresh, repeated idempotent imports, graph impact, webhook accepted
delivery/duplicate convergence/revocation, page/session refresh, and deliberate
bad-CSRF/stale-session probes. Re-fetch CSRF through the supported flow; never
reuse a token across an account change. At the midpoint, create a fresh browser
session for the same disposable identity and prove private state survives; if a
second disposable identity is supplied, prove it sees none of the first run's
memory or connector state.

The harness uses a monotonic clock, per-operation deadlines, bounded response
bytes, one client-side concurrency pool, and fail-fast safety thresholds. It
records only operation class, status/failure code, accepted/searchable counts,
latency histogram, bounded retry count, session-refresh result, and redacted
digests. Any unhandled rejection, timeout without an explicit indeterminate
result, auth loop, cross-account observation, growing listener/timer/queue count,
or operation beyond the declared caps fails the soak. It always attempts hook
revocation in `finally`, but never deletes or mutates unrelated owner data.

Run a separate deterministic local stress case with fake Hydra/network clocks to
exercise at least 10,000 queue/normalization/replay operations without network or
multiple workers. Assert semaphore/lock/waiter maps return to baseline and memory
growth stabilizes after forced idle/GC when the runtime exposes it; do not turn a
missing GC metric into a pass claim.

- [ ] **Step 6: Commit verified evidence with the combined release**

Stage only redacted generated evidence and status claims supported by the immutable deployment. The soak artifact includes exact preview deployment id/commit, start/end/duration, declared caps, actual counts, latency summary, failure counts, session/isolation assertions, cleanup result, and a SHA-256 digest of the full locally retained report—not cookies, emails, workspace ids, bodies, URLs, secrets, or signatures. Use commit subject `docs: record converged production evidence` in the final release task rather than a connector-only evidence commit.
