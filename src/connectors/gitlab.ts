import { createHash } from 'node:crypto';

import { MAX_SOURCE_CHARS } from '../api/ingest.js';
import { isCanonicalGitHubPath } from './evidence.js';
import { canonicalizeGitLabProjectRoot } from './gitlab-project.js';
import { prepareConnectorBatch, type ConnectorDocumentInput, type PreparedConnectorBatch } from './normalize.js';

export const GITLAB_PARSER_VERSION = 'gitlab-v1';

const API_ORIGIN = 'https://gitlab.com';
const API_ROOT = `${API_ORIGIN}/api/v4`;
const DEFAULT_DEADLINE_MS = 20_000;
const DEFAULT_MAX_REQUESTS = 35;
const DEFAULT_MAX_TREE_ENTRIES = 100;
const DEFAULT_MAX_FILES = 30;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_AGGREGATE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_RESPONSE_BYTES = 8 * 1024 * 1024;
const JSON_RESPONSE_BYTES = 1 * 1024 * 1024;
const RAW_RESPONSE_BYTES = 768 * 1024;
const SHA1 = /^[0-9a-f]{40}$/u;
const BRANCH = /^[A-Za-z0-9._/-]{1,255}$/u;
const BINARY_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const EXCLUDED_DIRECTORIES = new Set([
  '.cache', '.git', '.next', '.nuxt', '.output', '.parcel-cache', '.turbo',
  '.bundle', '.venv', 'bower_components', 'build', 'cache', 'coverage', 'dependencies',
  'deps', 'dist', 'env', 'generated', 'node_modules', 'obj', 'out', 'site-packages',
  'target', 'third-party', 'third_party', 'vendor', 'vendors', 'venv',
]);
const SENSITIVE_DIRECTORIES = new Set(['.aws', '.azure', '.docker', '.gnupg', '.kube', '.ssh']);
const LOCKFILES = new Set([
  'bun.lock', 'bun.lockb', 'cargo.lock', 'composer.lock', 'gemfile.lock',
  'package-lock.json', 'pipfile.lock', 'pnpm-lock.yaml', 'poetry.lock', 'yarn.lock',
]);
const SUPPORTED_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'jsx', 'json',
  'kt', 'kts', 'md', 'markdown', 'mjs', 'php', 'py', 'rb', 'rs', 'scala', 'sh', 'sql',
  'swift', 'text', 'ts', 'tsx', 'txt', 'vue',
]);
const HEADERS = Object.freeze({ Accept: 'application/json', 'User-Agent': 'Lacuna-Connector/1.0' });

export type GitLabImportErrorCode =
  | 'invalid_project_url' | 'gitlab_unavailable' | 'gitlab_timeout' | 'gitlab_snapshot_invalid'
  | 'gitlab_integrity_failed' | 'gitlab_budget_exceeded' | 'gitlab_no_documents';

export class GitLabImportError extends Error {
  override readonly name = 'GitLabImportError';
  readonly code: GitLabImportErrorCode;
  readonly status: number;

  constructor(code: GitLabImportErrorCode) {
    super(code);
    this.code = code;
    this.status = code === 'invalid_project_url' || code === 'gitlab_no_documents' ? 422
      : code === 'gitlab_budget_exceeded' ? 413
        : code === 'gitlab_timeout' ? 504 : 502;
  }
}

export type GitLabSkipReason =
  | 'binary' | 'directory' | 'document_too_long' | 'empty' | 'excluded_directory'
  | 'file_limit' | 'file_too_large' | 'invalid_utf8' | 'lockfile' | 'secret_filename'
  | 'unsupported_extension';

export interface PreparedGitLabBatch extends PreparedConnectorBatch {
  readonly projectUrl: string;
  readonly commitSha: string;
  readonly snapshotDigest: string;
  readonly consideredEntries: number;
  readonly fetchedBlobs: number;
  readonly skipped: readonly { readonly reason: GitLabSkipReason; readonly count: number }[];
}

export interface GitLabTransportRequest {
  readonly url: string;
  readonly method: 'GET';
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly maxResponseBytes: number;
}

export interface GitLabTransportResponse {
  readonly status: number;
  readonly url: string;
  readonly redirected: boolean;
  readonly body: Uint8Array;
}

export interface GitLabTransport { request(request: GitLabTransportRequest): Promise<GitLabTransportResponse> }
export interface GitLabImporterBoundary { importPublicProject(url: string, signal: AbortSignal): Promise<PreparedGitLabBatch> }
export interface GitLabImporterOptions {
  readonly transport?: GitLabTransport;
  readonly now?: () => number;
  readonly deadlineMs?: number;
  readonly maxRequests?: number;
  readonly maxTreeEntries?: number;
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly maxAggregateBytes?: number;
}

class FetchGitLabTransport implements GitLabTransport {
  async request(request: GitLabTransportRequest): Promise<GitLabTransportResponse> {
    const url = new URL(request.url);
    if (url.origin !== API_ORIGIN || request.method !== 'GET') throw new Error('invalid GitLab transport request');
    const response = await fetch(url, {
      method: 'GET', headers: request.headers, redirect: 'manual', credentials: 'omit', signal: request.signal,
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body?.getReader();
    if (reader !== undefined) {
      const cancelReader = () => { void reader.cancel().catch(() => undefined); };
      request.signal.addEventListener('abort', cancelReader, { once: true });
      if (request.signal.aborted) cancelReader();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > request.maxResponseBytes) {
            await reader.cancel();
            throw new GitLabImportError('gitlab_budget_exceeded');
          }
          chunks.push(next.value);
        }
      } finally {
        request.signal.removeEventListener('abort', cancelReader);
      }
    }
    return {
      status: response.status, url: response.url, redirected: response.redirected,
      body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bounded(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > fallback) throw new Error('invalid GitLab importer budget');
  return value;
}

function projectIdentity(value: string): { readonly namespace: string; readonly projectUrl: string; readonly apiRoot: string } {
  const canonical = canonicalizeGitLabProjectRoot(value);
  if (canonical === null) throw new GitLabImportError('invalid_project_url');
  const encoded = encodeURIComponent(canonical.namespace);
  return { ...canonical, apiRoot: `${API_ROOT}/projects/${encoded}` };
}

function decodeJson(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new GitLabImportError('gitlab_snapshot_invalid'); }
}

function extension(path: string): string {
  const name = path.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function secretFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === '.env' || lower.startsWith('.env.')
    || /(?:^|[._-])(?:credential|credentials|password|passwd|secret|secrets|token|private[-_]?key)(?:[._-]|$)/u.test(lower)
    || /(?:^|[._-])api[-_]?key(?:[._-]|$)/u.test(lower)
    || lower === '.gitconfig' || lower === '.netrc' || lower === '.npmrc' || lower === '.pypirc'
    || lower === 'auth.json' || lower === 'service-account.json' || lower === 'service_account.json'
    || lower === 'credentials.json' || lower === 'secrets.json' || lower === 'id_rsa' || lower === 'id_ed25519';
}

function policyReason(path: string): GitLabSkipReason | null {
  const parts = path.split('/').map((part) => part.toLowerCase());
  const name = parts.at(-1) ?? '';
  if (parts.slice(0, -1).some((part) => SENSITIVE_DIRECTORIES.has(part)) || secretFilename(name)) return 'secret_filename';
  if (parts.slice(0, -1).some((part) => EXCLUDED_DIRECTORIES.has(part))) return 'excluded_directory';
  if (LOCKFILES.has(name)) return 'lockfile';
  if (!SUPPORTED_EXTENSIONS.has(extension(path))) return 'unsupported_extension';
  return null;
}

function sha256(value: Uint8Array | string): string { return createHash('sha256').update(value).digest('hex'); }

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`, 'utf8').update(bytes).digest('hex');
}

function sourceUrl(projectUrl: string, commitSha: string, path: string): string {
  return `${projectUrl}/-/blob/${commitSha}/${path.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

function mediaType(path: string): 'text/plain' | 'text/markdown' | 'application/json' {
  const suffix = extension(path);
  if (suffix === 'md' || suffix === 'markdown') return 'text/markdown';
  return suffix === 'json' ? 'application/json' : 'text/plain';
}

function skips(counts: ReadonlyMap<GitLabSkipReason, number>): readonly { readonly reason: GitLabSkipReason; readonly count: number }[] {
  return Object.freeze([...counts]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([reason, count]) => Object.freeze({ reason, count })));
}

export class GitLabImporter implements GitLabImporterBoundary {
  readonly #transport: GitLabTransport;
  readonly #now: () => number;
  readonly #deadlineMs: number;
  readonly #maxRequests: number;
  readonly #maxTreeEntries: number;
  readonly #maxFiles: number;
  readonly #maxFileBytes: number;
  readonly #maxAggregateBytes: number;

  constructor(options: GitLabImporterOptions = {}) {
    this.#transport = options.transport ?? new FetchGitLabTransport();
    this.#now = options.now ?? Date.now;
    this.#deadlineMs = bounded(options.deadlineMs, DEFAULT_DEADLINE_MS);
    this.#maxRequests = bounded(options.maxRequests, DEFAULT_MAX_REQUESTS);
    this.#maxTreeEntries = bounded(options.maxTreeEntries, DEFAULT_MAX_TREE_ENTRIES);
    this.#maxFiles = bounded(options.maxFiles, DEFAULT_MAX_FILES);
    this.#maxFileBytes = bounded(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
    this.#maxAggregateBytes = bounded(options.maxAggregateBytes, DEFAULT_MAX_AGGREGATE_BYTES);
  }

  async importPublicProject(value: string, callerSignal: AbortSignal): Promise<PreparedGitLabBatch> {
    const identity = projectIdentity(value);
    const control = new AbortController();
    let deadlineExpired = false;
    let requests = 0;
    let responseBytes = 0;
    let aggregateBytes = 0;
    const relayAbort = () => control.abort();
    if (callerSignal.aborted) relayAbort();
    else callerSignal.addEventListener('abort', relayAbort, { once: true });
    const deadlineTimer = setTimeout(() => { deadlineExpired = true; control.abort(); }, this.#deadlineMs);
    deadlineTimer.unref?.();

    const request = async (url: string, maxResponseBytes: number): Promise<Uint8Array> => {
      if (control.signal.aborted) throw new GitLabImportError(deadlineExpired ? 'gitlab_timeout' : 'gitlab_unavailable');
      if (requests >= this.#maxRequests) throw new GitLabImportError('gitlab_budget_exceeded');
      requests += 1;
      let response: GitLabTransportResponse;
      try {
        response = await this.#transport.request({ url, method: 'GET', headers: HEADERS, signal: control.signal, maxResponseBytes });
      } catch (error) {
        if (error instanceof GitLabImportError) throw error;
        throw new GitLabImportError(deadlineExpired ? 'gitlab_timeout' : 'gitlab_unavailable');
      }
      if (control.signal.aborted) throw new GitLabImportError(deadlineExpired ? 'gitlab_timeout' : 'gitlab_unavailable');
      if (response.redirected || response.url !== url || response.status < 200 || response.status >= 300) {
        throw new GitLabImportError('gitlab_unavailable');
      }
      if (!(response.body instanceof Uint8Array) || response.body.byteLength > maxResponseBytes) {
        throw new GitLabImportError('gitlab_budget_exceeded');
      }
      responseBytes += response.body.byteLength;
      if (responseBytes > MAX_TOTAL_RESPONSE_BYTES) throw new GitLabImportError('gitlab_budget_exceeded');
      return response.body;
    };

    try {
      const projectValue = decodeJson(await request(identity.apiRoot, JSON_RESPONSE_BYTES));
      if (!isRecord(projectValue) || projectValue['visibility'] !== 'public'
        || typeof projectValue['path_with_namespace'] !== 'string'
        || projectValue['path_with_namespace'].toLowerCase() !== identity.namespace
        || typeof projectValue['default_branch'] !== 'string' || !BRANCH.test(projectValue['default_branch'])) {
        throw new GitLabImportError('gitlab_snapshot_invalid');
      }
      const projectId = projectValue['id'];
      if (!Number.isSafeInteger(projectId) || (projectId as number) < 1) throw new GitLabImportError('gitlab_snapshot_invalid');
      const commitsValue = decodeJson(await request(
        `${identity.apiRoot}/repository/commits?ref_name=${encodeURIComponent(projectValue['default_branch'])}&per_page=1`,
        JSON_RESPONSE_BYTES,
      ));
      const commit = Array.isArray(commitsValue) ? commitsValue[0] : null;
      const commitSha = isRecord(commit) ? commit['id'] : null;
      if (typeof commitSha !== 'string' || !SHA1.test(commitSha)) throw new GitLabImportError('gitlab_snapshot_invalid');

      const treeValue = decodeJson(await request(
        `${identity.apiRoot}/repository/tree?ref=${encodeURIComponent(commitSha)}&recursive=true&per_page=${this.#maxTreeEntries + 1}`,
        JSON_RESPONSE_BYTES,
      ));
      if (!Array.isArray(treeValue) || treeValue.length > this.#maxTreeEntries) throw new GitLabImportError('gitlab_budget_exceeded');
      const entries: { readonly path: string; readonly blobSha: string }[] = [];
      const seen = new Set<string>();
      const folded = new Set<string>();
      const skippedCounts = new Map<GitLabSkipReason, number>();
      const skip = (reason: GitLabSkipReason): void => {
        skippedCounts.set(reason, (skippedCounts.get(reason) ?? 0) + 1);
      };
      for (const raw of treeValue) {
        if (!isRecord(raw) || typeof raw['path'] !== 'string' || !isCanonicalGitHubPath(raw['path'])
          || typeof raw['type'] !== 'string' || typeof raw['id'] !== 'string' || !SHA1.test(raw['id'])) {
          throw new GitLabImportError('gitlab_snapshot_invalid');
        }
        const key = raw['path'].normalize('NFKC').toLowerCase();
        if (seen.has(raw['path']) || folded.has(key)) throw new GitLabImportError('gitlab_snapshot_invalid');
        seen.add(raw['path']); folded.add(key);
        if (raw['type'] !== 'blob') { skip('directory'); continue; }
        const reason = policyReason(raw['path']);
        if (reason !== null) { skip(reason); continue; }
        entries.push({ path: raw['path'], blobSha: raw['id'] });
      }
      for (const _entry of entries.slice(this.#maxFiles)) skip('file_limit');
      const selected = entries.slice(0, this.#maxFiles);
      const observedAt = new Date(this.#now()).toISOString();
      const inputs: ConnectorDocumentInput[] = [];
      let fetchedBlobs = 0;
      for (const entry of selected) {
        const encodedPath = entry.path.split('/').map((part) => encodeURIComponent(part)).join('/');
        const bytes = await request(`${identity.apiRoot}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(commitSha)}`, RAW_RESPONSE_BYTES);
        fetchedBlobs += 1;
        if (bytes.byteLength > this.#maxFileBytes || bytes.byteLength + aggregateBytes > this.#maxAggregateBytes) {
          throw new GitLabImportError('gitlab_budget_exceeded');
        }
        aggregateBytes += bytes.byteLength;
        if (gitBlobSha(bytes) !== entry.blobSha) throw new GitLabImportError('gitlab_integrity_failed');
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { skip('invalid_utf8'); continue; }
        if (BINARY_TEXT.test(text)) { skip('binary'); continue; }
        if (text.trim() === '') { skip('empty'); continue; }
        const normalized = text.replace(/^\ufeff/u, '').replace(/\r\n?/gu, '\n').replaceAll('\u0000', '').normalize('NFC');
        if (normalized.length > MAX_SOURCE_CHARS) { skip('document_too_long'); continue; }
        inputs.push({
          title: entry.path.length <= 120 ? entry.path : `…${entry.path.slice(-119)}`,
          text: normalized,
          provenance: {
            connectorId: 'gitlab', sourceUrl: sourceUrl(identity.projectUrl, commitSha, entry.path),
            mediaType: mediaType(entry.path), observedAt,
            gitlab: {
              projectUrl: identity.projectUrl, commitSha, path: entry.path, blobSha: entry.blobSha,
              retrievedAt: observedAt, rawDigest: sha256(bytes), parserVersion: GITLAB_PARSER_VERSION,
            },
          },
        });
      }
      if (inputs.length === 0) throw new GitLabImportError('gitlab_no_documents');
      const batch = prepareConnectorBatch(inputs);
      const snapshotDigest = sha256(JSON.stringify({
        projectUrl: identity.projectUrl, commitSha,
        documents: batch.documents.map((document) => ({ sourceKey: document.sourceKey, contentDigest: document.contentDigest })),
      }));
      return Object.freeze({
        ...batch, projectUrl: identity.projectUrl, commitSha, snapshotDigest,
        consideredEntries: treeValue.length, fetchedBlobs, skipped: skips(skippedCounts),
      });
    } catch (error) {
      control.abort();
      if (error instanceof GitLabImportError) throw error;
      throw new GitLabImportError(deadlineExpired ? 'gitlab_timeout' : 'gitlab_unavailable');
    } finally {
      clearTimeout(deadlineTimer);
      callerSignal.removeEventListener('abort', relayAbort);
      control.abort();
    }
  }
}
