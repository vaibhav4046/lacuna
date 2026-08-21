import { createHash } from 'node:crypto';

import { MAX_SOURCE_CHARS } from '../api/ingest.js';
import { isCanonicalGitHubPath } from './evidence.js';
import { canonicalizeGitHubRepositoryRoot } from './github-repository.js';
import {
  prepareConnectorBatch,
  type ConnectorDocumentInput,
  type PreparedConnectorBatch,
} from './normalize.js';

export const GITHUB_PARSER_VERSION = 'github-v1';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const DEFAULT_DEADLINE_MS = 20_000;
const DEFAULT_MAX_REQUESTS = 33;
const DEFAULT_MAX_TREE_ENTRIES = 100;
const DEFAULT_MAX_FILES = 30;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_AGGREGATE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_RESPONSE_BYTES = 8 * 1024 * 1024;
const METADATA_RESPONSE_BYTES = 256 * 1024;
const TREE_RESPONSE_BYTES = 512 * 1024;
const BLOB_RESPONSE_BYTES = 768 * 1024;
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const BRANCH = /^[A-Za-z0-9._/-]{1,255}$/u;
const BINARY_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const EXCLUDED_DIRECTORIES = new Set([
  '.cache', '.git', '.next', '.nuxt', '.output', '.parcel-cache', '.turbo',
  '.bundle', '.venv', 'bower_components', 'build', 'cache', 'coverage', 'dependencies',
  'deps', 'dist', 'env', 'generated', 'node_modules', 'obj', 'out', 'site-packages',
  'target', 'third-party', 'third_party', 'vendor', 'vendors', 'venv',
]);
const SENSITIVE_DIRECTORIES = new Set([
  '.aws', '.azure', '.docker', '.gnupg', '.kube', '.ssh',
]);
const LOCKFILES = new Set([
  'bun.lock', 'bun.lockb', 'cargo.lock', 'composer.lock', 'gemfile.lock',
  'package-lock.json', 'pipfile.lock', 'pnpm-lock.yaml', 'poetry.lock', 'yarn.lock',
]);
const SUPPORTED_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'jsx',
  'json', 'kt', 'kts', 'md', 'markdown', 'mjs', 'php', 'py', 'rb', 'rs', 'scala',
  'sh', 'sql', 'swift', 'text', 'ts', 'tsx', 'txt', 'vue',
]);
const FIXED_HEADERS = Object.freeze({
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Lacuna-Connector/1.0',
  'X-GitHub-Api-Version': '2022-11-28',
});

export type GitHubImportErrorCode =
  | 'invalid_repository_url'
  | 'github_unavailable'
  | 'github_timeout'
  | 'github_snapshot_invalid'
  | 'github_integrity_failed'
  | 'github_budget_exceeded'
  | 'github_no_documents';

export class GitHubImportError extends Error {
  override readonly name = 'GitHubImportError';
  readonly code: GitHubImportErrorCode;
  readonly status: number;

  constructor(code: GitHubImportErrorCode) {
    super(code);
    this.code = code;
    this.status = code === 'invalid_repository_url' || code === 'github_no_documents' ? 422
      : code === 'github_budget_exceeded' ? 413
        : code === 'github_timeout' ? 504
          : 502;
  }
}

export type GitHubSkipReason =
  | 'binary'
  | 'directory'
  | 'document_too_long'
  | 'empty'
  | 'excluded_directory'
  | 'executable'
  | 'file_limit'
  | 'file_too_large'
  | 'git_lfs'
  | 'invalid_utf8'
  | 'lockfile'
  | 'secret_filename'
  | 'submodule'
  | 'symlink'
  | 'unsupported_extension';

export interface GitHubSkipCount {
  readonly reason: GitHubSkipReason;
  readonly count: number;
}

export interface PreparedGitHubBatch extends PreparedConnectorBatch {
  readonly repositoryUrl: string;
  readonly commitSha: string;
  readonly snapshotDigest: string;
  readonly consideredEntries: number;
  readonly fetchedBlobs: number;
  readonly skipped: readonly GitHubSkipCount[];
}

export interface GitHubTransportRequest {
  readonly url: string;
  readonly method: 'GET';
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly maxResponseBytes: number;
}

export interface GitHubTransportResponse {
  readonly status: number;
  readonly url: string;
  readonly redirected: boolean;
  readonly body: Uint8Array;
}

export interface GitHubTransport {
  request(request: GitHubTransportRequest): Promise<GitHubTransportResponse>;
}

export interface GitHubImporterBoundary {
  importPublicRepo(url: string, signal: AbortSignal): Promise<PreparedGitHubBatch>;
}

export interface GitHubImporterOptions {
  readonly transport?: GitHubTransport;
  readonly now?: () => number;
  readonly deadlineMs?: number;
  readonly maxRequests?: number;
  readonly maxTreeEntries?: number;
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly maxAggregateBytes?: number;
}

interface RepositoryIdentity {
  readonly owner: string;
  readonly repository: string;
  readonly repositoryUrl: string;
  readonly apiRoot: string;
}

interface GitTreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
  readonly size: number | null;
}

class FetchGitHubTransport implements GitHubTransport {
  async request(request: GitHubTransportRequest): Promise<GitHubTransportResponse> {
    const url = new URL(request.url);
    if (url.origin !== GITHUB_API_ORIGIN || request.method !== 'GET'
      || JSON.stringify(request.headers) !== JSON.stringify(FIXED_HEADERS)) {
      throw new Error('invalid GitHub transport request');
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: request.headers,
      redirect: 'manual',
      credentials: 'omit',
      signal: request.signal,
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body?.getReader();
    if (reader !== undefined) {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > request.maxResponseBytes) {
          await reader.cancel();
          throw new GitHubImportError('github_budget_exceeded');
        }
        chunks.push(next.value);
      }
    }
    return {
      status: response.status,
      url: response.url,
      redirected: response.redirected,
      body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bounded(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > fallback) {
    throw new Error('invalid GitHub importer budget');
  }
  return value;
}

function repositoryIdentity(value: string): RepositoryIdentity {
  const canonical = canonicalizeGitHubRepositoryRoot(value);
  if (canonical === null) throw new GitHubImportError('invalid_repository_url');
  return {
    owner: canonical.owner,
    repository: canonical.repository,
    repositoryUrl: canonical.repositoryUrl,
    apiRoot: `${GITHUB_API_ORIGIN}/repos/${canonical.owner}/${canonical.repository}`,
  };
}

function validBranch(value: unknown): value is string {
  if (typeof value !== 'string' || !BRANCH.test(value) || value.startsWith('/') || value.endsWith('/')
    || value.includes('//') || value.includes('\\')) return false;
  return value.split('/').every((part) => part !== '.' && part !== '..');
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new GitHubImportError('github_snapshot_invalid');
  }
}

function secretFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === '.env' || lower.startsWith('.env.')
    || /(?:^|[._-])(?:credential|credentials|password|passwd|secret|secrets|token|private[-_]?key)(?:[._-]|$)/u.test(lower)
    || /(?:^|[._-])api[-_]?key(?:[._-]|$)/u.test(lower)
    || lower === '.gitconfig' || lower === '.netrc' || lower === '.npmrc' || lower === '.pypirc'
    || lower === 'auth.json' || lower === 'service-account.json' || lower === 'service_account.json'
    || lower === 'credentials.json' || lower === 'secrets.json'
    || lower === 'application_default_credentials.json' || lower === 'pip.conf'
    || lower === 'id_rsa' || lower === 'id_ed25519';
}

function extension(path: string): string {
  const name = path.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function policyReason(entry: GitTreeEntry, maxFileBytes: number): GitHubSkipReason | null {
  if (entry.type === 'tree') return 'directory';
  if (entry.type === 'commit' || entry.mode === '160000') return 'submodule';
  if (entry.mode === '120000') return 'symlink';
  if (entry.type !== 'blob') throw new GitHubImportError('github_snapshot_invalid');
  if (entry.mode !== '100644') return 'executable';
  const parts = entry.path.split('/').map((part) => part.toLowerCase());
  if (parts.slice(0, -1).some((part) => SENSITIVE_DIRECTORIES.has(part))) return 'secret_filename';
  if (parts.slice(0, -1).some((part) => EXCLUDED_DIRECTORIES.has(part))) return 'excluded_directory';
  const name = parts.at(-1) ?? '';
  if (secretFilename(name)) return 'secret_filename';
  if (LOCKFILES.has(name)) return 'lockfile';
  if (!SUPPORTED_EXTENSIONS.has(extension(entry.path))) return 'unsupported_extension';
  if (entry.size === null || entry.size > maxFileBytes) return 'file_too_large';
  return null;
}

function strictBase64(value: string): Buffer | null {
  const compact = value.replace(/[\x20\t\r\n]/gu, '');
  if (compact.length === 0) return Buffer.alloc(0);
  if (compact.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(compact)) return null;
  const decoded = Buffer.from(compact, 'base64');
  return decoded.toString('base64') === compact ? decoded : null;
}

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function titleFor(path: string): string {
  return path.length <= 120 ? path : `…${path.slice(-119)}`;
}

function sourceUrl(identity: RepositoryIdentity, commitSha: string, path: string): string {
  const encodedPath = path.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${identity.repositoryUrl}/blob/${commitSha}/${encodedPath}`;
}

function mediaType(path: string): 'text/plain' | 'text/markdown' | 'application/json' {
  const suffix = extension(path);
  if (suffix === 'md' || suffix === 'markdown') return 'text/markdown';
  return suffix === 'json' ? 'application/json' : 'text/plain';
}

function skips(counts: ReadonlyMap<GitHubSkipReason, number>): readonly GitHubSkipCount[] {
  return Object.freeze([...counts]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([reason, count]) => Object.freeze({ reason, count })));
}

export class GitHubImporter implements GitHubImporterBoundary {
  readonly #transport: GitHubTransport;
  readonly #now: () => number;
  readonly #deadlineMs: number;
  readonly #maxRequests: number;
  readonly #maxTreeEntries: number;
  readonly #maxFiles: number;
  readonly #maxFileBytes: number;
  readonly #maxAggregateBytes: number;

  constructor(options: GitHubImporterOptions = {}) {
    this.#transport = options.transport ?? new FetchGitHubTransport();
    this.#now = options.now ?? Date.now;
    this.#deadlineMs = bounded(options.deadlineMs, DEFAULT_DEADLINE_MS);
    this.#maxRequests = bounded(options.maxRequests, DEFAULT_MAX_REQUESTS);
    this.#maxTreeEntries = bounded(options.maxTreeEntries, DEFAULT_MAX_TREE_ENTRIES);
    this.#maxFiles = bounded(options.maxFiles, DEFAULT_MAX_FILES);
    this.#maxFileBytes = bounded(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
    this.#maxAggregateBytes = bounded(options.maxAggregateBytes, DEFAULT_MAX_AGGREGATE_BYTES);
  }

  async importPublicRepo(value: string, callerSignal: AbortSignal): Promise<PreparedGitHubBatch> {
    const identity = repositoryIdentity(value);
    const control = new AbortController();
    let deadlineExpired = false;
    let requests = 0;
    let responseBytes = 0;
    const relayAbort = () => control.abort();
    if (callerSignal.aborted) relayAbort();
    else callerSignal.addEventListener('abort', relayAbort, { once: true });
    const deadline = setTimeout(() => {
      deadlineExpired = true;
      control.abort();
    }, this.#deadlineMs);
    deadline.unref?.();

    const requestJson = async (url: string, maxResponseBytes: number): Promise<unknown> => {
      if (control.signal.aborted) {
        throw new GitHubImportError(deadlineExpired ? 'github_timeout' : 'github_unavailable');
      }
      if (requests >= this.#maxRequests) throw new GitHubImportError('github_budget_exceeded');
      requests += 1;
      let response: GitHubTransportResponse;
      try {
        response = await this.#transport.request(Object.freeze({
          url,
          method: 'GET' as const,
          headers: FIXED_HEADERS,
          signal: control.signal,
          maxResponseBytes,
        }));
      } catch (error) {
        if (error instanceof GitHubImportError) throw error;
        throw new GitHubImportError(deadlineExpired ? 'github_timeout' : 'github_unavailable');
      }
      if (control.signal.aborted) {
        throw new GitHubImportError(deadlineExpired ? 'github_timeout' : 'github_unavailable');
      }
      if (response.redirected || response.url !== url || response.status !== 200) {
        throw new GitHubImportError('github_unavailable');
      }
      if (!(response.body instanceof Uint8Array) || response.body.byteLength > maxResponseBytes) {
        throw new GitHubImportError('github_budget_exceeded');
      }
      responseBytes += response.body.byteLength;
      if (responseBytes > MAX_TOTAL_RESPONSE_BYTES) throw new GitHubImportError('github_budget_exceeded');
      return decodeJson(response.body);
    };

    try {
      const repository = await requestJson(identity.apiRoot, METADATA_RESPONSE_BYTES);
      if (!isRecord(repository) || repository['private'] !== false
        || typeof repository['full_name'] !== 'string'
        || repository['full_name'].toLowerCase() !== `${identity.owner}/${identity.repository}`
        || !validBranch(repository['default_branch'])) {
        throw new GitHubImportError('github_snapshot_invalid');
      }
      const branch = repository['default_branch'];
      const commit = await requestJson(
        `${identity.apiRoot}/commits/${encodeURIComponent(branch)}`,
        METADATA_RESPONSE_BYTES,
      );
      const commitTree = isRecord(commit) && isRecord(commit['commit']) && isRecord(commit['commit']['tree'])
        ? commit['commit']['tree']
        : null;
      const commitSha = isRecord(commit) ? commit['sha'] : null;
      const treeSha = commitTree?.['sha'];
      if (typeof commitSha !== 'string' || !SHA1.test(commitSha)
        || typeof treeSha !== 'string' || !SHA1.test(treeSha)) {
        throw new GitHubImportError('github_snapshot_invalid');
      }
      const treeResponse = await requestJson(
        `${identity.apiRoot}/git/trees/${treeSha}?recursive=1`,
        TREE_RESPONSE_BYTES,
      );
      if (!isRecord(treeResponse) || treeResponse['sha'] !== treeSha
        || treeResponse['truncated'] !== false || !Array.isArray(treeResponse['tree'])) {
        throw new GitHubImportError('github_snapshot_invalid');
      }
      if (treeResponse['tree'].length > this.#maxTreeEntries) {
        throw new GitHubImportError('github_budget_exceeded');
      }

      const entries: GitTreeEntry[] = [];
      const paths = new Set<string>();
      const foldedPaths = new Set<string>();
      for (const raw of treeResponse['tree']) {
        if (!isRecord(raw) || !isCanonicalGitHubPath(raw['path'])
          || typeof raw['mode'] !== 'string' || typeof raw['type'] !== 'string'
          || typeof raw['sha'] !== 'string' || !SHA1.test(raw['sha'])) {
          throw new GitHubImportError('github_snapshot_invalid');
        }
        const folded = raw['path'].normalize('NFKC').toLowerCase();
        if (paths.has(raw['path']) || foldedPaths.has(folded)) {
          throw new GitHubImportError('github_snapshot_invalid');
        }
        paths.add(raw['path']);
        foldedPaths.add(folded);
        const size = raw['size'];
        if (raw['type'] === 'blob' && (!Number.isSafeInteger(size) || (size as number) < 0)) {
          throw new GitHubImportError('github_snapshot_invalid');
        }
        entries.push({
          path: raw['path'],
          mode: raw['mode'],
          type: raw['type'],
          sha: raw['sha'],
          size: typeof size === 'number' ? size : null,
        });
      }
      entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

      const skippedCounts = new Map<GitHubSkipReason, number>();
      const skip = (reason: GitHubSkipReason): void => {
        skippedCounts.set(reason, (skippedCounts.get(reason) ?? 0) + 1);
      };
      const candidates: GitTreeEntry[] = [];
      for (const entry of entries) {
        const reason = policyReason(entry, this.#maxFileBytes);
        if (reason === null) candidates.push(entry);
        else skip(reason);
      }
      for (const _entry of candidates.slice(this.#maxFiles)) skip('file_limit');
      const selected = candidates.slice(0, this.#maxFiles);
      const observedAt = new Date(this.#now()).toISOString();
      if (new Date(observedAt).toISOString() !== observedAt) {
        throw new GitHubImportError('github_snapshot_invalid');
      }
      const inputs: ConnectorDocumentInput[] = [];
      let acceptedRawBytes = 0;
      let acceptedTextBytes = 0;
      let fetchedBlobs = 0;
      for (const entry of selected) {
        const blob = await requestJson(`${identity.apiRoot}/git/blobs/${entry.sha}`, BLOB_RESPONSE_BYTES);
        fetchedBlobs += 1;
        if (!isRecord(blob) || typeof blob['sha'] !== 'string' || !SHA1.test(blob['sha'])
          || blob['sha'] !== entry.sha || blob['encoding'] !== 'base64'
          || typeof blob['content'] !== 'string' || !Number.isSafeInteger(blob['size'])) {
          throw new GitHubImportError(
            isRecord(blob) && typeof blob['sha'] === 'string' && SHA1.test(blob['sha'])
              ? 'github_integrity_failed'
              : 'github_snapshot_invalid',
          );
        }
        const bytes = strictBase64(blob['content']);
        if (bytes === null) throw new GitHubImportError('github_snapshot_invalid');
        if (bytes.byteLength > this.#maxFileBytes) throw new GitHubImportError('github_budget_exceeded');
        if (blob['size'] !== bytes.byteLength || entry.size !== bytes.byteLength
          || gitBlobSha(bytes) !== entry.sha) {
          throw new GitHubImportError('github_integrity_failed');
        }
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          skip('invalid_utf8');
          continue;
        }
        if (BINARY_TEXT.test(text)) {
          skip('binary');
          continue;
        }
        if (text.replace(/^\ufeff/u, '').startsWith('version https://git-lfs.github.com/spec/v1')) {
          skip('git_lfs');
          continue;
        }
        if (text.trim() === '') {
          skip('empty');
          continue;
        }
        if (text.replace(/^\ufeff/u, '').replace(/\r\n?/gu, '\n').replaceAll('\u0000', '').normalize('NFC').length > MAX_SOURCE_CHARS) {
          skip('document_too_long');
          continue;
        }
        const normalizedBytes = Buffer.byteLength(
          text.replace(/^\ufeff/u, '').replace(/\r\n?/gu, '\n').replaceAll('\u0000', '').normalize('NFC'),
          'utf8',
        );
        acceptedRawBytes += bytes.byteLength;
        acceptedTextBytes += normalizedBytes;
        if (acceptedRawBytes > this.#maxAggregateBytes || acceptedTextBytes > this.#maxAggregateBytes) {
          throw new GitHubImportError('github_budget_exceeded');
        }
        inputs.push({
          title: titleFor(entry.path),
          text,
          provenance: {
            connectorId: 'github',
            sourceUrl: sourceUrl(identity, commitSha, entry.path),
            mediaType: mediaType(entry.path),
            observedAt,
            github: {
              repositoryUrl: identity.repositoryUrl,
              commitSha,
              path: entry.path,
              blobSha: entry.sha,
              retrievedAt: observedAt,
              rawDigest: sha256(bytes),
              parserVersion: GITHUB_PARSER_VERSION,
            },
          },
        });
      }
      if (inputs.length === 0) throw new GitHubImportError('github_no_documents');
      const batch = prepareConnectorBatch(inputs);
      const snapshotDigest = sha256(JSON.stringify({
        repositoryUrl: identity.repositoryUrl,
        commitSha,
        documents: batch.documents.map((document) => ({
          sourceKey: document.sourceKey,
          contentDigest: document.contentDigest,
        })),
      }));
      if (!SHA256.test(snapshotDigest)) throw new GitHubImportError('github_snapshot_invalid');
      return Object.freeze({
        ...batch,
        repositoryUrl: identity.repositoryUrl,
        commitSha,
        snapshotDigest,
        consideredEntries: entries.length,
        fetchedBlobs,
        skipped: skips(skippedCounts),
      });
    } catch (error) {
      control.abort();
      if (error instanceof GitHubImportError) throw error;
      throw new GitHubImportError(deadlineExpired ? 'github_timeout' : 'github_unavailable');
    } finally {
      clearTimeout(deadline);
      callerSignal.removeEventListener('abort', relayAbort);
      control.abort();
    }
  }
}
