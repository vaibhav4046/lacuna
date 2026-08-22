/**
 * Production voice boundary smoke.
 *
 * This proves the provider-backed path without printing the opaque provider
 * token or audio bytes. It does not inspect a browser profile or claim that a
 * particular browser autoplay policy has been accepted.
 *
 *   npm run smoke:voice -- https://lacuna-five.vercel.app
 */

const target = (process.argv[2] ?? 'http://127.0.0.1:3014').replace(/\/+$/u, '');

let passed = 0;
let failed = 0;

function record(ok: boolean, name: string, detail = ''): void {
  if (ok) passed += 1;
  else failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)}${detail}\n`);
}

function heldCookies(response: Response): Record<string, string> {
  const held: Record<string, string> = {};
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(';', 1)[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value === '') delete held[name];
    else held[name] = value;
  }
  return held;
}

function cookieHeader(held: Readonly<Record<string, string>>): string {
  return Object.entries(held).map(([name, value]) => `${name}=${value}`).join('; ');
}

process.stdout.write(`Voice provider boundary, against ${target}\n\n`);

const session = await fetch(`${target}/api/session`, { headers: { Accept: 'application/json' } });
const held = heldCookies(session);
const csrf = held['lacuna_csrf'];
const cookie = cookieHeader(held);
record(session.status === 200, 'session boundary is reachable', String(session.status));
record(typeof csrf === 'string' && csrf.length > 0, 'CSRF proof is issued', csrf === undefined ? 'missing' : 'set');

const commonHeaders = {
  Origin: target,
  Cookie: cookie,
  ...(csrf === undefined ? {} : { 'x-csrf-token': csrf }),
};
const tokenResponse = await fetch(`${target}/api/explore/voice/token`, {
  method: 'POST',
  headers: commonHeaders,
});
let tokenBody: Record<string, unknown> = {};
try { tokenBody = await tokenResponse.json() as Record<string, unknown>; } catch { tokenBody = {}; }
record(tokenResponse.status === 200, 'provider token boundary returns 200', String(tokenResponse.status));
record(typeof tokenBody['token'] === 'string'
  && (tokenBody['token'] as string).length >= 8
  && (tokenBody['token'] as string).length <= 2_048,
  'provider token is bounded and opaque',
  typeof tokenBody['token'] === 'string' ? `${(tokenBody['token'] as string).length} chars` : 'missing');

const speechResponse = await fetch(`${target}/api/explore/voice/speech`, {
  method: 'POST',
  headers: { ...commonHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Lacuna production voice check.' }),
});
const audio = await speechResponse.arrayBuffer();
const contentType = speechResponse.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
record(speechResponse.status === 200, 'provider speech boundary returns 200', String(speechResponse.status));
record(contentType === 'audio/mpeg' && audio.byteLength > 0 && audio.byteLength <= 12 * 1024 * 1024,
  'provider speech returns bounded MPEG audio', `${contentType ?? 'missing'} · ${audio.byteLength} bytes`);

const denied = await fetch(`${target}/api/explore/voice/token`, {
  method: 'POST',
  headers: { Origin: target, Cookie: cookie },
});
record(denied.status === 403, 'missing CSRF proof is refused', String(denied.status));

process.stdout.write(`\n${passed} of ${passed + failed} gates passed against ${target}\n`);
if (failed > 0) process.exit(1);

export {};
