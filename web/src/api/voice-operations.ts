export type VoiceOperationRequestFailure = 'session_required' | 'request_failed' | 'invalid_plan';

export class VoiceOperationRequestError extends Error {
  readonly failure: VoiceOperationRequestFailure;

  constructor(failure: VoiceOperationRequestFailure) {
    super(failure);
    this.name = 'VoiceOperationRequestError';
    this.failure = failure;
  }
}

export interface VoiceOperationApiOptions {
  readonly fetchImpl: typeof fetch;
  readonly csrfToken: () => string;
}

export interface VoiceIntentInput {
  readonly version: 1;
  readonly requestId: string;
  readonly transcript: string;
  readonly currentRoute: string;
}

function failure(status: number): VoiceOperationRequestError {
  return new VoiceOperationRequestError(status === 401 ? 'session_required' : 'request_failed');
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw failure(response.status);
  try {
    return await response.json() as unknown;
  } catch {
    throw new VoiceOperationRequestError('request_failed');
  }
}

/** Reads only the double-submit value. The server remains its authority. */
export function browserCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== 'lacuna_csrf') continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      return '';
    }
  }
  return '';
}

export async function getVoiceOperationJson(
  path: string,
  options: VoiceOperationApiOptions,
  sessionBinding?: string,
): Promise<unknown> {
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (sessionBinding !== undefined) headers['X-Lacuna-Voice-Binding'] = sessionBinding;
    const response = await options.fetchImpl(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers,
    });
    return await responseJson(response);
  } catch (error) {
    if (error instanceof VoiceOperationRequestError) throw error;
    throw new VoiceOperationRequestError('request_failed');
  }
}

export async function postVoiceOperationJson(
  path: string,
  body: unknown,
  options: VoiceOperationApiOptions,
  sessionBinding?: string,
): Promise<unknown> {
  try {
    // Voice actions are private mutations too. A clean tab can reach the
    // voice dock before the session read has issued the double-submit cookie;
    // prime it with the same read-only boundary used by the main client.
    if (options.csrfToken() === '') {
      try {
        await options.fetchImpl('/api/session', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
      } catch {
        // The private mutation below remains fail-closed if no token appears.
      }
    }
    const send = () => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': options.csrfToken(),
      };
      if (sessionBinding !== undefined) headers['X-Lacuna-Voice-Binding'] = sessionBinding;
      return options.fetchImpl(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(body),
      });
    };
    let response = await send();
    // A concurrent session read can issue the cookie just after the first
    // request starts. Retry once only when that new proof is visible.
    if (response.status === 403 && options.csrfToken() !== '') response = await send();
    return await responseJson(response);
  } catch (error) {
    if (error instanceof VoiceOperationRequestError) throw error;
    throw new VoiceOperationRequestError('request_failed');
  }
}

export function requestVoiceIntent(
  input: VoiceIntentInput,
  options: VoiceOperationApiOptions,
  sessionBinding: string,
): Promise<unknown> {
  return postVoiceOperationJson('/api/workspace/voice/intent', input, options, sessionBinding);
}
