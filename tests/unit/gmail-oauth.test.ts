import { describe, expect, it } from 'vitest';
import { exchangeGmailCode, gmailAuthorizeUrl } from '../../src/connectors/gmail-oauth.js';

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

describe('exchangeGmailCode', () => {
  it('requires a refresh token from the provider exchange', async () => {
    await expect(exchangeGmailCode({ clientId: 'id', clientSecret: 'secret', redirectUri: 'https://lacuna.test/callback' }, 'code', 'verifier', async () => new Response(JSON.stringify({ access_token: 'short-lived' }), { status: 200 })))
      .rejects.toThrow('Gmail token exchange failed');
  });
});
