import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
  type KeyObject,
  type webcrypto,
} from 'node:crypto';

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
 * then its RS256 signature is verified against Google's fixed HTTPS JWKS. TLS
 * authenticates the endpoint; the signature also binds the claims to Google
 * and makes the OIDC validation explicit. Audience, issuer, expiry, subject,
 * verified email and, when the caller supplies one, nonce are checked after
 * the signature. A valid Google token for another application is still not an
 * answer to whether this person may sign in here.
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
  /** Stable Google account id. Email alone is not a provider binding. */
  readonly subject: string;
}

/** Google's endpoints, written out rather than discovered, so this is readable. */
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const JWKS = 'https://www.googleapis.com/oauth2/v3/certs';

const SCOPES = 'openid email profile';

/** A provider outage must return to sign-in, never leave the callback hanging. */
export const GOOGLE_PROVIDER_TIMEOUT_MS = 10_000;

/** Provider JSON is small identity metadata, never an unbounded document. */
const GOOGLE_JSON_MAX_BYTES = 1_048_576;

/** The issuer Google uses. Both spellings are current and both are accepted. */
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export class GoogleAuthError extends Error {}

/**
 * Fetch aborts can cross a realm boundary (or come from a polyfill), so an
 * `instanceof DOMException` check is not a reliable way to recognise the
 * provider deadline. The stable contract is the error name.
 */
function hasErrorName(error: unknown, names: readonly string[]): boolean {
  return typeof error === 'object' && error !== null
    && typeof (error as { readonly name?: unknown }).name === 'string'
    && names.includes((error as { readonly name: string }).name);
}

export interface GoogleAuthorizationProof {
  /** OAuth PKCE verifier, kept server side for the callback. */
  readonly codeVerifier: string;
  /** S256 challenge sent on the authorization request. */
  readonly codeChallenge: string;
  /** OIDC replay binding, kept server side for ID-token validation. */
  readonly nonce: string;
}

export interface GoogleAuthorizationOptions {
  readonly codeChallenge: string;
  readonly nonce: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/u;

/** One independently random PKCE verifier and OIDC nonce. */
export function newGoogleAuthorizationProof(): GoogleAuthorizationProof {
  const codeVerifier = randomBytes(32).toString('base64url');
  return {
    codeVerifier,
    codeChallenge: createHash('sha256').update(codeVerifier, 'ascii').digest('base64url'),
    nonce: randomBytes(32).toString('base64url'),
  };
}

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
export function authorizeUrl(
  config: GoogleConfig,
  state: string,
  proof?: GoogleAuthorizationOptions,
): string {
  if (proof !== undefined && (
    proof.codeChallenge.length < 43 || proof.codeChallenge.length > 128
    || !BASE64URL.test(proof.codeChallenge)
    || proof.nonce.length < 32 || proof.nonce.length > 256
    || !BASE64URL.test(proof.nonce)
  )) {
    throw new GoogleAuthError('the authorization proof is malformed');
  }
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    prompt: 'select_account',
    ...(proof === undefined ? {} : {
      code_challenge: proof.codeChallenge,
      code_challenge_method: 'S256',
      nonce: proof.nonce,
    }),
  });
  return `${AUTHORIZE}?${query.toString()}`;
}

interface TokenResponse {
  readonly id_token?: unknown;
}

/** Read provider JSON with the same bounded timeout as the network request. */
async function readGoogleJson(response: Response, signal: AbortSignal): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    rejectAbort(new GoogleAuthError('the Google provider timed out'));
    if (reader !== null) void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    if (response.body === null || typeof response.body.getReader !== 'function') {
      try {
        return await Promise.race([response.json() as Promise<unknown>, aborted]);
      } catch (error) {
        if (error instanceof GoogleAuthError) throw error;
        throw new GoogleAuthError('the provider response could not be read');
      }
    }

    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        // Node's fetch reader and the DOM lib describe the optional `value`
        // on a completed read differently. The runtime contract is the same;
        // normalize it at this boundary before racing the provider deadline.
        const read = reader.read() as Promise<ReadableStreamReadResult<Uint8Array>>;
        next = await Promise.race([read, aborted]);
      } catch (error) {
        if (error instanceof GoogleAuthError) throw error;
        if (signal.aborted) throw new GoogleAuthError('the Google provider timed out');
        throw new GoogleAuthError('the provider response could not be read');
      }
      if (next.done) break;
      if (next.value === undefined) continue;
      total += next.value.byteLength;
      if (total > GOOGLE_JSON_MAX_BYTES) throw new GoogleAuthError('the provider response was too large');
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new GoogleAuthError('the provider response could not be read');
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader?.releaseLock();
  }
}

interface GoogleJwk {
  readonly kid?: unknown;
  readonly kty?: unknown;
  readonly alg?: unknown;
  readonly use?: unknown;
  readonly n?: unknown;
  readonly e?: unknown;
}

interface GoogleJwks {
  readonly keys?: unknown;
}

interface TokenParts {
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  readonly signingInput: Buffer;
  readonly signature: Buffer;
}

interface CachedKey {
  readonly key: KeyObject;
  readonly expiresAt: number;
}

const keyCache = new Map<string, CachedKey>();

function objectFromPart(part: string, label: string): Record<string, unknown> {
  try {
    const decoded = Buffer.from(part, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new GoogleAuthError(`the identity token carried no ${label}`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    throw new GoogleAuthError(`the identity token ${label} could not be read`);
  }
}

/** Decode only enough JWT structure to select a key; trust follows verification. */
function tokenParts(idToken: string): TokenParts {
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts[0] === undefined || parts[1] === undefined || parts[2] === undefined) {
    throw new GoogleAuthError('the identity token was not a JWT');
  }
  if (!BASE64URL.test(parts[0]) || !BASE64URL.test(parts[1]) || !BASE64URL.test(parts[2])) {
    throw new GoogleAuthError('the identity token was not base64url');
  }
  return {
    header: objectFromPart(parts[0], 'header'),
    payload: objectFromPart(parts[1], 'claims'),
    signingInput: Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'),
    signature: Buffer.from(parts[2], 'base64url'),
  };
}

function keyTtl(response: Response, now: number): number {
  const cache = response.headers.get('cache-control') ?? '';
  const match = /(?:^|,)\s*max-age=(\d+)/iu.exec(cache);
  const seconds = match?.[1] === undefined ? 3_600 : Number(match[1]);
  const bounded = Number.isSafeInteger(seconds) ? Math.min(86_400, Math.max(60, seconds)) : 3_600;
  return now + bounded * 1_000;
}

async function googleKey(
  kid: string,
  fetchImpl: typeof fetch,
  now: number,
  signal?: AbortSignal,
): Promise<KeyObject> {
  const cached = keyCache.get(kid);
  if (cached !== undefined && cached.expiresAt > now) return cached.key;

  const response = await fetchImpl(JWKS, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new GoogleAuthError(`the key endpoint answered ${response.status}`);
  let body: GoogleJwks;
  try {
    body = await readGoogleJson(response, signal ?? new AbortController().signal) as GoogleJwks;
  } catch {
    throw new GoogleAuthError('the key endpoint response could not be read');
  }
  if (!Array.isArray(body.keys)) throw new GoogleAuthError('the key endpoint carried no keys');

  const expiresAt = keyTtl(response, now);
  let selected: KeyObject | null = null;
  for (const raw of body.keys) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const jwk = raw as GoogleJwk;
    if (typeof jwk.kid !== 'string' || jwk.kid.length === 0 || jwk.kid.length > 256) continue;
    if (jwk.kty !== 'RSA' || (jwk.alg !== undefined && jwk.alg !== 'RS256')
      || (jwk.use !== undefined && jwk.use !== 'sig')
      || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') continue;
    try {
      const key = createPublicKey({ key: jwk as webcrypto.JsonWebKey, format: 'jwk' });
      keyCache.set(jwk.kid, { key, expiresAt });
      if (jwk.kid === kid) selected = key;
    } catch {
      // One malformed key must not hide another valid key in the same set.
    }
  }
  if (selected === null) throw new GoogleAuthError('the identity token named an unknown signing key');
  return selected;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(createHash('sha256').update(a, 'utf8').digest());
  const right = Buffer.from(createHash('sha256').update(b, 'utf8').digest());
  return timingSafeEqual(left, right);
}

export interface GoogleIdTokenOptions {
  readonly expectedNonce?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
}

/** Verify Google's RS256 signature and every claim Lacuna relies on. */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  options: GoogleIdTokenOptions = {},
): Promise<Record<string, unknown>> {
  const parts = tokenParts(idToken);
  const alg = parts.header['alg'];
  const kid = parts.header['kid'];
  if (alg !== 'RS256' || typeof kid !== 'string' || kid.length === 0 || kid.length > 256) {
    throw new GoogleAuthError('the identity token named no supported signing key');
  }
  const now = (options.now ?? Date.now)();
  const key = await googleKey(kid, options.fetch ?? fetch, now, options.signal);
  if (!verifySignature('RSA-SHA256', parts.signingInput, key, parts.signature)) {
    throw new GoogleAuthError('the identity token signature was invalid');
  }

  const payload = parts.payload;
  if (payload['aud'] !== clientId) {
    throw new GoogleAuthError('the identity token was minted for another application');
  }
  if (typeof payload['iss'] !== 'string' || !ISSUERS.has(payload['iss'])) {
    throw new GoogleAuthError('the identity token came from another issuer');
  }
  const expiry = payload['exp'];
  if (typeof expiry !== 'number' || !Number.isSafeInteger(expiry) || expiry * 1000 <= now) {
    throw new GoogleAuthError('the identity token has expired');
  }
  const subject = payload['sub'];
  if (typeof subject !== 'string' || subject.length === 0 || subject.length > 255) {
    throw new GoogleAuthError('the identity token carried no subject');
  }
  if (options.expectedNonce !== undefined) {
    const nonce = payload['nonce'];
    if (typeof nonce !== 'string' || !sameText(nonce, options.expectedNonce)) {
      throw new GoogleAuthError('the identity token nonce did not match');
    }
  }
  return payload;
}

export interface GoogleCodeOptions {
  readonly codeVerifier?: string;
  readonly expectedNonce?: string;
  /** Test seam for exercising the same bounded timeout with a short clock. */
  readonly timeoutMs?: number;
  /** Test seam. Production uses verifyGoogleIdToken above. */
  readonly verifyIdToken?: (idToken: string, clientId: string, expectedNonce?: string) => Promise<Record<string, unknown>>;
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
  options: GoogleCodeOptions = {},
): Promise<GoogleIdentity> {
  if (options.codeVerifier !== undefined && (
    options.codeVerifier.length < 43 || options.codeVerifier.length > 128
    || !BASE64URL.test(options.codeVerifier)
  )) {
    throw new GoogleAuthError('the PKCE verifier is malformed');
  }
  const signal = AbortSignal.timeout(options.timeoutMs ?? GOOGLE_PROVIDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        ...(options.codeVerifier === undefined ? {} : { code_verifier: options.codeVerifier }),
      }).toString(),
      signal,
    });
  } catch (error) {
    if (hasErrorName(error, ['TimeoutError', 'AbortError'])) {
      throw new GoogleAuthError('the Google provider timed out');
    }
    throw error;
  }

  if (!response.ok) throw new GoogleAuthError(`the token endpoint answered ${response.status}`);

  const body = await readGoogleJson(response, signal) as TokenResponse;
  if (typeof body.id_token !== 'string') {
    throw new GoogleAuthError('the token response carried no identity token');
  }

  const payload = options.verifyIdToken === undefined
    ? await verifyGoogleIdToken(body.id_token, config.clientId, {
      ...(options.expectedNonce === undefined ? {} : { expectedNonce: options.expectedNonce }),
      fetch: fetchImpl,
      signal,
    })
    : await options.verifyIdToken(body.id_token, config.clientId, options.expectedNonce);

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
  const subject = payload['sub'];
  // verifyGoogleIdToken proves this. The explicit seam used by tests must meet
  // the same contract or fail closed here.
  if (typeof subject !== 'string' || subject.length === 0 || subject.length > 255) {
    throw new GoogleAuthError('the identity token carried no subject');
  }
  return {
    email: email.trim().toLowerCase(),
    name: typeof name === 'string' && name.trim() !== '' ? name.trim() : null,
    subject,
  };
}
