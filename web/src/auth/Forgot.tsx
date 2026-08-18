import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestReset } from '../api/auth';
import { Brand, Field, Problem, FORM, LEAD, LEFT, MINOR, PAGE, PRIMARY } from './parts';

export default function Forgot() {
  const go = useNavigate();
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setProblem(null);
    const failure = await requestReset(email);
    setBusy(false);
    if (failure !== null) { setProblem(failure); return; }
    go('/signin');
  }

  return (
    <div style={PAGE}>
      <div style={LEFT}>
        <Brand />
        <h1 style={{ fontSize: 'clamp(40px, 4.6vw, 74px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Reset your<br />password.</h1>
        <p style={{ ...LEAD, maxWidth: '42ch' }}>We will email a reset link. Your memory and workspaces stay exactly where they are.</p>
      </div>
      <form style={FORM} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="EMAIL" type="email" placeholder="you@company.com" value={email} onChange={setEmail} autoComplete="email" />
        <button className="hv-violet" type="submit" disabled={busy} style={PRIMARY}>Send reset link</button>
        <Problem>{problem}</Problem>
        <button className="hv-text" type="button" onClick={() => go('/signin')} style={{ ...MINOR, textAlign: 'left', marginTop: '4px' }}>BACK TO SIGN IN</button>
      </form>
    </div>
  );
}
