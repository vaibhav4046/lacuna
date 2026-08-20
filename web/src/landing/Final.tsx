import { useNavigate } from 'react-router-dom';
import { MONO } from '../design/mark';

export function Final() {
  const go = useNavigate();
  return (
    <section data-scene="final" style={{ position: 'relative', height: '150vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div data-reveal style={{ position: 'absolute', top: '50%', translate: '0 -50%', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', textAlign: 'center', padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(40px, 4.8vw, 84px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF', maxWidth: '20ch' }}>Give your agents a memory that survives the session.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.7, color: '#9A9A9A', margin: 0, maxWidth: '48ch' }}>Connect your context once. Use it from whatever comes next.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '26px', marginTop: '4px' }}>
            <button className="hv-violet" onClick={() => go('/signup')} style={{ background: '#8052FF', border: 'none', cursor: 'pointer', color: '#FFFFFF', fontSize: '15px', fontWeight: 500, padding: '13px 24px', borderRadius: '8px', whiteSpace: 'nowrap' }}>Start building</button>
            <button className="hv-text" type="button" onClick={() => go('/explore/sdk')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', color: '#BDBDBD', borderBottom: '1px solid rgba(255,255,255,0.28)', paddingBottom: '3px', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>Read the docs</button>
          </div>
          <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#7A7A7A', marginTop: '8px' }}>Built on HydraDB.</span>
        </div>
      </div>
    </section>
  );
}
