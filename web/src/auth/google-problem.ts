const REASONS: Readonly<Record<string, string>> = {
  cancelled: 'Sign in with Google was cancelled. Nothing happened.',
  state: 'Your Google sign-in expired. Try again.',
  code: 'Google sign-in did not finish. Try again.',
  timeout: 'Google sign-in took too long to respond. Try again.',
  identity: 'Google sign-in did not finish. Try again.',
  email_mismatch: 'Choose the Google account you previously used for Lacuna.',
  legacy_unbound: 'This older account is not linked to Google. Sign in with its existing password below first, then use Settings → Link Google. If you saved a recovery code, use Forgot password.',
  provider_mismatch: 'This account uses a password. Sign in with your password or recovery code.',
  subject_mismatch: 'Choose the Google account you previously used for Lacuna.',
  rate: 'Too many sign-in windows were opened. Wait a few minutes, then try once.',
  store: 'Sign-in is temporarily unavailable. Try again in a moment.',
  unconfigured: 'Google sign-in is unavailable here. Contact the Lacuna administrator.',
  link_session: 'Sign in with the existing password account before linking Google.',
  link_email: 'Choose the same Google address as the signed-in Lacuna account.',
  link_expired: 'The account changed while Google was being linked. Start again from Settings.',
  link_store: 'Google linking is temporarily unavailable. Try again in a moment.',
  already_linked: 'This account is already linked to Google.',
  linked: 'Google is linked.',
};

/** The message for a reason the API sent, or null when there is nothing to say. */
export function googleProblem(search: string): string | null {
  const reason = new URLSearchParams(search).get('google');
  if (reason === null) return null;
  return REASONS[reason] ?? 'Sign in with Google did not complete.';
}
