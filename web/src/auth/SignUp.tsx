import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signUp } from '../api/auth';
import { useSession } from '../api/session';
import { Brand, Field, Problem, FORM, LEAD, LEFT, MINOR, PAGE, PRIMARY } from './parts';

export default function SignUp() {
  const go = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setProblem(null);
    const failure = await signUp(email, password);
    setBusy(false);
    if (failure !== null) { setProblem(failure); return; }
    await refresh();
    go('/onboarding');
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
        <Field label="PASSWORD" type="password" placeholder="••••••••" value={password} onChange={setPassword} autoComplete="new-password" />
        <button className="hv-violet" type="submit" disabled={busy} style={PRIMARY}>Create account</button>
        <Problem>{problem}</Problem>
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
          <button className="hv-text" type="button" onClick={() => go('/signin')} style={MINOR}>ALREADY HAVE AN ACCOUNT · SIGN IN</button>
        </div>
      </form>
    </div>
  );
}
