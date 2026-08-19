export {};

/**
 * Accounts, against a running deployment.
 *
 *   npm run smoke:auth -- https://lacuna-five.vercel.app
 *
 * The deployment has no writable filesystem, so an account is only real if it
 * survives a different function invocation than the one that created it. Every
 * request below is a separate one, and the sign in at the end uses a fresh
 * cookie jar, so nothing here can pass on in-memory state.
 *
 * It creates one throwaway account per run under a reserved domain and leaves
 * it behind. That is deliberate: an account that can be deleted by an
 * unauthenticated caller would be a worse hole than a few test rows.
 */

const target = (process.argv[2] ?? 'http://127.0.0.1:3014').replace(/\/+$/, '');
const email = `smoke-${Date.now()}@lacuna.test`;
const password = 'correct horse battery staple';

let passed = 0;
let failed = 0;

function record(ok: boolean, name: string, detail: string): void {
  if (ok) passed += 1;
  else failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)}${detail}\n`);
}

/** One cookie jar, as a browser keeps one. */
class Jar {
  readonly #values = new Map<string, string>();

  absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      if (pair === undefined) continue;
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const value = pair.slice(eq + 1);
      if (value === '') this.#values.delete(pair.slice(0, eq));
      else this.#values.set(pair.slice(0, eq), value);
    }
  }

  header(): string {
    return [...this.#values].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  get(name: string): string | undefined {
    return this.#values.get(name);
  }
}

async function call(
  jar: Jar,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const csrf = jar.get('lacuna_csrf');
  const response = await fetch(`${target}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrf === undefined ? {} : { 'x-csrf-token': csrf }),
      Cookie: jar.header(),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  jar.absorb(response);
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

process.stdout.write(`Accounts, against ${target}\n\n`);

const jar = new Jar();

// The first read issues the CSRF cookie a browser would have.
const first = await call(jar, '/api/session');
record(first.status === 200 && first.body['signedIn'] === false, 'a fresh visitor is signed out', String(first.status));
record(jar.get('lacuna_csrf') !== undefined, 'the session read issues a CSRF cookie', 'set');

const created = await call(jar, '/api/auth/signup', { method: 'POST', body: { email, password } });
record(created.body['signedIn'] === true, 'sign up creates an account', `${created.status}`);

// A separate request, which on this host is very likely a separate instance.
const after = await call(jar, '/api/session');
const session = after.body['session'] as { email?: string; workspace?: string | null } | undefined;
record(
  after.body['signedIn'] === true && session?.email === email,
  'the account survives a second request',
  session?.email ?? 'no session',
);

const named = await call(jar, '/api/workspace', { method: 'POST', body: { workspace: 'acme / backend' } });
// 204 is the endpoint's success: it names the workspace and returns nothing.
record(named.status === 200 || named.status === 204, 'onboarding names a workspace', String(named.status));

const onboarded = await call(jar, '/api/session');
const settled = onboarded.body['session'] as { workspace?: string | null; onboarded?: boolean } | undefined;
record(
  settled?.workspace === 'acme / backend' && settled?.onboarded === true,
  'the workspace persists',
  `${settled?.workspace ?? 'none'}`,
);

const memory = await call(jar, '/api/workspace/memory');
record(
  typeof (memory.body['total']) === 'number' && (memory.body['total'] as number) > 0,
  'the signed-in workspace reads its own rows',
  `${String(memory.body['total'])} rows`,
);

const duplicate = await call(jar, '/api/auth/signup', { method: 'POST', body: { email, password } });
record(duplicate.status === 409 || duplicate.body['error'] !== undefined, 'a taken address is refused', String(duplicate.status));

await call(jar, '/api/auth/signout', { method: 'POST' });
const out = await call(jar, '/api/session');
record(out.body['signedIn'] === false, 'sign out ends the session', 'signed out');

// A new jar, so the sign in cannot ride on anything the old one held.
const second = new Jar();
await call(second, '/api/session');
const back = await call(second, '/api/auth/signin', { method: 'POST', body: { email, password } });
record(back.body['signedIn'] === true, 'sign in works from a clean browser', String(back.status));

const restored = await call(second, '/api/session');
const kept = restored.body['session'] as { email?: string; workspace?: string | null } | undefined;
record(
  kept?.email === email && kept?.workspace === 'acme / backend',
  'state persists across sign out and back in',
  `${kept?.workspace ?? 'none'}`,
);

const wrong = new Jar();
await call(wrong, '/api/session');
const refused = await call(wrong, '/api/auth/signin', { method: 'POST', body: { email, password: 'not the password' } });
record(refused.body['signedIn'] !== true, 'a wrong password is refused', String(refused.status));

process.stdout.write(`\n${passed} of ${passed + failed} gates passed against ${target}\n`);
if (failed > 0) process.exit(1);
