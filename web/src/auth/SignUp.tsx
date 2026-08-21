import { useNavigate } from 'react-router-dom';

import { GoogleButton } from './google';
import { Brand, FORM, LEAD, LEFT, MINOR, PAGE } from './parts';

/**
 * Hosted account creation is intentionally Google-only.
 *
 * HydraDB's current document writer cannot conditionally create a unique
 * account record. Offering public password signup on that store would make a
 * same-email race capable of replacing credential material. Google proves
 * address ownership and binds the record to its stable provider subject; the
 * password endpoint remains available only to explicitly local stores.
 */
export default function SignUp() {
  const go = useNavigate();

  return (
    <div style={PAGE}>
      <div style={LEFT}>
        <Brand />
        <h1 style={{ fontSize: 'clamp(44px, 5.2vw, 84px)', fontWeight: 400, lineHeight: 1.0, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Start with<br />one memory.</h1>
        <p style={{ ...LEAD, maxWidth: '44ch' }}>Create your workspace with Google, then keep your project memory in one place.</p>
      </div>
      <div style={FORM}>
        <div style={{ border: '1px solid rgba(128,82,255,0.36)', borderRadius: '12px', padding: '18px', background: 'rgba(128,82,255,0.06)' }}>
          <div style={{ color: '#FFFFFF', fontSize: '15px', marginBottom: '8px' }}>Verified account creation</div>
          <p style={{ ...LEAD, fontSize: '13px', margin: 0 }}>
            Sign up securely with Google. Lacuna asks only for your basic profile and email. It cannot read Gmail or Drive.
          </p>
        </div>
        <GoogleButton label="Create with Google" showDivider={false} />
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
          <button className="hv-text" type="button" onClick={() => go('/signin')} style={MINOR}>ALREADY HAVE AN ACCOUNT · SIGN IN</button>
        </div>
      </div>
    </div>
  );
}
