import { useNavigate } from 'react-router-dom';
import { signOut } from '../../api/auth';
import { postJson } from '../../api/client';
import { hydraState, useHealth, useModelLabel } from '../../api/health';
import { useSession } from '../../api/session';
import { useScope } from '../../api/scope';
import { MONO } from '../../design/mark';
import { SAMPLE_WORKSPACE } from '../Shell';

/**
 * Settings.
 *
 * Every row is read from somewhere. The workspace and the address come from
 * the session, HydraDB and the model come from the same checks the rest of the
 * product uses, and the rows that describe things nobody has configured say
 * so rather than describing a default that does not exist.
 *
 * This is also where the demo workspace is opened, deliberately and by name.
 * Nothing loads it silently.
 */

const note = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#7A7A7A' } as const;

export function Settings() {
  const go = useNavigate();
  const { prefix } = useScope();
  const { loaded, refresh } = useSession();
  const health = useHealth();
  const model = useModelLabel();
  const scope = useScope();
  const account = loaded.state === 'ready' && loaded.value.signedIn ? loaded.value.session : null;
  const onDemo = scope.demo || account?.workspace === SAMPLE_WORKSPACE;

  const rows: readonly (readonly [string, string])[] = [
    ['Workspace', scope.demo ? SAMPLE_WORKSPACE : account?.workspace ?? '—'],
    ['Signed in as', scope.demo ? 'nobody, this is the read only demo' : account?.email ?? '—'],
    ['HydraDB', hydraState(health).toLowerCase()],
    ['Models', model.toLowerCase()],
    ['Voice', 'not configured'],
    ['API keys', 'not implemented'],
    ['Appearance', 'dark'],
    ['Accessibility', 'reduced motion follows system'],
    ['Data export', 'not configured'],
  ];

  async function openDemo() {
    await postJson('/api/workspace', { workspace: SAMPLE_WORKSPACE });
    await refresh();
    go(`${prefix}/dash`);
  }

  async function leave() {
    await signOut();
    await refresh();
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
        <span style={{ fontSize: '14.5px', color: '#BDBDBD' }}>{onDemo ? 'You are in the demo workspace' : 'Open the demo workspace'}</span>
        {onDemo ? (
          <span style={note}>{scope.demo ? 'READ ONLY · ITS CONTENTS ARE THE GENERATED CORPUS' : 'ITS CONTENTS ARE THE GENERATED CORPUS'}</span>
        ) : (
          <button className="hv-edge35" onClick={() => void openDemo()} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '7px', cursor: 'pointer', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#BDBDBD', padding: '9px 14px' }}>OPEN DEMO WORKSPACE</button>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', alignItems: 'center', padding: '16px', marginTop: '10px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '14.5px', color: '#BDBDBD' }}>{scope.demo ? 'Sign in' : 'Sign out'}</span>
        <button className="hv-edge35" onClick={() => { if (scope.demo) go('/signin'); else void leave(); }} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '7px', cursor: 'pointer', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#BDBDBD', padding: '9px 14px' }}>{scope.demo ? 'SIGN IN' : 'SIGN OUT'}</button>
      </div>

      {!scope.demo && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', alignItems: 'baseline', padding: '16px', marginTop: '10px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px' }}>
          <span style={{ fontSize: '14.5px', color: '#BDBDBD' }}>Delete workspace</span>
          <span style={note}>TYPE THE NAME TO CONFIRM</span>
        </div>
      )}
    </div>
  );
}
