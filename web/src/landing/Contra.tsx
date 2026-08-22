import { useNavigate } from 'react-router-dom';
import { MONO } from '../design/mark';

export function Contra() {
  const go = useNavigate();
  return (
    <section data-scene="contra" style={{ position: 'relative', height: '150vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div data-reveal style={{ position: 'absolute', top: 'max(13%, 96px)', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px', textAlign: 'center', padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(40px, 4.6vw, 78px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>When the sources disagree,<br />keep both.</h2>
          <p style={{ fontSize: '16.5px', color: '#9A9A9A', margin: 0 }}>Resolve it with evidence, not confidence theatre.</p>
          <button className="hv-text" data-fx="contra-x" onClick={() => go('/explore/graph')} style={{ opacity: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: '12px', fontWeight: 500, letterSpacing: '0.18em', color: '#D0D0D6', padding: '8px 2px', borderBottom: '1px solid rgba(255,255,255,0.4)' }}>INSPECT CONFLICT</button>
        </div>
      </div>
    </section>
  );
}
