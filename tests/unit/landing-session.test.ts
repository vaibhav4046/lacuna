import { describe, expect, it } from 'vitest';

import { landingAccountActions, landingWorkspacePath } from '../../web/src/landing/account-actions.js';

describe('landing account actions', () => {
  it('keeps a verified member on the private workspace from the hero', () => {
    expect(landingWorkspacePath({
      state: 'ready',
      value: {
        signedIn: true,
        session: { email: 'member@example.com', binding: 'a'.repeat(64), workspace: 'Atlas', onboarded: true },
      },
    })).toBe('/app/dash');
  });

  it('keeps unknown or signed-out visitors on the public workspace', () => {
    expect(landingWorkspacePath({ state: 'loading' })).toBe('/explore/dash');
    expect(landingWorkspacePath({ state: 'ready', value: { signedIn: false } })).toBe('/explore/dash');
  });

  it('returns to a signed-in workspace instead of offering another sign in', () => {
    expect(landingAccountActions({
      state: 'ready',
      value: {
        signedIn: true,
        session: { email: 'member@example.com', binding: 'a'.repeat(64), workspace: 'Atlas', onboarded: true },
      },
    })).toEqual({
      state: 'member',
      primary: { label: 'Open workspace', path: '/app/dash' },
      links: [
        { label: 'Open workspace', path: '/app/dash' },
        { label: 'Account settings', path: '/app/settings' },
      ],
    });
  });

  it('returns a signed-in account without a workspace to setup', () => {
    expect(landingAccountActions({
      state: 'ready',
      value: {
        signedIn: true,
        session: { email: 'new@example.com', binding: 'b'.repeat(64), workspace: null, onboarded: false },
      },
    })).toEqual({
      state: 'member',
      primary: { label: 'Finish setup', path: '/onboarding' },
      links: [
        { label: 'Finish setup', path: '/onboarding' },
        { label: 'Account settings', path: '/app/settings' },
      ],
    });
  });

  it('offers authentication only after the session check proves signed out', () => {
    expect(landingAccountActions({ state: 'ready', value: { signedIn: false } })).toEqual({
      state: 'guest',
      secondary: { label: 'Sign in', path: '/signin' },
      primary: { label: 'Get started', path: '/signup' },
      links: [
        { label: 'Sign in', path: '/signin' },
        { label: 'Create account', path: '/signup' },
        { label: 'Recover access', path: '/forgot' },
      ],
    });
  });

  it('does not impersonate signed-out state while the session is unknown', () => {
    expect(landingAccountActions({ state: 'loading' })).toEqual({ state: 'pending' });
    expect(landingAccountActions({ state: 'failed', reason: 'Connection failed.' }))
      .toEqual({ state: 'pending' });
  });
});
