import { describe, expect, it } from 'vitest';

import { GoogleAuthError, authorizeUrl, identityFromCode } from '../../src/auth/google.js';

/**
 * What Lacuna will and will not accept as proof of who somebody is.
 *
 * Most of these are refusals, and that is the point. A sign in flow is judged
 * by what it turns away: a token minted for a different application, one that
 * expired, one from another issuer, and above all one carrying an address
 * Google has not verified. That last case is the one that would let a stranger
 * take an existing member's account by asserting their email, so it has its own
 * test and its own sentence in the source.
 */

const CONFIG = {
  clientId: 'client-under-test.apps.googleusercontent.com',
  clientSecret: 'not-a-real-secret',
  redirectUri: 'https://lacuna-five.vercel.app/api/auth/google/callback',
};

const later = (): number => Math.floor(Date.now() / 1000) + 600;
const earlier = (): number => Math.floor(Date.now() / 1000) - 600;

/** A JWT with a real shape and no signature worth checking. See the source. */
function idToken(payload: Record<string, unknown>): string {
  const part = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(payload)}.${part('signature')}`;
}

function serving(payload: Record<string, unknown>, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify({ id_token: idToken(payload) }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;
}

const GOOD = {
  aud: CONFIG.clientId,
  iss: 'https://accounts.google.com',
  exp: later(),
  email: 'Person@Example.com',
  email_verified: true,
  name: 'A Person',
};

describe('the URL a person is sent to', () => {
  it('asks for identity and nothing else', () => {
    const url = new URL(authorizeUrl(CONFIG, 'state-value'));
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-value');
  });

  it('does not ask for offline access, because nothing acts for a person at Google', () => {
    const url = new URL(authorizeUrl(CONFIG, 's'));
    expect(url.searchParams.get('access_type')).toBeNull();
  });

  it('lets a person choose an account rather than silently using the signed in one', () => {
    expect(new URL(authorizeUrl(CONFIG, 's')).searchParams.get('prompt')).toBe('select_account');
  });
});

describe('an identity Lacuna accepts', () => {
  it('is returned with the address folded, so one person is one account', async () => {
    const identity = await identityFromCode(CONFIG, 'code', serving(GOOD));
    expect(identity).toEqual({ email: 'person@example.com', name: 'A Person' });
  });

  it('carries a null name rather than an empty one', async () => {
    const identity = await identityFromCode(CONFIG, 'code', serving({ ...GOOD, name: '  ' }));
    expect(identity.name).toBeNull();
  });

  it('accepts the bare issuer spelling, which Google also uses', async () => {
    const identity = await identityFromCode(CONFIG, 'code', serving({ ...GOOD, iss: 'accounts.google.com' }));
    expect(identity.email).toBe('person@example.com');
  });
});

describe('an identity Lacuna refuses', () => {
  const refuses = async (payload: Record<string, unknown>): Promise<unknown> =>
    identityFromCode(CONFIG, 'code', serving(payload)).catch((error: unknown) => error);

  it('refuses an address Google has not verified', async () => {
    expect(await refuses({ ...GOOD, email_verified: false })).toBeInstanceOf(GoogleAuthError);
    expect(await refuses({ ...GOOD, email_verified: 'true' })).toBeInstanceOf(GoogleAuthError);
    const { email_verified: _omitted, ...missing } = GOOD;
    expect(await refuses(missing)).toBeInstanceOf(GoogleAuthError);
  });

  it('refuses a token minted for another application', async () => {
    expect(await refuses({ ...GOOD, aud: 'somebody-else.apps.googleusercontent.com' }))
      .toBeInstanceOf(GoogleAuthError);
  });

  it('refuses a token from another issuer', async () => {
    expect(await refuses({ ...GOOD, iss: 'https://accounts.evil.example' }))
      .toBeInstanceOf(GoogleAuthError);
  });

  it('refuses an expired token', async () => {
    expect(await refuses({ ...GOOD, exp: earlier() })).toBeInstanceOf(GoogleAuthError);
    expect(await refuses({ ...GOOD, exp: 'soon' })).toBeInstanceOf(GoogleAuthError);
  });

  it('refuses a token with no address', async () => {
    const { email: _omitted, ...missing } = GOOD;
    expect(await refuses(missing)).toBeInstanceOf(GoogleAuthError);
    expect(await refuses({ ...GOOD, email: '' })).toBeInstanceOf(GoogleAuthError);
  });

  it('refuses when the token endpoint fails', async () => {
    const failing = (async () => new Response('no', { status: 400 })) as unknown as typeof fetch;
    await expect(identityFromCode(CONFIG, 'code', failing)).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it('refuses a response carrying no identity token', async () => {
    const empty = (async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
    await expect(identityFromCode(CONFIG, 'code', empty)).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it('refuses something that is not a JWT at all', async () => {
    const junk = (async () => new Response(JSON.stringify({ id_token: 'not.a' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
    await expect(identityFromCode(CONFIG, 'code', junk)).rejects.toBeInstanceOf(GoogleAuthError);
  });
});

describe('what reaches Google', () => {
  it('sends the secret in the body and never in a query', async () => {
    let seen: { url: string; body: string } | null = null;
    const capture = (async (url: string | URL, init?: RequestInit) => {
      seen = { url: String(url), body: String(init?.body ?? '') };
      return new Response(JSON.stringify({ id_token: idToken(GOOD) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await identityFromCode(CONFIG, 'the-code', capture);
    expect(seen!.url).not.toContain(CONFIG.clientSecret);
    expect(seen!.url).toBe('https://oauth2.googleapis.com/token');
    expect(seen!.body).toContain('grant_type=authorization_code');
    expect(seen!.body).toContain('the-code');
  });
});
