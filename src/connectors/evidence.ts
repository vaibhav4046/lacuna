import type { PreparedConnectorDocument } from './normalize.js';

const GITHUB_REPOSITORY = /^https:\/\/github\.com\/[a-z0-9-]+\/[a-z0-9_.-]+$/u;
const GITHUB_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GITHUB_PATH_PART = /^[A-Za-z0-9._@+~()' -]+$/u;
const EVIDENCE_KEYS = new Set([
  'schemaVersion', 'connectorId', 'repositoryUrl', 'commitSha', 'path', 'blobSha',
  'rawDigest', 'contentDigest', 'parserVersion',
]);

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
  readonly rawDigest: string;
  readonly contentDigest: string;
  readonly parserVersion: 'github-v1';
}

export type PersistedConnectorEvidence = PersistedGitHubConnectorEvidenceV1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

/** A closed decoder: missing evidence is legacy; any present unknown shape is invalid. */
export function decodePersistedConnectorEvidence(value: unknown): PersistedConnectorEvidence | null {
  if (!isRecord(value) || !exactKeys(value, EVIDENCE_KEYS)
    || value['schemaVersion'] !== 1 || value['connectorId'] !== 'github'
    || typeof value['repositoryUrl'] !== 'string' || !GITHUB_REPOSITORY.test(value['repositoryUrl'])
    || typeof value['commitSha'] !== 'string' || !GITHUB_SHA.test(value['commitSha'])
    || !isCanonicalGitHubPath(value['path'])
    || typeof value['blobSha'] !== 'string' || !GITHUB_SHA.test(value['blobSha'])
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
  if (prepared.provenance.connectorId !== 'github' || github === undefined) return undefined;
  const decoded = decodePersistedConnectorEvidence({
    schemaVersion: 1,
    connectorId: 'github',
    repositoryUrl: github.repositoryUrl,
    commitSha: github.commitSha,
    path: github.path,
    blobSha: github.blobSha,
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
  return {
    lacuna_connector_schema: evidence.schemaVersion,
    lacuna_connector_id: evidence.connectorId,
    lacuna_github_repository_url: evidence.repositoryUrl,
    lacuna_github_commit_sha: evidence.commitSha,
    lacuna_github_path: evidence.path,
    lacuna_github_blob_sha: evidence.blobSha,
    lacuna_github_raw_sha256: evidence.rawDigest,
    lacuna_content_sha256: evidence.contentDigest,
    lacuna_connector_parser_version: evidence.parserVersion,
  };
}
