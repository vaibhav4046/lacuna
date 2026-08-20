import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signUp } from '../api/auth';
import { useSession } from '../api/session';
import { RecoveryCode } from './Recovery';
import { Brand, Field, Problem, FORM, LEAD, LEFT, MINOR, PAGE, PRIMARY } from './parts';
import { GoogleButton } from './google';

/**
 * Creating an account, and the two things the old form left people to guess.
 *
 * It asked for a password and said nothing about what would be accepted, so the
 * first anybody heard of the twelve character minimum was a red line under a
 * form they had already filled in. And it took the password once, which for a
 * field rendered as dots means a typo becomes an account nobody can sign in to.
 *
 * The third addition is the recovery code. It exists because nothing in this
 * deployment sends email, so the reset page had nothing to offer; a code shown
 * once at creation is a channel that does not depend on one.
 */

/** The server's rule, stated before the form is submitted rather than after. */
const MIN_PASSWORD = 12;

export default function SignUp() {
  const go = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const tooShort = password !== '' && password.length < MIN_PASSWORD;
  const mismatch = confirm !== '' && confirm !== password;
  const ready = email.trim() !== '' && password.length >= MIN_PASSWORD && confirm === password;

  async function submit() {
    // Checked here as well as on the server, so the answer arrives before a
    // round trip rather than after one.
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
    const result = await signUp(email, password);
    setBusy(false);
    if ('problem' in result) { setProblem(result.problem); return; }

    // The session already exists: the server signed them in as it created the
    // account. Refreshing now means the code screen is behind a real session
    // rather than in front of one.
    await refresh();
    setRecoveryCode(result.recoveryCode);
  }

  if (recoveryCode !== null) {
    return (
      <div style={PAGE}>
        <div style={LEFT}>
          <Brand />
          <h1 style={{ fontSize: 'clamp(44px, 5.2vw, 84px)', fontWeight: 400, lineHeight: 1.0, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Account<br />created.</h1>
          <p style={{ ...LEAD, maxWidth: '44ch' }}>One thing to keep before you go on.</p>
        </div>
        <div style={FORM}>
          <RecoveryCode code={recoveryCode} onDone={() => go('/onboarding')} />
        </div>
      </div>
    );
  }

  return (
    <div style={PAGE}>
      <div style={LEFT}>
        <Brand />
        <h1 style={{ fontSize: 'clamp(44px, 5.2vw, 84px)', fontWeight: 400, lineHeight: 1.0, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Start with<br />one memory.</h1>
        <p style={{ ...LEAD, maxWidth: '44ch' }}>Create your workspace and keep the context with the work.</p>
      </div>
      <form style={FORM} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="EMAIL" type="email" placeholder="you@company.com" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="PASSWORD" type="password" placeholder="at least 12 characters" value={password} onChange={setPassword} autoComplete="new-password" />
        <Hint
          text={tooShort ? `${MIN_PASSWORD - password.length} more characters` : 'At least 12 characters. Length beats symbols.'}
          warn={tooShort}
        />
        <Field label="CONFIRM PASSWORD" type="password" placeholder="the same again" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {mismatch ? <Hint text="The two do not match." warn /> : null}
        <button className="hv-violet" type="submit" disabled={busy || !ready} style={{ ...PRIMARY, opacity: busy || !ready ? 0.55 : 1, cursor: busy || !ready ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <Problem>{problem}</Problem>
        <GoogleButton label="Continue with Google" />
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
          <button className="hv-text" type="button" onClick={() => go('/signin')} style={MINOR}>ALREADY HAVE AN ACCOUNT · SIGN IN</button>
        </div>
      </form>
    </div>
  );
}

/** A rule, or the distance from meeting it. Never a colour with no words. */
function Hint({ text, warn }: { text: string; warn?: boolean }) {
  return (
    <span style={{ fontSize: '12.5px', color: warn === true ? '#FFB829' : '#7A7A7A', marginTop: '-8px', lineHeight: 1.5 }}>
      {text}
    </span>
  );
}
