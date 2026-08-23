export interface GmailOAuthConfig {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
}

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';

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
