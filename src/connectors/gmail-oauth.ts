export interface GmailOAuthConfig {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
}

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

/** Isolated from sign-in: Gmail obtains only an explicit read-only grant. */
export function gmailAuthorizeUrl(config: GmailOAuthConfig, state: string, codeChallenge: string): string {
  if (config.clientId === '' || config.redirectUri === '' || state.length < 43 || codeChallenge.length < 43) {
    throw new Error('invalid Gmail authorization request');
  }
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GMAIL_READONLY_SCOPE,
    state,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE}?${query.toString()}`;
}

export async function exchangeGmailCode(
  config: Required<GmailOAuthConfig>, code: string, codeVerifier: string, fetchImpl: typeof fetch = fetch,
): Promise<{ readonly refreshToken: string; readonly accessToken: string; readonly expiresIn: number }> {
  if (code.length === 0 || code.length > 2_048 || codeVerifier.length < 43) throw new Error('Gmail token exchange failed');
  let response: Response;
  try {
    response = await fetchImpl(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri,
      grant_type: 'authorization_code', code_verifier: codeVerifier,
    }).toString(), signal: AbortSignal.timeout(10_000) });
  } catch { throw new Error('Gmail token exchange failed'); }
  if (!response.ok) throw new Error('Gmail token exchange failed');
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Gmail token exchange failed'); }
  if (typeof body !== 'object' || body === null) throw new Error('Gmail token exchange failed');
  const value = body as Record<string, unknown>;
  const expiresIn = value['expires_in'];
  if (typeof value['refresh_token'] !== 'string' || value['refresh_token'] === '' || typeof value['access_token'] !== 'string'
    || value['access_token'] === '' || typeof expiresIn !== 'number' || !Number.isSafeInteger(expiresIn) || expiresIn <= 0) throw new Error('Gmail token exchange failed');
  return { refreshToken: value['refresh_token'], accessToken: value['access_token'], expiresIn };
}
