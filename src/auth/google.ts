/**
 * Signing in with Google, as an authorization code exchange and nothing more.
 *
 * The only thing this asks Google for is who the person is: `openid`, `email`
 * and `profile`. No Gmail, no Drive, no offline access and no refresh token,
 * because the product never acts on anyone's behalf at Google. It learns a
 * verified address once, at sign in, and then forgets that Google was involved.
 * Scopes beyond these also drag the app into a verification review, which is a
 * real cost paid for a capability nothing here wants.
 *
 * The identity token is read from the direct response to the token endpoint,
 * over HTTPS, authenticated with the client secret. Google's own guidance is
 * that a token obtained that way does not need its signature checked again,
 * because the transport already established who sent it. The claims inside it
 * are still checked, since a valid signature on a token minted for somebody
 * else's application is not an answer to whether this person may sign in here.
 *
 * What is deliberately not here: no refresh token is requested or stored, no
 * Google user id is used as a primary key, and an unverified address is
 * refused. That last one matters most. Anyone can create a Google account
 * claiming an address, and only `email_verified` says Google checked it. Taking
 * an unverified address would let a stranger sign in as an existing member by
 * asserting their email.
 */

export interface GoogleConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface GoogleIdentity {
  readonly email: string;
  readonly name: string | null;
}

/** Google's endpoints, written out rather than discovered, so this is readable. */
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

const SCOPES = 'openid email profile';

/** The issuer Google uses. Both spellings are current and both are accepted. */
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export class GoogleAuthError extends Error {}

/**
 * Build the URL a person is sent to, carrying the state that ties their return
 * to this browser.
 *
 * `state` is not decoration. Without it a third party can hand somebody a
 * completed callback URL and sign them into an account they do not own, which
 * is the login half of cross-site request forgery. The value is minted by the
 * caller, put in an httpOnly cookie, and compared on the way back.
 *
 * `prompt=select_account` is deliberate: without it a person already signed
 * into one Google account is silently signed into this product as that account,
 * with no way to choose, which is surprising on a shared machine.
 */
export function authorizeUrl(config: GoogleConfig, state: string): string {
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    prompt: 'select_account',
  });
  return `${AUTHORIZE}?${query.toString()}`;
}

interface TokenResponse {
  readonly id_token?: unknown;
}

/** The middle segment of a JWT, decoded. No signature check, see the header. */
function claims(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts[1] === undefined) {
    throw new GoogleAuthError('the identity token was not a JWT');
  }
  try {
    const decoded = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new GoogleAuthError('the identity token carried no claims');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    throw new GoogleAuthError('the identity token could not be read');
  }
}

/**
 * Exchange the code for an identity, or throw.
 *
 * Every failure here is the same outcome for the person: they are sent back to
 * sign in. The distinctions exist so the reason can be logged without the
 * response telling an attacker which check failed.
 */
export async function identityFromCode(
  config: GoogleConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleIdentity> {
  const response = await fetchImpl(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!response.ok) throw new GoogleAuthError(`the token endpoint answered ${response.status}`);

  const body = await response.json() as TokenResponse;
  if (typeof body.id_token !== 'string') {
    throw new GoogleAuthError('the token response carried no identity token');
  }

  const payload = claims(body.id_token);

  // Minted for this application, by Google, and not expired. A token that is
  // valid somewhere else is not valid here.
  if (payload['aud'] !== config.clientId) {
    throw new GoogleAuthError('the identity token was minted for another application');
  }
  if (typeof payload['iss'] !== 'string' || !ISSUERS.has(payload['iss'])) {
    throw new GoogleAuthError('the identity token came from another issuer');
  }
  const expiry = payload['exp'];
  if (typeof expiry !== 'number' || expiry * 1000 <= Date.now()) {
    throw new GoogleAuthError('the identity token has expired');
  }

  const email = payload['email'];
  if (typeof email !== 'string' || email === '') {
    throw new GoogleAuthError('the identity token carried no address');
  }

  // The check that stops one person signing in as another. Google only sets
  // this when it has confirmed the address belongs to the account.
  if (payload['email_verified'] !== true) {
    throw new GoogleAuthError('the address on the account is not verified');
  }

  const name = payload['name'];
  return {
    email: email.trim().toLowerCase(),
    name: typeof name === 'string' && name.trim() !== '' ? name.trim() : null,
  };
}
