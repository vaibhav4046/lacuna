export {};

/**
 * Non-destructive production proof for the hosted authentication boundary.
 *
 * This deliberately stops before Google's account chooser: completing OAuth
 * requires the account owner to select an identity. It still verifies every
 * security property Lacuna controls before that hand-off, plus the fail-closed
 * callback and the hosted Google-only signup policy.
 *
 *   npm run smoke:google -- https://lacuna-five.vercel.app
 */

const target = (process.argv[2] ?? 'http://127.0.0.1:3014').replace(/\/+$/, '');

let passed = 0;
let failed = 0;

function record(ok: boolean, name: string, detail = ''): void {
  if (ok) passed += 1;
  else failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)}${detail}\n`);
}

function cookiePairs(lines: readonly string[]): Record<string, string> {
  const held: Record<string, string> = {};
  for (const line of lines) {
    const pair = line.split(';')[0];
    const separator = pair?.indexOf('=') ?? -1;
    if (pair !== undefined && separator > 0) {
      held[pair.slice(0, separator)] = pair.slice(separator + 1);
    }
  }
  return held;
}

function cookieHeader(held: Readonly<Record<string, string>>): string {
  return Object.entries(held).map(([name, value]) => `${name}=${value}`).join('; ');
}

process.stdout.write(`Google auth boundary, against ${target}\n\n`);

const begun = await fetch(`${target}/api/auth/google/start`, { redirect: 'manual' });
const locationValue = begun.headers.get('location') ?? '';
let location: URL | null = null;
try {
  location = new URL(locationValue);
} catch {
  location = null;
}
const setCookies = begun.headers.getSetCookie();
const held = cookiePairs(setCookies);

record(begun.status === 302, 'OAuth starts with a redirect', String(begun.status));
record(location?.origin === 'https://accounts.google.com', "redirect is Google's authorization origin");
record(location?.searchParams.get('response_type') === 'code', 'authorization-code flow is selected');
record(location?.searchParams.get('redirect_uri') === `${target}/api/auth/google/callback`, 'callback is pinned to this origin');
record(location?.searchParams.get('scope') === 'openid email profile', 'scopes are identity-only');
record(location?.searchParams.get('prompt') === 'select_account', 'account selection is explicit');
record(location?.searchParams.get('code_challenge_method') === 'S256'
  && /^[A-Za-z0-9_-]{43}$/.test(location?.searchParams.get('code_challenge') ?? ''), 'PKCE S256 proof is present');
record((location?.searchParams.get('nonce') ?? '') === held['lacuna_google_nonce'], 'OIDC nonce is browser-bound');
record(/^[A-Za-z0-9_-]{43}$/.test(held['lacuna_google_state'] ?? ''), 'CSRF state is high entropy');
record(/^[A-Za-z0-9_-]{43}$/.test(held['lacuna_google_pkce'] ?? ''), 'PKCE verifier is high entropy');
record(setCookies.length === 3
  && setCookies.every((cookie) => cookie.includes('HttpOnly')
    && cookie.includes('Secure') && cookie.includes('SameSite=Lax')), 'transient cookies are hardened');
record(begun.headers.get('cache-control') === 'no-store, private'
  && begun.headers.get('pragma') === 'no-cache', 'OAuth redirect is not cacheable');

const badCallback = await fetch(`${target}/api/auth/google/callback?state=wrong&code=unused`, {
  redirect: 'manual',
  headers: { cookie: cookieHeader(held) },
});
const cleared = badCallback.headers.getSetCookie();
record(badCallback.status === 302 && badCallback.headers.get('location') === '/signin?google=state', 'wrong state fails before token exchange');
record(cleared.length === 3 && cleared.every((cookie) => cookie.includes('Max-Age=0')), 'failed callback clears transient cookies');

const session = await fetch(`${target}/api/session`);
const sessionCookies = session.headers.getSetCookie();
const sessionHeld = cookiePairs(sessionCookies);
const csrf = sessionHeld['lacuna_csrf'];
const passwordSignup = await fetch(`${target}/api/auth/signup`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    cookie: cookieHeader(sessionHeld),
    ...(csrf === undefined ? {} : { 'x-csrf-token': csrf }),
  },
  body: JSON.stringify({ email: `boundary-${Date.now()}@lacuna.test`, password: 'not-created-by-this-proof' }),
});
let signupBody: Record<string, unknown> = {};
try {
  signupBody = await passwordSignup.json() as Record<string, unknown>;
} catch {
  signupBody = {};
}
record(passwordSignup.status === 403 && signupBody['error'] === 'google_required', 'hosted account creation is Google-only');

process.stdout.write(`\n${passed} of ${passed + failed} gates passed against ${target}\n`);
if (failed > 0) process.exit(1);
