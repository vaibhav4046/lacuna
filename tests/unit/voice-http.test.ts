import { describe, expect, it, vi } from 'vitest';

import { postVoiceOperationJson } from '../../web/src/api/voice-operations.js';

describe('voice operation HTTP boundary', () => {
  it('primes CSRF before the first private voice mutation on a clean browser', async () => {
    let token = '';
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      if (String(input) === '/api/session') {
        token = 'voice-token';
        return { ok: true, status: 200, json: async () => ({ signedIn: true }) } as Response;
      }
      expect(new Headers(init?.headers).get('x-csrf-token')).toBe('voice-token');
      return { ok: true, status: 200, json: async () => ({ accepted: true }) } as Response;
    });

    await expect(postVoiceOperationJson('/api/workspace/voice/intent', { version: 1 }, {
      fetchImpl,
      csrfToken: () => token,
    })).resolves.toEqual({ accepted: true });
    expect(calls).toEqual(['/api/session', '/api/workspace/voice/intent']);
  });
});
