import { postJson } from './client';

/**
 * Sign in, sign up and reset, and the sentences each failure is allowed to
 * produce.
 *
 * The message comes from the status code, never from the response body. A
 * server that has been made to echo something should not be able to put that
 * something on the page, and a fixed table means every string a user can see
 * is in this file where it can be read.
 */

const MESSAGES: Readonly<Record<number, string>> = {
  0: 'Connection failed.',
  400: 'Enter an email and a password.',
  401: 'Email or password not recognised.',
  403: 'Permission required.',
  408: 'Request timed out.',
  409: 'That email already has an account.',
  422: 'Password must be at least 12 characters.',
  429: 'Too many attempts. Try again in a minute.',
  501: 'Password reset is not configured.',
  504: 'Request timed out.',
};

function messageFor(status: number): string {
  return MESSAGES[status] ?? 'Connection failed.';
}

/** Null on success, otherwise the sentence to show. */
export async function signIn(email: string, password: string): Promise<string | null> {
  const result = await postJson('/api/auth/signin', { email, password });
  return result.ok ? null : messageFor(result.status);
}

export async function signUp(email: string, password: string): Promise<string | null> {
  const result = await postJson('/api/auth/signup', { email, password });
  return result.ok ? null : messageFor(result.status);
}

/**
 * The screen says a reset link will be emailed. If no mail transport is
 * configured the server says 501 and the screen says so, because a page that
 * reports success for something that did not happen is the same lie as a
 * status chip nobody checked.
 */
export async function requestReset(email: string): Promise<string | null> {
  const result = await postJson('/api/auth/reset', { email });
  return result.ok ? null : messageFor(result.status);
}

export async function signOut(): Promise<void> {
  await postJson('/api/auth/signout', {});
}
