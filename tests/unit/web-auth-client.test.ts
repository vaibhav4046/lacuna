import { afterEach, describe, expect, it, vi } from 'vitest';

import { getJson, postJson } from '../../web/src/api/client.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the browser auth client', () => {
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
