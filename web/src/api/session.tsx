/**
 * Who is signed in, asked once for the whole app.
 *
 * Both the route guard and the sidebar footer need this, and asking twice
 * would mean two answers to one question, so the check lives in one provider
 * above the router. Signed out is a normal answer with a 200 behind it, not an
 * error: a visitor arriving at /app has not done anything wrong, they are
 * simply not signed in yet.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getJson } from './client';
import type { Loaded } from './client';
import type { SessionState } from './session-state';

export type { Session, SessionState } from './session-state';

interface SessionContextValue {
  readonly loaded: Loaded<SessionState>;
  /**
   * Re-ask after sign in, sign up, sign out, or finishing onboarding.
   *
   * Awaitable, and that is the whole point. It used to bump a counter and let
   * an effect re-fetch, so a caller that navigated on the next line arrived at
   * a guarded route while the answer in hand still said signed out, and the
   * guard correctly bounced a person who had just signed up. Resolving when
   * the new answer is in state removes the race rather than papering over it
   * with a timeout.
   */
  readonly refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded<SessionState>>({ state: 'loading' });

  const read = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const value = await getJson<SessionState>('/api/session', signal ?? new AbortController().signal);
      if (signal?.aborted !== true) setLoaded({ state: 'ready', value });
    } catch {
      // The server did not answer. That is not proof of being signed out, so
      // the guard holds rather than bouncing someone who has a valid cookie.
      if (signal?.aborted !== true) setLoaded({ state: 'failed', reason: 'Connection failed.' });
    }
  }, []);

  useEffect(() => {
    const control = new AbortController();
    void read(control.signal);
    return () => control.abort();
  }, [read]);

  const refresh = useCallback(() => read(), [read]);

  return <SessionContext.Provider value={{ loaded, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession used outside SessionProvider');
  return value;
}
