import { useNavigate } from 'react-router-dom';
import { MONO, Mark } from '../design/mark';

const link = { fontFamily: MONO, fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9A9A9A' } as const;

export function Header() {
  const go = useNavigate();
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', padding: '16px clamp(20px, 3.4vw, 44px)', background: 'linear-gradient(180deg, rgba(0,0,0,0.8), rgba(0,0,0,0))', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', pointerEvents: 'auto' }}>
        <Mark size={21} />
        <span style={{ fontSize: '15px', fontWeight: 500, letterSpacing: '0.01em', color: '#FFFFFF' }}>Lacuna</span>
      </div>
      <div data-navlinks="1" style={{ display: 'flex', alignItems: 'center', gap: 'clamp(18px, 2.3vw, 32px)', pointerEvents: 'auto' }}>
        <a href="#product" style={link}>Product</a>
        <a href="#how" style={link}>How it works</a>
        <a href="#dev" style={link}>Developers</a>
        <a href="#evals" style={link}>Benchmarks</a>
        <a href="#faq" style={link}>FAQ</a>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'auto' }}>
        <button className="hv-text" onClick={() => go('/signin')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#BDBDBD', fontSize: '14px', padding: '9px 14px' }}>Sign in</button>
        <button className="hv-violet" onClick={() => go('/signup')} style={{ background: '#8052FF', border: 'none', cursor: 'pointer', color: '#FFFFFF', fontSize: '14px', fontWeight: 500, padding: '9px 18px', borderRadius: '8px' }}>Get started</button>
      </div>
    </div>
  );
}
