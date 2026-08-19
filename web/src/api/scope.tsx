import { createContext, useContext, type ReactNode } from 'react';
import { useLoaded, type Loaded } from './client';

/**
 * Which workspace the screens are reading, and where its links go.
 *
 * The product has two ways in. Signed in, a session names a workspace and the
 * reads go to /api/workspace. Signed out, /demo reads the ingested corpus
 * through /api/demo, which answers to nobody and writes nothing. Both render
 * the same eighteen screens from the same components, because a demo built out
 * of a second set of components is a demo that drifts from the product it is
 * meant to show.
 *
 * The alternative was a flag threaded through every route. This is one context
 * and one hook, and a screen that forgets to use it reads the signed-in
 * endpoint and renders an empty workspace, which is loud rather than subtle.
 */

export interface Scope {
  /** Where the workspace reads go. No trailing slash. */
  readonly base: string;
  /** Where the nav links go. No trailing slash. */
  readonly prefix: string;
  /** True when nobody is signed in and the corpus is being read read-only. */
  readonly demo: boolean;
}

const SIGNED_IN: Scope = { base: '/api/workspace', prefix: '/app', demo: false };
const DEMO: Scope = { base: '/api/demo', prefix: '/demo', demo: true };

const ScopeContext = createContext<Scope>(SIGNED_IN);

export function ScopeProvider({ demo, children }: { demo: boolean; children: ReactNode }) {
  return <ScopeContext.Provider value={demo ? DEMO : SIGNED_IN}>{children}</ScopeContext.Provider>;
}

export function useScope(): Scope {
  return useContext(ScopeContext);
}

/** One named part of whichever workspace this subtree is reading. */
export function useScoped<T>(part: string): Loaded<T> {
  const scope = useScope();
  return useLoaded<T>(`${scope.base}/${part}`);
}
