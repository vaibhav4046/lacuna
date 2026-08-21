import { createHash } from 'node:crypto';

import { isCanonicalGitHubPath } from './evidence.js';
import { isCanonicalGitHubRepositoryRoot } from './github-repository.js';
import type { ConnectorId } from './types.js';

export const MAX_CONNECTOR_DOCUMENTS = 30;
export const MAX_CONNECTOR_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_TITLE_CHARS = 120;
const CONNECTOR_IDS = new Set<ConnectorId>([
  'github', 'markdown', 'text', 'pdf', 'docx', 'https_api', 'webhook',
]);
const MEDIA_TYPES = new Set<ConnectorMediaType>([
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const INPUT_KEYS = new Set(['title', 'text', 'provenance']);
const PROVENANCE_KEYS = new Set(['connectorId', 'sourceUrl', 'mediaType', 'observedAt']);
const GITHUB_PROVENANCE_KEYS = new Set([...PROVENANCE_KEYS, 'github']);
const GITHUB_EVIDENCE_KEYS = new Set([
  'repositoryUrl', 'commitSha', 'path', 'blobSha', 'retrievedAt', 'rawDigest', 'parserVersion',
]);
const GITHUB_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export type ConnectorMediaType =
  | 'text/plain'
  | 'text/markdown'
  | 'application/json'
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ConnectorProvenance {
  readonly connectorId: ConnectorId;
  readonly sourceUrl: string | null;
  readonly mediaType: ConnectorMediaType;
  readonly observedAt: string;
  readonly github?: GitHubConnectorEvidence;
}

export interface GitHubConnectorEvidence {
  readonly repositoryUrl: string;
  readonly commitSha: string;
  readonly path: string;
  readonly blobSha: string;
  readonly retrievedAt: string;
  readonly rawDigest: string;
  readonly parserVersion: 'github-v1';
}

export interface ConnectorDocumentInput {
  readonly title: string;
  readonly text: string | Uint8Array;
  readonly provenance: ConnectorProvenance;
}

export interface PreparedConnectorDocument {
  readonly title: string;
  readonly text: string;
  readonly provenance: ConnectorProvenance;
  readonly contentDigest: string;
  /** Canonical provenance excluding observation time, so retries converge. */
  readonly provenanceKey: string;
  /** Full deterministic SHA-256 source identity consumed by governed ingestion. */
  readonly sourceKey: string;
}

export interface PreparedConnectorBatch {
  readonly documents: readonly PreparedConnectorDocument[];
  readonly duplicates: number;
  readonly normalizedTextBytes: number;
}

export type ConnectorNormalizationFailure =
  | 'invalid_document'
  | 'invalid_utf8'
  | 'invalid_title'
  | 'invalid_text'
  | 'invalid_provenance'
  | 'document_too_long'
  | 'too_many_documents'
  | 'text_budget_exceeded';

export class ConnectorNormalizationError extends Error {
  override readonly name = 'ConnectorNormalizationError';
  readonly code: ConnectorNormalizationFailure;

  constructor(code: ConnectorNormalizationFailure) {
    super(code);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function canonicalUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new ConnectorNormalizationError('invalid_provenance');
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      throw new ConnectorNormalizationError('invalid_provenance');
    }
    url.hash = '';
    url.searchParams.sort();
    return url.href;
  } catch (error) {
    if (error instanceof ConnectorNormalizationError) throw error;
    throw new ConnectorNormalizationError('invalid_provenance');
  }
}

function normalizeProvenance(value: unknown): ConnectorProvenance {
  if (!isRecord(value)
    || typeof value['connectorId'] !== 'string'
    || !CONNECTOR_IDS.has(value['connectorId'] as ConnectorId)
    || typeof value['mediaType'] !== 'string'
    || !MEDIA_TYPES.has(value['mediaType'] as ConnectorMediaType)
    || !canonicalInstant(value['observedAt'])) {
    throw new ConnectorNormalizationError('invalid_provenance');
  }
  const github = value['connectorId'] === 'github';
  if (!hasExactKeys(value, github ? GITHUB_PROVENANCE_KEYS : PROVENANCE_KEYS)) {
    throw new ConnectorNormalizationError('invalid_provenance');
  }
  const normalizedSourceUrl = canonicalUrl(value['sourceUrl']);
  let githubEvidence: GitHubConnectorEvidence | undefined;
  if (github) {
    const evidence = value['github'];
    if (!isRecord(evidence) || !hasExactKeys(evidence, GITHUB_EVIDENCE_KEYS)
      || typeof evidence['repositoryUrl'] !== 'string'
      || !isCanonicalGitHubRepositoryRoot(evidence['repositoryUrl'])
      || typeof evidence['commitSha'] !== 'string' || !GITHUB_SHA.test(evidence['commitSha'])
      || typeof evidence['blobSha'] !== 'string' || !GITHUB_SHA.test(evidence['blobSha'])
      || !isCanonicalGitHubPath(evidence['path'])
      || !canonicalInstant(evidence['retrievedAt']) || evidence['retrievedAt'] !== value['observedAt']
      || typeof evidence['rawDigest'] !== 'string' || !SHA256.test(evidence['rawDigest'])
      || evidence['parserVersion'] !== 'github-v1') {
      throw new ConnectorNormalizationError('invalid_provenance');
    }
    const expectedSourceUrl = `${evidence['repositoryUrl']}/blob/${evidence['commitSha']}/${evidence['path']
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')}`;
    if (normalizedSourceUrl !== expectedSourceUrl) {
      throw new ConnectorNormalizationError('invalid_provenance');
    }
    githubEvidence = Object.freeze({
      repositoryUrl: evidence['repositoryUrl'],
      commitSha: evidence['commitSha'],
      path: evidence['path'],
      blobSha: evidence['blobSha'],
      retrievedAt: evidence['retrievedAt'],
      rawDigest: evidence['rawDigest'],
      parserVersion: evidence['parserVersion'],
    });
  }
  return Object.freeze({
    connectorId: value['connectorId'] as ConnectorId,
    sourceUrl: normalizedSourceUrl,
    mediaType: value['mediaType'] as ConnectorMediaType,
    observedAt: value['observedAt'],
    ...(githubEvidence === undefined ? {} : { github: githubEvidence }),
  });
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== 'string') throw new ConnectorNormalizationError('invalid_title');
  const title = value.replaceAll('\u0000', '').normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (title === '' || title.length > MAX_TITLE_CHARS) {
    throw new ConnectorNormalizationError('invalid_title');
  }
  return title;
}

function normalizeText(value: unknown): string {
  let decoded: string;
  if (typeof value === 'string') {
    decoded = value;
  } else if (value instanceof Uint8Array) {
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(value);
    } catch {
      throw new ConnectorNormalizationError('invalid_utf8');
    }
  } else {
    throw new ConnectorNormalizationError('invalid_text');
  }
  const text = decoded.replace(/^\ufeff/u, '').replace(/\r\n?/gu, '\n').replaceAll('\u0000', '').normalize('NFC');
  if (text.trim() === '') throw new ConnectorNormalizationError('invalid_text');
  return text;
}

export function prepareConnectorDocument(input: ConnectorDocumentInput): PreparedConnectorDocument {
  if (!isRecord(input) || !hasExactKeys(input, INPUT_KEYS)) {
    throw new ConnectorNormalizationError('invalid_document');
  }
  const title = normalizeTitle(input.title);
  const text = normalizeText(input.text);
  const provenance = normalizeProvenance(input.provenance);
  const contentDigest = sha256(text);
  const provenanceKey = sha256(JSON.stringify({
    connectorId: provenance.connectorId,
    sourceUrl: provenance.sourceUrl,
    mediaType: provenance.mediaType,
    ...(provenance.github === undefined ? {} : {
      github: {
        repositoryUrl: provenance.github.repositoryUrl,
        commitSha: provenance.github.commitSha,
        path: provenance.github.path,
        blobSha: provenance.github.blobSha,
        rawDigest: provenance.github.rawDigest,
        parserVersion: provenance.github.parserVersion,
      },
    }),
  }));
  const sourceKey = `src-${sha256(`${contentDigest}\n${provenanceKey}`)}`;
  return Object.freeze({ title, text, provenance, contentDigest, provenanceKey, sourceKey });
}

export function prepareConnectorBatch(inputs: readonly ConnectorDocumentInput[]): PreparedConnectorBatch {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new ConnectorNormalizationError('invalid_document');
  }
  if (inputs.length > MAX_CONNECTOR_DOCUMENTS) {
    throw new ConnectorNormalizationError('too_many_documents');
  }
  const documents: PreparedConnectorDocument[] = [];
  const identities = new Set<string>();
  let normalizedTextBytes = 0;
  let duplicates = 0;
  for (const input of inputs) {
    const document = prepareConnectorDocument(input);
    const identity = `${document.contentDigest}:${document.provenanceKey}`;
    if (identities.has(identity)) {
      duplicates += 1;
      continue;
    }
    identities.add(identity);
    normalizedTextBytes += Buffer.byteLength(document.text, 'utf8');
    if (normalizedTextBytes > MAX_CONNECTOR_TEXT_BYTES) {
      throw new ConnectorNormalizationError('text_budget_exceeded');
    }
    documents.push(document);
  }
  return Object.freeze({ documents: Object.freeze(documents), duplicates, normalizedTextBytes });
}
