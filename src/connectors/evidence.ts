import type { PreparedConnectorDocument } from './normalize.js';
import { isCanonicalGitHubRepositoryRoot } from './github-repository.js';
import { canonicalizePublicHttpsUrl } from './https-url.js';

const GITHUB_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GITHUB_PATH_PART = /^[A-Za-z0-9._@+~()' -]+$/u;
const GITHUB_EVIDENCE_KEYS = new Set([
  'schemaVersion', 'connectorId', 'repositoryUrl', 'commitSha', 'path', 'blobSha',
  'retrievedAt', 'rawDigest', 'contentDigest', 'parserVersion',
]);
const HTTPS_EVIDENCE_KEYS = new Set([
  'schemaVersion', 'connectorId', 'sourceUrl', 'mediaType', 'pathDigest',
  'retrievedAt', 'rawDigest', 'contentDigest', 'parserVersion',
]);
const HTTPS_MEDIA_TYPES = new Set(['application/json', 'text/plain', 'text/markdown']);

/**
 * The deliberately narrow GitHub path alphabet accepted by both import and
 * persistence. It is ASCII, slash-separated, NFC by construction, and has no
 * percent/query/fragment characters whose alternate spellings could collide.
 */
export function isCanonicalGitHubPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
    || value.startsWith('/') || value.endsWith('/') || value.includes('//')) return false;
  return value.split('/').every((part) => part.length > 0 && part.length <= 255
    && part !== '.' && part !== '..' && part.trim() === part && GITHUB_PATH_PART.test(part));
}

export interface PersistedGitHubConnectorEvidenceV1 {
  readonly schemaVersion: 1;
  readonly connectorId: 'github';
  readonly repositoryUrl: string;
  readonly commitSha: string;
  readonly path: string;
  readonly blobSha: string;
  readonly retrievedAt: string;
  readonly rawDigest: string;
  readonly contentDigest: string;
  readonly parserVersion: 'github-v1';
}

export interface PersistedHttpsConnectorEvidenceV1 {
  readonly schemaVersion: 1;
  readonly connectorId: 'https_api';
  readonly sourceUrl: string;
  readonly mediaType: 'application/json' | 'text/plain' | 'text/markdown';
  readonly pathDigest: string;
  readonly retrievedAt: string;
  readonly rawDigest: string;
  readonly contentDigest: string;
  readonly parserVersion: 'https-v1';
}

export type PersistedConnectorEvidence =
  | PersistedGitHubConnectorEvidenceV1
  | PersistedHttpsConnectorEvidenceV1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** A closed decoder: missing evidence is legacy; any present unknown shape is invalid. */
export function decodePersistedConnectorEvidence(value: unknown): PersistedConnectorEvidence | null {
  if (!isRecord(value) || value['schemaVersion'] !== 1) return null;
  if (value['connectorId'] === 'https_api') {
    const canonical = canonicalizePublicHttpsUrl(value['sourceUrl']);
    if (!exactKeys(value, HTTPS_EVIDENCE_KEYS)
      || canonical === null || canonical.origin !== value['sourceUrl']
      || canonical.pathname !== '/' || canonical.requestPath !== '/'
      || typeof value['mediaType'] !== 'string' || !HTTPS_MEDIA_TYPES.has(value['mediaType'])
      || typeof value['pathDigest'] !== 'string' || !SHA256.test(value['pathDigest'])
      || !isCanonicalInstant(value['retrievedAt'])
      || typeof value['rawDigest'] !== 'string' || !SHA256.test(value['rawDigest'])
      || typeof value['contentDigest'] !== 'string' || !SHA256.test(value['contentDigest'])
      || value['parserVersion'] !== 'https-v1') return null;
    return Object.freeze({
      schemaVersion: 1,
      connectorId: 'https_api',
      sourceUrl: value['sourceUrl'],
      mediaType: value['mediaType'] as PersistedHttpsConnectorEvidenceV1['mediaType'],
      pathDigest: value['pathDigest'],
      retrievedAt: value['retrievedAt'],
      rawDigest: value['rawDigest'],
      contentDigest: value['contentDigest'],
      parserVersion: 'https-v1',
    });
  }
  if (!exactKeys(value, GITHUB_EVIDENCE_KEYS) || value['connectorId'] !== 'github'
    || !isCanonicalGitHubRepositoryRoot(value['repositoryUrl'])
    || typeof value['commitSha'] !== 'string' || !GITHUB_SHA.test(value['commitSha'])
    || !isCanonicalGitHubPath(value['path'])
    || typeof value['blobSha'] !== 'string' || !GITHUB_SHA.test(value['blobSha'])
    || !isCanonicalInstant(value['retrievedAt'])
    || typeof value['rawDigest'] !== 'string' || !SHA256.test(value['rawDigest'])
    || typeof value['contentDigest'] !== 'string' || !SHA256.test(value['contentDigest'])
    || value['parserVersion'] !== 'github-v1') return null;
  return Object.freeze({
    schemaVersion: 1,
    connectorId: 'github',
    repositoryUrl: value['repositoryUrl'],
    commitSha: value['commitSha'],
    path: value['path'],
    blobSha: value['blobSha'],
    retrievedAt: value['retrievedAt'],
    rawDigest: value['rawDigest'],
    contentDigest: value['contentDigest'],
    parserVersion: 'github-v1',
  });
}

/** Copies only normalized allowlisted provenance into the durable graph. */
export function persistedEvidenceFor(
  prepared: PreparedConnectorDocument,
): PersistedConnectorEvidence | undefined {
  const github = prepared.provenance.github;
  const https = prepared.provenance.https;
  if (prepared.provenance.connectorId === 'https_api' && https !== undefined) {
    const decoded = decodePersistedConnectorEvidence({
      schemaVersion: 1,
      connectorId: 'https_api',
      sourceUrl: prepared.provenance.sourceUrl,
      mediaType: prepared.provenance.mediaType,
      pathDigest: https.pathDigest,
      retrievedAt: https.retrievedAt,
      rawDigest: https.rawDigest,
      contentDigest: prepared.contentDigest,
      parserVersion: https.parserVersion,
    });
    if (decoded === null) throw new Error('invalid normalized connector evidence');
    return decoded;
  }
  if (prepared.provenance.connectorId !== 'github' || github === undefined) return undefined;
  const decoded = decodePersistedConnectorEvidence({
    schemaVersion: 1,
    connectorId: 'github',
    repositoryUrl: github.repositoryUrl,
    commitSha: github.commitSha,
    path: github.path,
    blobSha: github.blobSha,
    retrievedAt: github.retrievedAt,
    rawDigest: github.rawDigest,
    contentDigest: prepared.contentDigest,
    parserVersion: github.parserVersion,
  });
  if (decoded === null) throw new Error('invalid normalized connector evidence');
  return decoded;
}

export function connectorEvidenceMetadata(
  evidence: PersistedConnectorEvidence | undefined,
): Readonly<Record<string, string | number>> {
  if (evidence === undefined) return {};
  if (evidence.connectorId === 'https_api') {
    return {
      lacuna_connector_schema: evidence.schemaVersion,
      lacuna_connector_id: evidence.connectorId,
      lacuna_https_origin: evidence.sourceUrl,
      lacuna_https_media_type: evidence.mediaType,
      lacuna_https_path_sha256: evidence.pathDigest,
      lacuna_https_retrieved_at: evidence.retrievedAt,
      lacuna_https_raw_sha256: evidence.rawDigest,
      lacuna_content_sha256: evidence.contentDigest,
      lacuna_connector_parser_version: evidence.parserVersion,
    };
  }
  return {
    lacuna_connector_schema: evidence.schemaVersion,
    lacuna_connector_id: evidence.connectorId,
    lacuna_github_repository_url: evidence.repositoryUrl,
    lacuna_github_commit_sha: evidence.commitSha,
    lacuna_github_path: evidence.path,
    lacuna_github_blob_sha: evidence.blobSha,
    lacuna_github_retrieved_at: evidence.retrievedAt,
    lacuna_github_raw_sha256: evidence.rawDigest,
    lacuna_content_sha256: evidence.contentDigest,
    lacuna_connector_parser_version: evidence.parserVersion,
  };
}
