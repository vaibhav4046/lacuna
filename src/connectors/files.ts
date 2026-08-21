import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Readable } from 'node:stream';
import { Worker, type WorkerOptions } from 'node:worker_threads';

import Busboy from '@fastify/busboy';

import { MAX_SOURCE_CHARS } from '../api/ingest.js';
import {
  ConnectorNormalizationError,
  prepareConnectorDocument,
  type PreparedConnectorDocument,
} from './normalize.js';
import type { ConnectorRunner, ConnectorRunResult } from './run.js';
import {
  FilePreviewTokenService,
  PreviewTokenError,
  type FilePreviewBinding,
  type PreviewFileType,
} from './preview-token.js';

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_MULTIPART_BYTES = 8 * 1024 * 1024;
export const FILE_PARSER_VERSION = 'files-v1';

const MAX_FILENAME_BYTES = 240;
const PARSER_TIMEOUT_MS = 5_000;
const PARSER_TEARDOWN_MS = 500;
const PREVIEW_EXCERPT_CHARS = 320;
const SUPPORTED_TYPES = new Set(['text', 'markdown', 'pdf', 'docx']);
const DANGEROUS_SUFFIXES = new Set([
  'bat', 'cmd', 'com', 'docx', 'exe', 'html', 'js', 'markdown', 'md', 'mjs',
  'pdf', 'ps1', 'scr', 'svg', 'txt', 'vbs', 'zip',
]);
const RESERVED_BASENAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const BINARY_TEXT_CONTROL = /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DEFAULT_FILE_PARSER_WORKER = new URL('../../api/file-parser-worker.mjs', import.meta.url);

export type FileConnectorErrorCode =
  | 'invalid_multipart'
  | 'request_too_large'
  | 'file_too_large'
  | 'file_required'
  | 'invalid_filename'
  | 'unsupported_file'
  | 'invalid_file'
  | 'invalid_utf8'
  | 'empty_file'
  | 'parse_failed'
  | 'file_too_complex'
  | 'document_too_long';

export class FileConnectorError extends Error {
  override readonly name = 'FileConnectorError';
  readonly code: FileConnectorErrorCode;
  readonly status: number;

  constructor(code: FileConnectorErrorCode, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export interface UploadedFile {
  readonly filename: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface ParseUploadedFileInput extends UploadedFile {
  readonly observedAt: string;
}

export interface PreparedFile {
  readonly filename: string;
  readonly title: string;
  readonly type: PreviewFileType;
  readonly mediaType: string;
  readonly parserVersion: typeof FILE_PARSER_VERSION;
  readonly rawDigest: string;
  readonly normalizedDigest: string;
  readonly text: string;
  readonly characters: number;
  readonly pages: number;
  readonly paragraphs: number;
  readonly tables: number;
  readonly document: PreparedConnectorDocument;
}

export interface MultipartFileRequest {
  readonly file: UploadedFile;
  readonly previewToken?: string;
}

export interface FilePreview {
  readonly filename: string;
  readonly title: string;
  readonly type: PreviewFileType;
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

export interface FileRequestContext {
  readonly workspace: string;
  readonly sessionBinding: string;
}

export interface MultipartRequestStream extends Readable {
  readonly headers: IncomingHttpHeaders;
}

export interface FileConnectorBoundary {
  preview(request: MultipartRequestStream, context: FileRequestContext): Promise<FilePreview>;
  importFile(request: MultipartRequestStream, context: FileRequestContext): Promise<ConnectorRunResult>;
}

function fail(code: FileConnectorErrorCode, status = 422): never {
  throw new FileConnectorError(code, status);
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function extensionPolicy(filename: string): { readonly title: string; readonly type: PreviewFileType; readonly mediaType: string } {
  if (filename.length === 0
    || Buffer.byteLength(filename, 'utf8') > MAX_FILENAME_BYTES
    || CONTROL_OR_BIDI.test(filename)
    || filename.includes('/')
    || filename.includes('\\')
    || filename.includes(':')
    || filename === '.'
    || filename === '..'
    || filename.endsWith('.')
    || filename.endsWith(' ')) fail('invalid_filename');
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === filename.length - 1) fail('unsupported_file');
  const stem = filename.slice(0, lastDot);
  const extension = filename.slice(lastDot + 1).toLowerCase();
  const canonicalStem = stem.normalize('NFKC').trim();
  const stemParts = canonicalStem.split('.').map((part) => part.trim());
  if (stemParts.some((part) => part.length === 0)
    || stemParts.slice(1).some((part) => DANGEROUS_SUFFIXES.has(part.toLowerCase()))
    || RESERVED_BASENAMES.test(stemParts[0] ?? '')
    || RESERVED_BASENAMES.test(canonicalStem)) fail('invalid_filename');
  const type = extension === 'txt' ? 'text'
    : extension === 'md' || extension === 'markdown' ? 'markdown'
      : extension === 'pdf' ? 'pdf'
        : extension === 'docx' ? 'docx'
          : null;
  if (type === null || !SUPPORTED_TYPES.has(type)) fail('unsupported_file');
  const title = canonicalStem.normalize('NFC').replace(/\s+/gu, ' ');
  if (title.length === 0 || title.length > 120) fail('invalid_filename');
  const mediaType = type === 'text' ? 'text/plain'
    : type === 'markdown' ? 'text/markdown'
      : type === 'pdf' ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return { title, type, mediaType };
}

function mediaTypeAgrees(type: PreviewFileType, mediaType: string): boolean {
  const normalized = mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (normalized === '' || normalized === 'application/octet-stream') return true;
  if (type === 'text') return normalized === 'text/plain';
  if (type === 'markdown') return normalized === 'text/markdown' || normalized === 'text/plain';
  if (type === 'pdf') return normalized === 'application/pdf';
  return normalized === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function begins(bytes: Buffer, magic: Buffer): boolean {
  return bytes.length >= magic.length && bytes.subarray(0, magic.length).equals(magic);
}

function decodeText(bytes: Buffer): string {
  if (bytes.includes(0)) fail('invalid_file');
  if (begins(bytes, PDF_MAGIC) || begins(bytes, ZIP_MAGIC) || (bytes[0] === 0x4d && bytes[1] === 0x5a)) {
    fail('invalid_file');
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (BINARY_TEXT_CONTROL.test(text)) fail('invalid_file');
    return text;
  } catch (error) {
    if (error instanceof FileConnectorError) throw error;
    return fail('invalid_utf8');
  }
}

interface ExtractedText {
  readonly text: string;
  readonly pages: number;
  readonly paragraphs: number;
  readonly tables: number;
}

export interface FileParserIsolationOptions {
  readonly workerUrl?: URL;
  readonly timeoutMs?: number;
  readonly workerFactory?: (url: URL, options: WorkerOptions) => Worker;
}

const WORKER_ERROR_CODES = new Set<FileConnectorErrorCode>([
  'invalid_file',
  'parse_failed',
  'file_too_complex',
  'empty_file',
  'document_too_long',
]);

function extractedFromWorker(message: unknown): ExtractedText {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) fail('parse_failed');
  const record = message as Record<string, unknown>;
  if (record['ok'] === false
    && Object.keys(record).sort().join('\u0000') === 'code\u0000ok'
    && typeof record['code'] === 'string'
    && WORKER_ERROR_CODES.has(record['code'] as FileConnectorErrorCode)) {
    fail(record['code'] as FileConnectorErrorCode);
  }
  if (record['ok'] !== true || Object.keys(record).sort().join('\u0000') !== 'ok\u0000value') {
    fail('parse_failed');
  }
  const value = record['value'];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('parse_failed');
  const parsed = value as Record<string, unknown>;
  if (Object.keys(parsed).sort().join('\u0000') !== 'pages\u0000paragraphs\u0000tables\u0000text'
    || typeof parsed['text'] !== 'string'
    || parsed['text'].length === 0
    || parsed['text'].length > MAX_SOURCE_CHARS
    || !Number.isSafeInteger(parsed['pages'])
    || !Number.isSafeInteger(parsed['paragraphs'])
    || !Number.isSafeInteger(parsed['tables'])
    || (parsed['pages'] as number) < 0
    || (parsed['pages'] as number) > 100
    || (parsed['paragraphs'] as number) < 0
    || (parsed['paragraphs'] as number) > 5_000
    || (parsed['tables'] as number) < 0
    || (parsed['tables'] as number) > 500) fail('parse_failed');
  return {
    text: parsed['text'],
    pages: parsed['pages'] as number,
    paragraphs: parsed['paragraphs'] as number,
    tables: parsed['tables'] as number,
  };
}

function terminateWorker(worker: Worker): { readonly bounded: Promise<boolean>; readonly settled: Promise<boolean> } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = worker.terminate().then(() => true, () => false);
  const bounded = Promise.race([
    settled,
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), PARSER_TEARDOWN_MS);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
  return { bounded, settled };
}

async function extractIsolated(
  type: 'pdf' | 'docx',
  bytes: Buffer,
  options: FileParserIsolationOptions,
): Promise<ExtractedText> {
  const timeoutMs = options.timeoutMs ?? PARSER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > PARSER_TIMEOUT_MS) {
    fail('parse_failed');
  }
  const workerUrl = options.workerUrl ?? DEFAULT_FILE_PARSER_WORKER;
  if (workerUrl.protocol !== 'file:') fail('parse_failed');
  let worker: Worker;
  try {
    const workerOptions: WorkerOptions = {
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: 192,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
      },
    };
    worker = options.workerFactory === undefined
      ? new Worker(workerUrl, workerOptions)
      : options.workerFactory(workerUrl, workerOptions);
  } catch {
    fail('parse_failed');
  }

  return await new Promise<ExtractedText>((resolve, reject) => {
    let finishing = false;
    const timeout = setTimeout(() => finish(new FileConnectorError('file_too_complex', 422)), timeoutMs);
    timeout.unref?.();
    const cleanup = () => {
      clearTimeout(timeout);
      worker.off('message', onMessage);
      worker.off('messageerror', onMessageError);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const finish = (outcome: ExtractedText | FileConnectorError) => {
      if (finishing) return;
      finishing = true;
      clearTimeout(timeout);
      const termination = terminateWorker(worker);
      void termination.bounded.then((stopped) => {
        if (stopped) cleanup();
        else void termination.settled.finally(cleanup);
        if (!stopped) {
          reject(new FileConnectorError('parse_failed', 422));
        } else if (outcome instanceof FileConnectorError) {
          reject(outcome);
        } else {
          resolve(outcome);
        }
      });
    };
    const onMessage = (message: unknown) => {
      try {
        finish(extractedFromWorker(message));
      } catch (error) {
        finish(error instanceof FileConnectorError ? error : new FileConnectorError('parse_failed', 422));
      }
    };
    const onMessageError = () => finish(new FileConnectorError('parse_failed', 422));
    const onError = () => finish(new FileConnectorError('parse_failed', 422));
    const onExit = () => finish(new FileConnectorError('parse_failed', 422));
    worker.once('message', onMessage);
    worker.once('messageerror', onMessageError);
    worker.once('error', onError);
    worker.once('exit', onExit);
    const owned = Uint8Array.from(bytes);
    const transferred = owned.buffer as ArrayBuffer;
    try {
      worker.postMessage({ kind: 'parse', fileType: type, bytes: transferred }, [transferred]);
    } catch {
      finish(new FileConnectorError('parse_failed', 422));
    }
  });
}

function preparedDocument(
  title: string,
  type: PreviewFileType,
  mediaType: string,
  text: string,
  observedAt: string,
): PreparedConnectorDocument {
  if (text.length > MAX_SOURCE_CHARS) fail('document_too_long', 422);
  try {
    return prepareConnectorDocument({
      title,
      text,
      provenance: {
        connectorId: type,
        sourceUrl: null,
        mediaType: mediaType as 'text/plain' | 'text/markdown' | 'application/pdf'
          | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        observedAt,
      },
    });
  } catch (error) {
    if (error instanceof ConnectorNormalizationError) {
      fail(error.code === 'document_too_long' ? 'document_too_long' : 'invalid_file', 422);
    }
    throw error;
  }
}

/** Parse a fully bounded upload; multipart acquisition is a separate streaming gate. */
export async function parseUploadedFile(
  input: ParseUploadedFileInput,
  isolation: FileParserIsolationOptions = {},
): Promise<PreparedFile> {
  const bytes = Buffer.from(input.bytes);
  if (bytes.length === 0) fail('empty_file');
  if (bytes.length > MAX_FILE_BYTES) fail('file_too_large', 413);
  const policy = extensionPolicy(input.filename);
  if (!mediaTypeAgrees(policy.type, input.mediaType)) fail('unsupported_file');

  let extracted: ExtractedText;
  if (policy.type === 'pdf') {
    extracted = await extractIsolated('pdf', bytes, isolation);
  } else if (policy.type === 'docx') {
    extracted = await extractIsolated('docx', bytes, isolation);
  } else {
    const text = decodeText(bytes);
    if (text.trim() === '') fail('empty_file');
    extracted = {
      text,
      pages: 0,
      paragraphs: text.split('\n').filter((line) => line.trim() !== '').length,
      tables: 0,
    };
  }
  const document = preparedDocument(
    policy.title,
    policy.type,
    policy.mediaType,
    extracted.text,
    input.observedAt,
  );
  return Object.freeze({
    filename: input.filename,
    title: policy.title,
    type: policy.type,
    mediaType: policy.mediaType,
    parserVersion: FILE_PARSER_VERSION,
    rawDigest: sha256(bytes),
    normalizedDigest: document.contentDigest,
    text: document.text,
    characters: document.text.length,
    pages: extracted.pages,
    paragraphs: extracted.paragraphs,
    tables: extracted.tables,
    document,
  });
}

function contentLength(headers: IncomingHttpHeaders): number | null {
  const raw = headers['content-length'];
  if (raw === undefined) return null;
  if (Array.isArray(raw) || !/^(?:0|[1-9][0-9]*)$/u.test(raw)) fail('invalid_multipart', 400);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) fail('invalid_multipart', 400);
  return value;
}

/** Stream exactly one multipart file and the mode's exact scalar field set. */
export async function readMultipartFile(
  request: MultipartRequestStream,
  mode: 'preview' | 'import',
): Promise<MultipartFileRequest> {
  const declared = contentLength(request.headers);
  if (declared !== null && declared > MAX_MULTIPART_BYTES) fail('request_too_large', 413);
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string') fail('invalid_multipart', 400);

  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: { ...request.headers, 'content-type': contentType },
      preservePath: true,
      limits: {
        fileSize: MAX_FILE_BYTES,
        files: 1,
        fields: mode === 'import' ? 1 : 0,
        parts: mode === 'import' ? 2 : 1,
        fieldNameSize: 64,
        fieldSize: 3_000,
        headerPairs: 8,
      },
    });
  } catch {
    fail('invalid_multipart', 400);
  }

  return await new Promise<MultipartFileRequest>((resolve, reject) => {
    let settled = false;
    let rawBytes = 0;
    let file: UploadedFile | null = null;
    let fileSeen = false;
    let previewToken: string | undefined;
    let tokenSeen = false;

    const cleanup = () => {
      request.off('data', countRaw);
      request.off('aborted', aborted);
      request.off('error', streamError);
    };
    const rejectOnce = (error: FileConnectorError) => {
      if (settled) return;
      settled = true;
      cleanup();
      request.unpipe(parser);
      request.pause();
      parser.destroy();
      reject(error);
    };
    const invalid = () => rejectOnce(new FileConnectorError('invalid_multipart', 400));
    const countRaw = (chunk: Buffer | string) => {
      rawBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      if (rawBytes > MAX_MULTIPART_BYTES) rejectOnce(new FileConnectorError('request_too_large', 413));
    };
    const aborted = () => invalid();
    const streamError = () => invalid();

    request.on('data', countRaw);
    request.once('aborted', aborted);
    request.once('error', streamError);
    parser.once('error', invalid);
    parser.once('partsLimit', invalid);
    parser.once('filesLimit', invalid);
    parser.once('fieldsLimit', invalid);

    parser.on('field', (fieldname, value, fieldnameTruncated, valueTruncated) => {
      if (mode !== 'import' || tokenSeen || fieldname !== 'preview_token'
        || fieldnameTruncated || valueTruncated || value.length === 0 || value.length > 3_000) {
        invalid();
        return;
      }
      tokenSeen = true;
      previewToken = value;
    });

    parser.on('file', (fieldname, stream, filename, transferEncoding, mimeType) => {
      if (fileSeen || fieldname !== 'file' || filename === ''
        || (transferEncoding !== '7bit' && transferEncoding !== 'binary')) {
        stream.resume();
        invalid();
        return;
      }
      fileSeen = true;
      const chunks: Buffer[] = [];
      let bytes = 0;
      let limited = false;
      stream.once('limit', () => {
        limited = true;
        rejectOnce(new FileConnectorError('file_too_large', 413));
      });
      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes <= MAX_FILE_BYTES) chunks.push(Buffer.from(chunk));
      });
      stream.once('error', invalid);
      stream.once('end', () => {
        if (limited || stream.truncated || settled) return;
        file = { filename, mediaType: mimeType, bytes: Buffer.concat(chunks, bytes) };
      });
    });

    parser.once('finish', () => {
      if (settled) return;
      cleanup();
      if (declared !== null && rawBytes !== declared) {
        invalid();
        return;
      }
      if (!fileSeen || file === null) {
        rejectOnce(new FileConnectorError('file_required', 400));
        return;
      }
      if (mode === 'import' && (!tokenSeen || previewToken === undefined)) {
        invalid();
        return;
      }
      settled = true;
      resolve({ file, ...(previewToken === undefined ? {} : { previewToken }) });
    });
    request.pipe(parser);
  });
}

function previewExcerpt(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= 1) return '…';
  return `${normalized.slice(0, Math.min(PREVIEW_EXCERPT_CHARS, normalized.length - 1))}…`;
}

function tokenBinding(prepared: PreparedFile, context: FileRequestContext): FilePreviewBinding {
  return {
    sessionBinding: context.sessionBinding,
    workspaceDigest: sha256(context.workspace),
    rawDigest: prepared.rawDigest,
    normalizedDigest: prepared.normalizedDigest,
    parserVersion: prepared.parserVersion,
    type: prepared.type,
    title: prepared.title,
  };
}

export interface FileConnectorServiceOptions {
  readonly runner: Pick<ConnectorRunner, 'run'>;
  readonly tokens: FilePreviewTokenService;
  readonly now?: () => number;
  readonly parserIsolation?: FileParserIsolationOptions;
}

/** Preview is pure; import reparses and consumes its authenticated policy before the runner. */
export class FileConnectorService implements FileConnectorBoundary {
  readonly #runner: Pick<ConnectorRunner, 'run'>;
  readonly #tokens: FilePreviewTokenService;
  readonly #now: () => number;
  readonly #parserIsolation: FileParserIsolationOptions;

  constructor(options: FileConnectorServiceOptions) {
    this.#runner = options.runner;
    this.#tokens = options.tokens;
    this.#now = options.now ?? Date.now;
    this.#parserIsolation = options.parserIsolation ?? {};
  }

  async preview(request: MultipartRequestStream, context: FileRequestContext): Promise<FilePreview> {
    const multipart = await readMultipartFile(request, 'preview');
    const prepared = await parseUploadedFile({
      ...multipart.file,
      observedAt: new Date(this.#now()).toISOString(),
    }, this.#parserIsolation);
    const issued = this.#tokens.issue(tokenBinding(prepared, context));
    return {
      filename: prepared.filename,
      title: prepared.title,
      type: prepared.type,
      excerpt: previewExcerpt(prepared.text),
      characters: prepared.characters,
      pages: prepared.pages,
      paragraphs: prepared.paragraphs,
      tables: prepared.tables,
      rawDigest: prepared.rawDigest,
      normalizedDigest: prepared.normalizedDigest,
      previewToken: issued.token,
      expiresAt: issued.expiresAt,
    };
  }

  async importFile(request: MultipartRequestStream, context: FileRequestContext): Promise<ConnectorRunResult> {
    const multipart = await readMultipartFile(request, 'import');
    const prepared = await parseUploadedFile({
      ...multipart.file,
      observedAt: new Date(this.#now()).toISOString(),
    }, this.#parserIsolation);
    try {
      this.#tokens.verifyAndConsume(multipart.previewToken ?? '', tokenBinding(prepared, context));
    } catch (error) {
      if (error instanceof PreviewTokenError) throw error;
      throw new PreviewTokenError('preview_invalid');
    }
    return this.#runner.run(context.workspace, {
      connectorId: prepared.type,
      documents: [{
        title: prepared.document.title,
        text: prepared.document.text,
        provenance: prepared.document.provenance,
      }],
      awaitSearchable: true,
    });
  }
}
