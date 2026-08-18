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

export interface Session {
  readonly email: string;
  /** Null until a workspace exists. Never a placeholder name. */
  readonly workspace: string | null;
  readonly onboarded: boolean;
}

export type SessionState = { readonly signedIn: false } | { readonly signedIn: true; readonly session: Session };

interface SessionContextValue {
  readonly loaded: Loaded<SessionState>;
  /** Re-ask after sign in, sign up, sign out, or finishing onboarding. */
  readonly refresh: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded<SessionState>>({ state: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const control = new AbortController();
    getJson<SessionState>('/api/session', control.signal).then(
      (value) => {
        if (!control.signal.aborted) setLoaded({ state: 'ready', value });
      },
      () => {
        // The server did not answer. That is not proof of being signed out, so
        // the guard holds rather than bouncing someone who has a valid cookie.
        if (!control.signal.aborted) setLoaded({ state: 'failed', reason: 'Connection failed.' });
      },
    );
    return () => control.abort();
  }, [tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  return <SessionContext.Provider value={{ loaded, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession used outside SessionProvider');
  return value;
}
