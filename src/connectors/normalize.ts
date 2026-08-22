import { createHash } from 'node:crypto';

import { isCanonicalGitHubPath } from './evidence.js';
import { isCanonicalGitHubRepositoryRoot } from './github-repository.js';
import { isCanonicalGitLabProjectRoot } from './gitlab-project.js';
import { canonicalizePublicHttpsUrl } from './https-url.js';
import type { ConnectorId } from './types.js';

export const MAX_CONNECTOR_DOCUMENTS = 30;
export const MAX_CONNECTOR_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_TITLE_CHARS = 120;
const CONNECTOR_IDS = new Set<ConnectorId>([
  'github', 'gitlab', 'markdown', 'text', 'pdf', 'docx', 'https_api', 'webhook',
]);
const MEDIA_TYPES = new Set<ConnectorMediaType>([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const INPUT_KEYS = new Set(['title', 'text', 'provenance']);
const PROVENANCE_KEYS = new Set(['connectorId', 'sourceUrl', 'mediaType', 'observedAt']);
const GITHUB_PROVENANCE_KEYS = new Set([...PROVENANCE_KEYS, 'github']);
const GITLAB_PROVENANCE_KEYS = new Set([...PROVENANCE_KEYS, 'gitlab']);
const HTTPS_PROVENANCE_KEYS = new Set([...PROVENANCE_KEYS, 'https']);
const WEBHOOK_PROVENANCE_KEYS = new Set([...PROVENANCE_KEYS, 'webhook']);
const GITHUB_EVIDENCE_KEYS = new Set([
  'repositoryUrl', 'commitSha', 'path', 'blobSha', 'retrievedAt', 'rawDigest', 'parserVersion',
]);
const GITLAB_EVIDENCE_KEYS = new Set([
  'projectUrl', 'commitSha', 'path', 'blobSha', 'retrievedAt', 'rawDigest', 'parserVersion',
]);
const GITHUB_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const HTTPS_EVIDENCE_KEYS = new Set([
  'schemaVersion', 'pathDigest', 'retrievedAt', 'rawDigest', 'parserVersion',
]);
const WEBHOOK_EVIDENCE_KEYS = new Set(['schemaVersion', 'rawDigest', 'parserVersion']);

export type ConnectorMediaType =
  | 'text/plain'
  | 'text/markdown'
  | 'text/csv'
  | 'application/json'
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ConnectorProvenance {
  readonly connectorId: ConnectorId;
  readonly sourceUrl: string | null;
  readonly mediaType: ConnectorMediaType;
  readonly observedAt: string;
  readonly github?: GitHubConnectorEvidence;
  readonly gitlab?: GitLabConnectorEvidence;
  readonly https?: HttpsConnectorEvidence;
  readonly webhook?: WebhookConnectorEvidence;
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

export interface GitLabConnectorEvidence {
  readonly projectUrl: string;
  readonly commitSha: string;
  readonly path: string;
  readonly blobSha: string;
  readonly retrievedAt: string;
  readonly rawDigest: string;
  readonly parserVersion: 'gitlab-v1';
}

export interface HttpsConnectorEvidence {
  readonly schemaVersion: 1;
  readonly pathDigest: string;
  readonly retrievedAt: string;
  readonly rawDigest: string;
  readonly parserVersion: 'https-v1';
}

export interface WebhookConnectorEvidence {
  readonly schemaVersion: 1;
  readonly rawDigest: string;
  readonly parserVersion: 'webhook-v1';
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
  const gitlab = value['connectorId'] === 'gitlab';
  const https = value['connectorId'] === 'https_api';
  const webhook = value['connectorId'] === 'webhook';
  const expectedKeys = github
    ? GITHUB_PROVENANCE_KEYS
    : gitlab
      ? GITLAB_PROVENANCE_KEYS
    : https
      ? HTTPS_PROVENANCE_KEYS
      : webhook
        ? WEBHOOK_PROVENANCE_KEYS
        : PROVENANCE_KEYS;
  if (!hasExactKeys(value, expectedKeys)) {
    throw new ConnectorNormalizationError('invalid_provenance');
  }
  const normalizedSourceUrl = canonicalUrl(value['sourceUrl']);
  let githubEvidence: GitHubConnectorEvidence | undefined;
  let gitlabEvidence: GitLabConnectorEvidence | undefined;
  let httpsEvidence: HttpsConnectorEvidence | undefined;
  let webhookEvidence: WebhookConnectorEvidence | undefined;
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
  if (gitlab) {
    const evidence = value['gitlab'];
    if (!isRecord(evidence) || !hasExactKeys(evidence, GITLAB_EVIDENCE_KEYS)
      || typeof evidence['projectUrl'] !== 'string'
      || !isCanonicalGitLabProjectRoot(evidence['projectUrl'])
      || typeof evidence['commitSha'] !== 'string' || !GITHUB_SHA.test(evidence['commitSha'])
      || typeof evidence['blobSha'] !== 'string' || !GITHUB_SHA.test(evidence['blobSha'])
      || !isCanonicalGitHubPath(evidence['path'])
      || !canonicalInstant(evidence['retrievedAt']) || evidence['retrievedAt'] !== value['observedAt']
      || typeof evidence['rawDigest'] !== 'string' || !SHA256.test(evidence['rawDigest'])
      || evidence['parserVersion'] !== 'gitlab-v1') {
      throw new ConnectorNormalizationError('invalid_provenance');
    }
    const expectedSourceUrl = `${evidence['projectUrl']}/-/blob/${evidence['commitSha']}/${evidence['path']
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')}`;
    if (normalizedSourceUrl !== expectedSourceUrl) {
      throw new ConnectorNormalizationError('invalid_provenance');
    }
    gitlabEvidence = Object.freeze({
      projectUrl: evidence['projectUrl'],
      commitSha: evidence['commitSha'],
      path: evidence['path'],
      blobSha: evidence['blobSha'],
      retrievedAt: evidence['retrievedAt'],
      rawDigest: evidence['rawDigest'],
      parserVersion: evidence['parserVersion'],
    });
  }
  if (https) {
    const evidence = value['https'];
    const canonicalOrigin = canonicalizePublicHttpsUrl(value['sourceUrl']);
    if (!isRecord(evidence) || !hasExactKeys(evidence, HTTPS_EVIDENCE_KEYS)
      || evidence['schemaVersion'] !== 1
      || typeof evidence['pathDigest'] !== 'string' || !SHA256.test(evidence['pathDigest'])
      || !canonicalInstant(evidence['retrievedAt']) || evidence['retrievedAt'] !== value['observedAt']
      || typeof evidence['rawDigest'] !== 'string' || !SHA256.test(evidence['rawDigest'])
      || evidence['parserVersion'] !== 'https-v1'
      || canonicalOrigin === null || canonicalOrigin.origin !== value['sourceUrl']
      || canonicalOrigin.pathname !== '/' || canonicalOrigin.requestPath !== '/') {
      throw new ConnectorNormalizationError('invalid_provenance');
    }
    httpsEvidence = Object.freeze({
      schemaVersion: 1,
      pathDigest: evidence['pathDigest'],
      retrievedAt: evidence['retrievedAt'],
      rawDigest: evidence['rawDigest'],
      parserVersion: evidence['parserVersion'],
    });
  }
  if (webhook) {
    const evidence = value['webhook'];
    if (normalizedSourceUrl !== null
      || value['mediaType'] !== 'application/json'
      || !isRecord(evidence) || !hasExactKeys(evidence, WEBHOOK_EVIDENCE_KEYS)
      || evidence['schemaVersion'] !== 1
      || typeof evidence['rawDigest'] !== 'string' || !SHA256.test(evidence['rawDigest'])
      || evidence['parserVersion'] !== 'webhook-v1') {
      throw new ConnectorNormalizationError('invalid_provenance');
    }
    webhookEvidence = Object.freeze({
      schemaVersion: 1,
      rawDigest: evidence['rawDigest'],
      parserVersion: 'webhook-v1',
    });
  }
  return Object.freeze({
    connectorId: value['connectorId'] as ConnectorId,
    sourceUrl: normalizedSourceUrl,
    mediaType: value['mediaType'] as ConnectorMediaType,
    observedAt: value['observedAt'],
    ...(githubEvidence === undefined ? {} : { github: githubEvidence }),
    ...(gitlabEvidence === undefined ? {} : { gitlab: gitlabEvidence }),
    ...(httpsEvidence === undefined ? {} : { https: httpsEvidence }),
    ...(webhookEvidence === undefined ? {} : { webhook: webhookEvidence }),
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
    ...(provenance.gitlab === undefined ? {} : {
      gitlab: {
        projectUrl: provenance.gitlab.projectUrl,
        commitSha: provenance.gitlab.commitSha,
        path: provenance.gitlab.path,
        blobSha: provenance.gitlab.blobSha,
        rawDigest: provenance.gitlab.rawDigest,
        parserVersion: provenance.gitlab.parserVersion,
      },
    }),
    ...(provenance.https === undefined ? {} : {
      https: {
        schemaVersion: provenance.https.schemaVersion,
        pathDigest: provenance.https.pathDigest,
        rawDigest: provenance.https.rawDigest,
        parserVersion: provenance.https.parserVersion,
      },
    }),
    ...(provenance.webhook === undefined ? {} : {
      webhook: {
        schemaVersion: provenance.webhook.schemaVersion,
        rawDigest: provenance.webhook.rawDigest,
        parserVersion: provenance.webhook.parserVersion,
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
