import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  FILE_PARSER_VERSION,
  FileConnectorError,
  MAX_FILE_BYTES,
  MAX_MULTIPART_BYTES,
  parseUploadedFile,
  readMultipartFile,
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

interface ZipPart {
  readonly name: string;
  readonly data: Buffer;
  readonly encrypted?: boolean;
  readonly deflate?: boolean;
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
    const flags = part.encrypted === true ? 1 : 0;
    const method = part.deflate === true ? 8 : 0;
    const checksum = crc32(part.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(part.data.length, 22);
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
    directory.writeUInt32LE(part.data.length, 24);
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

  it.each([
    ['../notes.txt', 'invalid_filename'],
    ['notes.pdf.txt', 'invalid_filename'],
    ['CON.txt', 'invalid_filename'],
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
  ] as const)('rejects %s DOCX input before Mammoth', async (_name, bytes, code) => {
    await expect(parseUploadedFile({
      filename: 'runbook.docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes,
      observedAt: OBSERVED_AT,
    })).rejects.toMatchObject({ code });
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
});
