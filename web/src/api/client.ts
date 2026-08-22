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
const REQUEST_TIMEOUT_MS = 15_000;
const SESSION_BINDING = /^[0-9a-f]{64}$/u;
const MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024;

function reasonForStatus(status: number): string {
  if (status === 401 || status === 403) return PERMISSION_REQUIRED;
  if (status === 408 || status === 504) return REQUEST_TIMED_OUT;
  return CONNECTION_FAILED;
}

function reasonFor(error: unknown): string {
  return error instanceof Error && REASONS.has(error.message) ? error.message : CONNECTION_FAILED;
}

/**
 * Consume JSON through the response stream so a caller/deadline abort also
 * cancels a body that delivered headers but never completes. Small embedded
 * adapters that expose only `json()` retain the compatibility fallback.
 */
async function readJsonBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.body === null || typeof response.body?.getReader !== 'function') {
    return response.json() as Promise<unknown>;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abortReject!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { abortReject = reject; });
  const onAbort = () => {
    abortReject(new Error('response body read cancelled'));
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > MAX_JSON_RESPONSE_BYTES) throw new Error('response body too large');
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function getJson<T>(path: string, signal: AbortSignal, sessionBinding?: string): Promise<T> {
  const control = new AbortController();
  const relayAbort = () => control.abort();
  let timedOut = false;
  if (signal.aborted) control.abort();
  else signal.addEventListener('abort', relayAbort, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    control.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      signal: control.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...sessionBindingHeader(sessionBinding) },
    });
    if (!response.ok) throw new Error(reasonForStatus(response.status));
    return (await readJsonBody(response, control.signal)) as T;
  } catch (error) {
    if (timedOut && error instanceof Error && error.name === 'AbortError') throw new Error(REQUEST_TIMED_OUT);
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    signal.removeEventListener('abort', relayAbort);
  }
}

/**
 * Fetch once per path and hand back the three states.
 *
 * The abort on cleanup is what makes this safe under StrictMode's double
 * mount: the first effect's response is thrown away instead of racing the
 * second one into state.
 */
export function useLoaded<T>(path: string, sessionBinding?: string): Loaded<T> {
  const [result, setResult] = useState<Loaded<T>>({ state: 'loading' });

  useEffect(() => {
    const control = new AbortController();
    setResult({ state: 'loading' });
    if (path.startsWith('/api/workspace/') && sessionBinding === undefined) {
      return () => control.abort();
    }
    getJson<T>(path, control.signal, sessionBinding).then(
      (value) => {
        if (!control.signal.aborted) setResult({ state: 'ready', value });
      },
      (error: unknown) => {
        if (!control.signal.aborted) setResult({ state: 'failed', reason: reasonFor(error) });
      },
    );
    return () => control.abort();
  }, [path, sessionBinding]);

  return result;
}

/** The name of the double-submit cookie the server sets for mutations. */
const CSRF_COOKIE = 'lacuna_csrf';

/** The double submit header, for a caller that builds its own request. */
export function csrfHeaders(): Readonly<Record<string, string>> {
  return { 'X-CSRF-Token': csrfToken() };
}

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function needsCsrfPreflight(path: string): boolean {
  return path.startsWith('/api/auth/') || path.startsWith('/api/workspace/');
}

/** Establishes the browser half of the double-submit proof without mutating state. */
async function primeCsrf(control: AbortController): Promise<void> {
  if (csrfToken() !== '') return;
  try {
    await fetch('/api/session', {
      signal: control.signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch {
    // The mutation below still fails closed if the token could not be issued.
  }
}

export interface PostResult {
  readonly ok: boolean;
  readonly status: number;
  /**
   * The parsed response, when there was one.
   *
   * Deliberately not used for messages: every sentence a person can see comes
   * from a fixed table keyed on the status, so a server that has been made to
   * echo something cannot put that something on the page. It is here for values
   * that have nowhere else to come from, like the recovery code that exists in
   * exactly one response and nowhere else ever again.
   */
  readonly body: unknown;
}

/**
 * A mutation. Sends the CSRF cookie back in a header so the server can check
 * that the request came from a page it served, and reports the status rather
 * than a message: nothing the server writes reaches the page as text, so a
 * response body can never become copy.
 */
export async function postJson(
  path: string,
  body: unknown,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  sessionBinding?: string,
): Promise<PostResult> {
  const send = async (): Promise<{
    readonly response: Response;
    readonly signal: AbortSignal;
    readonly clear: () => void;
    readonly timedOut: () => boolean;
  }> => {
    const control = new AbortController();
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      control.abort();
    }, timeoutMs);
    try {
      // A person can press a private action before the session provider's first
      // read has returned. Prime the double-submit cookie in that narrow
      // window. This request carries no mutation and is bounded by the same
      // abort signal; the actual mutation still fails closed at the server if
      // a token cannot be established.
      if (needsCsrfPreflight(path)) await primeCsrf(control);
      const response = await fetch(path, {
        method: 'POST',
        signal: control.signal,
        credentials: 'same-origin',
        headers: mutationHeaders(sessionBinding),
        body: JSON.stringify(body),
      });
      // `fetch` resolves after headers. Keep its abort timer alive while the
      // response body is parsed, otherwise a stalled JSON body leaves a form
      // disabled forever even though the request appeared to finish.
      return { response, signal: control.signal, clear: () => globalThis.clearTimeout(timeout), timedOut: () => timedOut };
    } catch (error) {
      globalThis.clearTimeout(timeout);
      throw error;
    }
  };

  try {
    let sent = await send();

    /**
     * One retry, and only for the first request a visitor ever makes.
     *
     * The CSRF cookie is minted by the server on the request that fails without
     * one, so somebody arriving at the sign up page with a clean browser had
     * their very first submission rejected every time. They saw "Permission
     * required" on a form that was perfectly valid, and creating an account
     * appeared to be broken until they happened to press the button twice.
     *
     * Retrying once, only on 403, and only when the cookie has appeared since
     * the first attempt, fixes that without turning a real refusal into a loop:
     * if the token is still missing the second attempt is not made.
     */
    if (sent.response.status === 403 && csrfToken() !== '') {
      sent.clear();
      sent = await send();
    }

    // A 204 has no body and neither does a failure worth reading. Parsing is
    // best effort because the status is what decides everything a user sees.
    let parsed: unknown = null;
    try {
      parsed = sent.response.status === 204 ? null : await readJsonBody(sent.response, sent.signal);
    } catch (error) {
      if (sent.timedOut()) throw error;
      parsed = null;
    } finally {
      sent.clear();
    }
    return { ok: sent.response.ok, status: sent.response.status, body: parsed };
  } catch (error) {
    return { ok: false, status: error instanceof Error && error.name === 'AbortError' ? 408 : 0, body: null };
  }
}

/**
 * A mutation that answers with a document. Same CSRF header as postJson; the
 * difference is that the caller needs the body, so a parse failure is a null
 * rather than a thrown error in a click handler.
 */
export async function postFor<T>(
  path: string,
  body: unknown,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  sessionBinding?: string,
): Promise<T | null> {
  const send = async (): Promise<{
    readonly response: Response;
    readonly signal: AbortSignal;
    readonly clear: () => void;
  }> => {
    const control = new AbortController();
    const timeout = globalThis.setTimeout(() => control.abort(), timeoutMs);
    try {
      if (needsCsrfPreflight(path)) await primeCsrf(control);
      const response = await fetch(path, {
        method: 'POST',
        signal: control.signal,
        credentials: 'same-origin',
        headers: mutationHeaders(sessionBinding),
        body: JSON.stringify(body),
      });
      return { response, signal: control.signal, clear: () => globalThis.clearTimeout(timeout) };
    } catch (error) {
      globalThis.clearTimeout(timeout);
      throw error;
    }
  };

  try {
    let sent = await send();
    // The session endpoint may have issued a token between a concurrent read
    // and this mutation. Retry once only when the server refused the missing
    // proof and a token is now present; never turn another refusal into a loop.
    if (sent.response.status === 403 && csrfToken() !== '') {
      sent.clear();
      sent = await send();
    }
    if (!sent.response.ok) { sent.clear(); return null; }
    try {
      return (await readJsonBody(sent.response, sent.signal)) as T;
    } finally {
      sent.clear();
    }
  } catch {
    return null;
  }
}

function mutationHeaders(sessionBinding?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-CSRF-Token': csrfToken(),
  };
  return { ...headers, ...sessionBindingHeader(sessionBinding) };
}

function sessionBindingHeader(sessionBinding?: string): Readonly<Record<string, string>> {
  return sessionBinding !== undefined && SESSION_BINDING.test(sessionBinding)
    ? { 'x-lacuna-voice-binding': sessionBinding }
    : {};
}
