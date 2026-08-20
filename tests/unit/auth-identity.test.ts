import { describe, expect, it } from 'vitest';

import { googleBinding } from '../../src/auth/identity.js';
import type { GoogleIdentity } from '../../src/auth/google.js';
import type { Account } from '../../src/auth/store.js';

const IDENTITY: GoogleIdentity = {
  email: 'person@example.com',
  name: 'A Person',
  subject: 'google-subject-123',
};

const ACCOUNT: Account = {
  email: IDENTITY.email,
  passwordHash: 'not-a-real-hash',
  createdAt: '2026-08-20T00:00:00.000Z',
  workspace: null,
  onboarded: false,
};

describe('Google provider binding', () => {
  it('refuses a bound account selected under a different email', () => {
    expect(googleBinding({
      ...ACCOUNT,
      authProvider: 'google',
      providerSubject: IDENTITY.subject,
    }, { ...IDENTITY, email: 'somebody-else@example.com' })).toEqual({
      allowed: false,
      failure: 'email_mismatch',
    });
  });

  it('fails closed for legacy records whose missing provider is ambiguous', () => {
    expect(googleBinding(ACCOUNT, IDENTITY)).toEqual({
      allowed: false,
      failure: 'legacy_unbound',
    });
  });

  it('does not merge a verified Google email into a password account', () => {
    expect(googleBinding({ ...ACCOUNT, authProvider: 'password' }, IDENTITY)).toEqual({
      allowed: false,
      failure: 'provider_mismatch',
    });
  });

  it('binds a Google account to the stable subject, not email alone', () => {
    const account: Account = {
      ...ACCOUNT,
      authProvider: 'google',
      providerSubject: IDENTITY.subject,
    };
    expect(googleBinding(account, IDENTITY)).toEqual({ allowed: true, account });
    expect(googleBinding(account, { ...IDENTITY, subject: 'somebody-else' })).toEqual({
      allowed: false,
      failure: 'subject_mismatch',
    });
  });
});
