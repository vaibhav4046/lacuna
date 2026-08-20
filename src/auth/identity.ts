import type { GoogleIdentity } from './google.js';
import type { Account } from './store.js';

/** Why a verified Google identity may not use an existing email record. */
export type GoogleBindingFailure =
  | 'email_mismatch'
  | 'legacy_unbound'
  | 'provider_mismatch'
  | 'subject_mismatch';

export type GoogleBindingDecision =
  | { readonly allowed: true; readonly account: Account }
  | { readonly allowed: false; readonly failure: GoogleBindingFailure };

/**
 * Decide whether a verified Google identity owns an existing account.
 *
 * Email equality is not enough. Password signup currently proves knowledge of
 * a password, not ownership of the address, so silently merging a later Google
 * login into that record would hand the Google user the password account and
 * its workspace. Conversely, treating a password record as Google-owned would
 * let an address squatter choose the workspace before the real owner arrives.
 *
 * Legacy records are deliberately refused. Their missing provider field is
 * ambiguous, and recoveryHash cannot disambiguate accounts created before
 * recovery codes from accounts created by Google. They require an explicit,
 * separately verified migration rather than a guess made during sign in.
 */
export function googleBinding(
  account: Account,
  identity: GoogleIdentity,
): GoogleBindingDecision {
  if (account.email !== identity.email) {
    return { allowed: false, failure: 'email_mismatch' };
  }
  if (account.authProvider === undefined) {
    return { allowed: false, failure: 'legacy_unbound' };
  }
  if (account.authProvider !== 'google') {
    return { allowed: false, failure: 'provider_mismatch' };
  }
  if (account.providerSubject !== identity.subject) {
    return { allowed: false, failure: 'subject_mismatch' };
  }
  return { allowed: true, account };
}
