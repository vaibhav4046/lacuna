import { describe, expect, it } from 'vitest';
import { gmailAuthorizeUrl } from '../../src/connectors/gmail-oauth.js';

describe('gmailAuthorizeUrl', () => {
  it('requests only offline read-only Gmail access with PKCE', () => {
    const proof = 'a'.repeat(43);
    const url = new URL(gmailAuthorizeUrl({ clientId: 'client', redirectUri: 'https://lacuna.test/callback' }, proof, proof));
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });
});
