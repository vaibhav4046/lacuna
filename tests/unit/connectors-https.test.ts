import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  HttpsImportError,
  PinnedHttpsReader,
  canonicalizePublicHttpsUrl,
  isGlobalUnicastAddress,
  type HttpsRequestFactory,
  type HttpsResolver,
} from '../../src/connectors/https.js';

interface ResponseSpec {
  readonly status?: number;
  readonly rawHeaders?: readonly string[];
  readonly body?: Uint8Array | string;
  readonly remoteAddress?: string;
  readonly rawTrailers?: readonly string[];
  readonly holdBody?: boolean;
  readonly holdClose?: boolean;
  readonly requestError?: Error;
  readonly onBodyListener?: () => void;
}

class ResolverFixture implements HttpsResolver {
  readonly resolve4 = vi.fn(async (): Promise<readonly string[]> => ['93.184.216.34']);
  readonly resolve6 = vi.fn(async (): Promise<readonly string[]> => {
    const error = Object.assign(new Error('no IPv6'), { code: 'ENODATA' });
    throw error;
  });
  readonly cancel = vi.fn();
}

class RequestFixture {
  readonly requests: RequestOptions[] = [];
  readonly requestCount = vi.fn();
  readonly #specs: ResponseSpec[];

  constructor(...specs: ResponseSpec[]) {
    this.#specs = specs.length === 0 ? [{}] : specs;
  }

  readonly factory: HttpsRequestFactory = (options, onResponse) => {
    this.requestCount();
    this.requests.push(options);
    const spec = this.#specs[Math.min(this.requests.length - 1, this.#specs.length - 1)] ?? {};
    const request = new EventEmitter() as EventEmitter & Partial<ClientRequest>;
    const socket = new EventEmitter() as EventEmitter & {
      remoteAddress?: string;
      destroy: () => void;
      destroyed: boolean;
    };
    socket.remoteAddress = spec.remoteAddress ?? '93.184.216.34';
    socket.destroyed = false;
    socket.destroy = () => {
      if (socket.destroyed) return;
      socket.destroyed = true;
      socket.emit('close');
    };
    const response = new PassThrough() as PassThrough & Partial<IncomingMessage>;
    response.statusCode = spec.status ?? 200;
    response.rawHeaders = [...(spec.rawHeaders ?? [
      'Content-Type', 'text/plain; charset=utf-8',
      'Content-Length', String(Buffer.byteLength(typeof spec.body === 'string' ? spec.body : 'safe text', 'utf8')),
    ])];
    response.rawTrailers = [...(spec.rawTrailers ?? [])];
    response.trailers = {};
    const originalOn = response.on.bind(response);
    response.on = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
      if (event === 'data') spec.onBodyListener?.();
      return originalOn(event, listener);
    }) as typeof response.on;
    const emitClose = (): void => {
      if (spec.holdClose === true) return;
      response.emit('close');
      socket.destroy();
      request.emit('close');
    };
    request.destroyed = false;
    request.setTimeout = vi.fn();
    request.end = () => {
      queueMicrotask(() => {
        if (request.destroyed === true) return;
        request.emit('socket', socket);
        socket.emit('secureConnect');
        if (spec.requestError !== undefined) {
          request.emit('error', spec.requestError);
          request.emit('close');
          return;
        }
        onResponse(response as IncomingMessage);
        if (spec.holdBody === true) return;
        const body = typeof spec.body === 'string' ? Buffer.from(spec.body) : Buffer.from(spec.body ?? 'safe text');
        response.end(body, emitClose);
      });
      return request as ClientRequest;
    };
    request.destroy = () => {
      if (request.destroyed === true) return request as ClientRequest;
      request.destroyed = true;
      response.destroy();
      emitClose();
      return request as ClientRequest;
    };
    return request as ClientRequest;
  };
}

function reader(
  resolver = new ResolverFixture(),
  requests = new RequestFixture(),
  overrides: ConstructorParameters<typeof PinnedHttpsReader>[0] = {},
): PinnedHttpsReader {
  return new PinnedHttpsReader({
    resolverFactory: () => resolver,
    requestFactory: requests.factory,
    now: () => Date.parse('2026-08-21T10:00:00.000Z'),
    ...overrides,
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'HttpsImportError', code });
  await expect(promise).rejects.toBeInstanceOf(HttpsImportError);
}

describe('public HTTPS URL and address policy', () => {
  it.each([
    '', 'http://example.com/a', 'https://example.com:444/a', 'https://user@example.com/a',
    'https://example.com/a#fragment', 'https://example.com./a', 'https://LOCALHOST/a',
    'https://metadata.google.internal/a', 'https://host.local/a', 'https://host.home.arpa/a',
    'https://host.onion/a', 'https://xn--strae-oqa.de/a', 'https://straße.de/a',
    'https://127.0.0.1/a', 'https://[::1]/a', 'https://[fe80::1%25eth0]/a',
    'https://2130706433/a', 'https://0177.0.0.1/a', 'https://0x7f000001/a', 'https://127.1/a',
    'https://exa_mple.com/a', 'https://example.com\\safe', 'https://example.com/%0a',
    'https://example.com/%zz', 'https://example.com/a?bad=%',
    `https://${'a'.repeat(64)}.example/a`, `https://${'a'.repeat(2040)}.com/a`,
  ])('rejects ambiguous or non-public URL input before resolution: %s', async (value) => {
    const resolver = new ResolverFixture();
    const requests = new RequestFixture();
    expect(canonicalizePublicHttpsUrl(value)).toBeNull();
    await expectCode(reader(resolver, requests).read(value, new AbortController().signal), 'invalid_https_url');
    expect(resolver.resolve4).not.toHaveBeenCalled();
    expect(requests.requestCount).not.toHaveBeenCalled();
  });

  it('canonicalizes only the safe host and path while retaining the query for the request', () => {
    expect(canonicalizePublicHttpsUrl('https://EXAMPLE.com:443/a/../b?q=secret')).toEqual({
      hostname: 'example.com',
      origin: 'https://example.com/',
      pathname: '/b',
      requestPath: '/b?q=secret',
    });
    expect(canonicalizePublicHttpsUrl('https://example.com/%7euser/%2f?q=%7e')).toMatchObject({
      pathname: '/~user/%2F',
      requestPath: '/~user/%2F?q=%7e',
    });
  });

  it.each([
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1',
    '192.0.0.1', '192.0.2.1', '192.31.196.1', '192.52.193.1', '192.88.99.1',
    '192.168.1.1', '192.175.48.1', '198.18.0.1', '198.51.100.1',
    '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:5db8:d822', '64:ff9b::1', '100::1', '2001::1',
    '2001:db8::1', '2002::1', '2620:4f:8000::1', '3ffe::1', '3fff::1', 'fc00::1', 'fe80::1', 'ff00::1',
  ])('rejects special-use or noncanonical address %s', (address) => {
    expect(isGlobalUnicastAddress(address)).toBe(false);
  });

  it.each([
    ['8.8.8.8', true], ['9.255.255.255', true], ['100.63.255.255', true],
    ['100.128.0.0', true], ['172.15.255.255', true], ['172.32.0.0', true],
    ['198.17.255.255', true], ['198.20.0.0', true],
    ['1:2:3:4:5:6:7:8', false], ['2606:4700:4700::1111', true], ['2a00:1450:4001:81b::200e', true],
  ] as const)('classifies the public boundary %s', (address, expected) => {
    expect(isGlobalUnicastAddress(address)).toBe(expected);
  });
});

describe('pinned public HTTPS transport', () => {
  it('resolves A and AAAA in parallel, accepts only ENODATA, and pins one deterministic address', async () => {
    const resolver = new ResolverFixture();
    resolver.resolve4.mockResolvedValue(['93.184.216.35', '93.184.216.34']);
    resolver.resolve6.mockResolvedValue(['2606:4700:4700::1111']);
    const requests = new RequestFixture({ body: 'safe text', remoteAddress: '93.184.216.34' });
    const prepared = await reader(resolver, requests).read(
      'https://EXAMPLE.com/source?q=must-not-persist', new AbortController().signal,
    );

    expect(resolver.resolve4).toHaveBeenCalledWith('example.com');
    expect(resolver.resolve6).toHaveBeenCalledWith('example.com');
    expect(requests.requests).toHaveLength(1);
    const options = requests.requests[0];
    expect(options).toMatchObject({
      hostname: 'example.com', servername: 'example.com', port: 443, path: '/source?q=must-not-persist',
      method: 'GET', agent: false, rejectUnauthorized: true,
      headers: {
        Accept: 'application/json, text/plain, text/markdown',
        'User-Agent': 'Lacuna-Connector/1.0', Connection: 'close', 'Accept-Encoding': 'identity',
      },
    });
    const lookup = options?.lookup;
    expect(typeof lookup).toBe('function');
    const lookedUp = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      (lookup as Function)('example.com', {}, (error: Error | null, address: string, family: number) => {
        if (error !== null) reject(error); else resolve({ address, family });
      });
    });
    expect(lookedUp).toEqual({ address: '93.184.216.34', family: 4 });
    expect(resolver.resolve4).toHaveBeenCalledTimes(1);
    expect(prepared.provenance).toMatchObject({
      connectorId: 'https_api', sourceUrl: 'https://example.com/', mediaType: 'text/plain',
      observedAt: '2026-08-21T10:00:00.000Z',
      https: {
        schemaVersion: 1, retrievedAt: '2026-08-21T10:00:00.000Z', parserVersion: 'https-v1',
      },
    });
    expect(JSON.stringify(prepared)).not.toContain('must-not-persist');
    expect(JSON.stringify(prepared)).not.toContain('93.184.216.34');
  });

  it('starts both DNS families before awaiting either and cancels both through the resolver seam', async () => {
    const resolver = new ResolverFixture();
    let release4: ((value: readonly string[]) => void) | undefined;
    let release6: ((value: readonly string[]) => void) | undefined;
    resolver.resolve4.mockImplementation(() => new Promise((resolve) => { release4 = resolve; }));
    resolver.resolve6.mockImplementation(() => new Promise((resolve) => { release6 = resolve; }));
    const promise = reader(resolver).read('https://example.com/data', new AbortController().signal);
    await vi.waitFor(() => {
      expect(resolver.resolve4).toHaveBeenCalledTimes(1);
      expect(resolver.resolve6).toHaveBeenCalledTimes(1);
    });
    release6?.([]);
    release4?.(['93.184.216.34']);
    await expect(promise).resolves.toMatchObject({ provenance: { connectorId: 'https_api' } });
    expect(resolver.cancel).not.toHaveBeenCalled();
  });

  it('fails closed for mixed public/private, partial-family error, excess answers, and peer mismatch', async () => {
    const mixed = new ResolverFixture();
    mixed.resolve4.mockResolvedValue(['93.184.216.34', '10.0.0.1']);
    await expectCode(reader(mixed).read('https://example.com/a', new AbortController().signal), 'https_address_blocked');

    const partial = new ResolverFixture();
    partial.resolve6.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
    await expectCode(reader(partial).read('https://example.com/a', new AbortController().signal), 'https_dns_failed');

    const excess = new ResolverFixture();
    excess.resolve4.mockResolvedValue(Array.from({ length: 17 }, (_, index) => `8.8.8.${index + 1}`));
    await expectCode(reader(excess).read('https://example.com/a', new AbortController().signal), 'https_dns_failed');

    const bodyListener = vi.fn();
    await expectCode(reader(new ResolverFixture(), new RequestFixture({
      remoteAddress: '8.8.8.8', onBodyListener: bodyListener,
    }))
      .read('https://example.com/a', new AbortController().signal), 'https_peer_mismatch');
    expect(bodyListener).not.toHaveBeenCalled();

    const noncanonical = new ResolverFixture();
    noncanonical.resolve4.mockResolvedValue([]);
    noncanonical.resolve6.mockResolvedValue(['2606:4700:4700:0:0:0:0:1111']);
    await expectCode(reader(noncanonical).read(
      'https://example.com/a', new AbortController().signal,
    ), 'https_address_blocked');
  });

  it('maps certificate/TLS failure without returning provider detail or retrying', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const requests = new RequestFixture({
      requestError: Object.assign(new Error('certificate host and query detail'), { code: 'CERT_HAS_EXPIRED' }),
    });
    const promise = reader(new ResolverFixture(), requests).read(
      'https://example.com/private?token=secret', new AbortController().signal,
    );
    await expectCode(promise, 'https_tls_failed');
    await expect(promise).rejects.not.toThrow(/certificate|private|secret|example/u);
    expect(requests.requestCount).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it.each([
    [{ status: 302 }, 'https_redirect_refused'],
    [{ status: 404 }, 'https_upstream_failed'],
    [{ rawHeaders: ['Content-Length', '9'] }, 'https_type_unsupported'],
    [{ rawHeaders: ['Content-Type', 'text/html', 'Content-Length', '9'] }, 'https_type_unsupported'],
    [{ rawHeaders: ['Content-Type', 'text/plain; charset="utf-8"', 'Content-Length', '9'] }, 'https_type_unsupported'],
    [{ rawHeaders: ['Content-Type', 'text/plain; charset=utf-8; x=y', 'Content-Length', '9'] }, 'https_type_unsupported'],
    [{ rawHeaders: ['Content-Type', 'text/plain', 'Content-Type', 'text/plain', 'Content-Length', '9'] }, 'https_response_invalid'],
    [{ rawHeaders: ['Content-Type', 'text/plain', 'Content-Length', '9', 'Transfer-Encoding', 'chunked'] }, 'https_response_invalid'],
    [{ rawHeaders: ['Content-Type', 'text/plain', 'Content-Length', '09'] }, 'https_response_invalid'],
    [{ rawHeaders: ['Content-Type', 'text/plain', 'Content-Encoding', 'gzip', 'Content-Length', '9'] }, 'https_response_invalid'],
    [{ rawHeaders: ['Content-Type', 'text/plain', 'Transfer-Encoding', 'gzip'] }, 'https_response_invalid'],
    [{ rawHeaders: ['Content-Type', 'text/plain'] }, 'https_response_invalid'],
    [{ rawHeaders: ['Content-Type', 'text/plain', 'Content-Length', '10'], body: 'safe text' }, 'https_response_invalid'],
    [{ rawHeaders: ['Content-Type', 'text/plain', 'Transfer-Encoding', 'chunked'], rawTrailers: ['X-Late', 'value'] }, 'https_response_invalid'],
  ] as const)('rejects unsafe response metadata %#', async (spec, code) => {
    await expectCode(reader(new ResolverFixture(), new RequestFixture(spec))
      .read('https://example.com/a?secret=1', new AbortController().signal), code);
  });

  it('enforces one entity-byte cap before decode and never retries', async () => {
    const requests = new RequestFixture({
      rawHeaders: ['Content-Type', 'text/plain', 'Content-Length', String(1024 * 1024 + 1)],
      body: Buffer.alloc(1024 * 1024 + 1, 97),
    });
    await expectCode(reader(new ResolverFixture(), requests).read(
      'https://example.com/large', new AbortController().signal,
    ), 'https_too_large');
    expect(requests.requestCount).toHaveBeenCalledTimes(1);
  });

  it('accepts only exact byte-valid chunking and bounded response headers', async () => {
    const chunked = await reader(new ResolverFixture(), new RequestFixture({
      rawHeaders: ['Content-Type', 'text/markdown', 'Transfer-Encoding', 'chunked'],
      body: '# Safe',
    })).read('https://example.com/readme', new AbortController().signal);
    expect(chunked).toMatchObject({ text: '# Safe', provenance: { mediaType: 'text/markdown' } });

    const tooManyHeaders = Array.from({ length: 65 }, (_, index) => [`X-${index}`, 'a']).flat();
    await expectCode(reader(new ResolverFixture(), new RequestFixture({
      rawHeaders: [
        'Content-Type', 'text/plain', 'Content-Length', '9', ...tooManyHeaders,
      ],
    })).read('https://example.com/a', new AbortController().signal), 'https_response_invalid');
    await expectCode(reader(new ResolverFixture(), new RequestFixture({
      rawHeaders: ['Content-Type', 'text/plain', 'Content-Length', '9', 'X-Large', 'x'.repeat(16_384)],
    })).read('https://example.com/a', new AbortController().signal), 'https_response_invalid');
  });

  it('cancels DNS and the request under the same total deadline without leaking provider details', async () => {
    const resolver = new ResolverFixture();
    resolver.resolve4.mockImplementation(() => new Promise(() => {}));
    resolver.resolve6.mockImplementation(() => new Promise(() => {}));
    const promise = reader(resolver, new RequestFixture(), { deadlineMs: 20 }).read(
      'https://example.com/private?token=provider-secret', new AbortController().signal,
    );
    await expectCode(promise, 'https_timeout');
    expect(resolver.cancel).toHaveBeenCalledTimes(1);
    await expect(promise).rejects.not.toThrow(/provider-secret|example\.com|private/u);
  });

  it('tears down an active request on caller cancellation and cancels the per-read resolver', async () => {
    const resolver = new ResolverFixture();
    const requests = new RequestFixture({ holdBody: true });
    const control = new AbortController();
    const promise = reader(resolver, requests).read('https://example.com/data', control.signal);
    await vi.waitFor(() => expect(requests.requestCount).toHaveBeenCalledTimes(1));
    control.abort();
    await expect(promise).rejects.toMatchObject({ name: 'HttpsReadCancelledError' });
    expect(resolver.cancel).toHaveBeenCalledTimes(1);
  });
});

describe('bounded HTTPS content preparation', () => {
  it.each([
    [Buffer.from([0xc3, 0x28]), 'https_content_invalid'],
    ['\ufeffambiguous', 'https_content_invalid'],
    ['nul\u0000byte', 'https_content_invalid'],
    ['control\u0001byte', 'https_content_invalid'],
    ['  \r\n ', 'https_content_invalid'],
    ['x'.repeat(20_001), 'https_content_invalid'],
  ] as const)('rejects invalid UTF-8/text content %#', async (body, code) => {
    const bytes = typeof body === 'string' ? Buffer.from(body) : body;
    const requests = new RequestFixture({
      body: bytes,
      rawHeaders: ['Content-Type', 'text/plain; charset=utf-8', 'Content-Length', String(bytes.byteLength)],
    });
    await expectCode(reader(new ResolverFixture(), requests).read(
      'https://example.com/text', new AbortController().signal,
    ), code);
  });

  it('flattens JSON deterministically with escaped pointers, last-key-wins, and inert prototype names', async () => {
    const body = '{"z":2,"a/b":{"~key":true},"dup":1,"dup":3,"__proto__":{"polluted":"no"}}';
    const requests = new RequestFixture({
      body,
      rawHeaders: ['Content-Type', 'application/json; charset=utf-8', 'Content-Length', String(Buffer.byteLength(body))],
    });
    const prepared = await reader(new ResolverFixture(), requests).read(
      'https://example.com/data?token=secret', new AbortController().signal,
    );
    expect(prepared.text).toBe('/__proto__/polluted = "no"\n/a~1b/~0key = true\n/dup = 3\n/z = 2');
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
    expect(prepared.title).toBe('Public HTTPS JSON');
    expect(JSON.stringify(prepared)).not.toMatch(/token|secret|\/data/u);
  });

  it.each([
    ['NUL', '{"bad\\u0000key":1}'],
    ['line feed', '{"bad\\nkey":1}'],
    ['carriage return', '{"bad\\rkey":1}'],
    ['tab', '{"bad\\tkey":1}'],
    ['C1 control', '{"bad\\u0085key":1}'],
    ['line separator', '{"bad\\u2028key":1}'],
    ['paragraph separator', '{"bad\\u2029key":1}'],
    ['unpaired high surrogate', '{"bad\\ud800key":1}'],
    ['unpaired low surrogate', '{"bad\\udc00key":1}'],
  ])('rejects an escaped %s in a parsed JSON object key', async (_label, body) => {
    const requests = new RequestFixture({
      body,
      rawHeaders: ['Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(body))],
    });
    await expectCode(reader(new ResolverFixture(), requests).read(
      'https://example.com/data', new AbortController().signal,
    ), 'https_json_invalid');
  });

  it('rejects forbidden code points that JSON scalar serialization would leave in flattened text', async () => {
    for (const body of ['{"safe":"bad\\u0085value"}', '{"safe":"bad\\u2028value"}']) {
      const requests = new RequestFixture({
        body,
        rawHeaders: ['Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(body))],
      });
      await expectCode(reader(new ResolverFixture(), requests).read(
        'https://example.com/data', new AbortController().signal,
      ), 'https_json_invalid');
    }
  });

  it('preserves a valid surrogate pair in an NFC JSON key', async () => {
    const body = '{"emoji\\ud83d\\ude00":1}';
    const prepared = await reader(new ResolverFixture(), new RequestFixture({
      body,
      rawHeaders: ['Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(body))],
    })).read('https://example.com/data', new AbortController().signal);
    expect(prepared.text).toBe('/emoji😀 = 1');
  });

  it.each([
    ['too deep', JSON.stringify({ a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } })],
    ['too many members', JSON.stringify(Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`k${index}`, index])))],
    ['too many array members', JSON.stringify(Array.from({ length: 101 }, (_, index) => index))],
    ['key too long', JSON.stringify({ ['x'.repeat(257)]: 1 })],
    ['no scalar', '{}'],
    ['no scalar array', '[]'],
    ['non-NFC key', '{"e\\u0301":1}'],
    ['normalization collision', '{"é":1,"e\\u0301":2}'],
    ['too many scalar leaves', JSON.stringify([Array.from({ length: 51 }, (_, index) => index), Array.from({ length: 51 }, (_, index) => index)])],
    ['too many total nodes', JSON.stringify(Array.from({ length: 100 }, () => Array.from({ length: 5 }, () => ({}))))],
    ['flattened path too long', JSON.stringify({
      ['a'.repeat(200)]: { ['b'.repeat(200)]: { ['c'.repeat(200)]: {
        ['d'.repeat(200)]: { ['e'.repeat(200)]: { ['f'.repeat(200)]: 1 } },
      } } },
    })],
  ])('rejects JSON structural abuse: %s', async (_label, body) => {
    const requests = new RequestFixture({
      body,
      rawHeaders: ['Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(body))],
    });
    await expectCode(reader(new ResolverFixture(), requests).read(
      'https://example.com/data', new AbortController().signal,
    ), 'https_json_invalid');
  });

  it('accepts the exact shared extractor boundary and a one-MiB JSON entity that flattens safely', async () => {
    const exact = 'x'.repeat(20_000);
    const text = await reader(new ResolverFixture(), new RequestFixture({ body: exact })).read(
      'https://example.com/text', new AbortController().signal,
    );
    expect(text.text).toHaveLength(20_000);

    const json = `${'{"x":1}'}${' '.repeat(1024 * 1024 - 7)}`;
    const prepared = await reader(new ResolverFixture(), new RequestFixture({
      body: json,
      rawHeaders: ['Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(json))],
    })).read('https://example.com/data', new AbortController().signal);
    expect(prepared.text).toBe('/x = 1');
  });

  it('keeps identity stable across time and query-only changes but binds exact raw bytes', async () => {
    const first = await reader(new ResolverFixture(), new RequestFixture({ body: 'A\r\nB' })).read(
      'https://example.com/data?token=one', new AbortController().signal,
    );
    const later = await reader(new ResolverFixture(), new RequestFixture({ body: 'A\r\nB' }), {
      now: () => Date.parse('2026-08-22T10:00:00.000Z'),
    }).read('https://example.com/data?token=two', new AbortController().signal);
    const differentBytes = await reader(new ResolverFixture(), new RequestFixture({ body: 'A\nB' })).read(
      'https://example.com/data?token=one', new AbortController().signal,
    );
    const differentPath = await reader(new ResolverFixture(), new RequestFixture({ body: 'A\r\nB' })).read(
      'https://example.com/other?token=one', new AbortController().signal,
    );

    expect(later.sourceKey).toBe(first.sourceKey);
    expect(later.provenanceKey).toBe(first.provenanceKey);
    expect(later.provenance.observedAt).not.toBe(first.provenance.observedAt);
    expect(differentBytes.text).toBe(first.text);
    expect(differentBytes.contentDigest).toBe(first.contentDigest);
    expect(differentBytes.sourceKey).not.toBe(first.sourceKey);
    expect(differentPath.sourceKey).not.toBe(first.sourceKey);
  });
});

describe('HTTPS reader leases and cancellation', () => {
  it('bounds active reads to three, queues sixteen, and fails the seventeenth waiter closed', async () => {
    const resolver = new ResolverFixture();
    const requests = new RequestFixture({ holdBody: true });
    const instance = reader(resolver, requests, { deadlineMs: 2_000 });
    const signals = Array.from({ length: 20 }, () => new AbortController());
    const reads = signals.map((control, index) => instance.read(
      `https://example.com/${index}`, control.signal,
    ));
    const busy = expectCode(reads[19]!, 'https_busy');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requests.requestCount).toHaveBeenCalledTimes(3);
    await busy;
    for (const control of signals.slice(0, 19)) control.abort();
    await Promise.allSettled(reads.slice(0, 19));
  });

  it('does not release an active lease until request teardown is confirmed', async () => {
    const firstRequests = new RequestFixture({ body: 'first', holdClose: true });
    const instance = reader(new ResolverFixture(), firstRequests, {
      maxActive: 1, maxQueued: 1, deadlineMs: 50,
    });
    const first = instance.read('https://example.com/first', new AbortController().signal);
    const second = instance.read('https://example.com/second', new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(firstRequests.requestCount).toHaveBeenCalledTimes(1);
    await expectCode(first, 'https_timeout');
    await expectCode(second, 'https_timeout');
    expect(firstRequests.requestCount).toHaveBeenCalledTimes(1);
  });
});
