import { File as NodeFile } from 'node:buffer';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getConnectorCatalogue,
  getWebhookState,
  importFile,
  importGitHub,
  importHttps,
  issueWebhook,
  previewFile,
  revokeWebhook,
  type ConnectorStatus,
} from '../../web/src/api/connectors.js';

const BINDING = 'a'.repeat(64);
const PREVIEW_TOKEN = `${'p'.repeat(64)}.${'A'.repeat(43)}`;

function request(signal: AbortSignal = new AbortController().signal) {
  return { binding: BINDING, csrf: 'csrf-under-test', signal };
}

const RUN_RECEIPT = {
  connectorId: 'text', submittedDocuments: 1, duplicateDocuments: 0,
  acceptedDocuments: 1, searchableDocuments: 1, failedDocuments: 0,
  acceptedRecords: 4, refusedRecords: 0, failure: null,
  startedAt: '2026-08-21T12:00:00.000Z', completedAt: '2026-08-21T12:00:01.000Z',
  observationWrite: 'stored', indeterminateSubmission: false,
} as const;

type MutableConnectorStatus = { -readonly [Key in keyof ConnectorStatus]: ConnectorStatus[Key] };

function catalogueBody(): { connectors: MutableConnectorStatus[] } {
  return { connectors: [
    {
      id: 'github', label: 'GitHub', group: 'CODE', availability: 'available', reason: null,
      configuredAt: null, lastAttemptAt: null, lastSuccessAt: null, lastFailure: null,
      importedDocuments: 0, state: 'idle',
    },
    {
      id: 'gitlab', label: 'GitLab', group: 'CODE', availability: 'available', reason: null,
      configuredAt: null, lastAttemptAt: null, lastSuccessAt: null, lastFailure: null,
      importedDocuments: 0, state: 'idle',
    },
    ...(['markdown', 'text', 'pdf', 'docx'] as const).map((id) => ({
      id, label: id === 'docx' ? 'DOCX' : id === 'pdf' ? 'PDF' : id[0]!.toUpperCase() + id.slice(1), group: 'FILES',
      availability: 'available', reason: null, configuredAt: null, lastAttemptAt: null,
      lastSuccessAt: null, lastFailure: null, importedDocuments: 0, state: 'idle',
    })),
    {
      id: 'https_api', label: 'HTTPS API', group: 'DATA', availability: 'available', reason: null,
      configuredAt: null, lastAttemptAt: null, lastSuccessAt: null, lastFailure: null,
      importedDocuments: 0, state: 'idle',
    },
    {
      id: 'webhook', label: 'Webhook', group: 'DATA', availability: 'available', reason: null,
      configuredAt: null, lastAttemptAt: null, lastSuccessAt: null, lastFailure: null,
      importedDocuments: 0, state: 'idle',
    },
  ] as MutableConnectorStatus[] };
}

function browserFile(contents: string, name: string, type: string): Parameters<typeof previewFile>[0] {
  return new NodeFile([contents], name, { type }) as unknown as Parameters<typeof previewFile>[0];
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('browser file connector client', () => {
  it('lets the browser own multipart boundaries and sends only safe required headers', async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return Response.json({
        filename: 'notes.md', type: 'markdown', title: 'notes', excerpt: 'bounded…',
        characters: 100, pages: 0, paragraphs: 2, tables: 0,
        rawDigest: 'a'.repeat(64), normalizedDigest: 'b'.repeat(64),
        previewToken: PREVIEW_TOKEN, expiresAt: '2026-08-21T12:05:00.000Z',
      });
    }));
    const file = browserFile('a: Atlas is owned by Priya.', 'notes.md', 'text/markdown');

    const result = await previewFile(file, request());

    expect(result).toMatchObject({ kind: 'receipt', value: { previewToken: PREVIEW_TOKEN } });
    expect(captured?.credentials).toBe('same-origin');
    const headers = new Headers(captured?.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('X-CSRF-Token')).toBe('csrf-under-test');
    expect(headers.has('Content-Type')).toBe(false);
    expect(captured?.body).toBeInstanceOf(FormData);
    expect((captured?.body as FormData).get('file')).toBe(file);
  });

  it('imports once without retry and includes only the file plus preview token', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return Response.json({ error: 'readiness_failed' }, { status: 503 });
    }));
    const file = browserFile('source', 'source.txt', 'text/plain');

    const result = await importFile(file, PREVIEW_TOKEN, request());

    expect(result).toEqual({ kind: 'known_refusal', status: 503, code: 'readiness_failed' });
    expect(calls).toHaveLength(1);
    const form = calls[0]?.body as FormData;
    const names: string[] = [];
    form.forEach((_value, name) => names.push(name));
    expect(names).toEqual(['file', 'preview_token']);
    expect(form.get('file')).toBe(file);
    expect(form.get('preview_token')).toBe(PREVIEW_TOKEN);
  });

  it('decodes an expired preview as one known refusal without retrying', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: 'preview_expired' }, { status: 409 }));
    vi.stubGlobal('fetch', fetcher);
    const file = browserFile('source', 'source.txt', 'text/plain');

    await expect(importFile(file, PREVIEW_TOKEN, request())).resolves.toEqual({
      kind: 'known_refusal', status: 409, code: 'preview_expired',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honours caller abort and keeps the timeout alive through JSON parsing', async () => {
    const file = browserFile('source', 'source.txt', 'text/plain');
    const caller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      })
    )));
    const aborted = previewFile(file, { ...request(caller.signal), csrf: 'csrf' });
    caller.abort();
    await expect(aborted).resolves.toEqual({ kind: 'discarded' });

    vi.useFakeTimers();
    let bodyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { bodyStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => await new Promise<never>((_resolve, reject) => {
        bodyStarted?.();
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    })));
    const timed = previewFile(file, { ...request(), csrf: 'csrf' });
    await started;
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(timed).resolves.toEqual({ kind: 'indeterminate' });
  });

  it('cancels a stalled connector response body when the caller aborts after headers', async () => {
    let readStarted = false;
    let releaseRead!: (result: { readonly done: boolean; readonly value?: Uint8Array }) => void;
    const reader = {
      read: vi.fn(() => {
        readStarted = true;
        return new Promise<{ readonly done: boolean; readonly value?: Uint8Array }>((resolve) => {
          releaseRead = resolve;
        });
      }),
      cancel: vi.fn(async () => { releaseRead?.({ done: true }); }),
      releaseLock: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => reader },
    })));
    const caller = new AbortController();
    const pending = getConnectorCatalogue(BINDING, caller.signal);

    await vi.waitFor(() => expect(readStarted).toBe(true));
    caller.abort();
    if (reader.cancel.mock.calls.length === 0) releaseRead({ done: true });

    await expect(pending).resolves.toEqual({ kind: 'discarded' });
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it('strictly decodes the no-store catalogue and sends the exact session binding once', async () => {
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, ...(init === undefined ? {} : { init }) });
      return Response.json(catalogueBody());
    }));

    const result = await getConnectorCatalogue(BINDING, new AbortController().signal);

    expect(result.kind).toBe('receipt');
    if (result.kind === 'receipt') expect(result.value.connectors[0]?.id).toBe('github');
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe('/api/workspace/connectors');
    expect(calls[0]?.init?.cache).toBe('no-store');
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('x-lacuna-voice-binding')).toBe(BINDING);
    expect(headers.has('content-type')).toBe(false);
  });

  it('uses one reviewed JSON POST for GitHub and HTTPS and never echoes an HTTPS query', async () => {
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, ...(init === undefined ? {} : { init }) });
      if (String(input).endsWith('/github/import')) {
        return Response.json({
          ...RUN_RECEIPT, connectorId: 'github', snapshotCommit: 'b'.repeat(40),
          snapshotDigest: 'c'.repeat(64), consideredEntries: 2, fetchedBlobs: 1,
          skipped: [{ reason: 'unsupported_extension', count: 1 }],
        });
      }
      return Response.json({
        ...RUN_RECEIPT, connectorId: 'https_api', sourceDigest: 'd'.repeat(64),
        contentDigest: 'e'.repeat(64),
      });
    }));
    const github = await importGitHub('https://github.com/acme/atlas', request());
    const source = 'https://api.example.com/data?credential=never-render';
    const https = await importHttps(source, request());

    expect(github).toMatchObject({ kind: 'receipt', value: { connectorId: 'github' } });
    expect(https).toMatchObject({
      kind: 'receipt', value: { connectorId: 'https_api', sourceDigest: 'd'.repeat(64) },
    });
    expect(JSON.stringify(https)).not.toContain('credential=never-render');
    expect(calls).toHaveLength(2);
    expect(calls.map(({ input }) => String(input))).toEqual([
      '/api/workspace/connectors/github/import', '/api/workspace/connectors/api/import',
    ]);
    expect(calls.map(({ init }) => init?.body)).toEqual([
      JSON.stringify({ url: 'https://github.com/acme/atlas' }), JSON.stringify({ url: source }),
    ]);
  });

  it('pins the bodyless webhook issue contract and rejects invalid status/body pairings', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return Response.json({
        created: true,
        endpointId: 'A'.repeat(22),
        endpoint: `${location.origin}/api/connectors/webhook/${'A'.repeat(22)}`,
        secret: calls.length === 3 ? 'B'.repeat(43) : 'A'.repeat(43),
        configuredAt: '2026-08-21T12:00:00.000Z',
      }, { status: calls.length === 2 ? 200 : 201 });
    }));
    vi.stubGlobal('location', { origin: 'https://app.example.test' });

    const valid = await issueWebhook(request());
    const invalidPair = await issueWebhook(request());
    const noncanonicalSecret = await issueWebhook(request());

    expect(valid).toMatchObject({ kind: 'receipt', value: { created: true, secret: 'A'.repeat(43) } });
    expect(invalidPair).toEqual({ kind: 'indeterminate' });
    expect(noncanonicalSecret).toEqual({ kind: 'indeterminate' });
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.method).toBe('POST');
      expect(call.body).toBeUndefined();
      expect(new Headers(call.headers).has('content-type')).toBe(false);
    }
  });

  it('strictly validates authoritative webhook state and revokes only one exact id', async () => {
    vi.stubGlobal('location', { origin: 'https://app.example.test' });
    const id = 'A'.repeat(22);
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, ...(init === undefined ? {} : { init }) });
      if (init?.method === 'DELETE') return Response.json({ revoked: true });
      return Response.json({
        configured: true,
        endpointId: id,
        endpoint: `https://app.example.test/api/connectors/webhook/${id}`,
        configuredAt: '2026-08-21T12:00:00.000Z',
      });
    }));

    await expect(getWebhookState(BINDING, new AbortController().signal)).resolves.toMatchObject({
      kind: 'receipt', value: { configured: true, endpointId: id },
    });
    await expect(revokeWebhook(id, request())).resolves.toEqual({
      kind: 'receipt', value: { revoked: true },
    });
    expect(calls.map(({ input }) => String(input))).toEqual([
      '/api/workspace/connectors/webhook', `/api/workspace/connectors/webhook/${id}`,
    ]);
    expect(calls[1]?.init?.method).toBe('DELETE');
    expect(calls[1]?.init?.body).toBeUndefined();
  });

  it('turns malformed successful responses into indeterminate without retrying', async () => {
    const fetcher = vi.fn(async () => Response.json({ ...RUN_RECEIPT, collection: 'must-not-render' }));
    vi.stubGlobal('fetch', fetcher);
    const file = browserFile('source', 'source.txt', 'text/plain');

    await expect(importFile(file, PREVIEW_TOKEN, request())).resolves.toEqual({ kind: 'indeterminate' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects impossible receipt cross-fields instead of rendering false readiness', async () => {
    const replies = [
      { ...RUN_RECEIPT, searchableDocuments: 2 },
      { ...RUN_RECEIPT, acceptedDocuments: 0, searchableDocuments: 0, failure: null, indeterminateSubmission: true },
      { ...RUN_RECEIPT, startedAt: '2026-08-21T12:01:00.000Z', completedAt: '2026-08-21T12:00:00.000Z' },
    ];
    const fetcher = vi.fn(async () => Response.json(replies.shift()));
    vi.stubGlobal('fetch', fetcher);
    const source = browserFile('source', 'source.txt', 'text/plain');

    await expect(importFile(source, PREVIEW_TOKEN, request())).resolves.toEqual({ kind: 'indeterminate' });
    await expect(importFile(source, PREVIEW_TOKEN, request())).resolves.toEqual({ kind: 'indeterminate' });
    await expect(importFile(source, PREVIEW_TOKEN, request())).resolves.toEqual({ kind: 'indeterminate' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('accepts a legitimate mixed multi-document indeterminate receipt whose first failure is retained', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...RUN_RECEIPT,
      connectorId: 'github', submittedDocuments: 2, acceptedDocuments: 1,
      searchableDocuments: 1, failedDocuments: 1, refusedRecords: 1,
      failure: 'receipt_refused', indeterminateSubmission: true,
      snapshotCommit: 'b'.repeat(40), snapshotDigest: 'c'.repeat(64),
      consideredEntries: 2, fetchedBlobs: 2, skipped: [],
    })));

    await expect(importGitHub('https://github.com/acme/atlas', request())).resolves.toMatchObject({
      kind: 'receipt',
      value: { failure: 'receipt_refused', indeterminateSubmission: true, acceptedDocuments: 1 },
    });
  });

  it('rejects catalogue reason, state, chronology, configuration, order, and count contradictions', async () => {
    const invalidBodies = [
      (() => { const body = catalogueBody(); body.connectors[0]!.availability = 'unavailable'; body.connectors[0]!.reason = 'file_import_unavailable'; return body; })(),
      (() => { const body = catalogueBody(); body.connectors[0]!.configuredAt = '2026-08-21T12:00:00.000Z'; return body; })(),
      (() => { const body = catalogueBody(); body.connectors[0]!.lastFailure = 'readiness_failed'; return body; })(),
      (() => { const body = catalogueBody(); body.connectors[0]!.importedDocuments = 1; return body; })(),
      (() => { const body = catalogueBody(); body.connectors[0]!.importedDocuments = 1_000_001; body.connectors[0]!.lastAttemptAt = '2026-08-21T12:00:00.000Z'; body.connectors[0]!.lastSuccessAt = '2026-08-21T12:00:00.000Z'; return body; })(),
      (() => { const body = catalogueBody(); body.connectors[0]!.lastAttemptAt = '2026-08-21T12:00:00.000Z'; body.connectors[0]!.lastSuccessAt = '2026-08-21T12:00:01.000Z'; return body; })(),
      (() => { const body = catalogueBody(); body.connectors.reverse(); return body; })(),
    ];
    const fetcher = vi.fn(async () => Response.json(invalidBodies.shift()));
    vi.stubGlobal('fetch', fetcher);

    for (let index = 0; index < 7; index += 1) {
      await expect(getConnectorCatalogue(BINDING, new AbortController().signal))
        .resolves.toEqual({ kind: 'indeterminate' });
    }
    expect(fetcher).toHaveBeenCalledTimes(7);
  });
});
