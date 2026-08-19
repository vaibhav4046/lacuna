import { useNavigate } from 'react-router-dom';
import { Brand, FORM, LEAD, LEFT, MINOR, PAGE } from './parts';

/**
 * Reset is not configured, and this page says so rather than pretending.
 *
 * The endpoint behind it has always answered 501 with no mail transport
 * configured, which is honest. The page in front of it said "We will email a
 * reset link" and offered a Send button, so the only way to discover the truth
 * was to type an address and submit it. A form that cannot do the thing it
 * offers is worse than no form: it takes an email address for nothing.
 */

export default function Forgot() {
  const go = useNavigate();

  return (
    <div style={PAGE}>
      <div style={LEFT}>
        <Brand />
        <h1 style={{ fontSize: 'clamp(40px, 4.6vw, 74px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Password reset<br />is not configured.</h1>
        <p style={{ ...LEAD, maxWidth: '46ch' }}>
          This deployment has no mail transport, so nothing here can send you a link. Asking
          for your address and then failing would be worse than saying so.
        </p>
      </div>
      <div style={FORM}>
        <p style={{ ...LEAD, maxWidth: '46ch', margin: 0 }}>
          Sign in with Google instead, which needs no password at all. If you signed up with
          one and have lost it, the account can be recreated under the same address.
        </p>
        <button className="hv-text" type="button" onClick={() => go('/signin')} style={{ ...MINOR, textAlign: 'left', marginTop: '4px' }}>BACK TO SIGN IN</button>
      </div>
    </div>
  );
}
