import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  FILE_PARSER_VERSION,
  FileConnectorError,
  MAX_FILE_BYTES,
  MAX_MULTIPART_BYTES,
  parseUploadedFile,
  readMultipartFile,
  type FileParserIsolationOptions,
  type MultipartRequestStream,
} from '../../src/connectors/files.js';
import {
  FilePreviewTokenService,
  PreviewTokenError,
  previewSigningKey,
} from '../../src/connectors/preview-token.js';

const OBSERVED_AT = '2026-08-21T12:00:00.000Z';

function pdf(pages: readonly string[], encrypted = false): Buffer {
  const objects = new Map<number, string>();
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((text, index) => {
    const pageId = pageIds[index] ?? 0;
    const contentId = pageId + 1;
    const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    const stream = text === '' ? '' : `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  let encryptId: number | null = null;
  if (encrypted) {
    encryptId = 4 + pages.length * 2;
    objects.set(encryptId, `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'00'.repeat(32)}> /U <${'11'.repeat(32)}> /P -4 >>`);
  }

  let body = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = new Map<number, number>();
  for (const [id, value] of [...objects].sort((a, b) => a[0] - b[0])) {
    offsets.set(id, Buffer.byteLength(body, 'binary'));
    body += `${id} 0 obj\n${value}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, 'binary');
  const size = Math.max(...objects.keys()) + 1;
  body += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) {
    body += `${String(offsets.get(id) ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${size} /Root 1 0 R${encryptId === null ? '' : ` /Encrypt ${encryptId} 0 R /ID [<${'22'.repeat(16)}><${'22'.repeat(16)}>]`} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

function rewriteClassicXref(
  value: Buffer,
  rewrite: (rows: readonly string[]) => string,
): Buffer {
  const source = value.toString('binary');
  const table = /xref\n0 6\n((?:[0-9]{10} [0-9]{5} [nf] \n){6})trailer/u.exec(source);
  if (table?.index === undefined || table[1] === undefined) throw new Error('expected classic test xref');
  const rows = table[1].match(/[0-9]{10} [0-9]{5} [nf] \n/gu);
  if (rows?.length !== 6) throw new Error('expected six classic test xref rows');
  return Buffer.from(
    `${source.slice(0, table.index)}${rewrite(rows)}${source.slice(table.index + table[0].length)}`,
    'binary',
  );
}

function xrefOffset(row: string): number {
  return Number(row.slice(0, 10));
}

function withXrefOffset(row: string, offset: number): string {
  return `${String(offset).padStart(10, '0')}${row.slice(10)}`;
}

function xrefTable(header: string, rows: readonly string[]): string {
  return `xref\n${header}\n${rows.join('')}trailer`;
}

interface ZipPart {
  readonly name: string;
  readonly data: Buffer;
  readonly encrypted?: boolean;
  readonly deflate?: boolean;
  readonly declaredLocalUncompressedBytes?: number;
  readonly declaredCentralUncompressedBytes?: number;
  readonly declaredChecksum?: number;
  readonly dataDescriptor?: boolean;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(parts: readonly ZipPart[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name, 'utf8');
    const compressed = part.deflate === true ? deflateRawSync(part.data) : part.data;
    const flags = (part.encrypted === true ? 1 : 0) | (part.dataDescriptor === true ? 8 : 0);
    const method = part.deflate === true ? 8 : 0;
    const checksum = part.declaredChecksum ?? crc32(part.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(part.declaredLocalUncompressedBytes ?? part.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(part.declaredCentralUncompressedBytes ?? part.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

const CONTENT_TYPES = Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
const ROOT_RELS = Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
const DOCUMENT_RELS = Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
const DOCUMENT = Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Atlas is owned by Priya.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Service</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Billing</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Dana</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>');

function docx(
  extra: readonly ZipPart[] = [],
  document = DOCUMENT,
  contentTypes = CONTENT_TYPES,
): Buffer {
  return zip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/document.xml', data: document },
    { name: 'word/_rels/document.xml.rels', data: DOCUMENT_RELS },
    ...extra,
  ]);
}

function multipart(boundary: string, parts: readonly {
  readonly name: string;
  readonly value: Buffer | string;
  readonly filename?: string;
  readonly contentType?: string;
}[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = `Content-Disposition: form-data; name="${part.name}"${part.filename === undefined ? '' : `; filename="${part.filename}"`}`;
    const type = part.contentType === undefined ? '' : `\r\nContent-Type: ${part.contentType}`;
    chunks.push(Buffer.from(`--${boundary}\r\n${disposition}${type}\r\n\r\n`));
    chunks.push(typeof part.value === 'string' ? Buffer.from(part.value) : part.value);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function multipartRequest(body: Buffer, boundary = 'lacuna-test-boundary', declaredLength = true): MultipartRequestStream {
  const stream = Readable.from([body]) as MultipartRequestStream & { headers: Record<string, string> };
  stream.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    ...(declaredLength ? { 'content-length': String(body.length) } : {}),
  };
  return stream;
}

class DelayedTerminationWorker extends EventEmitter {
  readonly #termination: Promise<number>;
  #confirmTermination!: () => void;
  #timer: ReturnType<typeof setInterval> | undefined;
  ticks = 0;

  constructor() {
    super();
    this.#termination = new Promise<number>((resolve) => {
      this.#confirmTermination = () => {
        if (this.#timer === undefined) return;
        clearInterval(this.#timer);
        this.#timer = undefined;
        this.emit('exit', 1);
        resolve(1);
      };
    });
    this.#timer = setInterval(() => {
      this.ticks += 1;
    }, 1);
  }

  postMessage(): void {
    // The deterministic timeout case intentionally never returns a parser result.
  }

  terminate(): Promise<number> {
    return this.#termination;
  }

  confirmTermination(): void {
    this.#confirmTermination();
  }
}

class RejectingTerminationWorker extends EventEmitter {
  postMessage(): void {
    // The isolation timeout drives termination in this deterministic fake.
  }

  terminate(): Promise<number> {
    return Promise.reject(new Error('termination rejected'));
  }
}

class UnconfirmedTerminationWorker extends EventEmitter {
  postMessage(): void {
    // The isolation timeout drives termination in this deterministic fake.
  }

  terminate(): Promise<number> {
    return new Promise<number>(() => undefined);
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await delay(5);
  if (!predicate()) throw new Error('test condition timed out');
}

describe('uploaded text and Markdown', () => {
  it('fatal-decodes and normalizes text while retaining distinct raw and normalized digests', async () => {
    const prepared = await parseUploadedFile({
      filename: 'notes.txt',
      mediaType: 'text/plain',
      bytes: Buffer.from('\ufeffa: Atlas is owned by Priya.\r\n', 'utf8'),
      observedAt: OBSERVED_AT,
    });

    expect(prepared).toMatchObject({
      filename: 'notes.txt',
      title: 'notes',
      type: 'text',
      parserVersion: FILE_PARSER_VERSION,
      text: 'a: Atlas is owned by Priya.\n',
      characters: 28,
    });
    expect(prepared.rawDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(prepared.normalizedDigest).toBe(prepared.document.contentDigest);
    expect(prepared.rawDigest).not.toBe(prepared.normalizedDigest);
  });

  it('validates bounded JSON uploads and keeps JSON provenance explicit', async () => {
    const prepared = await parseUploadedFile({
      filename: 'claims.json',
      mediaType: 'application/json',
      bytes: Buffer.from('{"owner":"Priya","active":true}\n', 'utf8'),
      observedAt: OBSERVED_AT,
    });

    expect(prepared).toMatchObject({
      type: 'text',
      mediaType: 'application/json',
      paragraphs: 1,
      text: '{"owner":"Priya","active":true}\n',
    });
    expect(prepared.document.provenance).toMatchObject({
      connectorId: 'text',
      mediaType: 'application/json',
      sourceUrl: null,
      observedAt: OBSERVED_AT,
    });
  });

  it('validates CSV quoting and reports row count without rewriting source bytes', async () => {
    const prepared = await parseUploadedFile({
      filename: 'claims.csv',
      mediaType: 'text/csv',
      bytes: Buffer.from('owner,note\nPriya,"keeps, context"\n', 'utf8'),
      observedAt: OBSERVED_AT,
    });

    expect(prepared).toMatchObject({
      type: 'text',
      mediaType: 'text/csv',
      paragraphs: 2,
      text: 'owner,note\nPriya,"keeps, context"\n',
    });
    expect(prepared.document.provenance.mediaType).toBe('text/csv');
  });

  it.each([
    ['claims.json', 'application/json', '{"owner":', 'invalid_file'],
    ['claims.csv', 'text/csv', 'owner,"unterminated\n', 'invalid_file'],
    ['claims.csv', 'text/csv', 'owner,"closed"tail\n', 'invalid_file'],
  ] as const)('rejects malformed structured file %s with a stable code', async (filename, mediaType, text, code) => {
    await expect(parseUploadedFile({
      filename,
      mediaType,
      bytes: Buffer.from(text, 'utf8'),
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code });
  });

  it.each([
    ['../notes.txt', 'invalid_filename'],
    ['notes.pdf.txt', 'invalid_filename'],
    ['notes.ExE.backup.txt', 'invalid_filename'],
    ['notes.ExE .backup.txt', 'invalid_filename'],
    ['CON.txt', 'invalid_filename'],
    [' CoN .txt', 'invalid_filename'],
    ['NUL.notes.txt', 'invalid_filename'],
    ['notes.txt', 'invalid_utf8', Buffer.from([0xc3, 0x28])],
    ['notes.md', 'invalid_file', Buffer.from('a\u0000b')],
    ['notes.txt', 'invalid_file', Buffer.from('a\u0001b')],
    ['notes.txt', 'invalid_file', Buffer.from('%PDF-1.7')],
  ] as const)('rejects unsafe %s input with a stable code', async (filename, code, bytes = Buffer.from('safe')) => {
    await expect(parseUploadedFile({
      filename,
      mediaType: filename.endsWith('.md') ? 'text/markdown' : 'text/plain',
      bytes,
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code });
  });

  it('rejects prepared output above the actual extractor limit instead of previewing a prefix', async () => {
    await expect(parseUploadedFile({
      filename: 'too-long.md',
      mediaType: 'text/markdown',
      bytes: Buffer.from(`a: ${'x'.repeat(20_000)}`),
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'document_too_long', status: 422 });
  });

  it('uses only stable redacted parser errors', () => {
    const error = new FileConnectorError('parse_failed', 422);
    expect(error.message).toBe('parse_failed');
    expect(JSON.stringify(error)).not.toContain('provider');
  });

  it('requires the advisory MIME declaration to agree with the selected extension policy', async () => {
    await expect(parseUploadedFile({
      filename: 'notes.md',
      mediaType: 'application/pdf',
      bytes: Buffer.from('# Notes'),
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'unsupported_file' });
  });

  it('keeps ordinary multi-suffix document names usable', async () => {
    const prepared = await parseUploadedFile({
      filename: 'runbook.v2.final.md',
      mediaType: 'text/markdown',
      bytes: Buffer.from('# Safe'),
      observedAt: OBSERVED_AT,
    });

    expect(prepared.title).toBe('runbook.v2.final');
  });
});

describe('bounded PDF extraction', () => {
  it('extracts text in page order through the Node-compatible PDF parser', async () => {
    const prepared = await parseUploadedFile({
      filename: 'brief.pdf',
      mediaType: 'application/pdf',
      bytes: pdf(['First page', 'Second page']),
      observedAt: OBSERVED_AT,
    });

    expect(prepared.type).toBe('pdf');
    expect(prepared.pages).toBe(2);
    expect(prepared.text).toContain('First page');
    expect(prepared.text).toContain('Second page');
    expect(prepared.text.indexOf('First page')).toBeLessThan(prepared.text.indexOf('Second page'));
  });

  it.each([
    ['image-only', pdf(['']), 'empty_file'],
    ['encrypted', pdf(['secret'], true), 'parse_failed'],
    ['corrupt', Buffer.from('%PDF-not-a-document'), 'parse_failed'],
    ['polyglot', Buffer.concat([Buffer.from('MZ'), pdf(['text'])]), 'invalid_file'],
    ['appended-polyglot', Buffer.concat([pdf(['text']), zip([{ name: 'payload.txt', data: Buffer.from('payload') }])]), 'invalid_file'],
    ['too-many-pages', pdf(Array.from({ length: 101 }, () => 'page')), 'file_too_complex'],
  ] as const)('rejects %s PDF input with a stable code', async (_name, bytes, code) => {
    await expect(parseUploadedFile({
      filename: 'brief.pdf',
      mediaType: 'application/pdf',
      bytes,
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code });
  });

  it.each([
    ['payload with a fake terminal EOF', (value: Buffer) => {
      const xref = /startxref\n([0-9]+)\n%%EOF\n$/u.exec(value.toString('binary'))?.[1] ?? '0';
      return Buffer.concat([value, Buffer.from(`hidden-payload\nstartxref\n${xref}\n%%EOF\n`)]);
    }],
    ['missing startxref', (value: Buffer) => Buffer.from(value.toString('binary').replace(/startxref\n[0-9]+\n/u, ''), 'binary')],
    ['startxref pointing at a body object', (value: Buffer) => Buffer.from(value.toString('binary').replace(/startxref\n[0-9]+\n/u, 'startxref\n15\n'), 'binary')],
  ] as const)('rejects a PDF with %s instead of recovering it', async (_name, mutate) => {
    await expect(parseUploadedFile({
      filename: 'brief.pdf',
      mediaType: 'application/pdf',
      bytes: mutate(pdf(['text'])),
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'invalid_file' });
  });

  it('rejects one terminal marker when unreferenced payload follows the parsed trailer', async () => {
    const source = pdf(['text']).toString('binary');
    const terminal = /startxref\n([0-9]+)\n%%EOF\n$/u.exec(source);
    expect(terminal?.index).toBeTypeOf('number');
    const attack = Buffer.from(
      `${source.slice(0, terminal?.index)}unreferenced-payload\nstartxref\n${terminal?.[1]}\n%%EOF\n`,
      'binary',
    );

    await expect(parseUploadedFile({
      filename: 'single-marker.pdf',
      mediaType: 'application/pdf',
      bytes: attack,
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'invalid_file' });
  });

  it('rejects a malformed classic xref row before PDF recovery', async () => {
    const malformed = Buffer.from(
      pdf(['text']).toString('binary').replace('0000000000 65535 f \n', '000000000 65535 f \n'),
      'binary',
    );

    await expect(parseUploadedFile({
      filename: 'malformed-xref.pdf',
      mediaType: 'application/pdf',
      bytes: malformed,
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'invalid_file' });
  });

  it.each([
    ['wrong in-body offset', rewriteClassicXref(pdf(['text']), (rows) => {
      const changed = [...rows];
      changed[1] = withXrefOffset(rows[1] ?? '', xrefOffset(rows[1] ?? '') + 1);
      return xrefTable('0 6', changed);
    })],
    ['out-of-range offset', rewriteClassicXref(pdf(['text']), (rows) => {
      const changed = [...rows];
      changed[1] = withXrefOffset(rows[1] ?? '', 9_999_999_999);
      return xrefTable('0 6', changed);
    })],
    ['mismatched object offsets', rewriteClassicXref(pdf(['text']), (rows) => {
      const changed = [...rows];
      changed[1] = withXrefOffset(rows[1] ?? '', xrefOffset(rows[2] ?? ''));
      changed[2] = withXrefOffset(rows[2] ?? '', xrefOffset(rows[1] ?? ''));
      return xrefTable('0 6', changed);
    })],
    ['duplicate in-use offset', rewriteClassicXref(pdf(['text']), (rows) => {
      const changed = [...rows];
      changed[2] = withXrefOffset(rows[2] ?? '', xrefOffset(rows[1] ?? ''));
      return xrefTable('0 6', changed);
    })],
    ['overlapping subsection ranges', rewriteClassicXref(pdf(['text']), (rows) => (
      `xref\n0 3\n${rows.slice(0, 3).join('')}2 4\n${rows.slice(2).join('')}trailer`
    ))],
    ['missing object zero', rewriteClassicXref(pdf(['text']), (rows) => xrefTable('1 5', rows.slice(1)))],
    ['invalid object-zero generation', rewriteClassicXref(pdf(['text']), (rows) => {
      const changed = [...rows];
      changed[0] = '0000000000 00000 f \n';
      return xrefTable('0 6', changed);
    })],
    ['bad trailer Size', Buffer.from(pdf(['text']).toString('binary').replace('/Size 6', '/Size 5'), 'binary')],
  ] as const)('rejects a lexically valid classic xref with %s', async (_label, bytes) => {
    await expect(parseUploadedFile({
      filename: 'semantic-xref.pdf',
      mediaType: 'application/pdf',
      bytes,
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'invalid_file' });
  });

  it.each([
    ['Prev separated by a comment', '/Prev% hidden value\n123'],
    ['escaped Prev', '/Pr#65v 123'],
    ['XRefStm separated by a comment', '/XRefStm% hidden value\n123'],
    ['escaped XRefStm', '/XRef#53tm 123'],
    ['duplicate Size', '/Size 6'],
  ] as const)('rejects a trailer with %s', async (_label, trailerEntry) => {
    const bytes = Buffer.from(
      pdf(['text']).toString('binary').replace('/Size 6 /Root 1 0 R', `/Size 6 /Root 1 0 R ${trailerEntry}`),
      'binary',
    );

    await expect(parseUploadedFile({
      filename: 'trailer-name.pdf',
      mediaType: 'application/pdf',
      bytes,
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'invalid_file' });
  });

  it('does not treat a nested case-exact Prev name as a top-level trailer key', async () => {
    const bytes = Buffer.from(
      pdf(['text']).toString('binary').replace('/Size 6 /Root 1 0 R', '/Size 6 /Root 1 0 R /Metadata << /Prev 123 >>'),
      'binary',
    );
    const prepared = await parseUploadedFile({
      filename: 'nested-trailer.pdf',
      mediaType: 'application/pdf',
      bytes,
      observedAt: OBSERVED_AT,
    });

    expect(prepared.document.text).toBe('text');
  });

  it('allows only PDF whitespace and comments between the classic trailer and terminal marker', async () => {
    const withTrivia = Buffer.from(
      pdf(['text']).toString('binary').replace('startxref\n', '% approved trailer comment\nstartxref\n'),
      'binary',
    );
    const prepared = await parseUploadedFile({
      filename: 'commented.pdf',
      mediaType: 'application/pdf',
      bytes: withTrivia,
      observedAt: OBSERVED_AT,
    });

    expect(prepared.document.text).toBe('text');
  });

  it('terminates isolated parser work before returning a timeout failure', async () => {
    const ticks = new Int32Array(new SharedArrayBuffer(4));
    let worker: Worker | undefined;
    let inheritedExecArgv: readonly string[] | undefined;

    await expect(parseUploadedFile({
      filename: 'brief.pdf',
      mediaType: 'application/pdf',
      bytes: pdf(['text']),
      observedAt: OBSERVED_AT,
    }, {
      timeoutMs: 40,
      workerFactory: (_url, options) => {
        inheritedExecArgv = options.execArgv;
        worker = new Worker(`
          const { workerData } = require('node:worker_threads');
          const ticks = new Int32Array(workerData);
          setInterval(() => Atomics.add(ticks, 0, 1), 1);
        `, { eval: true, workerData: ticks.buffer });
        return worker;
      },
    })).rejects.toMatchObject({ code: 'file_too_complex' });

    expect(inheritedExecArgv).toEqual([]);
    expect(worker?.threadId).toBe(-1);
    const stoppedAt = Atomics.load(ticks, 0);
    await delay(75);
    expect(Atomics.load(ticks, 0)).toBe(stoppedAt);
  });

  it('keeps a timed-out request pending until delayed termination is confirmed', async () => {
    const fake = new DelayedTerminationWorker();
    let settled = false;
    const parsing = parseUploadedFile({
      filename: 'brief.pdf',
      mediaType: 'application/pdf',
      bytes: pdf(['text']),
      observedAt: OBSERVED_AT,
    }, {
      timeoutMs: 20,
      workerFactory: () => fake as unknown as Worker,
    });
    void parsing.then(() => { settled = true; }, () => { settled = true; });

    let settledBeforeExit = true;
    try {
      await delay(550);
      settledBeforeExit = settled;
      expect(() => {
        fake.emit('error', new Error('late worker error'));
        fake.emit('error', new Error('second late worker error'));
      }).not.toThrow();
    } finally {
      fake.confirmTermination();
    }
    await expect(parsing).rejects.toMatchObject({ code: 'file_too_complex' });
    expect(settledBeforeExit).toBe(false);
    const stoppedAt = fake.ticks;
    await delay(50);
    expect(fake.ticks).toBe(stoppedAt);
  });

  it('fail-stops rejected termination without releasing live leases and isolates a new instance', async () => {
    const input = {
      filename: 'brief.pdf',
      mediaType: 'application/pdf',
      bytes: pdf(['text']),
      observedAt: OBSERVED_AT,
    };
    let fatalCalls = 0;
    const processDeath = new Error('simulated process death');
    const failedIsolation: FileParserIsolationOptions = {
      timeoutMs: 10,
      acquireTimeoutMs: 20,
      fatalIsolationFailure: () => {
        fatalCalls += 1;
        throw processDeath;
      },
      workerFactory: () => new RejectingTerminationWorker() as unknown as Worker,
    };
    const stuck = [
      parseUploadedFile(input, failedIsolation),
      parseUploadedFile(input, failedIsolation),
    ];
    const results = await Promise.race([
      Promise.allSettled(stuck),
      delay(1_000).then(() => null),
    ]);
    if (results === null) throw new Error('fail-stop seam was not invoked');
    expect(results).toEqual([
      { status: 'rejected', reason: processDeath },
      { status: 'rejected', reason: processDeath },
    ]);
    expect(fatalCalls).toBe(2);
    await expect(parseUploadedFile(input, failedIsolation)).rejects.toMatchObject({ code: 'file_too_complex' });

    const fresh = await parseUploadedFile(input, {});
    expect(fresh.document.text).toBe('text');
  });

  it('fail-stops when termination cannot be confirmed before the watchdog', async () => {
    let fatalCalls = 0;
    const processDeath = new Error('simulated watchdog process death');
    const parsing = parseUploadedFile({
      filename: 'brief.pdf',
      mediaType: 'application/pdf',
      bytes: pdf(['text']),
      observedAt: OBSERVED_AT,
    }, {
      timeoutMs: 10,
      // Its own threshold, so the assertion is about the fail-stop firing
      // rather than about how quickly the machine reaps a worker thread.
      terminationWatchdogMs: 50,
      fatalIsolationFailure: () => {
        fatalCalls += 1;
        throw processDeath;
      },
      workerFactory: () => new UnconfirmedTerminationWorker() as unknown as Worker,
    });
    const result = await Promise.race([
      parsing.then(() => ({ status: 'fulfilled' as const }), (reason: unknown) => ({ status: 'rejected' as const, reason })),
      delay(1_000).then(() => null),
    ]);

    expect(result).toEqual({ status: 'rejected', reason: processDeath });
    expect(fatalCalls).toBe(1);
  });

  it('runs at most two isolated parsers for one service isolation instance', async () => {
    const counts = new Int32Array(new SharedArrayBuffer(8));
    const releases = new Int32Array(new SharedArrayBuffer(12));
    let workerIndex = 0;
    const isolation: FileParserIsolationOptions = {
      timeoutMs: 1_000,
      acquireTimeoutMs: 40,
      workerFactory: (_url, options) => {
        const index = workerIndex;
        workerIndex += 1;
        return new Worker(`
          const { parentPort, workerData } = require('node:worker_threads');
          const counts = new Int32Array(workerData.counts);
          const releases = new Int32Array(workerData.releases);
          parentPort.once('message', () => {
            const active = Atomics.add(counts, 0, 1) + 1;
            let observed = Atomics.load(counts, 1);
            while (active > observed && Atomics.compareExchange(counts, 1, observed, active) !== observed) {
              observed = Atomics.load(counts, 1);
            }
            const timer = setInterval(() => {
              if (Atomics.load(releases, workerData.index) !== 1) return;
              clearInterval(timer);
              Atomics.sub(counts, 0, 1);
              parentPort.postMessage({ ok: true, value: { text: 'queued', pages: 1, paragraphs: 1, tables: 0 } });
            }, 1);
          });
        `, {
          ...options,
          eval: true,
          workerData: { counts: counts.buffer, releases: releases.buffer, index },
        });
      },
    };
    const input = {
      filename: 'brief.pdf',
      mediaType: 'application/pdf',
      bytes: pdf(['text']),
      observedAt: OBSERVED_AT,
    };
    const runs = [
      parseUploadedFile(input, isolation),
      parseUploadedFile(input, isolation),
    ];

    await waitUntil(() => Atomics.load(counts, 0) === 2);
    await expect(parseUploadedFile(input, isolation)).rejects.toMatchObject({ code: 'file_too_complex' });
    const maximum = Atomics.load(counts, 1);
    Atomics.store(releases, 0, 1);
    Atomics.store(releases, 1, 1);
    await Promise.all(runs);

    expect(maximum).toBe(2);
    expect(Atomics.load(counts, 0)).toBe(0);
  });
});

describe('DOCX central-directory policy and extraction', () => {
  it('extracts paragraphs and table text only after ZIP preflight', async () => {
    const prepared = await parseUploadedFile({
      filename: 'runbook.docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docx(),
      observedAt: OBSERVED_AT,
    });

    expect(prepared.type).toBe('docx');
    expect(prepared.paragraphs).toBeGreaterThanOrEqual(3);
    expect(prepared.tables).toBe(1);
    expect(prepared.text).toContain('Atlas is owned by Priya.');
    expect(prepared.text).toContain('Billing');
    expect(prepared.text).toContain('Dana');
  });

  it.each([
    ['corrupt', Buffer.from('PK\u0003\u0004broken'), 'parse_failed'],
    ['encrypted', docx([{ name: 'word/encrypted.bin', data: Buffer.from('x'), encrypted: true }]), 'invalid_file'],
    ['macro', docx([{ name: 'word/vbaProject.bin', data: Buffer.from('macro') }]), 'invalid_file'],
    ['traversal', docx([{ name: '../outside.xml', data: Buffer.from('<x/>') }]), 'invalid_file'],
    ['duplicate', docx([{ name: 'WORD/DOCUMENT.XML', data: DOCUMENT }]), 'invalid_file'],
    ['wrong-crc', docx([{ name: 'word/styles.xml', data: Buffer.from('<styles/>'), declaredChecksum: 0 }]), 'invalid_file'],
    ['data-descriptor', docx([{ name: 'word/styles.xml', data: Buffer.from('<styles/>'), dataDescriptor: true }]), 'invalid_file'],
    ['external-rel', docx([{ name: 'word/_rels/header1.xml.rels', data: Buffer.from('<Relationships><Relationship TargetMode="External" Target="https://secret.invalid/x"/></Relationships>') }]), 'invalid_file'],
    ['encoded-external-rel', docx([{ name: 'word/_rels/header1.xml.rels', data: Buffer.from('<Relationships><Relationship TargetMode="Exter&#110;al" Target="https://secret.invalid/x"/></Relationships>') }]), 'invalid_file'],
    ['ole-content-type', docx(
      [{ name: 'custom/payload.dat', data: Buffer.from('payload') }],
      DOCUMENT,
      Buffer.from(CONTENT_TYPES.toString('utf8').replace(
        '</Types>',
        '<Override PartName="/custom/payload.dat" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/></Types>',
      )),
    ), 'invalid_file'],
    ['zip-bomb', docx([{ name: 'word/media/repeated.bin', data: Buffer.alloc(200_000, 0x41), deflate: true }]), 'file_too_complex'],
  ] as const)('rejects %s DOCX input before text extraction', async (_name, bytes, code) => {
    await expect(parseUploadedFile({
      filename: 'runbook.docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes,
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code });
  });

  it.each([
    ['styles', 'word/styles.xml'],
    ['numbering', 'word/numbering.xml'],
    ['notes', 'word/footnotes.xml'],
  ] as const)('streams actual forged %s expansion before text extraction can consume it', async (_label, name) => {
    const expansion = Buffer.concat([
      Buffer.from('<?xml version="1.0"?><root>'),
      Buffer.alloc(200_000, 0x20),
      Buffer.from('</root>'),
    ]);
    await expect(parseUploadedFile({
      filename: 'forged.docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docx([{
        name,
        data: expansion,
        deflate: true,
        declaredLocalUncompressedBytes: 1,
        declaredCentralUncompressedBytes: 1,
      }]),
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'file_too_complex' });
  });

  it('rejects a forged central size before opening a stream whose local header disagrees', async () => {
    await expect(parseUploadedFile({
      filename: 'central-only.docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docx([{
        name: 'word/styles.xml',
        data: Buffer.from('<styles/>'),
        deflate: true,
        declaredCentralUncompressedBytes: 1,
      }]),
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'invalid_file' });
  });

  it('rejects contradictory local and central sizes before opening a deflate stream', async () => {
    const expansion = Buffer.concat([
      Buffer.from('<?xml version="1.0"?><root>'),
      Buffer.alloc(200_000, 0x20),
      Buffer.from('</root>'),
    ]);
    await expect(parseUploadedFile({
      filename: 'contradictory.docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docx([{
        name: 'word/styles.xml',
        data: expansion,
        deflate: true,
        declaredLocalUncompressedBytes: 1,
        declaredCentralUncompressedBytes: 2,
      }]),
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'invalid_file' });
  });

  it.each([
    ['alternate', Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/alternate.xml"/></Relationships>')],
    ['encoded', Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/%64ocument.xml"/></Relationships>')],
    ['conflicting', Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/alternate.xml"/></Relationships>')],
  ] as const)('rejects an %s package main-document relationship', async (_label, rootRelationships) => {
    const alternate = Buffer.from(DOCUMENT.toString('utf8').replace('Atlas is owned by Priya.', 'Alternate payload.'));
    const bytes = zip([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: '_rels/.rels', data: rootRelationships },
      { name: 'word/document.xml', data: DOCUMENT },
      { name: 'word/alternate.xml', data: alternate },
      { name: 'word/_rels/document.xml.rels', data: DOCUMENT_RELS },
    ]);

    await expect(parseUploadedFile({
      filename: 'alternate.docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes,
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'invalid_file' });
  });
});

describe('streaming multipart acquisition', () => {
  it('accepts exactly one bounded file and the one import token field', async () => {
    const boundary = 'one-file';
    const body = multipart(boundary, [
      { name: 'file', filename: 'notes.md', contentType: 'text/markdown', value: Buffer.from('# Notes') },
      { name: 'preview_token', value: 'signed.preview.token' },
    ]);

    const parsed = await readMultipartFile(multipartRequest(body, boundary), 'import');

    expect(parsed).toEqual({
      file: { filename: 'notes.md', mediaType: 'text/markdown', bytes: Buffer.from('# Notes') },
      previewToken: 'signed.preview.token',
    });
  });

  it.each([
    ['second-file', [
      { name: 'file', filename: 'one.txt', value: Buffer.from('one') },
      { name: 'file', filename: 'two.txt', value: Buffer.from('two') },
    ], 'invalid_multipart'],
    ['unexpected-part', [
      { name: 'file', filename: 'one.txt', value: Buffer.from('one') },
      { name: 'workspace', value: 'attacker-workspace' },
    ], 'invalid_multipart'],
    ['duplicate-token', [
      { name: 'file', filename: 'one.txt', value: Buffer.from('one') },
      { name: 'preview_token', value: 'a' },
      { name: 'preview_token', value: 'b' },
    ], 'invalid_multipart'],
  ] as const)('rejects %s multipart input once', async (_name, parts, code) => {
    const boundary = `bad-${_name}`;
    await expect(readMultipartFile(multipartRequest(multipart(boundary, parts), boundary), 'import'))
      .rejects.toMatchObject({ code });
  });

  it('rejects missing boundaries, partial streams, declared request overflow, and independent file overflow', async () => {
    const missing = Readable.from([Buffer.from('not multipart')]) as MultipartRequestStream & { headers: Record<string, string> };
    missing.headers = { 'content-type': 'multipart/form-data' };
    await expect(readMultipartFile(missing, 'preview')).rejects.toMatchObject({ code: 'invalid_multipart' });

    const partialBoundary = 'partial';
    const partial = multipart(partialBoundary, [
      { name: 'file', filename: 'one.txt', value: Buffer.from('one') },
    ]).subarray(0, -8);
    await expect(readMultipartFile(multipartRequest(partial, partialBoundary), 'preview'))
      .rejects.toMatchObject({ code: 'invalid_multipart' });

    const tooLarge = multipartRequest(Buffer.from('ignored'));
    (tooLarge.headers as Record<string, string>)['content-length'] = String(MAX_FILE_BYTES + 1);
    await expect(readMultipartFile(tooLarge, 'preview')).rejects.toMatchObject({ code: 'request_too_large' });

    await expect(parseUploadedFile({
      filename: 'huge.txt',
      mediaType: 'text/plain',
      bytes: Buffer.alloc(MAX_FILE_BYTES + 1, 0x41),
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('retains hostile upload paths for rejection and validates declared and streamed request sizes', async () => {
    const pathBoundary = 'path-name';
    const pathBody = multipart(pathBoundary, [
      { name: 'file', filename: '../notes.txt', contentType: 'text/plain', value: Buffer.from('notes') },
    ]);
    const hostilePath = await readMultipartFile(multipartRequest(pathBody, pathBoundary), 'preview');
    await expect(parseUploadedFile({ ...hostilePath.file, observedAt: OBSERVED_AT }))
      .rejects.toMatchObject({ code: 'invalid_filename' });

    const lengthBoundary = 'wrong-length';
    const lengthBody = multipart(lengthBoundary, [
      { name: 'file', filename: 'notes.txt', contentType: 'text/plain', value: Buffer.from('notes') },
    ]);
    const wrongLength = multipartRequest(lengthBody, lengthBoundary);
    (wrongLength.headers as Record<string, string>)['content-length'] = String(lengthBody.length - 1);
    await expect(readMultipartFile(wrongLength, 'preview'))
      .rejects.toMatchObject({ code: 'invalid_multipart' });

    const chunkedBoundary = 'chunked-request-cap';
    const chunked = multipart(chunkedBoundary, [
      { name: 'file', filename: 'notes.txt', contentType: 'text/plain', value: Buffer.alloc(MAX_FILE_BYTES, 0x41) },
    ]);
    expect(chunked.length).toBeGreaterThan(MAX_MULTIPART_BYTES);
    await expect(readMultipartFile(multipartRequest(chunked, chunkedBoundary, false), 'preview'))
      .rejects.toMatchObject({ code: 'request_too_large' });
  });

  it('releases the multipart parser and fails once when the request aborts', async () => {
    const aborted = new Readable({ read() {} }) as MultipartRequestStream & { headers: Record<string, string> };
    aborted.headers = { 'content-type': 'multipart/form-data; boundary=aborted-request' };

    const reading = readMultipartFile(aborted, 'preview');
    aborted.emit('aborted');

    await expect(reading).rejects.toMatchObject({ code: 'invalid_multipart' });
    expect(aborted.isPaused()).toBe(true);
  });
});

describe('file preview tokens', () => {
  const key = Buffer.alloc(32, 0x5a);
  const binding = {
    sessionBinding: 'a'.repeat(64),
    workspaceDigest: 'b'.repeat(64),
    rawDigest: 'c'.repeat(64),
    normalizedDigest: 'd'.repeat(64),
    parserVersion: FILE_PARSER_VERSION,
    type: 'markdown' as const,
    title: 'notes',
  };

  it('accepts only dedicated key material of at least 32 bytes', () => {
    expect(previewSigningKey(undefined)).toBeNull();
    expect(previewSigningKey('short')).toBeNull();
    expect(previewSigningKey('ab'.repeat(31))).toBeNull();
    expect(previewSigningKey('ab'.repeat(32))).toEqual(Buffer.alloc(32, 0xab));
    expect(previewSigningKey(Buffer.alloc(32, 0xcd).toString('base64url'))).toEqual(Buffer.alloc(32, 0xcd));
  });

  it('binds exact policy and consumes a valid token once', () => {
    let now = Date.parse(OBSERVED_AT);
    const tokens = new FilePreviewTokenService({
      key,
      now: () => now,
      nonce: () => Buffer.alloc(18, 0x31),
    });
    const issued = tokens.issue(binding);

    expect(issued.expiresAt).toBe('2026-08-21T12:05:00.000Z');
    expect(tokens.verifyAndConsume(issued.token, binding)).toBeUndefined();
    expect(() => tokens.verifyAndConsume(issued.token, binding))
      .toThrow(new PreviewTokenError('preview_replayed'));

    now += 1;
  });

  it('rejects tamper, expiry, and every changed binding before consumption', () => {
    let now = Date.parse(OBSERVED_AT);
    let nonceByte = 1;
    const tokens = new FilePreviewTokenService({
      key,
      now: () => now,
      nonce: () => Buffer.alloc(18, nonceByte++),
    });
    const tampered = tokens.issue(binding).token;
    expect(() => tokens.verifyAndConsume(`${tampered.slice(0, -1)}x`, binding))
      .toThrow(new PreviewTokenError('preview_invalid'));

    for (const changed of [
      { ...binding, sessionBinding: 'e'.repeat(64) },
      { ...binding, workspaceDigest: 'e'.repeat(64) },
      { ...binding, rawDigest: 'e'.repeat(64) },
      { ...binding, normalizedDigest: 'e'.repeat(64) },
      { ...binding, parserVersion: 'files-v0' },
      { ...binding, type: 'text' as const },
      { ...binding, title: 'other' },
    ]) {
      const issued = tokens.issue(binding);
      expect(() => tokens.verifyAndConsume(issued.token, changed))
        .toThrow(new PreviewTokenError('preview_invalid'));
    }

    const expired = tokens.issue(binding).token;
    now += 300_001;
    expect(() => tokens.verifyAndConsume(expired, binding))
      .toThrow(new PreviewTokenError('preview_expired'));
  });

  it('rejects a non-canonical base64url signature alias before consuming the nonce', () => {
    const tokens = new FilePreviewTokenService({
      key,
      now: () => Date.parse(OBSERVED_AT),
      nonce: () => Buffer.alloc(18, 0x42),
    });
    const issued = tokens.issue(binding).token;
    const [payload, signature = ''] = issued.split('.');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const final = signature.at(-1) ?? '';
    const index = alphabet.indexOf(final);
    const alias = `${signature.slice(0, -1)}${alphabet[(index & ~3) | ((index + 1) & 3)] ?? ''}`;

    expect(Buffer.from(alias, 'base64url')).toEqual(Buffer.from(signature, 'base64url'));
    expect(() => tokens.verifyAndConsume(`${payload}.${alias}`, binding))
      .toThrow(new PreviewTokenError('preview_invalid'));
    expect(tokens.verifyAndConsume(issued, binding)).toBeUndefined();
  });
});
