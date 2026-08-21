import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const FILE_PREVIEW_TTL_MS = 5 * 60_000;
const TOKEN_VERSION = 1;
const DIGEST = /^[0-9a-f]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const TYPES = new Set(['text', 'markdown', 'pdf', 'docx']);
const PAYLOAD_KEYS = [
  'exp', 'iat', 'nonce', 'normalizedDigest', 'parserVersion', 'rawDigest',
  'sessionBinding', 'title', 'type', 'v', 'workspaceDigest',
];

export type FilePreviewTokenCode = 'preview_invalid' | 'preview_expired' | 'preview_replayed';

export class PreviewTokenError extends Error {
  override readonly name = 'PreviewTokenError';
  readonly code: FilePreviewTokenCode;

  constructor(code: FilePreviewTokenCode) {
    super(code);
    this.code = code;
  }
}

export type PreviewFileType = 'text' | 'markdown' | 'pdf' | 'docx';

export interface FilePreviewBinding {
  readonly sessionBinding: string;
  readonly workspaceDigest: string;
  readonly rawDigest: string;
  readonly normalizedDigest: string;
  readonly parserVersion: string;
  readonly type: PreviewFileType;
  readonly title: string;
}

interface FilePreviewPayload extends FilePreviewBinding {
  readonly v: 1;
  readonly iat: number;
  readonly exp: number;
  readonly nonce: string;
}

export interface IssuedFilePreviewToken {
  readonly token: string;
  readonly expiresAt: string;
}

export interface FilePreviewTokenOptions {
  readonly key: Uint8Array;
  readonly now?: () => number;
  readonly nonce?: () => Uint8Array;
  readonly ttlMs?: number;
  readonly maxUsedNonces?: number;
}

function exactRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validBinding(value: FilePreviewBinding): boolean {
  return DIGEST.test(value.sessionBinding)
    && DIGEST.test(value.workspaceDigest)
    && DIGEST.test(value.rawDigest)
    && DIGEST.test(value.normalizedDigest)
    && value.parserVersion.length > 0
    && value.parserVersion.length <= 64
    && TYPES.has(value.type)
    && value.title.length > 0
    && value.title.length <= 120;
}

function safeSame(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function payloadBinding(payload: FilePreviewPayload): FilePreviewBinding {
  return {
    sessionBinding: payload.sessionBinding,
    workspaceDigest: payload.workspaceDigest,
    rawDigest: payload.rawDigest,
    normalizedDigest: payload.normalizedDigest,
    parserVersion: payload.parserVersion,
    type: payload.type,
    title: payload.title,
  };
}

function bindingsMatch(actual: FilePreviewBinding, expected: FilePreviewBinding): boolean {
  return safeSame(actual.sessionBinding, expected.sessionBinding)
    && safeSame(actual.workspaceDigest, expected.workspaceDigest)
    && safeSame(actual.rawDigest, expected.rawDigest)
    && safeSame(actual.normalizedDigest, expected.normalizedDigest)
    && safeSame(actual.parserVersion, expected.parserVersion)
    && safeSame(actual.type, expected.type)
    && safeSame(actual.title, expected.title);
}

function parsePayload(encoded: string): FilePreviewPayload {
  if (encoded.length === 0 || encoded.length > 2_048 || !BASE64URL.test(encoded)) {
    throw new PreviewTokenError('preview_invalid');
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new PreviewTokenError('preview_invalid');
  }
  if (!exactRecord(value) || Object.keys(value).sort().join('\u0000') !== PAYLOAD_KEYS.join('\u0000')) {
    throw new PreviewTokenError('preview_invalid');
  }
  const payload = value as Partial<FilePreviewPayload>;
  if (payload.v !== TOKEN_VERSION
    || !Number.isSafeInteger(payload.iat)
    || !Number.isSafeInteger(payload.exp)
    || typeof payload.nonce !== 'string'
    || payload.nonce.length < 16
    || payload.nonce.length > 64
    || !BASE64URL.test(payload.nonce)
    || typeof payload.sessionBinding !== 'string'
    || typeof payload.workspaceDigest !== 'string'
    || typeof payload.rawDigest !== 'string'
    || typeof payload.normalizedDigest !== 'string'
    || typeof payload.parserVersion !== 'string'
    || typeof payload.type !== 'string'
    || typeof payload.title !== 'string'
    || !validBinding(payload as FilePreviewBinding)) {
    throw new PreviewTokenError('preview_invalid');
  }
  return payload as FilePreviewPayload;
}

/** Parse a dedicated base64url or hex secret; weak, ambiguous values fail closed. */
export function previewSigningKey(value: string | undefined): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return null;
  let decoded: Buffer;
  if (/^(?:[0-9a-fA-F]{2})+$/u.test(value)) {
    decoded = Buffer.from(value, 'hex');
  } else if (BASE64URL.test(value)) {
    decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value.replace(/=+$/u, '')) return null;
  } else {
    return null;
  }
  return decoded.length >= 32 ? decoded : null;
}

/**
 * Authenticates preview policy and keeps a bounded process-local replay cache.
 * Cross-instance replay remains a deterministic runner upsert; this is not a
 * global one-time compare-and-swap claim.
 */
export class FilePreviewTokenService {
  readonly #key: Buffer;
  readonly #now: () => number;
  readonly #nonce: () => Uint8Array;
  readonly #ttlMs: number;
  readonly #maxUsedNonces: number;
  readonly #used = new Map<string, number>();

  constructor(options: FilePreviewTokenOptions) {
    if (options.key.byteLength < 32) throw new Error('preview signing key is too short');
    this.#key = Buffer.from(options.key);
    this.#now = options.now ?? Date.now;
    this.#nonce = options.nonce ?? (() => randomBytes(18));
    this.#ttlMs = options.ttlMs ?? FILE_PREVIEW_TTL_MS;
    this.#maxUsedNonces = options.maxUsedNonces ?? 4_096;
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs < 1_000 || this.#ttlMs > FILE_PREVIEW_TTL_MS) {
      throw new Error('invalid preview token ttl');
    }
    if (!Number.isSafeInteger(this.#maxUsedNonces) || this.#maxUsedNonces < 1 || this.#maxUsedNonces > 65_536) {
      throw new Error('invalid preview replay bound');
    }
  }

  issue(binding: FilePreviewBinding): IssuedFilePreviewToken {
    if (!validBinding(binding)) throw new PreviewTokenError('preview_invalid');
    const iat = this.#now();
    const exp = iat + this.#ttlMs;
    const nonce = Buffer.from(this.#nonce()).toString('base64url');
    if (nonce.length < 16 || nonce.length > 64) throw new Error('invalid preview nonce');
    const payload: FilePreviewPayload = { v: 1, ...binding, iat, exp, nonce };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.#key).update(encoded, 'ascii').digest('base64url');
    return { token: `${encoded}.${signature}`, expiresAt: new Date(exp).toISOString() };
  }

  verifyAndConsume(token: string, expected: FilePreviewBinding): void {
    if (!validBinding(expected) || token.length > 3_000) throw new PreviewTokenError('preview_invalid');
    const pieces = token.split('.');
    const encoded = pieces[0];
    const suppliedSignature = pieces[1];
    if (pieces.length !== 2 || encoded === undefined || suppliedSignature === undefined
      || !BASE64URL.test(suppliedSignature)) throw new PreviewTokenError('preview_invalid');
    const wanted = createHmac('sha256', this.#key).update(encoded, 'ascii').digest();
    const supplied = Buffer.from(suppliedSignature, 'base64url');
    if (supplied.toString('base64url') !== suppliedSignature
      || supplied.length !== wanted.length
      || !timingSafeEqual(supplied, wanted)) {
      throw new PreviewTokenError('preview_invalid');
    }
    const payload = parsePayload(encoded);
    const now = this.#now();
    if (payload.exp - payload.iat !== this.#ttlMs || payload.iat > now || now >= payload.exp) {
      throw new PreviewTokenError(now >= payload.exp ? 'preview_expired' : 'preview_invalid');
    }
    if (!bindingsMatch(payloadBinding(payload), expected)) throw new PreviewTokenError('preview_invalid');
    this.#prune(now);
    if (this.#used.has(payload.nonce)) throw new PreviewTokenError('preview_replayed');
    this.#used.set(payload.nonce, payload.exp);
  }

  #prune(now: number): void {
    for (const [nonce, expiry] of this.#used) {
      if (expiry <= now) this.#used.delete(nonce);
    }
    while (this.#used.size >= this.#maxUsedNonces) {
      const oldest = this.#used.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#used.delete(oldest);
    }
  }
}
