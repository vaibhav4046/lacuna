import { afterEach, describe, expect, it, vi } from 'vitest';

import { getJson, postFor, postJson } from '../../web/src/api/client.js';
import { googleProblem } from '../../web/src/auth/google-problem.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the browser auth client', () => {
  it('does not promise recovery to an unbound legacy account that may not have a recovery code', () => {
    const problem = googleProblem('?google=legacy_unbound') ?? '';

    expect(problem).toContain('existing password below');
    expect(problem).toContain('If you saved a recovery code');
    expect(problem).not.toContain('password or recovery code');
  });

  it('settles a stalled auth mutation as a timeout instead of leaving the form busy forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { cookie: 'lacuna_csrf=csrf-under-test' });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      })
    )));

    let settled = false;
    const request = postJson('/api/auth/signin', { email: 'probe@example.invalid', password: 'not-a-password' })
      .then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(settled).toBe(true);
    await expect(request).resolves.toMatchObject({ ok: false, status: 408 });
  });

  it('settles an auth mutation when headers arrive but its response body stalls', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { cookie: 'lacuna_csrf=csrf-under-test' });
    let markBodyStarted: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => await new Promise<never>((_resolve, reject) => {
        markBodyStarted?.();
        if (init?.signal?.aborted === true) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    })));

    const request = postJson('/api/auth/signin', { email: 'probe@example.invalid', password: 'not-a-password' });
    await bodyStarted;
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(request).resolves.toMatchObject({ ok: false, status: 408 });
  });

  it('settles a document mutation when its JSON body stalls instead of leaving product controls busy', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { cookie: 'lacuna_csrf=csrf-under-test' });
    let markBodyStarted: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => await new Promise<never>((_resolve, reject) => {
        markBodyStarted?.();
        if (init?.signal?.aborted === true) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    })));

    let settled = false;
    const request = postFor<{ readonly answer: string }>('/api/explore/query', { question: 'Who owns token-forge?' })
      .then((result) => {
        settled = true;
        return result;
      });
    await bodyStarted;
    await vi.advanceTimersByTimeAsync(15_000);

    expect(settled).toBe(true);
    await expect(request).resolves.toBeNull();
  });

  it('lets long agent mutations use their full supported wall-time budget', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { cookie: 'lacuna_csrf=csrf-under-test' });
    let markBodyStarted: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => await new Promise<never>((_resolve, reject) => {
        markBodyStarted?.();
        if (init?.signal?.aborted === true) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    })));

    let settled = false;
    const request = postFor('/api/workspace/schedules/schedule-1/run', {}, 65_000)
      .then((result) => {
        settled = true;
        return result;
      });
    await bodyStarted;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(50_000);
    expect(settled).toBe(true);
    await expect(request).resolves.toBeNull();
  });

  it('settles a stalled session read as a timeout instead of freezing route guards', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      })
    )));

    const request = getJson('/api/session', new AbortController().signal);
    const assertion = expect(request).rejects.toThrow('Request timed out.');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });
});
