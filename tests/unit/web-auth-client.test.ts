import { afterEach, describe, expect, it, vi } from 'vitest';

import { configurePassword } from '../../web/src/api/auth.js';
import { postJson } from '../../web/src/api/client.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the browser auth client', () => {
  it('returns the one-time recovery code after an authenticated password setup', async () => {
    vi.stubGlobal('document', { cookie: 'lacuna_csrf=csrf-under-test' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      signedIn: true,
      recoveryCode: 'ABCDE-FGHIJ-KLMNO-PQRST',
    })));

    await expect(configurePassword('a-secure-password-for-lacuna')).resolves.toEqual({
      recoveryCode: 'ABCDE-FGHIJ-KLMNO-PQRST',
    });
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
});
