import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn } from '../api/auth';
import { useSession } from '../api/session';
import { Brand, Field, Problem, FORM, LEAD, LEFT, MINOR, MINOR_DIM, PAGE, PRIMARY } from './parts';

export default function SignIn() {
  const go = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setProblem(null);
    const failure = await signIn(email, password);
    setBusy(false);
    if (failure !== null) { setProblem(failure); return; }
    refresh();
    go('/app/dash');
  }

  return (
    <div style={PAGE}>
      <div style={LEFT}>
        <Brand />
        <h1 style={{ fontSize: 'clamp(44px, 5.2vw, 84px)', fontWeight: 400, lineHeight: 1.0, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Your context<br />is still here.</h1>
        <p style={{ ...LEAD, maxWidth: '42ch' }}>Sign in to continue with your workspaces, memory and agents.</p>
      </div>
      <form style={FORM} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="EMAIL" type="email" placeholder="you@company.com" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="PASSWORD" type="password" placeholder="••••••••" value={password} onChange={setPassword} autoComplete="current-password" />
        <button className="hv-violet" type="submit" disabled={busy} style={PRIMARY}>Sign in</button>
        <Problem>{problem}</Problem>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginTop: '4px' }}>
          <button className="hv-text" type="button" onClick={() => go('/signup')} style={MINOR}>CREATE ACCOUNT</button>
          <button className="hv-text" type="button" onClick={() => go('/forgot')} style={MINOR_DIM}>FORGOT PASSWORD</button>
        </div>
      </form>
    </div>
  );
}
