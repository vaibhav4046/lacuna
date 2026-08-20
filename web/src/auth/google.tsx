import { MONO } from '../design/mark';
import { GOOGLE_G, markUri } from '../design/brand';

/**
 * The Google button, and the sentence a failed round trip leaves behind.
 *
 * This is a link and not a fetch on purpose. The whole point of the flow is
 * that the browser leaves for Google and comes back, so an anchor is what it
 * is: no click handler, no state, and it works with the keyboard and with a
 * middle click because it is an ordinary navigation.
 *
 * The reasons below are the ones the API redirects back with. They are separate
 * strings rather than one apology because they call for different things from
 * the reader: a cancelled sign in needs no action, a stale round trip needs the
 * button pressing again, and an unverified address needs the password form.
 */

const REASONS: Readonly<Record<string, string>> = {
  cancelled: 'Sign in with Google was cancelled. Nothing happened.',
  state: 'That sign in took too long to come back. Press the button again.',
  code: 'Google did not send an authorisation back. Try once more.',
  identity: "Google identity could not be safely bound. Try a fresh Google account, or use this account's original sign-in method.",
  store: 'The account store did not answer. Nothing was changed.',
  unconfigured: 'Sign in with Google is not configured on this deployment.',
};

/** The message for a reason the API sent, or null when there is nothing to say. */
export function googleProblem(search: string): string | null {
  const reason = new URLSearchParams(search).get('google');
  if (reason === null) return null;
  return REASONS[reason] ?? 'Sign in with Google did not complete.';
}

export function GoogleButton({ label, showDivider = true }: { label: string; showDivider?: boolean }) {
  return (
    <>
      {showDivider ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', margin: '2px 0' }}>
          <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.12)' }} />
          <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.2em', color: '#7A7A7A' }}>OR</span>
          <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.12)' }} />
        </div>
      ) : null}
      <a
        href="/api/auth/google/start"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
          minHeight: '40px', boxSizing: 'border-box', padding: '10px 12px', borderRadius: '20px',
          border: '1px solid #8E918F', background: '#131314', color: '#E3E3E3',
          fontFamily: "'Google Sans', Roboto, Arial, sans-serif", fontSize: '14px', fontWeight: 500,
          lineHeight: '20px', textDecoration: 'none',
        }}
      >
        {/*
          The official Google "G", in its official four colours and official
          geometry. Google publishes this mark for exactly this button and the
          branding guidelines require it: a Sign in with Google button that
          shows only words is not compliant, and one showing a redrawn or
          recoloured G is worse. It is never tinted to match this product.
        */}
        <img src={markUri(GOOGLE_G)} alt="" width={18} height={18} aria-hidden="true" />
        {label}
      </a>
    </>
  );
}
