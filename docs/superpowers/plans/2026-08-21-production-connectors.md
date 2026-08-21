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

### Task 6: Signed webhook lifecycle and replay resistance

**Files:**
- Create: `src/connectors/webhook.ts`
- Modify: `src/api/router.ts`
- Modify: `api/index.ts`
- Modify: `.env.example`
- Test: `tests/unit/connectors-webhook.test.ts`
- Test: `tests/unit/connectors-api.test.ts`

**Interfaces:**
- Adds: `POST /api/workspace/connectors/webhook`
- Adds: `DELETE /api/workspace/connectors/webhook/:id`
- Adds: `POST /api/connectors/webhook/:id`
- Produces: `WebhookService.issue(workspace): Promise<IssuedWebhook>`
- Produces: `WebhookService.accept(id, headers, rawBody): Promise<WebhookReceipt>`

- [ ] **Step 1: Write issuance and secret-storage tests**

Require an authenticated CSRF-protected issuance route, an opaque random
endpoint id, and one-time return of a 256-bit signing secret derived as
`HMAC-SHA256(deploymentKey, "webhook-secret:" + endpointId)`. Persist only the
id, owner digest, creation/revocation state, and replay markers; the signing
secret is recomputed for verification and is never stored, logged, or returned
by GET. Return `503 signing_not_configured` when `LACUNA_WEBHOOK_KEY` is missing
or is not 32 bytes of base64url/hex key material.

- [ ] **Step 2: Write verification/replay tests**

Define headers `X-Lacuna-Timestamp`, `X-Lacuna-Event-Id`, and
`X-Lacuna-Signature: v1=<hex>`. Sign
`timestamp + '.' + eventId + '.' + rawBody` with HMAC-SHA-256. Use
constant-time comparison, a five-minute clock window, event ids of 16–128 safe
characters, a 256 KiB raw-body cap, and a durable replay record. Reject
missing/duplicate headers, malformed JSON, revoked ids, bad signatures,
stale/future timestamps, and repeated event ids before ingestion.

- [ ] **Step 3: Write at-least-once convergence tests**

Simulate a timeout after Hydra accepts an event, then retry the same event id. Assert no contradictory duplicate records are created, the response accurately says `duplicate` or `accepted`, and the state does not claim exactly-once delivery. Different event ids with identical content converge through the connector document digest/idempotency key.

- [ ] **Step 4: Run tests and verify RED**

Run: `npx vitest run tests/unit/connectors-webhook.test.ts tests/unit/connectors-api.test.ts --maxWorkers=1`

Expected: webhook service and routes are absent.

- [ ] **Step 5: Implement lifecycle and raw-body routing**

Derive per-hook verification material from `LACUNA_WEBHOOK_KEY` plus the one-time secret, persist only the verifier and lifecycle metadata in `lacuna-connectors`, and store bounded replay ids as versioned records addressable by hook/event digest. The public receiver must read raw bytes before JSON parsing, verify first, then accept `{ title, text, observed_at? }` only. Delete marks the hook revoked; it does not erase audit state.

- [ ] **Step 6: Document configuration without a fallback secret**

Add `LACUNA_WEBHOOK_KEY=` to `.env.example` with a generation command and explicit server-only note. In `api/index.ts`, instantiate the service only for a valid key. Do not fall back to `HYDRA_TOKEN`, OAuth credentials, or a source-controlled constant.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/connectors-webhook.test.ts tests/unit/connectors-run.test.ts tests/unit/connectors-api.test.ts --maxWorkers=1`

Expected: all focused tests pass.

- [ ] **Step 8: Commit signed webhooks**

```bash
git add src/connectors/webhook.ts src/api/router.ts api/index.ts .env.example tests/unit/connectors-webhook.test.ts tests/unit/connectors-api.test.ts
git commit -m "feat(connectors): accept signed replay-safe webhooks"
```

---

### Task 7: Real connector product surface

**Files:**
- Create: `web/src/app/routes/connectors.tsx`
- Modify: `web/src/app/routes/developers.tsx`
- Modify: `web/src/design/connectors.ts`
- Modify: `web/src/app/routes/Dashboard.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api/connectors.ts`
- Test: `tests/unit/web-connectors.test.ts`
- Test: `tests/unit/web-product-contracts.test.ts`

**Interfaces:**
- Consumes: all private connector routes
- Produces: real forms for file, GitHub, HTTPS API, and webhook setup/revocation

- [ ] **Step 1: Write product-contract tests**

Require the private route to fetch observed catalogue state, expose bounded forms for each implemented connector, display last success/failure/searchability, require an explicit confirmation before import, and show `planned` integrations as disabled with no fake connect buttons. Forbid source bodies, collection ids, secret redisplay, `OAuth`, `syncing` from persisted state, and any status derived from a timer.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npx vitest run tests/unit/web-connectors.test.ts tests/unit/web-product-contracts.test.ts --maxWorkers=1`

Expected: the current developers page is a static list and has no real route/forms.

- [ ] **Step 3: Build the route from server state**

Move the connector panel into `connectors.tsx`, preserve the visual language, and render state from `GET /api/workspace/connectors`. GitHub and HTTPS forms show exact supported boundaries. File flow previews before import. Webhook setup shows the endpoint and raw secret exactly once with `COPY` controls, then requires acknowledgement before leaving; later visits show only configured/revoke state.

- [ ] **Step 4: Keep signed-out and planned catalogue truthful**

Change `web/src/design/connectors.ts` to own presentation metadata only. Its availability copy must match server catalogue through a test mapping, while runtime connection state is never hard-coded. Keep GitLab, Linear, Jira, Slack, Notion, Gmail, Confluence, and database source disabled/planned.

- [ ] **Step 5: Run UI, accessibility, and build gates**

Run: `npx vitest run tests/unit/web-connectors.test.ts tests/unit/web-product-contracts.test.ts tests/unit/web-auth-client.test.ts --maxWorkers=1`

Run: `npm --prefix web run typecheck`

Run: `npm --prefix web run build`

Expected: tests/build pass; every input has a label, status is text as well as colour, focus remains visible, and secrets are not retained in browser storage.

- [ ] **Step 6: Commit the real connector UI**

```bash
git add web/src/app/routes/connectors.tsx web/src/app/routes/developers.tsx web/src/design/connectors.ts web/src/app/routes/Dashboard.tsx web/src/App.tsx web/src/api/connectors.ts tests/unit/web-connectors.test.ts tests/unit/web-product-contracts.test.ts
git commit -m "feat(connectors): expose truthful private import workflows"
```

---

### Task 8: Workspace-scoped Hydra graph impact over imported memory

**Files:**
- Modify: `src/api/router.ts`
- Modify: `api/index.ts`
- Modify: `src/api/impact.ts`
- Modify: `web/src/app/routes/proof.tsx`
- Test: `tests/unit/graph-impact.test.ts`
- Test: `tests/unit/graph-api.test.ts`
- Create: `tests/unit/workspace-impact-api.test.ts`

**Interfaces:**
- Adds: `GET /api/workspace/impact?subject=<bounded-name>`
- Consumes: workspace-scoped `HydraCloud.withCollection(collection).query(...,
  { type: 'graph_context' })` and `.relations()`
- Produces: raw reached Hydra relation ids/context plus accepted, rejected,
  duplicate, affected, depth, and elapsed accounting

- [ ] **Step 1: Write the private-scope and accounting regressions**

Require `401` without a session, derive the collection only from the account,
reject missing/empty/overlong/duplicate subject controls, apply the graph-walk
budget, and return `Cache-Control: no-store`. Use two fake accounts to prove
their Hydra graph calls cannot cross collections. Assert
`reached === accepted.length + rejected.length + duplicates`, every returned
edge retains Hydra id/context, and no result leaks collection or email.

- [ ] **Step 2: Run focused graph tests and verify RED**

Run: `npx vitest run tests/unit/graph-impact.test.ts tests/unit/graph-api.test.ts tests/unit/workspace-impact-api.test.ts --maxWorkers=1`

Expected: the private endpoint and collection-aware graph functions are absent.

- [ ] **Step 3: Implement the collection-aware graph boundary**

Expose separate collection-accepting graph functions from `api/index.ts`; do
not change the public demo closures. For the authenticated collection, obtain
the seed through Hydra graph-context query and the bounded edge inventory
through Hydra relations, then apply `graphImpact` to the same workspace
inventory used by Ask. Preserve the existing rule that ordinary Ask does not
enable graph context because stale/unmarked relation edges are candidates, not
resolved truth.

- [ ] **Step 4: Make the proof UI follow its actual scope**

`GraphImpact` consumes `useScope()`: public explore reads the existing fixed
demo impact; a private workspace offers a bounded subject field and reads only
`/api/workspace/impact`. Label reached candidates, policy rejections, and final
affected nodes distinctly. Never imply Hydra itself resolved temporal standing.

- [ ] **Step 5: Run focused graph/UI tests and verify GREEN**

Run: `npx vitest run tests/unit/graph-impact.test.ts tests/unit/graph-api.test.ts tests/unit/workspace-impact-api.test.ts tests/unit/web-product-contracts.test.ts --maxWorkers=1`

- [ ] **Step 6: Commit the graph-native workspace feature**

```bash
git add src/api/router.ts api/index.ts src/api/impact.ts web/src/app/routes/proof.tsx tests/unit/graph-impact.test.ts tests/unit/graph-api.test.ts tests/unit/workspace-impact-api.test.ts tests/unit/web-product-contracts.test.ts
git commit -m "feat(hydra): scope native graph impact to private memory"
```

---

### Task 9: Connector security, Hydra, and production proof gate

**Files:**
- Create: `scripts/smoke-connectors.ts`
- Modify: `package.json`
- Modify only after proof: `docs/V10_RELEASE_STATUS.md`
- Create only after proof: `artifacts/verification/2026-08-21-convergence/connectors.json`

**Interfaces:**
- Produces: `npm run smoke:connectors`
- Produces: redacted evidence for ingestion receipt, completed indexing, private retrieval, provenance, graph/temporal evidence, state persistence, and negative security cases

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

- [ ] **Step 2: Run the complete local gate with one worker**

Run: `npm run typecheck`

Run: `npm --prefix web run typecheck`

Run: `npm run build`

Run: `npm run copy:lint`

Run: `npx vitest run tests/unit/connectors-catalog.test.ts tests/unit/connectors-store.test.ts tests/unit/connectors-normalize.test.ts tests/unit/connectors-run.test.ts tests/unit/connectors-files.test.ts tests/unit/connectors-github.test.ts tests/unit/connectors-https.test.ts tests/unit/connectors-webhook.test.ts tests/unit/connectors-api.test.ts tests/unit/web-connectors.test.ts --maxWorkers=1`

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

- [ ] **Step 5: Commit verified evidence with the combined release**

Stage only redacted generated evidence and status claims supported by the immutable deployment. Use commit subject `docs: record converged production evidence` in the final release task rather than a connector-only evidence commit.
