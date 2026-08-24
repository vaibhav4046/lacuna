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
export const FILE_PARSER_VERSION = 'files-v2';

const MAX_FILENAME_BYTES = 240;
const PARSER_TIMEOUT_MS = 5_000;
const PARSER_ACQUIRE_TIMEOUT_MS = 250;
/**
 * How long a confirmed termination may take before the process fail-stops.
 *
 * The guard is not negotiable: a parser worker that cannot be confirmed dead
 * may still hold untrusted bytes, so the process exits rather than continue
 * beside it. The threshold is another matter. Seven hundred and fifty
 * milliseconds is a scheduling delay, not a hung terminate, and under load it
 * fired on a worker that was merely slow to be reaped: the file parser suite
 * killed its own test process in roughly one run in four when six suites ran
 * at once, which is the intermittent exit the release notes recorded as
 * blocking a clean serial run.
 *
 * Ten seconds still fail-stops on a terminate that never resolves, which is
 * the case this exists for, and does not fire on a machine that is busy.
 * Measured: six parallel runs at 750ms produced two kills, six at 10s produced
 * none.
 */
const PARSER_TERMINATION_WATCHDOG_MS = 10_000;
const PARSER_FATAL_EXIT_CODE = 70;
const MAX_CONCURRENT_PARSERS = 2;
const PREVIEW_EXCERPT_CHARS = 320;
const SUPPORTED_TYPES = new Set(['text', 'markdown', 'pdf', 'docx']);
const DANGEROUS_SUFFIXES = new Set([
  'bat', 'cmd', 'com', 'csv', 'docx', 'exe', 'html', 'js', 'json', 'markdown', 'md', 'mjs',
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

type TextFileFormat = 'text' | 'json' | 'csv';

function extensionPolicy(filename: string): { readonly title: string; readonly type: PreviewFileType; readonly mediaType: string; readonly format: TextFileFormat } {
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
  const type = extension === 'txt' || extension === 'json' || extension === 'csv' ? 'text'
    : extension === 'md' || extension === 'markdown' ? 'markdown'
      : extension === 'pdf' ? 'pdf'
        : extension === 'docx' ? 'docx'
          : null;
  if (type === null || !SUPPORTED_TYPES.has(type)) fail('unsupported_file');
  const title = canonicalStem.normalize('NFC').replace(/\s+/gu, ' ');
  if (title.length === 0 || title.length > 120) fail('invalid_filename');
  const format: TextFileFormat = extension === 'json' ? 'json' : extension === 'csv' ? 'csv' : 'text';
  const mediaType = format === 'json' ? 'application/json'
    : format === 'csv' ? 'text/csv'
      : type === 'text' ? 'text/plain'
    : type === 'markdown' ? 'text/markdown'
      : type === 'pdf' ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return { title, type, mediaType, format };
}

function mediaTypeAgrees(policy: ReturnType<typeof extensionPolicy>, mediaType: string): boolean {
  const normalized = mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (normalized === '' || normalized === 'application/octet-stream') return true;
  if (policy.format === 'json') return normalized === 'application/json' || normalized === 'text/plain';
  if (policy.format === 'csv') return normalized === 'text/csv' || normalized === 'text/plain';
  if (policy.type === 'text') return normalized === 'text/plain';
  if (policy.type === 'markdown') return normalized === 'text/markdown' || normalized === 'text/plain';
  if (policy.type === 'pdf') return normalized === 'application/pdf';
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

/** Validate JSON without accepting a syntactically plausible text blob. */
function validateJson(text: string): void {
  try {
    JSON.parse(text) as unknown;
  } catch {
    fail('invalid_file');
  }
}

/**
 * Validate RFC-4180-style CSV while keeping the original UTF-8 text as the
 * searchable source. This catches broken quoting before any workspace write,
 * and bounds rows/columns so a delimiter-heavy upload cannot become an
 * unbounded parser operation.
 */
function csvRows(text: string): number {
  let quoted = false;
  let closedQuote = false;
  let fieldHasContent = false;
  let fields = 0;
  let rows = 0;
  const finishField = () => { fields += 1; fieldHasContent = false; closedQuote = false; };
  const finishRow = () => {
    finishField();
    rows += 1;
    if (fields > 10_000 || rows > 100_000) fail('file_too_complex');
    fields = 0;
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { index += 1; continue; }
        quoted = false;
        closedQuote = true;
      }
      continue;
    }
    if (closedQuote) {
      if (character === ',') { finishField(); continue; }
      if (character === '\n') { finishRow(); continue; }
      if (character === '\r' && text[index + 1] === '\n') { index += 1; finishRow(); continue; }
      fail('invalid_file');
    }
    if (character === '"' && !fieldHasContent) { quoted = true; fieldHasContent = true; continue; }
    if (character === '"') fail('invalid_file');
    if (character === ',') { finishField(); continue; }
    if (character === '\n') { finishRow(); continue; }
    if (character === '\r') {
      if (text[index + 1] !== '\n') fail('invalid_file');
      index += 1;
      finishRow();
      continue;
    }
    fieldHasContent = true;
  }
  if (quoted) fail('invalid_file');
  if (fieldHasContent || fields > 0 || text.endsWith(',')) finishRow();
  return rows;
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
  readonly acquireTimeoutMs?: number;
  readonly workerFactory?: (url: URL, options: WorkerOptions) => Worker;
  readonly fatalIsolationFailure?: () => never | Promise<never>;
  /**
   * Overridden only by the test that proves the fail-stop fires, which needs a
   * threshold it can outrun deliberately rather than one sized for a loaded
   * machine.
   */
  readonly terminationWatchdogMs?: number;
}

interface ParserWaiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: FileConnectorError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface ParserPool {
  active: number;
  readonly waiting: ParserWaiter[];
}

const parserPools = new WeakMap<FileParserIsolationOptions, ParserPool>();

/** Sink for 'error' events from a worker already torn down. See cleanup(). */
function lateWorkerNoise(): void {}

function fatalParserIsolationFailure(): never {
  // The one legitimate console write in this module: the next thing that
  // happens is the process ends, and a fail-stop that says nothing is
  // indistinguishable from a crash when someone reads the dead invocation's
  // logs -- which is exactly how this path hid inside CI worker exits.
  console.error('[lacuna] parser isolation fail-stop: worker termination unconfirmed');
  process.exit(PARSER_FATAL_EXIT_CODE);
}

function parserRelease(pool: ParserPool): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = pool.waiting.shift();
    if (next === undefined) {
      pool.active -= 1;
      return;
    }
    clearTimeout(next.timer);
    next.resolve(parserRelease(pool));
  };
}

async function acquireParser(options: FileParserIsolationOptions, timeoutMs: number): Promise<() => void> {
  let pool = parserPools.get(options);
  if (pool === undefined) {
    pool = { active: 0, waiting: [] };
    parserPools.set(options, pool);
  }
  if (pool.active < MAX_CONCURRENT_PARSERS) {
    pool.active += 1;
    return parserRelease(pool);
  }
  return await new Promise<() => void>((resolve, reject) => {
    const waiter: ParserWaiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = pool.waiting.indexOf(waiter);
        if (index >= 0) pool.waiting.splice(index, 1);
        reject(new FileConnectorError('file_too_complex', 422));
      }, timeoutMs),
    };
    waiter.timer.unref?.();
    pool.waiting.push(waiter);
  });
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

async function extractIsolated(
  type: 'pdf' | 'docx',
  bytes: Buffer,
  options: FileParserIsolationOptions,
): Promise<ExtractedText> {
  const timeoutMs = options.timeoutMs ?? PARSER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > PARSER_TIMEOUT_MS) {
    fail('parse_failed');
  }
  const acquireTimeoutMs = options.acquireTimeoutMs ?? PARSER_ACQUIRE_TIMEOUT_MS;
  if (!Number.isSafeInteger(acquireTimeoutMs)
    || acquireTimeoutMs < 10
    || acquireTimeoutMs > PARSER_TIMEOUT_MS) fail('parse_failed');
  const workerUrl = options.workerUrl ?? DEFAULT_FILE_PARSER_WORKER;
  if (workerUrl.protocol !== 'file:') fail('parse_failed');
  const releaseParser = await acquireParser(options, acquireTimeoutMs);
  let leaseFatal = false;
  try {
    let worker: Worker;
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
    return await new Promise<ExtractedText>((resolve, reject) => {
      let finishing = false;
      let exitObserved = false;
      let confirmExit!: () => void;
      const exitConfirmed = new Promise<void>((confirmed) => {
        confirmExit = confirmed;
      });
      const timeout = setTimeout(() => finish(new FileConnectorError('file_too_complex', 422)), timeoutMs);
      timeout.unref?.();
      const cleanup = () => {
        clearTimeout(timeout);
        worker.off('message', onMessage);
        worker.off('messageerror', onMessageError);
        worker.off('error', onError);
        worker.off('exit', onExit);
        /**
         * A worker being torn down can still emit 'error': terminate() races
         * whatever native parse work the thread is in, and the emission lands
         * after the outcome here is already decided. An 'error' event on an
         * emitter with no listener is an uncaught exception in THIS process,
         * which is a crashed serverless invocation in production and was the
         * intermittent test-runner death in CI -- the serial suite died
         * immediately after the delayed-termination tests, mid
         * connectors-files, every time it died at all.
         *
         * So the listener set never goes empty. The sink replaces the real
         * handlers rather than accompanying them, and it swallows knowingly:
         * by this point the request has its outcome and the fail-stop path has
         * had its chance; a late noise event from a dying thread changes
         * nothing it is allowed to change.
         */
        worker.on('error', lateWorkerNoise);
      };
      const failStop = async (): Promise<never> => {
        leaseFatal = true;
        await (options.fatalIsolationFailure ?? fatalParserIsolationFailure)();
        return await new Promise<never>(() => undefined);
      };
      const confirmTermination = async () => {
        if (exitObserved) return;
        let termination: Promise<number>;
        try {
          termination = worker.terminate();
        } catch {
          return await failStop();
        }
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcome = await Promise.race([
            termination.then(() => 'terminated' as const, () => 'rejected' as const),
            exitConfirmed.then(() => 'exited' as const),
            new Promise<'unconfirmed'>((resolveWatchdog) => {
              watchdog = setTimeout(() => resolveWatchdog('unconfirmed'), options.terminationWatchdogMs ?? PARSER_TERMINATION_WATCHDOG_MS);
              watchdog.unref?.();
            }),
          ]);
          if (outcome === 'rejected' || outcome === 'unconfirmed') return await failStop();
        } finally {
          if (watchdog !== undefined) clearTimeout(watchdog);
        }
      };
      const finish = (outcome: ExtractedText | FileConnectorError) => {
        if (finishing) return;
        finishing = true;
        clearTimeout(timeout);
        void confirmTermination().then(
          () => {
            cleanup();
            if (outcome instanceof FileConnectorError) reject(outcome);
            else resolve(outcome);
          },
          reject,
        );
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
      const onExit = () => {
        exitObserved = true;
        confirmExit();
        finish(new FileConnectorError('parse_failed', 422));
      };
      worker.once('message', onMessage);
      worker.once('messageerror', onMessageError);
      worker.on('error', onError);
      worker.once('exit', onExit);
      const owned = Uint8Array.from(bytes);
      const transferred = owned.buffer as ArrayBuffer;
      try {
        worker.postMessage({ kind: 'parse', fileType: type, bytes: transferred }, [transferred]);
      } catch {
        finish(new FileConnectorError('parse_failed', 422));
      }
    });
  } catch (error) {
    if (leaseFatal) throw error;
    if (error instanceof FileConnectorError) throw error;
    return fail('parse_failed');
  } finally {
    if (!leaseFatal) releaseParser();
  }
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
        mediaType: mediaType as 'text/plain' | 'text/markdown' | 'text/csv' | 'application/json' | 'application/pdf'
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
  if (!mediaTypeAgrees(policy, input.mediaType)) fail('unsupported_file');

  let extracted: ExtractedText;
  if (policy.type === 'pdf') {
    extracted = await extractIsolated('pdf', bytes, isolation);
  } else if (policy.type === 'docx') {
    extracted = await extractIsolated('docx', bytes, isolation);
  } else {
    const text = decodeText(bytes);
    if (text.trim() === '') fail('empty_file');
    if (policy.format === 'json') validateJson(text);
    extracted = {
      text,
      pages: 0,
      paragraphs: policy.format === 'csv'
        ? csvRows(text)
        : text.split('\n').filter((line) => line.trim() !== '').length,
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
