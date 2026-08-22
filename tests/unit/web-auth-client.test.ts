import { afterEach, describe, expect, it, vi } from 'vitest';

import { getJson, postFor, postJson } from '../../web/src/api/client.js';
import {
  SessionEpochBus,
  SessionReadCoordinator,
  createSessionEpochMessage,
  parseSessionEpochMessage,
  type SessionState,
} from '../../web/src/api/session-state.js';
import * as sessionContracts from '../../web/src/api/session-state.js';
import { googleProblem } from '../../web/src/auth/google-problem.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the browser auth client', () => {
  it('accepts only the closed nonce-only cross-tab epoch message and emits canonical entropy', () => {
    expect(createSessionEpochMessage((bytes) => {
      bytes.set(Uint8Array.from({ length: 16 }, (_value, index) => index));
      return bytes;
    })).toEqual({ version: 1, nonce: '000102030405060708090a0b0c0d0e0f' });
    expect(parseSessionEpochMessage({ version: 1, nonce: 'a'.repeat(32) }))
      .toEqual({ version: 1, nonce: 'a'.repeat(32) });
    for (const invalid of [
      null,
      { version: 1, nonce: 'A'.repeat(32) },
      { version: 1, nonce: 'a'.repeat(31) },
      { version: 2, nonce: 'a'.repeat(32) },
      { version: 1, nonce: 'a'.repeat(32), binding: 'account-a' },
      { version: 1, nonce: 'a'.repeat(32), secret: 'must-not-cross-tabs' },
    ]) expect(parseSessionEpochMessage(invalid)).toBeNull();
  });

  it('deduplicates one remote epoch across channel and storage and removes every listener', () => {
    type Listener = (event: { readonly data?: unknown; readonly key?: string | null; readonly newValue?: string | null }) => void;
    const channelListeners = new Set<Listener>();
    const storageListeners = new Set<Listener>();
    const posted: unknown[] = [];
    const stored: { key: string; value: string }[] = [];
    let closed = false;
    let remote = 0;
    const bus = new SessionEpochBus({
      channel: {
        postMessage: (value) => posted.push(value),
        addEventListener: (_type, listener) => channelListeners.add(listener),
        removeEventListener: (_type, listener) => channelListeners.delete(listener),
        close: () => { closed = true; },
      },
      storage: { setItem: (key, value) => stored.push({ key, value }) },
      addStorageListener: (listener) => storageListeners.add(listener),
      removeStorageListener: (listener) => storageListeners.delete(listener),
      randomValues: (bytes) => { bytes.fill(0xab); return bytes; },
    }, () => { remote += 1; });

    const published = bus.publish();
    expect(published).toEqual({ version: 1, nonce: 'ab'.repeat(16) });
    expect(posted).toEqual([published]);
    expect(stored).toEqual([{
      key: 'lacuna_session_epoch_v1',
      value: JSON.stringify(published),
    }]);
    const incoming = { version: 1, nonce: 'cd'.repeat(16) };
    channelListeners.forEach((listener) => listener({ data: incoming }));
    storageListeners.forEach((listener) => listener({
      key: 'lacuna_session_epoch_v1', newValue: JSON.stringify(incoming),
    }));
    storageListeners.forEach((listener) => listener({
      key: 'lacuna_session_epoch_v1', newValue: JSON.stringify({ ...incoming, email: 'owner@example.com' }),
    }));
    expect(remote).toBe(1);

    bus.dispose();
    expect({ channel: channelListeners.size, storage: storageListeners.size, closed })
      .toEqual({ channel: 0, storage: 0, closed: true });
  });

  it('attempts both epoch transports even when one browser transport fails', () => {
    const stored: string[] = [];
    const bus = new SessionEpochBus({
      channel: {
        postMessage: () => { throw new Error('channel unavailable'); },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        close: () => undefined,
      },
      storage: { setItem: (_key, value) => stored.push(value) },
      addStorageListener: () => undefined,
      removeStorageListener: () => undefined,
      randomValues: (bytes) => { bytes.fill(0xef); return bytes; },
    }, () => undefined);

    expect(() => bus.publish()).toThrow('channel unavailable');
    expect(stored).toEqual([JSON.stringify({ version: 1, nonce: 'ef'.repeat(16) })]);
    bus.dispose();
  });

  it('makes the latest session read win and holds superseded callers until it settles', async () => {
    type Deferred = {
      readonly promise: Promise<SessionState>;
      readonly resolve: (value: SessionState) => void;
      readonly signal: AbortSignal;
    };
    const reads: Deferred[] = [];
    const ready: SessionState[] = [];
    const published: string[] = [];
    let loading = 0;
    const coordinator = new SessionReadCoordinator({
      read: (signal) => new Promise<SessionState>((resolve) => reads.push({
        promise: Promise.resolve({ signedIn: false }), resolve, signal,
      })),
      onLoading: () => { loading += 1; },
      onReady: (value) => ready.push(value),
      onFailed: () => { throw new Error('unexpected failure'); },
      onValidatedTransition: (identity) => published.push(identity),
    });

    let firstSettled = false;
    const first = coordinator.refresh('refresh').then(() => { firstSettled = true; });
    const second = coordinator.refresh('refresh');
    expect(reads).toHaveLength(2);
    expect(reads[0]?.signal.aborted).toBe(true);
    reads[0]?.resolve({ signedIn: true, session: {
      email: 'a@example.com', binding: 'a'.repeat(64), workspace: 'A', onboarded: true,
    } });
    await Promise.resolve();
    expect(firstSettled).toBe(false);
    expect(ready).toEqual([]);

    reads[1]?.resolve({ signedIn: true, session: {
      email: 'b@example.com', binding: 'b'.repeat(64), workspace: 'B', onboarded: true,
    } });
    await Promise.all([first, second]);
    expect(loading).toBe(2);
    expect(ready).toEqual([{ signedIn: true, session: {
      email: 'b@example.com', binding: 'b'.repeat(64), workspace: 'B', onboarded: true,
    } }]);
    expect(published).toEqual([`${'b'.repeat(64)}\u0000B`]);
  });

  it('invalidates synchronously for remote/focus reads without rebroadcasting unchanged or remote state', async () => {
    const states: SessionState[] = [
      { signedIn: true, session: {
        email: 'a@example.com', binding: 'a'.repeat(64), workspace: 'A', onboarded: true,
      } },
      { signedIn: true, session: {
        email: 'b@example.com', binding: 'b'.repeat(64), workspace: 'B', onboarded: true,
      } },
      { signedIn: true, session: {
        email: 'b@example.com', binding: 'b'.repeat(64), workspace: 'B', onboarded: true,
      } },
    ];
    const order: string[] = [];
    const published: string[] = [];
    const coordinator = new SessionReadCoordinator({
      read: async () => states.shift() ?? { signedIn: false },
      onLoading: () => order.push('loading'),
      onReady: (value) => order.push(value.signedIn ? value.session.workspace ?? 'none' : 'signed-out'),
      onFailed: () => order.push('failed'),
      onValidatedTransition: (identity) => published.push(identity),
    });

    await coordinator.refresh('initial');
    const remote = coordinator.refresh('remote');
    expect(order.at(-1)).toBe('loading');
    await remote;
    await coordinator.refresh('focus');

    expect(order).toEqual(['loading', 'A', 'loading', 'B', 'loading', 'B']);
    expect(published).toEqual([`${'a'.repeat(64)}\u0000A`]);
    coordinator.dispose();
  });

  it('commits removal of the old private tree before a revalidation can begin its fetch', async () => {
    const teardown = Reflect.get(sessionContracts, 'synchronousSessionTeardown');
    expect(teardown).toBeTypeOf('function');
    if (typeof teardown !== 'function') return;
    const oldPrivateTree = { isConnected: true };
    const order: string[] = [];
    const coordinator = new SessionReadCoordinator({
      read: async () => {
        order.push('fetch');
        expect(oldPrivateTree.isConnected).toBe(false);
        return { signedIn: false };
      },
      onLoading: () => teardown(
        () => { oldPrivateTree.isConnected = false; order.push('private-tree-removed'); },
        (commit: () => void) => commit(),
      ),
      onReady: () => order.push('ready'),
      onFailed: () => order.push('failed'),
      onValidatedTransition: () => undefined,
    });

    await coordinator.refresh('focus');
    expect(order).toEqual(['private-tree-removed', 'fetch', 'ready']);
    coordinator.dispose();
  });

  it('publishes one mutation epoch after synchronous teardown and destroys an old-tab secret before stalled or failed validation', async () => {
    type Listener = (event: { readonly data?: unknown }) => void;
    const remoteListeners = new Set<Listener>();
    const posted: unknown[] = [];
    const stored: string[] = [];
    const order: string[] = [];
    let localPrivateTree = true;
    let remoteSecret = true;
    let localReads = 0;
    let remoteReads = 0;
    let duplicateValidatedBroadcasts = 0;

    const remoteCoordinator = new SessionReadCoordinator({
      read: async (signal) => {
        remoteReads += 1;
        order.push('remote-read-stalled');
        return await new Promise<SessionState>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
      },
      onLoading: () => { remoteSecret = false; order.push('remote-secret-destroyed'); },
      onReady: () => { throw new Error('unexpected remote readiness'); },
      onFailed: () => { throw new Error('unexpected remote failure'); },
      onValidatedTransition: () => { duplicateValidatedBroadcasts += 1; },
    });
    const remoteBus = new SessionEpochBus({
      channel: {
        postMessage: () => undefined,
        addEventListener: (_type, listener) => remoteListeners.add(listener),
        removeEventListener: (_type, listener) => remoteListeners.delete(listener),
        close: () => undefined,
      },
      storage: { setItem: () => undefined },
      addStorageListener: () => undefined,
      removeStorageListener: () => undefined,
    }, () => { void remoteCoordinator.refresh('remote'); });

    const localBus = new SessionEpochBus({
      channel: {
        postMessage: (value) => {
          posted.push(value);
          remoteListeners.forEach((listener) => listener({ data: value }));
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        close: () => undefined,
      },
      storage: { setItem: (_key, value) => stored.push(value) },
      addStorageListener: () => undefined,
      removeStorageListener: () => undefined,
      randomValues: (bytes) => { bytes.fill(0x12); return bytes; },
    }, () => undefined);
    const localCoordinator = new SessionReadCoordinator({
      read: async () => {
        localReads += 1;
        order.push('local-read-failed');
        throw new Error('session validation failed');
      },
      onLoading: () => { localPrivateTree = false; order.push('local-tree-destroyed'); },
      onReady: () => { throw new Error('unexpected local readiness'); },
      onFailed: () => order.push('local-failed'),
      onValidatedTransition: () => { duplicateValidatedBroadcasts += 1; },
    });

    const refreshAfterMutation = Reflect.get(localCoordinator, 'refreshAfterMutation');
    expect(refreshAfterMutation).toBeTypeOf('function');
    if (typeof refreshAfterMutation !== 'function') {
      localCoordinator.dispose();
      remoteCoordinator.dispose();
      localBus.dispose();
      remoteBus.dispose();
      return;
    }
    const mutationRefresh = refreshAfterMutation.call(localCoordinator, () => {
      order.push('epoch-published');
      localBus.publish();
    });
    expect({ localPrivateTree, remoteSecret, localReads, remoteReads }).toEqual({
      localPrivateTree: false, remoteSecret: false, localReads: 1, remoteReads: 1,
    });
    expect(order.slice(0, 5)).toEqual([
      'local-tree-destroyed', 'epoch-published', 'remote-secret-destroyed',
      'remote-read-stalled', 'local-read-failed',
    ]);
    await mutationRefresh;
    expect(posted).toHaveLength(1);
    expect(stored).toHaveLength(1);
    expect(duplicateValidatedBroadcasts).toBe(0);
    expect(order.at(-1)).toBe('local-failed');

    localCoordinator.dispose();
    remoteCoordinator.dispose();
    localBus.dispose();
    remoteBus.dispose();
  });

  it('does not promise recovery to an unbound legacy account that may not have a recovery code', () => {
    const problem = googleProblem('?google=legacy_unbound') ?? '';

    expect(problem).toContain('existing password below');
    expect(problem).toContain('If you saved a recovery code');
    expect(problem).not.toContain('password or recovery code');
  });

  it('gives password-owned Google accounts a safe linking path', () => {
    const problem = googleProblem('?google=provider_mismatch') ?? '';

    expect(problem).toContain('Sign in with it first');
    expect(problem).toContain('Settings → Link Google');
    expect(problem).toContain('Forgot password');
  });

  it('settles a stalled auth mutation as a timeout instead of leaving the form busy forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { cookie: 'lacuna_csrf=csrf-under-test' });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      })
    )));

    let settled = false;
    const request = postJson('/api/auth/signin', { email: 'probe@example.invalid', password: 'not-a-password' })
      .then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(settled).toBe(true);
    await expect(request).resolves.toMatchObject({ ok: false, status: 408 });
  });

  it('recognises a cross-realm timeout error from a browser fetch implementation', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { cookie: 'lacuna_csrf=csrf-under-test' });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject({ name: 'TimeoutError' }), { once: true });
      })
    )));

    const request = postJson('/api/auth/signin', { email: 'probe@example.invalid', password: 'not-a-password' });
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(request).resolves.toMatchObject({ ok: false, status: 408 });
  });

  it('primes the CSRF cookie before the first auth submit on a clean browser', async () => {
    const browserDocument = { cookie: '' };
    vi.stubGlobal('document', browserDocument);
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init === undefined ? { input } : { input, init });
      if (String(input) === '/api/session') {
        browserDocument.cookie = 'lacuna_csrf=primed-token';
        return { ok: true, status: 200, json: async () => ({ signedIn: false }) };
      }
      return { ok: false, status: 401, json: async () => ({ error: 'credentials' }) };
    }));

    await expect(postJson('/api/auth/signin', { email: 'fresh@example.com', password: 'not-a-password' }))
      .resolves.toMatchObject({ ok: false, status: 401 });
    expect(calls.map((call) => String(call.input))).toEqual(['/api/session', '/api/auth/signin']);
    expect(new Headers(calls[1]?.init?.headers).get('x-csrf-token')).toBe('primed-token');
  });

  it('primes the CSRF cookie before the first private document mutation on a clean browser', async () => {
    const browserDocument = { cookie: '' };
    vi.stubGlobal('document', browserDocument);
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init === undefined ? { input } : { input, init });
      if (String(input) === '/api/session') {
        browserDocument.cookie = 'lacuna_csrf=workspace-token';
        return { ok: true, status: 200, json: async () => ({ signedIn: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));

    await expect(postFor<{ readonly ok: boolean }>('/api/workspace/query', { question: 'Who owns Atlas?' }))
      .resolves.toEqual({ ok: true });
    expect(calls.map((call) => String(call.input))).toEqual(['/api/session', '/api/workspace/query']);
    expect(new Headers(calls[1]?.init?.headers).get('x-csrf-token')).toBe('workspace-token');
  });

  it('settles an auth mutation when headers arrive but its response body stalls', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { cookie: 'lacuna_csrf=csrf-under-test' });
    let markBodyStarted: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => await new Promise<never>((_resolve, reject) => {
        markBodyStarted?.();
        if (init?.signal?.aborted === true) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    })));

    const request = postJson('/api/auth/signin', { email: 'probe@example.invalid', password: 'not-a-password' });
    await bodyStarted;
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(request).resolves.toMatchObject({ ok: false, status: 408 });
  });

  it('settles a document mutation when its JSON body stalls instead of leaving product controls busy', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { cookie: 'lacuna_csrf=csrf-under-test' });
    let markBodyStarted: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => await new Promise<never>((_resolve, reject) => {
        markBodyStarted?.();
        if (init?.signal?.aborted === true) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    })));

    let settled = false;
    const request = postFor<{ readonly answer: string }>('/api/explore/query', { question: 'Who owns token-forge?' })
      .then((result) => {
        settled = true;
        return result;
      });
    await bodyStarted;
    await vi.advanceTimersByTimeAsync(15_000);

    expect(settled).toBe(true);
    await expect(request).resolves.toBeNull();
  });

  it('lets long agent mutations use their full supported wall-time budget', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { cookie: 'lacuna_csrf=csrf-under-test' });
    let markBodyStarted: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => await new Promise<never>((_resolve, reject) => {
        markBodyStarted?.();
        if (init?.signal?.aborted === true) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    })));

    let settled = false;
    const request = postFor('/api/workspace/schedules/schedule-1/run', {}, 65_000)
      .then((result) => {
        settled = true;
        return result;
      });
    await bodyStarted;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(50_000);
    expect(settled).toBe(true);
    await expect(request).resolves.toBeNull();
  });

  it('sends the exact session voice binding on private mutations', async () => {
    vi.stubGlobal('document', { cookie: 'lacuna_csrf=csrf-under-test' });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      headers: new Headers(),
      requestHeaders: new Headers(init?.headers),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await postJson('/api/workspace/agent/run', { task: 'bounded' }, 65_000, 'a'.repeat(64));
    await postFor('/api/workspace/schedules/schedule-1/run', {}, 65_000, 'a'.repeat(64));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get('x-lacuna-voice-binding')).toBe('a'.repeat(64));
    }
  });

  it('sends the exact session voice binding on private run reads', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => [],
      headers: new Headers(),
      requestHeaders: new Headers(init?.headers),
    })));

    await getJson('/api/workspace/runs', new AbortController().signal, 'b'.repeat(64));

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(new Headers(call?.[1]?.headers).get('x-lacuna-voice-binding')).toBe('b'.repeat(64));
  });

  it('cancels a stalled private read body when the caller aborts after headers', async () => {
    let readStarted = false;
    let releaseRead!: (result: { readonly done: boolean; readonly value?: Uint8Array }) => void;
    const reader = {
      read: vi.fn(() => {
        readStarted = true;
        return new Promise<{ readonly done: boolean; readonly value?: Uint8Array }>((resolve) => {
          releaseRead = resolve;
        });
      }),
      cancel: vi.fn(async () => { releaseRead?.({ done: true }); }),
      releaseLock: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => reader },
    })));
    const caller = new AbortController();
    const request = getJson('/api/workspace/runs', caller.signal, 'b'.repeat(64));

    await vi.waitFor(() => expect(readStarted).toBe(true));
    caller.abort();
    if (reader.cancel.mock.calls.length === 0) releaseRead({ done: true });

    await expect(request).rejects.toThrow('response body read cancelled');
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it('settles a stalled session read as a timeout instead of freezing route guards', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      })
    )));

    const request = getJson('/api/session', new AbortController().signal);
    const assertion = expect(request).rejects.toThrow('Request timed out.');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });
});
