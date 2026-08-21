import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';

import type { Loaded } from './client';
import {
  SessionEpochBus,
  SessionReadCoordinator,
  decodeSessionState,
  sessionIdentity,
  synchronousSessionTeardown,
  type SessionState,
} from './session-state';

export type { Session, SessionState } from './session-state';

interface SessionContextValue {
  readonly loaded: Loaded<SessionState>;
  readonly epoch: number;
  readonly identity: string | null;
  /** Resolves only after the newest read, including a superseding tab/focus read, settles. */
  readonly refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

async function readSession(signal: AbortSignal): Promise<SessionState> {
  const control = new AbortController();
  const relay = () => control.abort();
  if (signal.aborted) control.abort();
  else signal.addEventListener('abort', relay, { once: true });
  const timeout = globalThis.setTimeout(() => control.abort(), 15_000);
  try {
    const response = await fetch('/api/session', {
      signal: control.signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (response.status !== 200) throw new Error('session unavailable');
    const decoded = decodeSessionState(await response.json() as unknown);
    if (decoded === null) throw new Error('invalid session response');
    return decoded;
  } finally {
    globalThis.clearTimeout(timeout);
    signal.removeEventListener('abort', relay);
  }
}

function browserEpochBus(onRemote: () => void): SessionEpochBus {
  const channel = typeof BroadcastChannel === 'undefined' ? {
    postMessage: (_value: unknown) => undefined,
    addEventListener: (_type: 'message', _listener: (event: { readonly data?: unknown }) => void) => undefined,
    removeEventListener: (_type: 'message', _listener: (event: { readonly data?: unknown }) => void) => undefined,
    close: () => undefined,
  } : new BroadcastChannel('lacuna-session-epoch-v1');
  return new SessionEpochBus({
    channel,
    storage: { setItem: (key, value) => { try { localStorage.setItem(key, value); } catch { /* unavailable storage leaves BroadcastChannel active */ } } },
    addStorageListener: (listener) => window.addEventListener('storage', listener),
    removeStorageListener: (listener) => window.removeEventListener('storage', listener),
  }, onRemote);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded<SessionState>>({ state: 'loading' });
  const [epoch, setEpoch] = useState(0);
  const coordinatorRef = useRef<SessionReadCoordinator | null>(null);

  useEffect(() => {
    let bus: SessionEpochBus | null = null;
    const coordinator = new SessionReadCoordinator({
      read: readSession,
      onLoading: (cause) => {
        const commit = () => {
          setEpoch((held) => held + 1);
          setLoaded({ state: 'loading' });
        };
        if (cause === 'initial') commit();
        else synchronousSessionTeardown(commit, flushSync);
      },
      onReady: (value) => setLoaded({ state: 'ready', value }),
      onFailed: () => setLoaded({ state: 'failed', reason: 'Connection failed.' }),
      onValidatedTransition: () => { try { bus?.publish(); } catch { /* local invalidation remains complete */ } },
    });
    bus = browserEpochBus(() => { void coordinator.refresh('remote'); });
    coordinatorRef.current = coordinator;

    const onFocus = () => { void coordinator.refresh('focus'); };
    const onPageShow = () => { void coordinator.refresh('pageshow'); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    void coordinator.refresh('initial');
    return () => {
      coordinatorRef.current = null;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      bus?.dispose();
      coordinator.dispose();
    };
  }, []);

  const refresh = useCallback(async () => {
    await coordinatorRef.current?.refresh('refresh');
  }, []);
  const identity = loaded.state === 'ready' ? sessionIdentity(loaded.value) : null;

  return <SessionContext.Provider value={{ loaded, epoch, identity, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession used outside SessionProvider');
  return value;
}
