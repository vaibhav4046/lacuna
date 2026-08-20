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
  404: 'No account for that email.',
  403: 'Permission required.',
  408: 'Request timed out.',
  409: 'That email already has an account.',
  422: 'Password must be at least 12 characters.',
  429: 'Too many attempts. Try again in a minute.',
  501: 'Password reset by email is not configured. Use your recovery code.',
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

/**
 * Creating an account returns the one thing it will ever return once.
 *
 * The recovery code is generated on the server, stored only as a hash, and put
 * in this response and nowhere else. A caller that drops it has thrown away the
 * only way back into that account, so it is returned as a value rather than
 * left in a body somebody may or may not read.
 */
export async function signUp(
  email: string,
  password: string,
): Promise<{ readonly problem: string } | { readonly recoveryCode: string }> {
  const result = await postJson('/api/auth/signup', { email, password });
  if (!result.ok) return { problem: messageFor(result.status) };
  const code = (result.body as { recoveryCode?: unknown } | null)?.recoveryCode;
  // A server that answered without one is a server this build does not match.
  // Reporting success and showing nothing would be worse than saying so.
  return typeof code === 'string' && code !== ''
    ? { recoveryCode: code }
    : { problem: 'The account was created but no recovery code came back. Sign in and check Settings.' };
}

/**
 * A new password, proved by the recovery code rather than by email.
 *
 * Succeeds with a replacement code, because the one just used is spent. The
 * caller has to show it for the same reason signup does.
 */
export async function recover(
  email: string,
  code: string,
  password: string,
): Promise<{ readonly problem: string } | { readonly recoveryCode: string }> {
  const result = await postJson('/api/auth/recover', { email, code, password });
  if (!result.ok) {
    return { problem: result.status === 401 ? 'That email and recovery code do not match.' : messageFor(result.status) };
  }
  const next = (result.body as { recoveryCode?: unknown } | null)?.recoveryCode;
  return typeof next === 'string' && next !== ''
    ? { recoveryCode: next }
    : { problem: 'The password was changed but no new recovery code came back.' };
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
