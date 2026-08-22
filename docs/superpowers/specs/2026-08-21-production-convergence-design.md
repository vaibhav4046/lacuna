# Production Convergence Design

**Date:** 2026-08-21

**Status:** Approved in conversation

## Goal

Close the remaining product-completeness gaps without weakening Lacuna's truth
boundary. The release must add real connector workflows, reproducible official
LongMemEval evidence, a useful first authenticated session, session-aware public
navigation, and a global voice control that can perform supported authenticated
operations and play speech even where Web Audio analysis is unavailable. Every
visible state must still describe observed behavior rather than intended
behavior.

## Product boundary

This design delivers these connector workflows:

- existing pasted text and custom ingestion;
- public GitHub repository import;
- UTF-8 text and Markdown file import;
- PDF text extraction;
- DOCX text extraction;
- bounded HTTPS JSON or text API import;
- authenticated signed-webhook ingestion.

GitLab, Linear, Jira, Slack, Notion, Gmail, and Confluence remain `PLANNED`
until their provider-specific OAuth applications, consent flows, incremental
syncs, revocation, and production proofs exist. The connector engine introduced
here is the boundary those adapters will use, but an adapter interface is not a
connection and does not change their catalogue state.

The official benchmark deliverable is the complete 500-question LongMemEval
oracle tier. It is not the 277 MB small tier or the 2.74 GB medium tier. The
artifact must say `oracle` prominently and must not imply a full long-context
score. Hypotheses come from Lacuna retrieval plus an answer model. Ground truth
is available only to the official evaluator after hypotheses are sealed.

## Approach considered

Three approaches were evaluated.

1. **Verified breadth, then OAuth adapters.** Build one secure connector core,
   ship the integrations that can be production-proved without provider app
   review, and leave credentialed providers visibly planned. This is the chosen
   approach because it creates several complete user journeys while preserving
   the repository's central rule against unsupported claims.
2. **OAuth-first across every vendor.** This would require separate external
   applications, scopes, review policies, token refresh semantics, and admin
   consent for at least seven providers before any coherent release. It has a
   high chance of leaving many half-connected rows and was rejected.
3. **Bring-your-own access tokens.** This avoids app registration but transfers
   secret handling and provider-specific failures to users. It is an inferior
   security and onboarding model and was rejected for the production UI.

## Architecture

The work is split into five independently testable subsystems. They share the
existing authenticated workspace boundary and the existing `ingestSource`
pipeline, but otherwise communicate through narrow interfaces.

```text
connector input -> bounded acquisition -> normalized source -> ingestSource
                                                        |-> HydraDB collection
                                                        |-> native graph impact

official dataset -> per-question HydraDB collection -> hybrid query -> answerer
                                                            |-> hypotheses.jsonl

onboarding -> workspace create -> optional first-source ingest -> suggested Ask

session cookie -> SessionProvider -> landing/auth controls -> open workspace

global voice bubble -> transcript/typed text -> typed intent allowlist
                         |-> read action -> existing authenticated API -> result
                         |-> mutation preview -> explicit confirm -> existing API
                         |-> answer/result -> TTS bytes -> native audio
                                                   |-> optional Web Audio analyser
```

### Connector core

Create a server-only `src/connectors/` package with these responsibilities:

- `catalog.ts` defines stable connector identifiers and their global
  availability. The web catalogue consumes this data through an API response
  instead of maintaining a second truth table.
- `types.ts` defines `ConnectorDefinition`, `ConnectorRun`, `NormalizedSource`,
  `ConnectorState`, and typed acquisition failures.
- `normalize.ts` accepts only normalized title, text, source URL, media type,
  and observed time. It removes NUL characters, normalizes newlines, preserves
  source text, and splits at sentence or newline boundaries into chunks no
  longer than 20,000 characters.
- `run.ts` sends each normalized chunk through the existing `ingestSource`
  function. It aggregates accepted/refused receipts and writes connector state
  only after every required receipt has been validated.
- `store.ts` persists non-secret connector state in the dedicated non-memory
  HydraDB collection `lacuna-connectors`, keyed by an opaque keyed digest of the
  server-derived workspace id. This prevents operational records from becoming
  Ask evidence. State records include connector id, status, source label,
  deterministic source fingerprint, last attempt, last success, item count,
  and a redacted failure code. They never include authorization headers,
  webhook secrets, fetched response bodies, workspace collections, or workspace
  email addresses.

The connector API is under `/api/workspace/connectors` and derives the
workspace collection from the signed-in session. No request may name a
workspace or collection.

- `GET /api/workspace/connectors` returns the global catalogue merged with the
  current workspace's observed state.
- `POST /api/workspace/connectors/file/preview` extracts one supported file
  without storing it and returns the bounded preview used by onboarding and the
  connector panel.
- `POST /api/workspace/connectors/github/import` accepts a public GitHub URL and
  optional ref.
- `POST /api/workspace/connectors/file/import` accepts one supported file.
- `POST /api/workspace/connectors/api/import` accepts one bounded HTTPS source.
- `POST /api/workspace/connectors/webhook` creates or rotates a webhook.
- `DELETE /api/workspace/connectors/webhook/:id` revokes it.
- `POST /api/connectors/webhook/:id` is the only connector write that does not
  use a browser session. It uses a timestamped HMAC signature and a replay id.

All authenticated browser mutations require the existing CSRF protection.
Connector runs reuse the existing private-ingest quota and add a per-connector
concurrency lease so two clicks cannot start duplicate imports in one process.
The lease is documented as process-local because HydraDB exposes no CAS.

### Acquisition adapters

#### GitHub

The GitHub adapter accepts only canonical
`https://github.com/<owner>/<repository>` URLs. Owner, repository, and ref are
validated as data and never interpolated into a shell command. It calls the
public GitHub REST API, optionally using a server-side `GITHUB_TOKEN` when one
is configured. The token is never required for a public repository and never
enters a response or log.

One import reads the default or requested ref, the root README, and text files
under `docs/` with extensions `.md`, `.mdx`, `.txt`, `.json`, `.yaml`, and
`.yml`. It follows at most 100 tree entries, fetches at most 30 files, accepts at
most 4 MiB before normalization, and stops after 20 seconds of acquisition.
Binary files, symlinks, submodules, generated/vendor directories, and files
larger than 512 KiB are skipped and reported by count. A successful run records
the repository URL and commit SHA as provenance.

#### Files

The file route accepts one file at a time and a maximum request size of 8 MiB.
Extension and sniffed content must agree.

- `.txt`, `.md`, and `.markdown` are decoded as UTF-8 with an optional BOM.
- `.pdf` is parsed server-side with `pdfjs-dist`; encrypted PDFs and PDFs with
  no extractable text are refused.
- `.docx` is parsed server-side after bounded ZIP preflight and direct XML text
  extraction; macros are never executed and
  embedded media is ignored.

The normalized title defaults to the sanitized filename. The source record
stores the original filename, media type, byte count, and SHA-256 digest, never
the local filesystem path.

#### HTTPS API

The API adapter accepts `https://` only, no URL credentials, port 443 only, and
no caller-supplied headers. Before every request it resolves all host addresses
and rejects loopback, link-local, private, multicast, documentation, and other
non-public ranges for both IPv4 and IPv6. The outbound client pins its TLS
connection to one of those validated addresses while retaining the hostname for
certificate verification, so DNS rebinding cannot replace the checked address
between validation and connection. Redirects are disabled. The response must
be `application/json`, `text/plain`, or Markdown, must arrive within ten
seconds, and may not exceed 1 MiB.

JSON is converted deterministically: arrays become one record per item up to
100 items, objects use sorted keys, and nesting deeper than eight levels is
refused. The URL is shown as provenance, with query parameter values redacted
from UI and logs.

#### Signed webhook

Webhook creation returns a random public id and a secret exactly once. The
secret is derived from a 256-bit deployment key and the random id and is not
stored. The HydraDB state record stores the id, creation time, and revocation
state. Requests carry:

- `X-Lacuna-Timestamp`: Unix seconds within five minutes;
- `X-Lacuna-Event-Id`: a 128-bit-or-larger unique event id;
- `X-Lacuna-Signature`:
  `v1=<hex HMAC-SHA256(timestamp + "." + eventId + "." + rawBody)>`.

Verification uses constant-time comparison. The latest 1,024 event ids inside
a 24-hour window are retained in the connector state as replay markers. A
same-process lease serializes state updates. HydraDB has no atomic create, so a
simultaneous delivery to different serverless instances may pass both replay
checks; deterministic source fingerprints make those writes converge rather
than duplicate facts, and the product does not claim exactly-once delivery.
Bodies are limited to 256 KiB and must match the same JSON normalization
contract as API import. A missing webhook deployment key makes creation
unavailable; it never falls back to an unsigned endpoint.

### Connector interface

The Connectors route becomes actionable rather than a static catalogue. Each
available connector opens a focused setup panel. The panel shows the exact
scope, limits, last observed state, last successful import, accepted records,
and skipped/refused items. `CONNECTED` is used only for a configured webhook or
a pull source with a successful persisted configuration. One-off files remain
`AVAILABLE` even after an import. `SYNCING` appears only while the current
process has an active run. A failed probe is `ERROR` in the detail panel and
does not silently revert to `PLANNED`.

### Official LongMemEval run

The existing loader and `stripGroundTruth` boundary remain authoritative. Add a
cloud benchmark runner that uses only `IngestibleQuestion` values.

For every oracle question:

1. Create a deterministic collection name from the run id and question id.
2. Convert every haystack session into a dated plain-text document containing
   role-labelled turns. Do not copy `answer`, `answer_session_ids`, or
   turn-level `has_answer`.
3. Ingest the documents into that collection with `HydraCloud.ingestDocument`
   and wait for every receipt to reach a successful terminal state.
4. Call `HydraCloud.query(question.question, { maxResults: 12 })` with graph
   context enabled.
5. Pass only the question text, question date, and returned chunks with dates
   and source ids to the configured answer model. The answer model must return
   a hypothesis string or an explicit abstention string.
6. Append the hypothesis to a durable checkpoint file so interruption can
   resume without repeating completed questions.

The hypotheses file is sealed with SHA-256 before the reference dataset is
given to the evaluator. The official upstream evaluator then runs over all 500
hypotheses. The checked-in artifact records:

- official dataset URL, filename, byte size, SHA-256, and instance count;
- upstream LongMemEval commit used for evaluation;
- Lacuna commit and deployment-independent configuration;
- HydraDB database/profile and retrieval parameters;
- answer-model and official judge-model identifiers;
- per-question completion and retrieval-failure counts;
- hypotheses digest;
- official overall, per-type, and abstention metrics;
- token/cost totals when the providers return them;
- exact limitations, including the oracle-tier boundary.

No accuracy value appears in product copy until the full 500-question official
evaluation artifact exists and its verifier passes. A failed or partial run is
stored under `artifacts/benchmarks/incomplete/` and is never rendered as a
score.

### First authenticated session

The onboarding flow becomes three consequential steps rather than five status
slides:

1. **Name the workspace.** Create it through the existing authenticated route.
2. **Add the first memory.** Let the user paste a real note or upload one
   supported file. Show extractor output before storage, including statements
   that will be kept and sentences that produced nothing. The user can skip and
   remain explicitly empty.
3. **Ask from that memory.** After a successful ingest, derive up to three
   suggested questions from the stored subject index and predicates. Clicking
   one executes the real private Ask route and shows answer plus evidence
   before entering the main shell.

No fictional facts are written automatically. A prefilled example may be
inserted into the editor only after an explicit `Use an example` click and is
labelled sample content before storage. The dashboard empty state links back to
Memory and file/connectors setup. Successful onboarding lands on the answer or
Memory view instead of a visually empty dashboard.

Workspace creation and first-source ingestion are separate durable operations.
If ingestion fails, the created workspace remains valid and the UI offers retry
without creating a second workspace.

### Session-aware public navigation

The secure 30-day session remains the source of truth on public and private
routes. Landing header, footer, and final call-to-action read `SessionProvider`:
an authenticated visitor sees `Open workspace`, never a contradictory `Sign in`
or `Get started` prompt. Visiting `/signin` or `/signup` with a valid session
redirects to the workspace. Refreshing Home or navigating Home from the shell
must preserve that behavior without minting a second workspace or exposing
session data in page markup. Loading and failed session checks remain explicit;
they never optimistically claim that a user is signed in.

### Authenticated voice operations

The floating voice control is a product control, not a shortcut to another
route. In every authenticated shell route it opens one accessible command panel
owned by the shell. That owner retains the current transcript, pending action,
answer, and reusable playback session while ordinary route navigation occurs.
The `/voice` route renders the same controller in an expanded layout instead of
creating a second microphone or audio runtime.

Committed speech and the typed fallback enter one deterministic command
boundary before the existing private Ask path. The boundary emits a closed,
versioned `VoiceIntent` union. The initial production allowlist covers:

- navigation to every visible workspace route, with spoken acknowledgement;
- private Ask, preserving answer, standing, evidence, and trace identifiers;
- read-only workspace summaries such as health and connector status, obtained
  from their existing authenticated APIs rather than inferred from the page;
- adding a bounded text memory through the existing preview and ingest path;
- starting an existing bounded agent/work request when its required inputs can
  be represented and validated by the existing API.

Unmatched language becomes private Ask only when it is framed as a question;
otherwise the panel reports the supported command forms and does nothing. The
intent layer cannot produce an arbitrary URL, HTTP method, endpoint, collection,
workspace identifier, shell command, or free-form tool invocation.

Navigation and reads may execute immediately. Every mutation first renders a
human-readable preview containing the exact action and bounded inputs. It runs
only after the user selects `CONFIRM` or commits the exact follow-up word
`confirm` while that preview is active. Pending confirmation is one-shot,
expires after 30 seconds, is cleared by navigation/account change/cancel, and is
bound to the current authenticated workspace. `cancel` always discards it.
Deletion, revocation, sign-out, credential, permission, and security-setting
changes are deliberately not voice-executable in this release; voice may only
navigate to their ordinary UI.

All operations call the same authenticated, CSRF-protected APIs used by their
screens and preserve their validation, quotas, receipt checks, and tenant
derivation. Voice has no privileged server path. Results shown and spoken come
from observed API responses. An operation may succeed when speech playback is
blocked, but the UI must distinguish those two outcomes and keep the result
visible.

### Cross-browser voice playback

The current runtime creates a fresh `AudioContext` after network work and makes
successful playback depend on `createMediaElementSource`. Some embedded,
Safari, and privacy-restricted browsers reject one of those operations even
when the MP3 and native audio element are valid.

Introduce a reusable `PlaybackSession` owned by `BrowserVoiceRuntime`:

- `prepare()` runs synchronously from the user's Start Listening, Ask as Text,
  Retry, or Play Answer gesture. It creates or resumes one `AudioContext` when
  supported. Failure disables analysis only; it does not disable sound.
- `play(blob, handlers, signal)` creates a native `Audio` element and calls
  `play()`. Playback success is defined by the element's `playing` event.
- After native playback starts, the session opportunistically attaches the
  reusable Web Audio analyser. Failure to create or connect an analyser leaves
  the audio playing and reports `signal: null`; it is not a provider error.
- Browsers with no `AudioContext` use native audio for the entire run. No
  waveform is invented.
- A rejected native `play()` remains a local `error` and keeps `PLAY ANSWER`
  available. The UI explains that the browser blocked sound and provides an
  explicit `ENABLE SOUND` retry gesture.
- Abort before `playing`, during context resume, during analysis setup, or
  during playback pauses the element, disconnects optional nodes, revokes the
  object URL, and resolves as `interrupted`. A stale async continuation cannot
  start later audio.
- One runtime owns at most one active element. Starting another play cancels
  the previous one. Disposal closes the shared context and removes all event
  listeners.

The speech acquisition boundary remains unchanged: only a non-empty,
size-bounded MP3 response can reach playback, and provider failures remain
distinct from local browser failures.

## Error handling and security invariants

- Connector and benchmark writes fail closed on missing, duplicate, unknown,
  or refused HydraDB receipts.
- No connector request chooses a private collection.
- External fetches never forward browser cookies, connector secrets, HydraDB
  credentials, or arbitrary user headers.
- API import has an SSRF boundary that is tested against IPv4, IPv6, DNS
  rebinding-style multi-address results, redirects, and URL parser edge cases.
- Imported HTML is treated as text and never rendered unsanitized.
- File parsers run with byte, character, page, nesting, and wall-clock limits.
- Connector errors expose stable codes, not provider bodies or secrets.
- Benchmark ground truth isolation is checked at runtime by rebuilding and
  serializing every answerer input and refusing if the forbidden `answer`,
  `answer_session_ids`, or `has_answer` property names survive. Answer text may
  legitimately occur inside an evidence turn, so value matching is not used as
  a false leakage test.
- Voice never calls provider-unavailable for a local playback problem and never
  simulates audio, transcript, RMS, or waveform data.
- Voice intents are closed and versioned. They cannot select an endpoint,
  workspace, collection, credential, shell command, or arbitrary tool.
- Voice mutations require an unexpired, workspace-bound preview and explicit
  confirmation, then use the existing authenticated and CSRF-protected route.
- A voice playback failure cannot roll back or re-run an already completed
  operation; the panel reports operation and audio outcomes independently.

## Testing and evidence

Implementation is test-first. Each subsystem must add focused unit tests before
production code and must finish with an independent review.

Connector evidence includes adapter fixtures, SSRF tests, file-parser tests,
webhook signature/replay tests, receipt-failure tests, authenticated API tests,
and one production import for each available connector type. Production proof
captures only public test data and redacted request metadata.

Benchmark evidence includes loader/adapter regressions, answerer-input leakage
tests, resumable checkpoint tests, official output-schema validation, artifact
verification, and the complete official evaluator output.

Onboarding evidence includes component contract tests and an authenticated
browser run from new workspace through ingest, suggested Ask, evidence view,
refresh, and session revalidation.

Voice evidence includes global-bubble ownership, route-persistence, intent
allowlist, ambiguous-command refusal, mutation preview/confirm/expiry,
authentication/CSRF/tenant checks, no-Web-Audio, analyser-failure,
autoplay-rejection, abort-race, replay, and disposal tests. Production
verification exercises navigation, a private cited Ask, one confirmed memory
write, and TTS playback in the connected browser. It confirms that a completed
operation remains visible and usable if the automation surface itself blocks
audio.

The release gate remains the full root unit suite, root and web typechecks, web
build, copy lint, dependency audit, targeted contract/smoke suites, diff check,
and a production health round trip. Heavy benchmark and browser work runs
serially so the user's laptop is not flooded with worker processes or terminals.

## Rollout

Land the four subsystems as reviewable commits, then one documentation/evidence
commit. Deploy to an immutable Vercel preview first. Run signed-out, signed-in,
connector, onboarding, MCP, voice, and health gates against that deployment.
Promote the canonical alias only when every gate passes. If a production-only
failure appears, roll the alias back before diagnosis.

After promotion, update `STATE.md`, the capability matrix, claim registry, and
submission evidence so they match the deployed behavior. Catalogue states move
only for connectors proven on the promoted deployment.

## Acceptance criteria

The goal is complete only when all of the following are true:

1. At least GitHub, Markdown/Text, PDF, DOCX, HTTPS API, and signed webhook
   workflows ingest public test data through the production private-workspace
   path and expose truthful persisted state. A two-source correction remains
   historically visible, changes the current cited answer, and drives a
   workspace-scoped Hydra native graph walk whose raw candidates and Lacuna
   policy decisions are fully accounted.
2. The official 500-question LongMemEval oracle evaluation has a verified
   hypotheses file, official evaluator output, provenance artifact, and no
   ground-truth leakage.
3. A new authenticated workspace can ingest its first source and execute a
   suggested private question without leaving onboarding.
4. A signed-in visitor remains visibly signed in across Home, workspace, and
   refresh, and signed-in auth pages return that visitor to the workspace.
5. The global voice panel persists across workspace navigation, performs its
   tested read operations, previews and confirms its tested mutations through
   ordinary authenticated APIs, and never executes an unsupported intent.
6. Voice plays through native audio without requiring Web Audio analysis, and
   all local/provider/cancellation failure boundaries pass regression tests.
7. Full local gates pass, the immutable production deployment passes the
   browser/API matrix, and the canonical URL points at that deployment.
8. Documentation and UI state only claim the integrations and benchmark tier
   demonstrated by those artifacts.
