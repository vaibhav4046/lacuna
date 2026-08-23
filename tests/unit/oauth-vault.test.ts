import { describe, expect, it } from 'vitest';

import { OAuthTokenVault } from '../../src/connectors/oauth-vault.js';

describe('OAuthTokenVault', () => {
  it('round-trips a refresh token without retaining it in the ciphertext', () => {
    const vault = new OAuthTokenVault(Buffer.alloc(32, 7));
    const sealed = vault.seal('gmail', 'workspace-a', 'refresh-token-value');
    expect(sealed).not.toContain('refresh-token-value');
    expect(vault.open('gmail', 'workspace-a', sealed)).toBe('refresh-token-value');
  });

  it('rejects a token copied to another workspace', () => {
    const vault = new OAuthTokenVault(Buffer.alloc(32, 7));
    const sealed = vault.seal('gmail', 'workspace-a', 'refresh-token-value');
    expect(() => vault.open('gmail', 'workspace-b', sealed)).toThrow('invalid OAuth token record');
  });
});
