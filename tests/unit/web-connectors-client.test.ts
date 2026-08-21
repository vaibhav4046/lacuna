import { File as NodeFile } from 'node:buffer';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { importFile, previewFile } from '../../web/src/api/connectors.js';

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
        previewToken: 'signed-token', expiresAt: '2026-08-21T12:05:00.000Z',
      });
    }));
    const file = browserFile('a: Atlas is owned by Priya.', 'notes.md', 'text/markdown');

    const result = await previewFile(file, 'csrf-under-test', new AbortController().signal);

    expect(result).toMatchObject({ ok: true, value: { previewToken: 'signed-token' } });
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

    const result = await importFile(file, 'signed-token', 'csrf-under-test', new AbortController().signal);

    expect(result).toEqual({ ok: false, status: 503 });
    expect(calls).toHaveLength(1);
    const form = calls[0]?.body as FormData;
    const names: string[] = [];
    form.forEach((_value, name) => names.push(name));
    expect(names).toEqual(['file', 'preview_token']);
    expect(form.get('file')).toBe(file);
    expect(form.get('preview_token')).toBe('signed-token');
  });

  it('honours caller abort and keeps the timeout alive through JSON parsing', async () => {
    const file = browserFile('source', 'source.txt', 'text/plain');
    const caller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      })
    )));
    const aborted = previewFile(file, 'csrf', caller.signal);
    caller.abort();
    await expect(aborted).resolves.toEqual({ ok: false, status: 0 });

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
    const timed = previewFile(file, 'csrf', new AbortController().signal);
    await started;
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(timed).resolves.toEqual({ ok: false, status: 408 });
  });
});
