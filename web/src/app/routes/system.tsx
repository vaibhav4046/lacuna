import { useNavigate } from 'react-router-dom';
import { signOut } from '../../api/auth';
import { hydraState, useHealth, useModelLabel } from '../../api/health';
import { useSession } from '../../api/session';
import { useScope } from '../../api/scope';
import { MONO } from '../../design/mark';
import { SAMPLE_WORKSPACE } from '../Shell';
import { PUBLIC_WORKSPACE_PATH } from '../product-contracts';
import { googleProblem } from '../../auth/google-problem';

/**
 * Settings.
 *
 * Every row is read from somewhere. The workspace and the address come from
 * the session, HydraDB and the model come from the same checks the rest of the
 * product uses, and the rows that describe things nobody has configured say
 * so rather than describing a default that does not exist.
 *
 * This is also where the public workspace is opened, deliberately and by name.
 * Nothing loads it silently.
 */

const note = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#7A7A7A' } as const;

export function Settings() {
  const go = useNavigate();
  const { loaded, refreshAfterMutation } = useSession();
  const health = useHealth();
  const model = useModelLabel();
  const scope = useScope();
  const account = loaded.state === 'ready' && loaded.value.signedIn ? loaded.value.session : null;
  const onDemo = scope.demo;
  const googleNotice = new URLSearchParams(window.location.search).get('google');

  const rows: readonly (readonly [string, string])[] = [
    ['Workspace', scope.demo ? SAMPLE_WORKSPACE : account?.workspace ?? '—'],
    ['Signed in as', scope.demo ? 'nobody, this is the public read only workspace' : account?.email ?? '—'],
    ['HydraDB', hydraState(health).toLowerCase()],
    ['Models', model.toLowerCase()],
    ['Voice', 'checked when opened'],
    ['API keys', 'not implemented'],
    ['Appearance', 'dark'],
    ['Accessibility', 'reduced motion follows system'],
    ['Data export', 'not configured'],
  ];

  async function leave() {
    if (!await signOut()) return;
    await refreshAfterMutation();
    go('/');
  }

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {rows.map(([label, value]) => (
        <div key={label} className="hv-surface3" style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', alignItems: 'baseline', padding: '16px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)', transition: 'background 140ms ease' }}>
          <span style={{ fontSize: '14.5px', color: '#FFFFFF' }}>{label}</span>
          <span style={{ fontFamily: MONO, fontSize: '11px', letterSpacing: '0.08em', color: '#9A9A9A' }}>{value}</span>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', alignItems: 'center', padding: '16px', marginTop: '22px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '14.5px', color: '#BDBDBD' }}>{onDemo ? 'You are in the public workspace' : 'Open the public workspace'}</span>
        {onDemo ? (
          <span style={note}>READ ONLY · ITS CONTENTS ARE THE GENERATED CORPUS</span>
        ) : (
          <button className="hv-edge35" onClick={() => go(PUBLIC_WORKSPACE_PATH)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '7px', cursor: 'pointer', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#BDBDBD', padding: '9px 14px' }}>OPEN PUBLIC WORKSPACE</button>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', alignItems: 'center', padding: '16px', marginTop: '10px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '14.5px', color: '#BDBDBD' }}>{scope.demo ? 'Sign in' : 'Sign out'}</span>
        <button className="hv-edge35" onClick={() => { if (scope.demo) go('/signin'); else void leave(); }} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '7px', cursor: 'pointer', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#BDBDBD', padding: '9px 14px' }}>{scope.demo ? 'SIGN IN' : 'SIGN OUT'}</button>
      </div>

      {!onDemo && account !== null ? (
        <div style={{ display: 'grid', gap: '10px', padding: '16px', marginTop: '10px', border: '1px solid rgba(128,82,255,0.30)', borderRadius: '8px', background: 'rgba(128,82,255,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '14.5px', color: '#FFFFFF' }}>Google sign-in</div>
              <div style={{ ...note, marginTop: '5px', lineHeight: 1.6 }}>Link this verified Google identity after proving the existing password session. Lacuna will revoke the old password and recovery code.</div>
            </div>
            <a className="hv-edge35" href="/api/auth/google/link/start" style={{ display: 'inline-flex', alignItems: 'center', minHeight: '38px', boxSizing: 'border-box', padding: '9px 14px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.22)', color: '#FFFFFF', textDecoration: 'none', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em' }}>LINK GOOGLE</a>
          </div>
          {googleNotice !== null && googleNotice !== 'linked' ? <div role="alert" style={{ color: '#FFB84D', fontSize: '12px' }}>{googleProblem(window.location.search) ?? 'Google linking did not complete. Try again.'}</div> : null}
          {googleNotice === 'linked' ? <div role="status" style={{ color: '#62E6D2', fontSize: '12px' }}>Google is linked. Future sign-ins use the verified Google account.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
