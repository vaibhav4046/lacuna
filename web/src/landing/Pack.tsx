import { MONO } from '../design/mark';

export function Pack() {
  return (
    <section data-scene="pack" style={{ position: 'relative', height: '220vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 'max(12%, 96px)', left: 'clamp(20px, 8vw, 130px)' }}>
          <h2 style={{ fontSize: 'clamp(40px, 4.6vw, 78px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Give the model less.<br />Give it better.</h2>
        </div>
        <div data-fx="pack-l" data-mhide="1" style={{ position: 'absolute', left: 'min(66%, calc(100vw - 300px))', top: '46%', opacity: 0, display: 'flex', flexDirection: 'column', gap: '9px', fontFamily: MONO, fontSize: '12px', letterSpacing: '0.16em', color: '#BDBDBD' }}>
          <span>FACTS</span>
          <span>CONSTRAINTS</span>
          <span>EVIDENCE</span>
          <span>OPEN QUESTIONS</span>
          <span style={{ color: '#9A9A9A' }}>REFERENCES STAY ATTACHED</span>
        </div>
      </div>
    </section>
  );
}
