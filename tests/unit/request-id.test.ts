import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClientRequestId } from '../../web/src/api/request-id.js';

afterEach(() => vi.unstubAllGlobals());

describe('browser mutation request ids', () => {
  it('uses the platform UUID when the browser exposes it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'native-id' });
    expect(createClientRequestId('ui')).toBe('ui-native-id');
  });

  it('falls back to Web Crypto when embedded browsers omit randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => { bytes.fill(0x11); return bytes; },
    });
    expect(createClientRequestId('ui')).toMatch(/^ui-11111111-1111-4111-9111-111111111111$/u);
  });
});
