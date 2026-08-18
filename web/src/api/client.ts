/**
 * The one way this app talks to its server.
 *
 * Everything the product displays comes back through here, so the loading and
 * failure shapes are part of the type rather than something each screen
 * invents. A screen that has not heard back yet cannot accidentally render a
 * value, because there is no value to render until the state says ready.
 *
 * The failure strings are the design's own error vocabulary. Anything
 * unexpected collapses into "Connection failed." rather than leaking a parser
 * message onto the page.
 */

import { useEffect, useState } from 'react';

export type Loaded<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly value: T }
  | { readonly state: 'failed'; readonly reason: string };

export const CONNECTION_FAILED = 'Connection failed.';
export const REQUEST_TIMED_OUT = 'Request timed out.';
export const PERMISSION_REQUIRED = 'Permission required.';

const REASONS: ReadonlySet<string> = new Set([CONNECTION_FAILED, REQUEST_TIMED_OUT, PERMISSION_REQUIRED]);

function reasonForStatus(status: number): string {
  if (status === 401 || status === 403) return PERMISSION_REQUIRED;
  if (status === 408 || status === 504) return REQUEST_TIMED_OUT;
  return CONNECTION_FAILED;
}

function reasonFor(error: unknown): string {
  return error instanceof Error && REASONS.has(error.message) ? error.message : CONNECTION_FAILED;
}

export async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    signal,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(reasonForStatus(response.status));
  return (await response.json()) as T;
}

/**
 * Fetch once per path and hand back the three states.
 *
 * The abort on cleanup is what makes this safe under StrictMode's double
 * mount: the first effect's response is thrown away instead of racing the
 * second one into state.
 */
export function useLoaded<T>(path: string): Loaded<T> {
  const [result, setResult] = useState<Loaded<T>>({ state: 'loading' });

  useEffect(() => {
    const control = new AbortController();
    setResult({ state: 'loading' });
    getJson<T>(path, control.signal).then(
      (value) => {
        if (!control.signal.aborted) setResult({ state: 'ready', value });
      },
      (error: unknown) => {
        if (!control.signal.aborted) setResult({ state: 'failed', reason: reasonFor(error) });
      },
    );
    return () => control.abort();
  }, [path]);

  return result;
}

/** The name of the double-submit cookie the server sets for mutations. */
const CSRF_COOKIE = 'lacuna_csrf';

function csrfToken(): string {
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export interface PostResult {
  readonly ok: boolean;
  readonly status: number;
}

/**
 * A mutation. Sends the CSRF cookie back in a header so the server can check
 * that the request came from a page it served, and reports the status rather
 * than a message: nothing the server writes reaches the page as text, so a
 * response body can never become copy.
 */
export async function postJson(path: string, body: unknown): Promise<PostResult> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrfToken() },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
