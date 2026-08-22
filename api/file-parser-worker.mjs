import { parentPort } from 'node:worker_threads';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_CHARS = 20_000;
const MAX_FILENAME_BYTES = 240;
const MAX_PDF_PAGES = 100;
const MAX_PDF_ITEMS = 20_000;
const MAX_DOCX_ENTRIES = 256;
const MAX_DOCX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 2 * 1024 * 1024;
const MAX_DOCX_RELATIONSHIP_BYTES = 256 * 1024;
const MAX_DOCX_RATIO = 100;
const MAX_DOCX_PARAGRAPHS = 5_000;
const MAX_DOCX_TABLES = 500;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const XML_POLICY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const XML_ENTITY = /&(?:#(?:x[0-9a-f]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);/iu;
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP64_EOCD = Buffer.from([0x50, 0x4b, 0x06, 0x06]);
const ZIP64_LOCATOR = Buffer.from([0x50, 0x4b, 0x06, 0x07]);
const OFFICE_DOCUMENT_TYPES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
]);
const MAIN_DOCUMENT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const SAFE_CODES = new Set([
  'invalid_file',
  'parse_failed',
  'file_too_complex',
  'empty_file',
  'document_too_long',
]);

class ParserPolicyError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ParserPolicyError(code);
}

function begins(bytes, magic) {
  return bytes.length >= magic.length && bytes.subarray(0, magic.length).equals(magic);
}

function skipPdfTrivia(source, initial, end = source.length) {
  let cursor = initial;
  while (cursor < end) {
    if (/^[\x00\t\n\f\r ]$/u.test(source[cursor] ?? '')) {
      cursor += 1;
      continue;
    }
    if (source[cursor] !== '%') break;
    while (cursor < end && source[cursor] !== '\r' && source[cursor] !== '\n') cursor += 1;
  }
  return cursor;
}

function isPdfWhitespace(character) {
  return character === '\x00' || character === '\t' || character === '\n'
    || character === '\f' || character === '\r' || character === ' ';
}

function isPdfDelimiter(character) {
  return character === '(' || character === ')' || character === '<' || character === '>'
    || character === '[' || character === ']' || character === '/' || character === '%';
}

function isPdfTokenEnd(source, cursor, end) {
  return cursor >= end || isPdfWhitespace(source[cursor]) || isPdfDelimiter(source[cursor]);
}

function parsePdfName(source, initial, end) {
  if (source[initial] !== '/') return null;
  let cursor = initial + 1;
  let name = '';
  while (cursor < end && !isPdfWhitespace(source[cursor]) && !isPdfDelimiter(source[cursor])) {
    if (source[cursor] === '#') {
      const encoded = source.slice(cursor + 1, cursor + 3);
      if (!/^[0-9A-Fa-f]{2}$/u.test(encoded)) return null;
      name += String.fromCharCode(Number.parseInt(encoded, 16));
      cursor += 3;
    } else {
      name += source[cursor];
      cursor += 1;
    }
    if (name.length > 256) return null;
  }
  return name.length === 0 ? null : { cursor, name };
}

function consumePdfString(source, initial, end) {
  let cursor = initial + 1;
  let depth = 1;
  while (cursor < end && depth > 0) {
    if (source[cursor] === '\\') cursor += 2;
    else {
      if (source[cursor] === '(') depth += 1;
      if (source[cursor] === ')') depth -= 1;
      cursor += 1;
    }
  }
  return depth === 0 ? cursor : -1;
}

function parsePdfNumber(source, initial, end) {
  const match = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)/u.exec(source.slice(initial, end));
  if (match === null || !isPdfTokenEnd(source, initial + match[0].length, end)) return null;
  const integer = /^[+-]?[0-9]+$/u.test(match[0]);
  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric)) return null;
  return { cursor: initial + match[0].length, integer, numeric };
}

function parsePdfValue(source, initial, end, depth, state) {
  if (depth > 16 || state.tokens >= 4_096) return null;
  state.tokens += 1;
  let cursor = skipPdfTrivia(source, initial, end);
  if (cursor >= end) return null;
  if (source.slice(cursor, cursor + 2) === '<<') return parsePdfDictionary(source, cursor, end, depth + 1, state);
  if (source[cursor] === '[') {
    const values = [];
    cursor += 1;
    while (cursor < end) {
      cursor = skipPdfTrivia(source, cursor, end);
      if (source[cursor] === ']') return { cursor: cursor + 1, kind: 'array', values };
      const value = parsePdfValue(source, cursor, end, depth + 1, state);
      if (value === null) return null;
      values.push(value);
      cursor = value.cursor;
    }
    return null;
  }
  if (source[cursor] === '(') {
    const stringEnd = consumePdfString(source, cursor, end);
    return stringEnd < 0 ? null : { cursor: stringEnd, kind: 'string' };
  }
  if (source[cursor] === '<') {
    const close = source.indexOf('>', cursor + 1);
    if (close < 0 || close >= end || !/^[0-9A-Fa-f\x00\t\n\f\r ]*$/u.test(source.slice(cursor + 1, close))) return null;
    return { cursor: close + 1, kind: 'hex' };
  }
  if (source[cursor] === '/') {
    const name = parsePdfName(source, cursor, end);
    return name === null ? null : { ...name, kind: 'name' };
  }
  for (const keyword of ['true', 'false', 'null']) {
    if (source.slice(cursor, cursor + keyword.length) === keyword
      && isPdfTokenEnd(source, cursor + keyword.length, end)) {
      return { cursor: cursor + keyword.length, kind: keyword };
    }
  }
  const number = parsePdfNumber(source, cursor, end);
  if (number === null) return null;
  if (number.integer) {
    const generationStart = skipPdfTrivia(source, number.cursor, end);
    const generation = parsePdfNumber(source, generationStart, end);
    if (generation?.integer === true && generation.numeric >= 0 && Number.isSafeInteger(generation.numeric)) {
      const reference = skipPdfTrivia(source, generation.cursor, end);
      if (source[reference] === 'R' && isPdfTokenEnd(source, reference + 1, end)) {
        return { cursor: reference + 1, kind: 'reference' };
      }
    }
  }
  return { cursor: number.cursor, kind: number.integer ? 'integer' : 'number', numeric: number.numeric };
}

function parsePdfDictionary(source, initial, end, depth = 0, state = { tokens: 0 }) {
  if (depth > 16 || source.slice(initial, initial + 2) !== '<<') return null;
  const entries = new Map();
  let cursor = initial + 2;
  while (cursor < end && cursor - initial <= 65_536) {
    cursor = skipPdfTrivia(source, cursor, end);
    if (source.slice(cursor, cursor + 2) === '>>') {
      return { cursor: cursor + 2, entries, kind: 'dictionary' };
    }
    const name = parsePdfName(source, cursor, end);
    if (name === null || entries.has(name.name)) return null;
    const value = parsePdfValue(source, name.cursor, end, depth + 1, state);
    if (value === null) return null;
    entries.set(name.name, value);
    cursor = value.cursor;
  }
  return null;
}

function xrefPointsToObject(source, xrefOffset, offset, objectNumber, generation) {
  if (offset < PDF_MAGIC.length || offset >= xrefOffset) return false;
  const header = /^([0-9]{1,10})[\x00\t\n\f\r ]+([0-9]{1,5})[\x00\t\n\f\r ]+obj(?=[\x00\t\n\f\r ()<>\[\]\/%])/u.exec(
    source.slice(offset, Math.min(xrefOffset, offset + 128)),
  );
  return header !== null && Number(header[1]) === objectNumber && Number(header[2]) === generation;
}

function parseClassicXref(source, xrefOffset, terminalStart) {
  let cursor = xrefOffset;
  if (source.slice(cursor, cursor + 4) !== 'xref') return null;
  cursor += 4;
  const xrefEnd = /^(?:[ \t]*(?:\r\n|\n|\r))/u.exec(source.slice(cursor, terminalStart));
  if (xrefEnd === null) return null;
  cursor += xrefEnd[0].length;
  let sections = 0;
  let entries = 0;
  let previousRangeEnd = -1;
  let highestObject = -1;
  let objectZeroFound = false;
  const inUseOffsets = new Set();
  while (cursor < terminalStart) {
    cursor = skipPdfTrivia(source, cursor, terminalStart);
    if (source.slice(cursor, cursor + 7) === 'trailer') break;
    const header = /^([0-9]{1,10})[ \t]+([0-9]{1,10})[ \t]*(?:\r\n|\n|\r)/u.exec(
      source.slice(cursor, terminalStart),
    );
    if (header === null) return null;
    const start = Number(header[1]);
    const count = Number(header[2]);
    const rangeEnd = start + count;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count)
      || !Number.isSafeInteger(rangeEnd) || count < 1 || start < 0
      || start < previousRangeEnd) return null;
    previousRangeEnd = rangeEnd;
    highestObject = rangeEnd - 1;
    sections += 1;
    entries += count;
    if (sections > 1_000 || entries > 100_000) return null;
    cursor += header[0].length;
    for (let index = 0; index < count; index += 1) {
      const entry = /^([0-9]{10})[ \t]+([0-9]{5})[ \t]+([nf])[ \t]*(?:\r\n|\n|\r)/u.exec(
        source.slice(cursor, terminalStart),
      );
      if (entry === null) return null;
      const objectNumber = start + index;
      const offset = Number(entry[1]);
      const generation = Number(entry[2]);
      const state = entry[3];
      if (objectNumber === 0) {
        if (objectZeroFound || state !== 'f' || offset !== 0 || generation !== 65_535) return null;
        objectZeroFound = true;
      } else if (state === 'n') {
        if (inUseOffsets.has(offset)
          || !xrefPointsToObject(source, xrefOffset, offset, objectNumber, generation)) return null;
        inUseOffsets.add(offset);
      }
      cursor += entry[0].length;
    }
  }
  if (sections === 0 || !objectZeroFound || source.slice(cursor, cursor + 7) !== 'trailer') return null;
  cursor = skipPdfTrivia(source, cursor + 7, terminalStart);
  const dictionaryStart = cursor;
  const dictionary = parsePdfDictionary(source, dictionaryStart, terminalStart);
  if (dictionary === null || dictionary.entries.has('Prev') || dictionary.entries.has('XRefStm')) return null;
  const size = dictionary.entries.get('Size');
  if (size?.kind !== 'integer' || !Number.isSafeInteger(size.numeric)
    || size.numeric !== highestObject + 1) return null;
  return { dictionaryEnd: dictionary.cursor };
}

function validatePdfEnvelope(bytes) {
  const source = bytes.toString('latin1');
  const marker = /(?:^|[\r\n])startxref[ \t]*(?=\r\n|\n|\r)/gu;
  if ([...source.matchAll(marker)].length !== 1) return false;
  const terminal = /startxref[ \t]*(?:\r\n|\n|\r)([0-9]{1,10})[ \t]*(?:\r\n|\n|\r)%%EOF[\x00\t\n\f\r ]*$/u.exec(source);
  const offsetText = terminal?.[1];
  if (terminal === null || offsetText === undefined || terminal.index === undefined) return false;
  const terminalStart = terminal.index;
  const xrefOffset = Number(offsetText);
  if (!Number.isSafeInteger(xrefOffset) || xrefOffset < PDF_MAGIC.length || xrefOffset >= terminalStart) return false;
  const parsed = parseClassicXref(source, xrefOffset, terminalStart);
  return parsed !== null && skipPdfTrivia(source, parsed.dictionaryEnd, terminalStart) === terminalStart;
}

async function extractPdf(bytes) {
  if (!begins(bytes, PDF_MAGIC)) fail('invalid_file');
  if (bytes.indexOf(Buffer.from('%%EOF', 'ascii')) < 0) fail('parse_failed');
  if (!validatePdfEnvelope(bytes)) fail('invalid_file');
  try {
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  } catch {
    fail('parse_failed');
  }
  let getDocument;
  try {
    ({ getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs'));
  } catch {
    fail('parse_failed');
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
  let document;
  try {
    document = await loading.promise;
    if (document.numPages < 1) fail('empty_file');
    if (document.numPages > MAX_PDF_PAGES) fail('file_too_complex');
    const pages = [];
    let items = 0;
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent({ disableNormalization: false });
        const text = [];
        for (const item of content.items) {
          items += 1;
          if (items > MAX_PDF_ITEMS) fail('file_too_complex');
          if ('str' in item && typeof item.str === 'string' && item.str !== '') text.push(item.str);
        }
        const joined = text.join(' ').trim();
        if (joined !== '') {
          characters += joined.length + (pages.length === 0 ? 0 : 1);
          if (characters > MAX_SOURCE_CHARS) fail('document_too_long');
          pages.push(joined);
        }
      } finally {
        page.cleanup();
      }
    }
    const text = pages.join('\n');
    if (text === '') fail('empty_file');
    return { text, pages: document.numPages, paragraphs: pages.length, tables: 0 };
  } catch (error) {
    if (error instanceof ParserPolicyError) throw error;
    fail('parse_failed');
  } finally {
    try {
      await document?.cleanup();
    } catch {
      // The parent still terminates this isolated worker after the safe result.
    }
    try {
      await loading.destroy();
    } catch {
      // Cleanup details never cross the worker boundary.
    }
  }
}

function zipEntryName(entry) {
  const name = entry.fileName.normalize('NFC');
  const parts = name.split('/');
  if (name.length === 0
    || Buffer.byteLength(name, 'utf8') > MAX_FILENAME_BYTES
    || CONTROL_OR_BIDI.test(name)
    || name.includes('\\')
    || name.startsWith('/')
    || /^[A-Za-z]:/u.test(name)
    || parts.some((part) => part === '..' || part === '.')
    || parts.length > 8) fail('invalid_file');
  return name;
}

function preflightCentralDirectory(bytes) {
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

  const names = new Set();
  let at = directoryOffset;
  let compressedTotal = 0;
  let uncompressedTotal = 0;
  const localRanges = [];
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > eocd || bytes.readUInt32LE(at) !== 0x02014b50) fail('parse_failed');
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const checksum = bytes.readUInt32LE(at + 16);
    const compressed = bytes.readUInt32LE(at + 20);
    const uncompressed = bytes.readUInt32LE(at + 24);
    const nameBytes = bytes.readUInt16LE(at + 28);
    const extraBytes = bytes.readUInt16LE(at + 30);
    const entryCommentBytes = bytes.readUInt16LE(at + 32);
    const localOffset = bytes.readUInt32LE(at + 42);
    const end = at + 46 + nameBytes + extraBytes + entryCommentBytes;
    if (end > eocd || nameBytes === 0 || nameBytes > MAX_FILENAME_BYTES) fail('invalid_file');
    let name;
    const centralName = bytes.subarray(at + 46, at + 46 + nameBytes);
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(centralName);
    } catch {
      fail('invalid_file');
    }
    const canonical = zipEntryName({ fileName: name }).toLowerCase();
    if (names.has(canonical)) fail('invalid_file');
    names.add(canonical);
    if ((flags & 9) !== 0 || (method !== 0 && method !== 8)) fail('invalid_file');
    if (localOffset + 30 > directoryOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) fail('invalid_file');
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localChecksum = bytes.readUInt32LE(localOffset + 14);
    const localCompressed = bytes.readUInt32LE(localOffset + 18);
    const localUncompressed = bytes.readUInt32LE(localOffset + 22);
    const localNameBytes = bytes.readUInt16LE(localOffset + 26);
    const localExtraBytes = bytes.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameBytes + localExtraBytes;
    const dataEnd = dataStart + compressed;
    if (localFlags !== flags
      || localMethod !== method
      || localNameBytes !== nameBytes
      || dataEnd > directoryOffset
      || !bytes.subarray(localNameStart, localNameStart + localNameBytes).equals(centralName)) fail('invalid_file');
    if (localChecksum !== checksum
      || localCompressed !== compressed
      || localUncompressed !== uncompressed) fail('invalid_file');
    localRanges.push({ start: localOffset, end: dataEnd });
    const extra = bytes.subarray(at + 46 + nameBytes, at + 46 + nameBytes + extraBytes);
    let cursor = 0;
    while (cursor + 4 <= extra.length) {
      const id = extra.readUInt16LE(cursor);
      const size = extra.readUInt16LE(cursor + 2);
      if (cursor + 4 + size > extra.length) fail('invalid_file');
      if (id === 1) fail('file_too_complex');
      cursor += 4 + size;
    }
    if (cursor !== extra.length) fail('invalid_file');
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
  localRanges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index - 1].end > localRanges[index].start) fail('invalid_file');
  }
}

function decodePolicyXml(bytes, rejectEntities = false) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('invalid_file');
  }
  if (XML_POLICY_CONTROL.test(text)
    || /<!DOCTYPE|<!ENTITY/iu.test(text)
    || (rejectEntities && XML_ENTITY.test(text))) fail('invalid_file');
  return text;
}

function parseAttributes(source, allowed, required) {
  const attributes = new Map();
  let cursor = 0;
  while (cursor < source.length) {
    const whitespace = /^[\t\n\f\r ]+/u.exec(source.slice(cursor));
    if (whitespace === null) fail('invalid_file');
    cursor += whitespace[0].length;
    if (cursor === source.length) break;
    const attribute = /^([A-Za-z_][A-Za-z0-9_.:-]*)[\t\n\f\r ]*=[\t\n\f\r ]*(["'])([^"'<>]*)\2/u.exec(source.slice(cursor));
    if (attribute === null) fail('invalid_file');
    const name = attribute[1];
    const value = attribute[3];
    if (name === undefined || value === undefined || !allowed.has(name) || attributes.has(name)) fail('invalid_file');
    attributes.set(name, value);
    cursor += attribute[0].length;
  }
  if ([...required].some((name) => !attributes.has(name))) fail('invalid_file');
  return attributes;
}

function safeRelationshipTarget(target) {
  if (target.length === 0
    || target.length > MAX_FILENAME_BYTES
    || target.normalize('NFC') !== target
    || CONTROL_OR_BIDI.test(target)
    || /[%\\:?#]/u.test(target)
    || target.startsWith('/')
    || target.split('/').some((part) => part === '' || part === '.' || part === '..')) fail('invalid_file');
}

function parseRelationships(bytes) {
  const text = decodePolicyXml(bytes, true)
    .replace(/^\s*<\?xml[^?]*\?>\s*/u, '');
  const root = /^<Relationships\b([^>]*)>([\s\S]*)<\/Relationships>\s*$/u.exec(text);
  if (root === null) fail('invalid_file');
  const rootAttributes = parseAttributes(root[1] ?? '', new Set(['xmlns']), new Set(['xmlns']));
  if (rootAttributes.get('xmlns') !== 'http://schemas.openxmlformats.org/package/2006/relationships') {
    fail('invalid_file');
  }
  const inner = root[2] ?? '';
  const relationships = [];
  const ids = new Set();
  const tag = /<Relationship\b([^>]*)\/>/gu;
  let cursor = 0;
  for (const match of inner.matchAll(tag)) {
    if (match.index === undefined || inner.slice(cursor, match.index).trim() !== '') fail('invalid_file');
    const attributes = parseAttributes(
      match[1] ?? '',
      new Set(['Id', 'Type', 'Target', 'TargetMode']),
      new Set(['Id', 'Type', 'Target']),
    );
    const id = attributes.get('Id');
    const type = attributes.get('Type');
    const target = attributes.get('Target');
    if (id === undefined || type === undefined || target === undefined
      || id.length === 0 || type.length === 0 || ids.has(id)
      || attributes.has('TargetMode')) fail('invalid_file');
    ids.add(id);
    safeRelationshipTarget(target);
    relationships.push({ id, type, target });
    cursor = match.index + match[0].length;
  }
  if (inner.slice(cursor).trim() !== '') fail('invalid_file');
  return relationships;
}

function validateContentTypes(bytes) {
  const text = decodePolicyXml(bytes, true);
  if (/macroEnabled|vbaProject|oleObject|application\/vnd\.ms-|application\/vnd\.openxmlformats-officedocument\.(?:oleObject|package)|application\/octet-stream/iu.test(text)) {
    fail('invalid_file');
  }
  const main = [];
  for (const match of text.matchAll(/<Override\b([^>]*)\/>/gu)) {
    const attributes = parseAttributes(
      match[1] ?? '',
      new Set(['PartName', 'ContentType']),
      new Set(['PartName', 'ContentType']),
    );
    if (attributes.get('ContentType') === MAIN_DOCUMENT_CONTENT_TYPE) main.push(attributes.get('PartName'));
  }
  const rawMainCount = text.match(/application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml/gu)?.length ?? 0;
  if (rawMainCount !== 1 || main.length !== 1 || main[0] !== '/word/document.xml') fail('invalid_file');
}

async function readEveryEntryByte(zipFile, entry, canonical, state) {
  const cap = canonical.endsWith('.rels')
    ? MAX_DOCX_RELATIONSHIP_BYTES
    : canonical.endsWith('.xml') || canonical === '[content_types].xml'
      ? MAX_DOCX_XML_BYTES
      : MAX_DOCX_ENTRY_BYTES;
  let stream;
  try {
    stream = await zipFile.openReadStreamPromise(entry);
  } catch {
    fail('parse_failed');
  }
  const chunks = [];
  let actual = 0;
  let checksum = 0xffffffff;
  try {
    for await (const chunk of stream) {
      const held = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      actual += held.length;
      state.actual += held.length;
      if (actual > cap
        || state.actual > MAX_DOCX_UNCOMPRESSED_BYTES
        || (actual > 0 && (entry.compressedSize === 0 || actual / entry.compressedSize > MAX_DOCX_RATIO))) {
        stream.destroy();
        fail('file_too_complex');
      }
      for (const byte of held) checksum = (checksum >>> 8) ^ CRC_TABLE[(checksum ^ byte) & 0xff];
      chunks.push(held);
    }
  } catch (error) {
    if (error instanceof ParserPolicyError) throw error;
    if (actual !== entry.uncompressedSize) fail('file_too_complex');
    fail('parse_failed');
  }
  if (actual !== entry.uncompressedSize) fail('file_too_complex');
  if (((checksum ^ 0xffffffff) >>> 0) !== (entry.crc32 >>> 0)) fail('invalid_file');
  return Buffer.concat(chunks, actual);
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  return crc >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

async function validatedDocx(bytes) {
  if (!begins(bytes, ZIP_MAGIC)) fail('invalid_file');
  if (bytes.indexOf(ZIP64_EOCD) >= 0 || bytes.indexOf(ZIP64_LOCATOR) >= 0) fail('file_too_complex');
  preflightCentralDirectory(bytes);
  let yauzl;
  try {
    yauzl = await import('yauzl');
  } catch {
    fail('parse_failed');
  }
  let zipFile;
  try {
    zipFile = await yauzl.fromBufferPromise(bytes, {
      autoClose: false,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      // Metadata was checked structurally above; actual expansion is counted
      // by readEveryEntryByte instead of being truncated at the claimed size.
      validateEntrySizes: false,
    });
  } catch {
    fail('parse_failed');
  }

  const names = new Set();
  const entries = [];
  const state = { actual: 0, count: 0, compressed: 0 };
  try {
    await new Promise((resolve, reject) => {
      let stopped = false;
      const stop = (error) => {
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
          state.count += 1;
          if (state.count > MAX_DOCX_ENTRIES) fail('file_too_complex');
          const name = zipEntryName(entry);
          const canonical = name.toLowerCase();
          if (names.has(canonical)) fail('invalid_file');
          names.add(canonical);
          if ((entry.generalPurposeBitFlag & 9) !== 0
            || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)) fail('invalid_file');
          state.compressed += entry.compressedSize;
          if (state.compressed > MAX_FILE_BYTES
            || entry.uncompressedSize > MAX_DOCX_ENTRY_BYTES
            || (entry.uncompressedSize > 0
              && (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > MAX_DOCX_RATIO))) {
            fail('file_too_complex');
          }
          if (canonical.includes('vbaproject')
            || canonical.includes('/embeddings/')
            || canonical.endsWith('.bin')
            || canonical.includes('oleobject')) fail('invalid_file');
          const data = await readEveryEntryByte(zipFile, entry, canonical, state);
          if (name.endsWith('/')) {
            if (data.length !== 0) fail('invalid_file');
          } else {
            entries.push({ name, canonical, data });
          }
          zipFile.readEntry();
        })().catch(stop);
      });
      zipFile.readEntry();
    });
  } catch (error) {
    if (error instanceof ParserPolicyError) throw error;
    fail('parse_failed');
  } finally {
    zipFile.close();
  }

  const byName = new Map(entries.map((entry) => [entry.canonical, entry]));
  const contentTypes = byName.get('[content_types].xml');
  const rootRelationships = byName.get('_rels/.rels');
  const document = byName.get('word/document.xml');
  if (contentTypes === undefined || rootRelationships === undefined || document === undefined
    || contentTypes.name !== '[Content_Types].xml'
    || rootRelationships.name !== '_rels/.rels'
    || document.name !== 'word/document.xml') fail('invalid_file');
  validateContentTypes(contentTypes.data);
  const root = parseRelationships(rootRelationships.data);
  const officeDocuments = root.filter((relationship) => OFFICE_DOCUMENT_TYPES.has(relationship.type));
  if (officeDocuments.length !== 1 || officeDocuments[0]?.target !== 'word/document.xml') fail('invalid_file');
  for (const entry of entries) {
    if (entry.canonical.endsWith('.rels')) parseRelationships(entry.data);
  }
  const documentXml = decodePolicyXml(document.data);
  const paragraphs = documentXml.match(/<w:p(?:\s|>)/gu)?.length ?? 0;
  const tables = documentXml.match(/<w:tbl(?:\s|>)/gu)?.length ?? 0;
  if (paragraphs > MAX_DOCX_PARAGRAPHS || tables > MAX_DOCX_TABLES) fail('file_too_complex');
  return {
    paragraphs,
    tables,
    documentXml,
  };
}

function decodeXmlText(value) {
  return value.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]+));/giu, (entity, hexadecimal, decimal, named) => {
    if (named !== undefined) {
      const decoded = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' }[named.toLowerCase()];
      if (decoded === undefined) fail('invalid_file');
      return decoded;
    }
    const codePoint = Number.parseInt(hexadecimal ?? decimal, hexadecimal === undefined ? 10 : 16);
    if (!Number.isSafeInteger(codePoint) || codePoint === 0 || codePoint > 0x10ffff
      || (codePoint >= 0xd800 && codePoint <= 0xdfff)) fail('invalid_file');
    return String.fromCodePoint(codePoint);
  });
}

function extractDocxText(documentXml) {
  const paragraphs = [];
  let current = '';
  let inParagraph = false;
  const tokens = /<w:p(?:\s[^>]*)?>|<\/w:p>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/\s*>|<w:br(?:\s[^>]*)?\/\s*>/gu;
  for (const match of documentXml.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith('<w:p')) {
      if (inParagraph) fail('invalid_file');
      inParagraph = true;
      current = '';
    } else if (token === '</w:p>') {
      if (!inParagraph) fail('invalid_file');
      paragraphs.push(current);
      inParagraph = false;
    } else if (!inParagraph || match[1] === undefined) {
      if (inParagraph) current += token.startsWith('<w:tab') ? '\t' : '\n';
    } else {
      current += decodeXmlText(match[1]);
    }
  }
  if (inParagraph) fail('invalid_file');
  const text = paragraphs.filter((paragraph) => paragraph.trim() !== '').join('\n').normalize('NFC').trim();
  if (text === '') fail('empty_file');
  if (text.length > MAX_SOURCE_CHARS) fail('document_too_long');
  return text;
}

async function extractDocx(bytes) {
  const validated = await validatedDocx(bytes);
  try {
    const text = extractDocxText(validated.documentXml);
    return { text, pages: 0, paragraphs: validated.paragraphs, tables: validated.tables };
  } catch (error) {
    if (error instanceof ParserPolicyError) throw error;
    fail('parse_failed');
  }
}

async function parseRequest(request) {
  if (typeof request !== 'object' || request === null || Array.isArray(request)
    || Object.keys(request).sort().join('\u0000') !== 'bytes\u0000fileType\u0000kind'
    || request.kind !== 'parse'
    || (request.fileType !== 'pdf' && request.fileType !== 'docx')
    || !(request.bytes instanceof ArrayBuffer)
    || request.bytes.byteLength === 0
    || request.bytes.byteLength > MAX_FILE_BYTES) fail('invalid_file');
  const bytes = Buffer.from(request.bytes);
  return request.fileType === 'pdf' ? await extractPdf(bytes) : await extractDocx(bytes);
}

if (parentPort === null) throw new Error('file parser worker requires a parent port');
parentPort.once('message', (request) => {
  void parseRequest(request).then(
    (value) => parentPort.postMessage({ ok: true, value }),
    (error) => parentPort.postMessage({
      ok: false,
      code: error instanceof ParserPolicyError && SAFE_CODES.has(error.code) ? error.code : 'parse_failed',
    }),
  ).finally(() => parentPort.close());
});
