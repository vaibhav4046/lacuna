export type ConnectorId = 'github' | 'gitlab' | 'markdown' | 'text' | 'pdf' | 'docx' | 'https_api' | 'webhook';
export type FileConnectorId = 'markdown' | 'text' | 'pdf' | 'docx';

export type ConnectorFailureCode =
  | 'validation_failed' | 'transport_failed' | 'parse_failed' | 'receipt_refused'
  | 'readiness_failed' | 'readiness_timeout' | 'signing_not_configured';

export type ConnectorRefusalCode = ConnectorFailureCode
  | 'session' | 'voice_binding' | 'permission' | 'csrf' | 'body'
  | 'workspace_ingest_budget' | 'workspace_file_budget'
  | 'file_import_unavailable' | 'invalid_multipart' | 'request_too_large' | 'file_too_large'
  | 'file_required' | 'invalid_filename' | 'unsupported_file' | 'invalid_file' | 'invalid_utf8'
  | 'empty_file' | 'file_too_complex' | 'document_too_long' | 'preview_invalid'
  | 'preview_expired' | 'preview_replayed' | 'file_import_failed'
  | 'github_import_unavailable' | 'invalid_github_request' | 'invalid_repository_url'
  | 'github_unavailable' | 'github_timeout' | 'github_snapshot_invalid'
  | 'github_integrity_failed' | 'github_budget_exceeded' | 'github_no_documents'
  | 'github_import_failed' | 'https_import_unavailable' | 'invalid_https_request'
  | 'gitlab_import_unavailable' | 'invalid_gitlab_request' | 'invalid_project_url'
  | 'gitlab_unavailable' | 'gitlab_timeout' | 'gitlab_snapshot_invalid'
  | 'gitlab_integrity_failed' | 'gitlab_budget_exceeded' | 'gitlab_no_documents'
  | 'gitlab_import_failed'
  | 'invalid_https_url' | 'https_busy' | 'https_timeout' | 'https_dns_failed'
  | 'https_address_blocked' | 'https_peer_mismatch' | 'https_redirect_refused'
  | 'https_upstream_failed' | 'https_tls_failed' | 'https_response_invalid'
  | 'https_type_unsupported' | 'https_too_large' | 'https_json_invalid'
  | 'https_content_invalid' | 'https_import_failed' | 'connector_state_unavailable'
  | 'webhook_state_unavailable' | 'webhook_lifecycle_failed' | 'webhook_not_found'
  | 'invalid_webhook_request';

export type ConnectorOutcome<T> =
  | { readonly kind: 'receipt'; readonly value: T }
  | { readonly kind: 'known_refusal'; readonly status: number; readonly code: ConnectorRefusalCode }
  | { readonly kind: 'indeterminate' }
  | { readonly kind: 'discarded' };

export interface ConnectorMutationContext {
  readonly binding: string;
  readonly csrf: string;
  readonly signal: AbortSignal;
}

export interface FilePreviewResponse {
  readonly filename: string;
  readonly title: string;
  readonly type: FileConnectorId;
  readonly excerpt: string;
  readonly characters: number;
  readonly pages: number;
  readonly paragraphs: number;
  readonly tables: number;
  readonly rawDigest: string;
  readonly normalizedDigest: string;
  readonly previewToken: string;
  readonly expiresAt: string;
}

export interface ConnectorRunReceipt {
  readonly connectorId: ConnectorId;
  readonly submittedDocuments: number;
  readonly duplicateDocuments: number;
  readonly acceptedDocuments: number;
  readonly searchableDocuments: number;
  readonly failedDocuments: number;
  /** Read cleanly and holding no claim the extractor could justify. Not a failure. */
  readonly emptyDocuments: number;
  readonly acceptedRecords: number;
  readonly refusedRecords: number;
  readonly failure: ConnectorFailureCode | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly observationWrite: 'stored' | 'unchanged' | 'stale' | 'failed';
  readonly indeterminateSubmission: boolean;
}

export type FileImportResponse = ConnectorRunReceipt & { readonly connectorId: FileConnectorId };

export interface GitHubImportResponse extends ConnectorRunReceipt {
  readonly connectorId: 'github';
  readonly snapshotCommit: string;
  readonly snapshotDigest: string;
  readonly consideredEntries: number;
  readonly fetchedBlobs: number;
  readonly skipped: readonly { readonly reason: string; readonly count: number }[];
}

export interface GitLabImportResponse extends ConnectorRunReceipt {
  readonly connectorId: 'gitlab';
  readonly snapshotCommit: string;
  readonly snapshotDigest: string;
  readonly consideredEntries: number;
  readonly fetchedBlobs: number;
  readonly skipped: readonly { readonly reason: string; readonly count: number }[];
}

export interface HttpsImportResponse extends ConnectorRunReceipt {
  readonly connectorId: 'https_api';
  readonly sourceDigest: string;
  readonly contentDigest: string;
}

export interface ConnectorStatus {
  readonly id: ConnectorId;
  readonly label: string;
  readonly group: 'CODE' | 'FILES' | 'DATA';
  readonly availability: 'available' | 'unavailable';
  readonly reason: 'signing_not_configured' | 'file_import_unavailable'
    | 'github_import_unavailable' | 'gitlab_import_unavailable' | 'https_import_unavailable' | null;
  readonly configuredAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastFailure: ConnectorFailureCode | null;
  readonly importedDocuments: number;
  readonly state: 'idle' | 'connected' | 'failed';
}

export interface ConnectorCatalogue { readonly connectors: readonly ConnectorStatus[] }
export type WebhookState =
  | { readonly configured: false; readonly endpointId: null; readonly endpoint: null; readonly configuredAt: null }
  | { readonly configured: true; readonly endpointId: string; readonly endpoint: string; readonly configuredAt: string };
export type WebhookIssueResponse =
  | { readonly created: true; readonly endpointId: string; readonly endpoint: string; readonly secret: string; readonly configuredAt: string }
  | { readonly created: false; readonly endpointId: string; readonly endpoint: string; readonly secret: null; readonly configuredAt: string };
export interface WebhookRevokeResponse { readonly revoked: true }

const CATALOGUE_TIMEOUT_MS = 15_000;
const FILE_PREVIEW_TIMEOUT_MS = 30_000;
const IMPORT_TIMEOUT_MS = 60_000;
const HTTPS_IMPORT_TIMEOUT_MS = 30_000;
const WEBHOOK_LIFECYCLE_TIMEOUT_MS = 35_000;
const BINDING = /^[0-9a-f]{64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9_-]{22}$/u;
const SECRET = /^[A-Za-z0-9_-]{43}$/u;
const PREVIEW_TOKEN = /^[A-Za-z0-9_-]{1,2956}\.[A-Za-z0-9_-]{43}$/u;
const SKIP_REASON = /^[a-z][a-z0-9_]{0,63}$/u;
const IDS = ['github', 'gitlab', 'markdown', 'text', 'pdf', 'docx', 'https_api', 'webhook'] as const;
const FILE_IDS = ['markdown', 'text', 'pdf', 'docx'] as const;
const MAX_RUN_DOCUMENTS = 30;
const MAX_RUN_RECORDS = 1_000_000;
const MAX_IMPORTED_DOCUMENTS = 1_000_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const FAILURES = [
  'validation_failed', 'transport_failed', 'parse_failed', 'receipt_refused',
  'readiness_failed', 'readiness_timeout', 'signing_not_configured',
] as const;
const REFUSALS: readonly ConnectorRefusalCode[] = [
  ...FAILURES, 'session', 'voice_binding', 'permission', 'csrf', 'body',
  'workspace_ingest_budget', 'workspace_file_budget', 'file_import_unavailable',
  'invalid_multipart', 'request_too_large', 'file_too_large', 'file_required',
  'invalid_filename', 'unsupported_file', 'invalid_file', 'invalid_utf8', 'empty_file',
  'file_too_complex', 'document_too_long', 'preview_invalid', 'preview_expired', 'preview_replayed', 'file_import_failed',
  'github_import_unavailable', 'invalid_github_request', 'invalid_repository_url',
  'github_unavailable', 'github_timeout', 'github_snapshot_invalid', 'github_integrity_failed',
  'github_budget_exceeded', 'github_no_documents', 'github_import_failed',
  'gitlab_import_unavailable', 'invalid_gitlab_request', 'invalid_project_url',
  'gitlab_unavailable', 'gitlab_timeout', 'gitlab_snapshot_invalid', 'gitlab_integrity_failed',
  'gitlab_budget_exceeded', 'gitlab_no_documents', 'gitlab_import_failed',
  'https_import_unavailable', 'invalid_https_request', 'invalid_https_url', 'https_busy',
  'https_timeout', 'https_dns_failed', 'https_address_blocked', 'https_peer_mismatch',
  'https_redirect_refused', 'https_upstream_failed', 'https_tls_failed',
  'https_response_invalid', 'https_type_unsupported', 'https_too_large', 'https_json_invalid',
  'https_content_invalid', 'https_import_failed', 'connector_state_unavailable',
  'webhook_state_unavailable', 'webhook_lifecycle_failed', 'webhook_not_found',
  'invalid_webhook_request',
];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!record(value)) return false;
  const held = Object.keys(value);
  return held.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function member<T extends string>(value: unknown, held: readonly T[]): value is T {
  return typeof value === 'string' && held.includes(value as T);
}

function canonicalBase64url(value: string, expectedLength: number): boolean {
  if (value.length !== expectedLength || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) return false;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(value.at(-1) ?? '');
  const remainder = value.length % 4;
  return last >= 0 && (remainder === 0 || (remainder === 2 ? last % 16 === 0 : last % 4 === 0));
}

function canonicalPreviewToken(value: string): boolean {
  if (value.length > 3_000 || !PREVIEW_TOKEN.test(value)) return false;
  const parts = value.split('.');
  const payload = parts[0] ?? '';
  const signature = parts[1] ?? '';
  return parts.length === 2 && canonicalBase64url(payload, payload.length)
    && canonicalBase64url(signature, 43);
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || timestamp(value);
}

function endpointFor(id: string): string | null {
  return typeof globalThis.location?.origin === 'string'
    ? `${globalThis.location.origin}/api/connectors/webhook/${id}` : null;
}

const RUN_KEYS = [
  'connectorId', 'submittedDocuments', 'duplicateDocuments', 'acceptedDocuments',
  'searchableDocuments', 'failedDocuments', 'emptyDocuments', 'acceptedRecords', 'refusedRecords',
  'failure', 'startedAt', 'completedAt', 'observationWrite', 'indeterminateSubmission',
] as const;

function decodeRun(value: unknown, connectorIds: readonly ConnectorId[]): ConnectorRunReceipt | null {
  if (!exact(value, RUN_KEYS) || !member(value.connectorId, connectorIds)
    || !count(value.submittedDocuments) || !count(value.duplicateDocuments)
    || !count(value.acceptedDocuments) || !count(value.searchableDocuments)
    || !count(value.failedDocuments) || !count(value.emptyDocuments)
    || !count(value.acceptedRecords) || !count(value.refusedRecords)
    || !(value.failure === null || member(value.failure, FAILURES))
    || !timestamp(value.startedAt) || !timestamp(value.completedAt)
    || !member(value.observationWrite, ['stored', 'unchanged', 'stale', 'failed'] as const)
    || typeof value.indeterminateSubmission !== 'boolean'
    || value.submittedDocuments < 1 || value.submittedDocuments > MAX_RUN_DOCUMENTS
    || value.acceptedRecords > MAX_RUN_RECORDS || value.refusedRecords > MAX_RUN_RECORDS
    || value.searchableDocuments > value.acceptedDocuments
    || value.acceptedDocuments > value.submittedDocuments
    || value.duplicateDocuments > value.submittedDocuments
    || value.failedDocuments > value.submittedDocuments
    || value.emptyDocuments > value.submittedDocuments
    || value.acceptedDocuments + value.duplicateDocuments > value.submittedDocuments
    || value.failedDocuments + value.duplicateDocuments > value.submittedDocuments
    || Date.parse(value.completedAt) < Date.parse(value.startedAt)
    || (value.indeterminateSubmission && value.failure === null)
    || (value.failedDocuments > 0 && value.failure === null)
    || ((value.acceptedDocuments === 0) !== (value.acceptedRecords === 0))
    || (value.observationWrite === 'failed' && value.failure !== 'transport_failed')) return null;
  return value as unknown as ConnectorRunReceipt;
}

function decodePreview(value: unknown): FilePreviewResponse | null {
  if (!exact(value, [
    'filename', 'title', 'type', 'excerpt', 'characters', 'pages', 'paragraphs', 'tables',
    'rawDigest', 'normalizedDigest', 'previewToken', 'expiresAt',
  ]) || typeof value.filename !== 'string' || value.filename.length === 0 || value.filename.length > 255
    || typeof value.title !== 'string' || value.title.length === 0 || value.title.length > 512
    || !member(value.type, FILE_IDS) || typeof value.excerpt !== 'string' || value.excerpt.length > 2_048
    || !count(value.characters) || !count(value.pages) || !count(value.paragraphs) || !count(value.tables)
    || typeof value.rawDigest !== 'string' || !SHA256.test(value.rawDigest)
    || typeof value.normalizedDigest !== 'string' || !SHA256.test(value.normalizedDigest)
    || typeof value.previewToken !== 'string' || !canonicalPreviewToken(value.previewToken)
    || !timestamp(value.expiresAt)) return null;
  return value as unknown as FilePreviewResponse;
}

function decodeFileImport(value: unknown): FileImportResponse | null {
  const decoded = decodeRun(value, FILE_IDS);
  return decoded === null ? null : decoded as FileImportResponse;
}

function fileTypeForName(name: string): FileConnectorId | null {
  return /\.md$/iu.test(name) ? 'markdown' : /\.(?:txt|json|csv)$/iu.test(name) ? 'text'
    : /\.pdf$/iu.test(name) ? 'pdf' : /\.docx$/iu.test(name) ? 'docx' : null;
}

function runPart(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(RUN_KEYS.map((key) => [key, value[key]]));
}

function decodeGitHub(value: unknown): GitHubImportResponse | null {
  if (!record(value) || !exact(value, [...RUN_KEYS, 'snapshotCommit', 'snapshotDigest', 'consideredEntries', 'fetchedBlobs', 'skipped'])
    || decodeRun(runPart(value), ['github']) === null
    || typeof value.snapshotCommit !== 'string' || !SHA1.test(value.snapshotCommit)
    || typeof value.snapshotDigest !== 'string' || !SHA256.test(value.snapshotDigest)
    || !count(value.consideredEntries) || !count(value.fetchedBlobs) || !Array.isArray(value.skipped)
    || value.skipped.length > 32 || value.skipped.some((item) => !exact(item, ['reason', 'count'])
      || typeof item.reason !== 'string' || !SKIP_REASON.test(item.reason) || !count(item.count))) return null;
  return value as unknown as GitHubImportResponse;
}

function decodeGitLab(value: unknown): GitLabImportResponse | null {
  if (!record(value) || !exact(value, [...RUN_KEYS, 'snapshotCommit', 'snapshotDigest', 'consideredEntries', 'fetchedBlobs', 'skipped'])
    || decodeRun(runPart(value), ['gitlab']) === null
    || typeof value.snapshotCommit !== 'string' || !SHA1.test(value.snapshotCommit)
    || typeof value.snapshotDigest !== 'string' || !SHA256.test(value.snapshotDigest)
    || !count(value.consideredEntries) || !count(value.fetchedBlobs) || !Array.isArray(value.skipped)
    || value.skipped.length > 32 || value.skipped.some((item) => !exact(item, ['reason', 'count'])
      || typeof item.reason !== 'string' || !SKIP_REASON.test(item.reason) || !count(item.count))) return null;
  return value as unknown as GitLabImportResponse;
}

function decodeHttps(value: unknown): HttpsImportResponse | null {
  if (!record(value) || !exact(value, [...RUN_KEYS, 'sourceDigest', 'contentDigest'])
    || decodeRun(runPart(value), ['https_api']) === null
    || typeof value.sourceDigest !== 'string' || !SHA256.test(value.sourceDigest)
    || typeof value.contentDigest !== 'string' || !SHA256.test(value.contentDigest)) return null;
  return value as unknown as HttpsImportResponse;
}

const CATALOGUE_SHAPE: Readonly<Record<ConnectorId, readonly [string, ConnectorStatus['group']]>> = {
  github: ['GitHub', 'CODE'], gitlab: ['GitLab', 'CODE'], markdown: ['Markdown', 'FILES'], text: ['Text', 'FILES'],
  pdf: ['PDF', 'FILES'], docx: ['DOCX', 'FILES'], https_api: ['HTTPS API', 'DATA'],
  webhook: ['Webhook', 'DATA'],
};

const UNAVAILABLE_REASON: Readonly<Record<ConnectorId, NonNullable<ConnectorStatus['reason']>>> = {
  github: 'github_import_unavailable',
  gitlab: 'gitlab_import_unavailable',
  markdown: 'file_import_unavailable',
  text: 'file_import_unavailable',
  pdf: 'file_import_unavailable',
  docx: 'file_import_unavailable',
  https_api: 'https_import_unavailable',
  webhook: 'signing_not_configured',
};

function decodeCatalogue(value: unknown): ConnectorCatalogue | null {
  if (!exact(value, ['connectors']) || !Array.isArray(value.connectors) || value.connectors.length !== IDS.length) return null;
  const seen = new Set<ConnectorId>();
  for (const [index, item] of value.connectors.entries()) {
    if (!exact(item, [
      'id', 'label', 'group', 'availability', 'reason', 'configuredAt', 'lastAttemptAt',
      'lastSuccessAt', 'lastFailure', 'importedDocuments', 'state',
    ]) || !member(item.id, IDS) || item.id !== IDS[index] || seen.has(item.id)) return null;
    const expected = CATALOGUE_SHAPE[item.id];
    const expectedState = item.lastFailure !== null ? 'failed'
      : item.id === 'webhook' && item.availability === 'available' && item.configuredAt !== null
        ? 'connected' : 'idle';
    if (item.label !== expected[0] || item.group !== expected[1]
      || !member(item.availability, ['available', 'unavailable'] as const)
      || !(item.reason === null || member(item.reason, [
        'signing_not_configured', 'file_import_unavailable', 'github_import_unavailable', 'gitlab_import_unavailable', 'https_import_unavailable',
      ] as const))
      || (item.availability === 'available') !== (item.reason === null)
      || (item.availability === 'unavailable' && item.reason !== UNAVAILABLE_REASON[item.id])
      || !nullableTimestamp(item.configuredAt) || !nullableTimestamp(item.lastAttemptAt)
      || !nullableTimestamp(item.lastSuccessAt)
      || !(item.lastFailure === null || member(item.lastFailure, FAILURES))
      || !count(item.importedDocuments) || item.importedDocuments > MAX_IMPORTED_DOCUMENTS
      || !member(item.state, ['idle', 'connected', 'failed'] as const)
      || item.state !== expectedState
      || (item.id !== 'webhook' && item.configuredAt !== null)
      || ((item.importedDocuments === 0) !== (item.lastSuccessAt === null))
      || (item.lastAttemptAt === null && (item.lastSuccessAt !== null || item.lastFailure !== null || item.importedDocuments !== 0))
      || (item.lastAttemptAt !== null && item.lastSuccessAt !== null
        && Date.parse(item.lastSuccessAt) > Date.parse(item.lastAttemptAt))) return null;
    seen.add(item.id);
  }
  return value as unknown as ConnectorCatalogue;
}

function decodeWebhookState(value: unknown): WebhookState | null {
  if (!exact(value, ['configured', 'endpointId', 'endpoint', 'configuredAt'])) return null;
  if (value.configured === false) {
    return value.endpointId === null && value.endpoint === null && value.configuredAt === null
      ? value as unknown as WebhookState : null;
  }
  if (value.configured !== true || typeof value.endpointId !== 'string' || !ID.test(value.endpointId)
    || !canonicalBase64url(value.endpointId, 22)
    || value.endpoint !== endpointFor(value.endpointId) || !timestamp(value.configuredAt)) return null;
  return value as unknown as WebhookState;
}

function decodeIssue(value: unknown, status: number): WebhookIssueResponse | null {
  if (!exact(value, ['created', 'endpointId', 'endpoint', 'secret', 'configuredAt'])
    || typeof value.endpointId !== 'string' || !ID.test(value.endpointId) || !canonicalBase64url(value.endpointId, 22)
    || value.endpoint !== endpointFor(value.endpointId) || !timestamp(value.configuredAt)) return null;
  if (status === 201 && value.created === true && typeof value.secret === 'string'
    && SECRET.test(value.secret) && canonicalBase64url(value.secret, 43)) {
    return value as unknown as WebhookIssueResponse;
  }
  return status === 200 && value.created === false && value.secret === null
    ? value as unknown as WebhookIssueResponse : null;
}

function decodeRefusal(value: unknown): ConnectorRefusalCode | null {
  return exact(value, ['error']) && member(value.error, REFUSALS) ? value.error : null;
}

interface RequestOptions<T> {
  readonly path: string;
  readonly init: RequestInit;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly decode: (value: unknown, status: number) => T | null;
  readonly successfulStatus?: (status: number) => boolean;
}

/**
 * Read connector JSON through the response stream so caller cancellation and
 * request deadlines also cancel a body that has already delivered headers.
 * A few test/embedded-browser adapters expose only `json()`, so retain that
 * compatibility fallback when no readable body is available.
 */
async function readResponseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.body === null || typeof response.body?.getReader !== 'function') {
    return response.json() as Promise<unknown>;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abortReject!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { abortReject = reject; });
  const onAbort = () => {
    abortReject(new Error('connector response body read cancelled'));
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error('connector response body too large');
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function oneRequest<T>(options: RequestOptions<T>): Promise<ConnectorOutcome<T>> {
  const controller = new AbortController();
  let callerAborted = options.signal.aborted;
  let timedOut = false;
  const relay = () => { callerAborted = true; controller.abort(); };
  if (callerAborted) controller.abort();
  else options.signal.addEventListener('abort', relay, { once: true });
  const timeout = globalThis.setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs);
  try {
    const response = await fetch(options.path, { ...options.init, signal: controller.signal });
    const body = await readResponseJson(response, controller.signal);
    if (callerAborted || options.signal.aborted) return { kind: 'discarded' };
    if (timedOut) return { kind: 'indeterminate' };
    const successful = options.successfulStatus?.(response.status) ?? response.ok;
    if (!successful) {
      const code = decodeRefusal(body);
      return code === null ? { kind: 'indeterminate' } : { kind: 'known_refusal', status: response.status, code };
    }
    const value = options.decode(body, response.status);
    return value === null ? { kind: 'indeterminate' } : { kind: 'receipt', value };
  } catch {
    return callerAborted || options.signal.aborted ? { kind: 'discarded' } : { kind: 'indeterminate' };
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal.removeEventListener('abort', relay);
  }
}

function privateHeaders(binding: string): Headers {
  const headers = new Headers({ Accept: 'application/json' });
  if (BINDING.test(binding)) headers.set('x-lacuna-voice-binding', binding);
  return headers;
}

function mutationHeaders(context: ConnectorMutationContext, json: boolean): Headers {
  const headers = privateHeaders(context.binding);
  headers.set('X-CSRF-Token', context.csrf);
  if (json) headers.set('Content-Type', 'application/json');
  return headers;
}

export function getConnectorCatalogue(binding: string, signal: AbortSignal): Promise<ConnectorOutcome<ConnectorCatalogue>> {
  return oneRequest({
    path: '/api/workspace/connectors', signal,
    timeoutMs: CATALOGUE_TIMEOUT_MS,
    init: { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: privateHeaders(binding) },
    successfulStatus: (status) => status === 200,
    decode: (value) => decodeCatalogue(value),
  });
}

export function previewFile(file: File, context: ConnectorMutationContext): Promise<ConnectorOutcome<FilePreviewResponse>> {
  const body = new FormData();
  body.set('file', file);
  return oneRequest({
    path: '/api/workspace/connectors/file/preview', signal: context.signal,
    timeoutMs: FILE_PREVIEW_TIMEOUT_MS,
    init: { method: 'POST', credentials: 'same-origin', headers: mutationHeaders(context, false), body },
    successfulStatus: (status) => status === 200,
    decode: (value) => {
      const decoded = decodePreview(value);
      return decoded !== null && decoded.filename === file.name && decoded.type === fileTypeForName(file.name)
        ? decoded : null;
    },
  });
}

export function importFile(file: File, previewToken: string, context: ConnectorMutationContext): Promise<ConnectorOutcome<FileImportResponse>> {
  const body = new FormData();
  body.set('file', file);
  body.set('preview_token', previewToken);
  return oneRequest({
    path: '/api/workspace/connectors/file/import', signal: context.signal,
    timeoutMs: IMPORT_TIMEOUT_MS,
    init: { method: 'POST', credentials: 'same-origin', headers: mutationHeaders(context, false), body },
    successfulStatus: (status) => status === 200,
    decode: (value) => {
      const decoded = decodeFileImport(value);
      return decoded !== null && decoded.connectorId === fileTypeForName(file.name) ? decoded : null;
    },
  });
}

export function importGitHub(url: string, context: ConnectorMutationContext): Promise<ConnectorOutcome<GitHubImportResponse>> {
  return oneRequest({
    path: '/api/workspace/connectors/github/import', signal: context.signal,
    timeoutMs: IMPORT_TIMEOUT_MS,
    init: { method: 'POST', credentials: 'same-origin', headers: mutationHeaders(context, true), body: JSON.stringify({ url }) },
    successfulStatus: (status) => status === 200,
    decode: (value) => decodeGitHub(value),
  });
}

export function importGitLab(url: string, context: ConnectorMutationContext): Promise<ConnectorOutcome<GitLabImportResponse>> {
  return oneRequest({
    path: '/api/workspace/connectors/gitlab/import', signal: context.signal,
    timeoutMs: IMPORT_TIMEOUT_MS,
    init: { method: 'POST', credentials: 'same-origin', headers: mutationHeaders(context, true), body: JSON.stringify({ url }) },
    successfulStatus: (status) => status === 200,
    decode: (value) => decodeGitLab(value),
  });
}

export function importHttps(url: string, context: ConnectorMutationContext): Promise<ConnectorOutcome<HttpsImportResponse>> {
  return oneRequest({
    path: '/api/workspace/connectors/api/import', signal: context.signal,
    timeoutMs: HTTPS_IMPORT_TIMEOUT_MS,
    init: { method: 'POST', credentials: 'same-origin', headers: mutationHeaders(context, true), body: JSON.stringify({ url }) },
    successfulStatus: (status) => status === 200,
    decode: (value) => decodeHttps(value),
  });
}

export function getWebhookState(binding: string, signal: AbortSignal): Promise<ConnectorOutcome<WebhookState>> {
  return oneRequest({
    path: '/api/workspace/connectors/webhook', signal,
    timeoutMs: CATALOGUE_TIMEOUT_MS,
    init: { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: privateHeaders(binding) },
    successfulStatus: (status) => status === 200,
    decode: (value) => decodeWebhookState(value),
  });
}

export function issueWebhook(context: ConnectorMutationContext): Promise<ConnectorOutcome<WebhookIssueResponse>> {
  return oneRequest({
    path: '/api/workspace/connectors/webhook', signal: context.signal,
    timeoutMs: WEBHOOK_LIFECYCLE_TIMEOUT_MS,
    init: { method: 'POST', credentials: 'same-origin', headers: mutationHeaders(context, false) },
    successfulStatus: (status) => status === 200 || status === 201,
    decode: (value, status) => decodeIssue(value, status),
  });
}

export function revokeWebhook(id: string, context: ConnectorMutationContext): Promise<ConnectorOutcome<WebhookRevokeResponse>> {
  return oneRequest({
    path: `/api/workspace/connectors/webhook/${ID.test(id) && canonicalBase64url(id, 22) ? id : ''}`, signal: context.signal,
    timeoutMs: WEBHOOK_LIFECYCLE_TIMEOUT_MS,
    init: { method: 'DELETE', credentials: 'same-origin', headers: mutationHeaders(context, false) },
    successfulStatus: (status) => status === 200,
    decode: (value) => exact(value, ['revoked']) && value.revoked === true ? { revoked: true } : null,
  });
}
