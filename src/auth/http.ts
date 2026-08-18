import type { IncomingMessage } from 'node:http';

/**
 * Cookies, CSRF, and reading a small JSON body.
 *
 * Two cookies. The session cookie is httpOnly, so script cannot read it and an
 * injected script cannot steal it. The CSRF cookie deliberately is not: the
 * page reads it and sends the same value back in a header, and a cross-origin
 * form post cannot do that because it cannot read the cookie. That is the whole
 * mechanism, and it is worth keeping in one file so nobody later "fixes" the
 * CSRF cookie by making it httpOnly and quietly disables the check.
 */

export const SESSION_COOKIE = 'lacuna_session';
export const CSRF_COOKIE = 'lacuna_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** A body larger than this is not a sign in form, it is someone probing. */
export const MAX_BODY_BYTES = 4_096;

export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === '') continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // A cookie we did not set, carrying bytes that are not percent encoded.
      // Skipped rather than thrown: another site's cookie is not our error.
    }
  }
  return out;
}

export interface CookieOptions {
  readonly maxAgeSeconds: number;
  readonly httpOnly: boolean;
  readonly secure: boolean;
}

export function serialiseCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${options.maxAgeSeconds}`,
    'SameSite=Lax',
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
  return serialiseCookie(name, '', { maxAgeSeconds: 0, httpOnly: false, secure });
}

export class BodyTooLarge extends Error {}

/** Reads at most MAX_BODY_BYTES and parses it as JSON. Never throws on bad JSON. */
export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge(`body over ${MAX_BODY_BYTES} bytes`);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The double submit check. Both halves have to be present and equal; a missing
 * cookie is a failure rather than a skip, because "no cookie means no check" is
 * how this control gets turned off by accident.
 */
export function csrfOk(request: IncomingMessage, cookies: Readonly<Record<string, string>>): boolean {
  const cookie = cookies[CSRF_COOKIE];
  const header = request.headers[CSRF_HEADER];
  const sent = Array.isArray(header) ? header[0] : header;
  if (typeof cookie !== 'string' || cookie === '') return false;
  if (typeof sent !== 'string' || sent === '') return false;
  return cookie === sent;
}

/** Trimmed, lowercased, and only if it looks like one address. */
export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}
