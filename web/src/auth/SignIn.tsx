import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { signIn } from '../api/auth';
import { useSession } from '../api/session';
import { landingAccountActions } from '../landing/account-actions';
import { Brand, Field, Problem, FORM, LEAD, LEFT, MINOR, MINOR_DIM, PAGE, PRIMARY } from './parts';
import { GoogleButton, googleProblem } from './google';

export default function SignIn() {
  const go = useNavigate();
  const { loaded, refresh } = useSession();
  const account = landingAccountActions(loaded);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // A failed Google round trip comes back as a query, not as a fetch result.
  const [problem, setProblem] = useState<string | null>(googleProblem(window.location.search));
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setProblem(null);
    const failure = await signIn(email, password);
    setBusy(false);
    if (failure !== null) { setProblem(failure); return; }
    await refresh();
    go('/app/dash');
  }

  if (account.state === 'member') return <Navigate to={account.primary.path} replace />;

  return (
    <div style={PAGE}>
      <div style={LEFT}>
        <Brand />
        <h1 style={{ fontSize: 'clamp(44px, 5.2vw, 84px)', fontWeight: 400, lineHeight: 1.0, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Your context<br />is still here.</h1>
        <p style={{ ...LEAD, maxWidth: '42ch' }}>Continue with Google. If you have an older password account, sign in with it below.</p>
      </div>
      <form style={FORM} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <GoogleButton label="Continue with Google" showDivider={false} />
        <Problem>{problem}</Problem>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', margin: '2px 0' }}>
          <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.12)' }} />
          <span style={{ fontSize: '10px', letterSpacing: '0.16em', color: '#7A7A7A' }}>OLDER PASSWORD ACCOUNT</span>
          <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.12)' }} />
        </div>
        <Field label="EMAIL" type="email" placeholder="you@company.com" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="PASSWORD" type="password" placeholder="••••••••" value={password} onChange={setPassword} autoComplete="current-password" />
        <button className="hv-violet" type="submit" disabled={busy} style={PRIMARY}>Sign in</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginTop: '4px' }}>
          <button className="hv-text" type="button" onClick={() => go('/signup')} style={MINOR}>NEW HERE? CREATE WITH GOOGLE</button>
          <button className="hv-text" type="button" onClick={() => go('/forgot')} style={MINOR_DIM}>FORGOT PASSWORD</button>
        </div>
      </form>
    </div>
  );
}
