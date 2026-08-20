import { useNavigate } from 'react-router-dom';

import { MONO, Mark } from '../design/mark';

const link = { fontFamily: MONO, fontSize: '10px', fontWeight: 500, letterSpacing: '0.16em', textTransform: 'uppercase' } as const;

const links = [
  ['Ask it', '#try'],
  ['How it works', '#journey'],
  ['Developers', '#mcp'],
  ['Benchmarks', '#evals'],
  ['HydraDB', '#hydra'],
] as const;

export function Header() {
  const go = useNavigate();

  return (
    <header className="landing-header">
      <a href="#top" className="landing-brand" aria-label="Lacuna home">
        <span className="landing-brand-mark"><Mark size={23} /></span>
        <span>Lacuna</span>
        <small>MEMORY OS</small>
      </a>

      <nav data-navlinks="1" aria-label="Landing page">
        {links.map(([label, href]) => <a key={href} href={href} style={link}>{label}</a>)}
      </nav>

      <div className="landing-header-actions">
        <button data-navwide="1" className="hv-text" onClick={() => go('/judge')}>Judge proof</button>
        <button data-navwide="1" className="hv-text" onClick={() => go('/signin')}>Sign in</button>
        <button className="landing-header-primary" onClick={() => go('/signup')}>Get started</button>
        <details data-navmenu="1" className="landing-menu">
          <summary aria-label="Open navigation menu">Menu</summary>
          <div>
            {links.map(([label, href]) => (
              <a
                key={href}
                href={href}
                style={link}
                onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}
              >{label}</a>
            ))}
            <span />
            <button onClick={() => go('/judge')}>Judge proof</button>
            <button onClick={() => go('/signin')}>Sign in</button>
          </div>
        </details>
      </div>
    </header>
  );
}
