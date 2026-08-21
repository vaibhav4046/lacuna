import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { recover } from '../api/auth';
import { useSession } from '../api/session';
import { RecoveryCode } from './Recovery';
import { Brand, Field, Problem, FORM, LEAD, LEFT, MINOR, PAGE, PRIMARY } from './parts';

/**
 * A way back in, which this page did not have.
 *
 * It used to say "password reset is not configured" and stop there. That was
 * honest and it was a dead end: the previous version had promised to email a
 * link and offered a Send button that sent nothing, so saying so out loud was
 * the right correction and the wrong resting place.
 *
 * Nothing here sends email, and nothing is going to. So the way back is the
 * recovery code issued when the account was created: it proves who you are
 * without a second channel, and it is the same mechanism the code screen warned
 * would be the only one. Using it spends it, and a replacement is issued in the
 * same response, which is why this page ends on the same screen sign up does.
 *
 * Google accounts have no code and no password. Sending them to Google is the
 * whole answer for them, and it is said plainly rather than left to a failure.
 */

const MIN_PASSWORD = 12;

export default function Forgot() {
  const go = useNavigate();
  const { refreshAfterMutation } = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  const ready = email.trim() !== '' && code.trim() !== ''
    && password.length >= MIN_PASSWORD && confirm === password;

  async function submit() {
    if (password.length < MIN_PASSWORD) {
      setProblem(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (confirm !== password) {
      setProblem('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await recover(email, code, password);
    setBusy(false);
    if ('problem' in result) { setProblem(result.problem); return; }
    await refreshAfterMutation();
    setIssued(result.recoveryCode);
  }

  if (issued !== null) {
    return (
      <div style={PAGE}>
        <div style={LEFT}>
          <Brand />
          <h1 style={{ fontSize: 'clamp(40px, 4.6vw, 74px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Password<br />changed.</h1>
          <p style={{ ...LEAD, maxWidth: '44ch' }}>You are signed in. The code you used is spent, so here is the next one.</p>
        </div>
        <div style={FORM}>
          <RecoveryCode code={issued} onDone={() => go('/app/dash')} />
        </div>
      </div>
    );
  }

  return (
    <div style={PAGE}>
      <div style={LEFT}>
        <Brand />
        <h1 style={{ fontSize: 'clamp(40px, 4.6vw, 74px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Use your<br />recovery code.</h1>
        <p style={{ ...LEAD, maxWidth: '46ch' }}>
          Nothing here sends email, so there is no reset link. The code shown when you created the
          account is the way back, and it sets a new password directly.
        </p>
      </div>
      <form style={FORM} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="EMAIL" type="email" placeholder="you@company.com" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="RECOVERY CODE" type="text" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" value={code} onChange={setCode} autoComplete="one-time-code" />
        <span style={{ fontSize: '12.5px', color: '#7A7A7A', marginTop: '-8px', lineHeight: 1.5 }}>
          Case and dashes do not matter.
        </span>
        <Field label="NEW PASSWORD" type="password" placeholder="at least 12 characters" value={password} onChange={setPassword} autoComplete="new-password" />
        <Field label="CONFIRM PASSWORD" type="password" placeholder="the same again" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <button className="hv-violet" type="submit" disabled={busy || !ready} style={{ ...PRIMARY, opacity: busy || !ready ? 0.55 : 1, cursor: busy || !ready ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Checking…' : 'Set new password'}
        </button>
        <Problem>{problem}</Problem>
        <p style={{ fontSize: '13.5px', color: '#7A7A7A', lineHeight: 1.7, margin: '4px 0 0', maxWidth: '46ch' }}>
          Signed up with Google? There is no password to reset. Go back and continue with Google.
          Lost the code and used a password? Nothing here can prove who you are, so that account
          cannot be recovered, and saying otherwise would be a promise this deployment cannot keep.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
          <button className="hv-text" type="button" onClick={() => go('/signin')} style={MINOR}>BACK TO SIGN IN</button>
        </div>
      </form>
    </div>
  );
}
