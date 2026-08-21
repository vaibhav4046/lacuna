import type { Loaded } from '../api/client';
import type { SessionState } from '../api/session';

export interface LandingLink {
  readonly label: string;
  readonly path: string;
}

export type LandingAccountActions =
  | { readonly state: 'pending' }
  | {
    readonly state: 'guest';
    readonly secondary: LandingLink;
    readonly primary: LandingLink;
    readonly links: readonly LandingLink[];
  }
  | {
    readonly state: 'member';
    readonly primary: LandingLink;
    readonly links: readonly LandingLink[];
  };

export function landingAccountActions(loaded: Loaded<SessionState>): LandingAccountActions {
  if (loaded.state !== 'ready') return { state: 'pending' };
  if (!loaded.value.signedIn) {
    return {
      state: 'guest',
      secondary: { label: 'Sign in', path: '/signin' },
      primary: { label: 'Get started', path: '/signup' },
      links: [
        { label: 'Sign in', path: '/signin' },
        { label: 'Create account', path: '/signup' },
        { label: 'Recover access', path: '/forgot' },
      ],
    };
  }

  const primary = loaded.value.session.workspace === null
    ? { label: 'Finish setup', path: '/onboarding' }
    : { label: 'Open workspace', path: '/app/dash' };
  return {
    state: 'member',
    primary,
    links: [primary, { label: 'Account settings', path: '/app/settings' }],
  };
}
