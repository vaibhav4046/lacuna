import { useNavigate } from 'react-router-dom';
import { MONO } from '../design/mark';

export function Hero() {
  const go = useNavigate();
  return (
    <section id="top" data-scene="hero" style={{ position: 'relative', height: '160vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', alignItems: 'center', padding: '84px clamp(20px, 4.4vw, 72px) 0', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: '660px', display: 'flex', flexDirection: 'column', gap: 'clamp(18px, 2.2vh, 28px)' }}>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#9A9A9A', animation: 'heroIn 0.6s ease 0.05s both' }}>Context for long-running agents</span>
          <h1 style={{ fontSize: 'clamp(54px, 7.3vw, 113px)', fontWeight: 400, lineHeight: 0.98, letterSpacing: '-0.045em', margin: 0, color: '#FFFFFF', animation: 'heroIn 0.7s ease 0.2s both' }}>Memory that knows<br />what changed.</h1>
          <p style={{ fontSize: '18px', fontWeight: 400, lineHeight: 1.7, color: '#9A9A9A', margin: '4px 0 0', maxWidth: '50ch', textWrap: 'pretty', animation: 'heroIn 0.7s ease 0.55s both' }}>Lacuna gives your agents one memory across sessions, models and tools. It keeps the history, finds what matters now, shows where it came from, and stops when the answer is missing.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '26px', marginTop: '8px', flexWrap: 'wrap', animation: 'heroIn 0.7s ease 0.8s both' }}>
            <button className="hv-violet" onClick={() => go('/signup')} style={{ background: '#8052FF', border: 'none', cursor: 'pointer', color: '#FFFFFF', fontSize: '15px', fontWeight: 500, padding: '13px 24px', borderRadius: '8px', whiteSpace: 'nowrap' }}>Start building</button>
            <button className="hv-edge35" onClick={() => go('/judge')} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', cursor: 'pointer', color: '#FFFFFF', fontSize: '15px', padding: '13px 22px', whiteSpace: 'nowrap' }}>See it answer, live</button>
            <a href="#how" style={{ fontSize: '15px', color: '#BDBDBD', borderBottom: '1px solid rgba(255,255,255,0.28)', paddingBottom: '3px', whiteSpace: 'nowrap' }}>See how it works</a>
          </div>
          <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#7A7A7A', marginTop: '14px', animation: 'heroIn 0.7s ease 1s both' }}>Built on HydraDB.</span>
        </div>
      </div>
    </section>
  );
}
