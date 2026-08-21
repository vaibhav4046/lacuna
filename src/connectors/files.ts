import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Readable } from 'node:stream';

import Busboy from '@fastify/busboy';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as yauzl from 'yauzl';

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
const MAX_PDF_PAGES = 100;
const MAX_PDF_ITEMS = 20_000;
const MAX_DOCX_ENTRIES = 256;
const MAX_DOCX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 2 * 1024 * 1024;
const MAX_DOCX_RATIO = 100;
const MAX_DOCX_PARAGRAPHS = 5_000;
const MAX_DOCX_TABLES = 500;
const PARSER_TIMEOUT_MS = 5_000;
const PREVIEW_EXCERPT_CHARS = 320;
const SUPPORTED_TYPES = new Set(['text', 'markdown', 'pdf', 'docx']);
const DANGEROUS_SUFFIXES = new Set([
  'bat', 'cmd', 'com', 'docx', 'exe', 'html', 'js', 'markdown', 'md', 'mjs',
  'pdf', 'ps1', 'scr', 'svg', 'txt', 'vbs', 'zip',
]);
const RESERVED_BASENAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const BINARY_TEXT_CONTROL = /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const XML_POLICY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const XML_ENTITY = /&(?:#(?:x[0-9a-f]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);/iu;
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const PDF_EOF = Buffer.from('%%EOF', 'ascii');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP64_EOCD = Buffer.from([0x50, 0x4b, 0x06, 0x06]);
const ZIP64_LOCATOR = Buffer.from([0x50, 0x4b, 0x06, 0x07]);

let pdfWorkerReady: Promise<unknown> | undefined;

function loadPdfWorker(): Promise<unknown> {
  // PDF.js otherwise hides its Node fake-worker behind a runtime-relative,
  // webpack-ignored import. This literal import is traceable and stays in an
  // isolated lazy module, whose side effect installs globalThis.pdfjsWorker.
  pdfWorkerReady ??= import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  return pdfWorkerReady;
}

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
  const priorDot = stem.lastIndexOf('.');
  if (priorDot >= 0 && DANGEROUS_SUFFIXES.has(stem.slice(priorDot + 1).toLowerCase())) fail('invalid_filename');
  if (RESERVED_BASENAMES.test(stem)) fail('invalid_filename');
  const type = extension === 'txt' ? 'text'
    : extension === 'md' || extension === 'markdown' ? 'markdown'
      : extension === 'pdf' ? 'pdf'
        : extension === 'docx' ? 'docx'
          : null;
  if (type === null || !SUPPORTED_TYPES.has(type)) fail('unsupported_file');
  const title = stem.normalize('NFC').trim().replace(/\s+/gu, ' ');
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

function decodePolicyXml(bytes: Buffer): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (XML_POLICY_CONTROL.test(text)) fail('invalid_file');
    return text;
  } catch (error) {
    if (error instanceof FileConnectorError) throw error;
    return fail('invalid_file');
  }
}

function hasNoTrailingPdfPayload(bytes: Buffer): boolean {
  const eof = bytes.lastIndexOf(PDF_EOF);
  // Let PDF.js classify a missing EOF as malformed; this gate is specifically
  // for a second payload hidden after an otherwise complete PDF.
  if (eof < 0) return true;
  for (let at = eof + PDF_EOF.length; at < bytes.length; at += 1) {
    const byte = bytes[at];
    if (byte !== 0x00 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d && byte !== 0x20) {
      return false;
    }
  }
  return true;
}

async function within<T>(promise: Promise<T>, timeoutMs = PARSER_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new FileConnectorError('file_too_complex', 422)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface ExtractedText {
  readonly text: string;
  readonly pages: number;
  readonly paragraphs: number;
  readonly tables: number;
}

async function extractPdf(bytes: Buffer): Promise<ExtractedText> {
  if (!begins(bytes, PDF_MAGIC) || !hasNoTrailingPdfPayload(bytes)) fail('invalid_file');
  const deadline = Date.now() + PARSER_TIMEOUT_MS;
  const bounded = async <T>(promise: Promise<T>): Promise<T> => (
    await within(promise, Math.max(1, deadline - Date.now()))
  );
  try {
    await bounded(loadPdfWorker());
  } catch (error) {
    if (error instanceof FileConnectorError) throw error;
    return fail('parse_failed');
  }
  const loading = getDocument({
    data: new Uint8Array(bytes),
    disableAutoFetch: true,
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    enableXfa: false,
    isEvalSupported: false,
    stopAtErrors: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
  });
  let document: Awaited<typeof loading.promise> | undefined;
  try {
    document = await bounded(loading.promise);
    if (document.numPages < 1) fail('empty_file');
    if (document.numPages > MAX_PDF_PAGES) fail('file_too_complex');
    const pages: string[] = [];
    let items = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await bounded(document.getPage(pageNumber));
      try {
        const content = await bounded(page.getTextContent({ disableNormalization: false }));
        const text: string[] = [];
        for (const item of content.items) {
          items += 1;
          if (items > MAX_PDF_ITEMS) fail('file_too_complex');
          if ('str' in item && typeof item.str === 'string' && item.str !== '') text.push(item.str);
        }
        pages.push(text.join(' ').trim());
        if (pages.join('\n').length > MAX_SOURCE_CHARS) fail('document_too_long', 422);
      } finally {
        page.cleanup();
      }
    }
    const text = pages.filter((page) => page !== '').join('\n');
    if (text.trim() === '') fail('empty_file');
    return { text, pages: document.numPages, paragraphs: pages.filter((page) => page !== '').length, tables: 0 };
  } catch (error) {
    if (error instanceof FileConnectorError) throw error;
    return fail('parse_failed');
  } finally {
    try {
      await document?.cleanup();
    } catch {
      // Cleanup has no bearing on the already-redacted parse result.
    }
    try {
      await loading.destroy();
    } catch {
      // Always attempt teardown; never expose parser cleanup messages.
    }
  }
}

function zipEntryName(entry: yauzl.Entry): string {
  const name = entry.fileName.normalize('NFC');
  if (name.length === 0
    || Buffer.byteLength(name, 'utf8') > MAX_FILENAME_BYTES
    || CONTROL_OR_BIDI.test(name)
    || name.includes('\\')
    || name.startsWith('/')
    || /^[A-Za-z]:/u.test(name)
    || name.split('/').some((part) => part === '..' || part === '.')
    || name.split('/').length > 8) fail('invalid_file');
  return name;
}

async function readZipEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry, cap: number): Promise<Buffer> {
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const held = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += held.length;
    if (bytes > cap) {
      stream.destroy();
      fail('file_too_complex');
    }
    chunks.push(held);
  }
  return Buffer.concat(chunks, bytes);
}

interface DocxPreflight {
  readonly paragraphs: number;
  readonly tables: number;
}

function preflightCentralDirectory(bytes: Buffer): void {
  const minimum = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= minimum; at -= 1) {
    if (bytes.readUInt32LE(at) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) fail('parse_failed');
  const entries = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  const commentBytes = bytes.readUInt16LE(eocd + 20);
  if (bytes.readUInt16LE(eocd + 4) !== 0
    || bytes.readUInt16LE(eocd + 6) !== 0
    || bytes.readUInt16LE(eocd + 8) !== entries
    || entries === 0
    || entries > MAX_DOCX_ENTRIES
    || eocd + 22 + commentBytes !== bytes.length
    || directoryOffset + directorySize !== eocd) fail('parse_failed');

  const names = new Set<string>();
  let at = directoryOffset;
  let compressedTotal = 0;
  let uncompressedTotal = 0;
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > eocd || bytes.readUInt32LE(at) !== 0x02014b50) fail('parse_failed');
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20);
    const uncompressed = bytes.readUInt32LE(at + 24);
    const nameBytes = bytes.readUInt16LE(at + 28);
    const extraBytes = bytes.readUInt16LE(at + 30);
    const entryCommentBytes = bytes.readUInt16LE(at + 32);
    const end = at + 46 + nameBytes + extraBytes + entryCommentBytes;
    if (end > eocd || nameBytes === 0 || nameBytes > MAX_FILENAME_BYTES) fail('invalid_file');
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(at + 46, at + 46 + nameBytes));
    } catch {
      fail('invalid_file');
    }
    const checked = zipEntryName({ fileName: name } as yauzl.Entry).toLowerCase();
    if (names.has(checked)) fail('invalid_file');
    names.add(checked);
    if ((flags & 1) !== 0) fail('invalid_file');
    if (method !== 0 && method !== 8) fail('invalid_file');
    const extra = bytes.subarray(at + 46 + nameBytes, at + 46 + nameBytes + extraBytes);
    for (let cursor = 0; cursor + 4 <= extra.length;) {
      const id = extra.readUInt16LE(cursor);
      const size = extra.readUInt16LE(cursor + 2);
      if (cursor + 4 + size > extra.length) fail('invalid_file');
      if (id === 1) fail('file_too_complex');
      cursor += 4 + size;
    }
    if (extra.length > 0) {
      let cursor = 0;
      while (cursor + 4 <= extra.length) cursor += 4 + extra.readUInt16LE(cursor + 2);
      if (cursor !== extra.length) fail('invalid_file');
    }
    if (uncompressed > MAX_DOCX_ENTRY_BYTES
      || (uncompressed > 0 && (compressed === 0 || uncompressed / compressed > MAX_DOCX_RATIO))) {
      fail('file_too_complex');
    }
    compressedTotal += compressed;
    uncompressedTotal += uncompressed;
    if (compressedTotal > MAX_FILE_BYTES || uncompressedTotal > MAX_DOCX_UNCOMPRESSED_BYTES) {
      fail('file_too_complex');
    }
    at = end;
  }
  if (at !== eocd) fail('parse_failed');
}

async function preflightDocx(bytes: Buffer, deadline: number): Promise<DocxPreflight> {
  if (!begins(bytes, ZIP_MAGIC)) fail('invalid_file');
  if (bytes.indexOf(ZIP64_EOCD) >= 0 || bytes.indexOf(ZIP64_LOCATOR) >= 0) fail('file_too_complex');
  preflightCentralDirectory(bytes);
  let zipFile: yauzl.ZipFile;
  try {
    zipFile = await yauzl.fromBufferPromise(bytes, {
      autoClose: false,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
  } catch {
    fail('parse_failed');
  }

  const names = new Set<string>();
  let entries = 0;
  let compressedTotal = 0;
  let uncompressedTotal = 0;
  const captured: { contentTypes?: Buffer; documentXml?: Buffer } = {};
  const relationships: Buffer[] = [];
  try {
    await within(new Promise<void>((resolve, reject) => {
      let stopped = false;
      const stop = (error: unknown) => {
        if (stopped) return;
        stopped = true;
        reject(error);
      };
      zipFile.once('error', stop);
      zipFile.once('end', () => {
        if (!stopped) resolve();
      });
      zipFile.on('entry', (entry) => {
        void (async () => {
          if (stopped) return;
          entries += 1;
          if (entries > MAX_DOCX_ENTRIES) fail('file_too_complex');
          const name = zipEntryName(entry);
          const canonical = name.toLowerCase();
          if (names.has(canonical)) fail('invalid_file');
          names.add(canonical);
          if ((entry.generalPurposeBitFlag & 1) !== 0) fail('invalid_file');
          if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) fail('invalid_file');
          if (entry.uncompressedSize > MAX_DOCX_ENTRY_BYTES) fail('file_too_complex');
          if (entry.uncompressedSize > 0
            && (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > MAX_DOCX_RATIO)) {
            fail('file_too_complex');
          }
          compressedTotal += entry.compressedSize;
          uncompressedTotal += entry.uncompressedSize;
          if (compressedTotal > MAX_FILE_BYTES || uncompressedTotal > MAX_DOCX_UNCOMPRESSED_BYTES) {
            fail('file_too_complex');
          }
          if (canonical.includes('vbaproject')
            || canonical.includes('/embeddings/')
            || canonical.endsWith('.bin')
            || canonical.includes('oleobject')) fail('invalid_file');

          if (canonical === '[content_types].xml') {
            captured.contentTypes = await readZipEntry(zipFile, entry, MAX_DOCX_XML_BYTES);
          } else if (canonical === 'word/document.xml') {
            captured.documentXml = await readZipEntry(zipFile, entry, MAX_DOCX_XML_BYTES);
          } else if (canonical.endsWith('.rels')) {
            relationships.push(await readZipEntry(zipFile, entry, 256 * 1024));
          }
          zipFile.readEntry();
        })().catch(stop);
      });
      zipFile.readEntry();
    }), Math.max(1, deadline - Date.now()));
  } catch (error) {
    if (error instanceof FileConnectorError) throw error;
    fail('parse_failed');
  } finally {
    zipFile.close();
  }

  if (captured.contentTypes === undefined || captured.documentXml === undefined) fail('invalid_file');
  const contentTypeText = decodePolicyXml(captured.contentTypes);
  if (!contentTypeText.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')
    || XML_ENTITY.test(contentTypeText)
    || /macroEnabled|vbaProject|oleObject|application\/vnd\.ms-|application\/vnd\.openxmlformats-officedocument\.(?:oleObject|package)|application\/octet-stream/iu.test(contentTypeText)) fail('invalid_file');
  for (const relationship of relationships) {
    const relationshipText = decodePolicyXml(relationship);
    if (XML_ENTITY.test(relationshipText)
      || /TargetMode\s*=/iu.test(relationshipText)
      || /Target\s*=\s*["']\s*(?:[A-Za-z][A-Za-z0-9+.-]*:|[/\\]{2})/iu.test(relationshipText)) {
      fail('invalid_file');
    }
  }
  const xml = decodePolicyXml(captured.documentXml);
  const paragraphs = xml.match(/<w:p(?:\s|>)/gu)?.length ?? 0;
  const tables = xml.match(/<w:tbl(?:\s|>)/gu)?.length ?? 0;
  if (paragraphs > MAX_DOCX_PARAGRAPHS || tables > MAX_DOCX_TABLES) fail('file_too_complex');
  return { paragraphs, tables };
}

async function extractDocx(bytes: Buffer): Promise<ExtractedText> {
  const deadline = Date.now() + PARSER_TIMEOUT_MS;
  const policy = await preflightDocx(bytes, deadline);
  try {
    const result = await within(
      mammoth.extractRawText({ buffer: bytes }),
      Math.max(1, deadline - Date.now()),
    );
    const text = result.value.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
    if (text === '') fail('empty_file');
    if (text.length > MAX_SOURCE_CHARS) fail('document_too_long', 422);
    return { text, pages: 0, paragraphs: policy.paragraphs, tables: policy.tables };
  } catch (error) {
    if (error instanceof FileConnectorError) throw error;
    fail('parse_failed');
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
export async function parseUploadedFile(input: ParseUploadedFileInput): Promise<PreparedFile> {
  const bytes = Buffer.from(input.bytes);
  if (bytes.length === 0) fail('empty_file');
  if (bytes.length > MAX_FILE_BYTES) fail('file_too_large', 413);
  const policy = extensionPolicy(input.filename);
  if (!mediaTypeAgrees(policy.type, input.mediaType)) fail('unsupported_file');

  let extracted: ExtractedText;
  if (policy.type === 'pdf') {
    extracted = await extractPdf(bytes);
  } else if (policy.type === 'docx') {
    extracted = await extractDocx(bytes);
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
}

/** Preview is pure; import reparses and consumes its authenticated policy before the runner. */
export class FileConnectorService implements FileConnectorBoundary {
  readonly #runner: Pick<ConnectorRunner, 'run'>;
  readonly #tokens: FilePreviewTokenService;
  readonly #now: () => number;

  constructor(options: FileConnectorServiceOptions) {
    this.#runner = options.runner;
    this.#tokens = options.tokens;
    this.#now = options.now ?? Date.now;
  }

  async preview(request: MultipartRequestStream, context: FileRequestContext): Promise<FilePreview> {
    const multipart = await readMultipartFile(request, 'preview');
    const prepared = await parseUploadedFile({
      ...multipart.file,
      observedAt: new Date(this.#now()).toISOString(),
    });
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
    });
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
