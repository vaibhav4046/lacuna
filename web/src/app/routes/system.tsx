import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { configurePassword, signOut } from '../../api/auth';
import { hydraState, useHealth, useModelLabel } from '../../api/health';
import { useSession } from '../../api/session';
import { useScope } from '../../api/scope';
import { Field, Problem, PRIMARY } from '../../auth/parts';
import { RecoveryCode } from '../../auth/Recovery';
import { MONO } from '../../design/mark';
import { SAMPLE_WORKSPACE } from '../Shell';
import { PUBLIC_WORKSPACE_PATH } from '../product-contracts';

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
  const { loaded, refresh } = useSession();
  const health = useHealth();
  const model = useModelLabel();
  const scope = useScope();
  const account = loaded.state === 'ready' && loaded.value.signedIn ? loaded.value.session : null;
  const onDemo = scope.demo;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordProblem, setPasswordProblem] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

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
    await signOut();
    await refresh();
    go('/');
  }

  async function savePassword() {
    if (password.length < 12) {
      setPasswordProblem('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirm) {
      setPasswordProblem('The two passwords do not match.');
      return;
    }
    setPasswordBusy(true);
    setPasswordProblem(null);
    try {
      const result = await configurePassword(password);
      if ('problem' in result) {
        setPasswordProblem(result.problem);
        return;
      }
      setPassword('');
      setConfirm('');
      setRecoveryCode(result.recoveryCode);
      await refresh();
    } finally {
      setPasswordBusy(false);
    }
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

      {!onDemo ? (
        <div style={{ padding: '20px', marginTop: '10px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px' }}>
          {recoveryCode === null ? (
            <form onSubmit={(event) => { event.preventDefault(); void savePassword(); }} style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '420px' }}>
              <div>
                <div style={{ color: '#FFFFFF', fontSize: '15px', marginBottom: '6px' }}>Password sign-in & recovery</div>
                <p style={{ color: '#9A9A9A', fontSize: '13px', lineHeight: 1.6, margin: 0 }}>
                  Add or replace your password after Google has verified this account. A one-time recovery code appears next.
                </p>
              </div>
              <Field label="NEW PASSWORD" type="password" placeholder="at least 12 characters" value={password} onChange={setPassword} autoComplete="new-password" />
              <Field label="CONFIRM PASSWORD" type="password" placeholder="the same again" value={confirm} onChange={setConfirm} autoComplete="new-password" />
              <button className="hv-violet" type="submit" disabled={passwordBusy || password.length < 12 || password !== confirm} style={{ ...PRIMARY, opacity: passwordBusy || password.length < 12 || password !== confirm ? 0.55 : 1 }}>
                {passwordBusy ? 'Saving…' : 'Set password'}
              </button>
              <Problem>{passwordProblem}</Problem>
            </form>
          ) : (
            <RecoveryCode code={recoveryCode} onDone={() => setRecoveryCode(null)} />
          )}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', alignItems: 'center', padding: '16px', marginTop: '10px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '14.5px', color: '#BDBDBD' }}>{scope.demo ? 'Sign in' : 'Sign out'}</span>
        <button className="hv-edge35" onClick={() => { if (scope.demo) go('/signin'); else void leave(); }} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '7px', cursor: 'pointer', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#BDBDBD', padding: '9px 14px' }}>{scope.demo ? 'SIGN IN' : 'SIGN OUT'}</button>
      </div>
    </div>
  );
}
