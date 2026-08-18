import { MONO } from '../design/mark';

export function Rot() {
  return (
    <section id="context-rot" data-scene="rot" style={{ position: 'relative', height: '210vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', alignItems: 'center', padding: '0 clamp(20px, 4.4vw, 72px)', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: '780px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#9A9A9A' }}>Context rot</span>
          <h2 style={{ fontSize: 'clamp(38px, 4.4vw, 74px)', fontWeight: 400, lineHeight: 1.0, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Memory gets worse when nobody maintains the context.</h2>
          <p style={{ fontSize: '18px', lineHeight: 1.7, color: '#9A9A9A', margin: '6px 0 0', maxWidth: '54ch', textWrap: 'pretty' }}>Agents keep collecting facts, messages, summaries and decisions. Old information stays searchable. New information arrives. Different sources disagree.</p>
          <p style={{ fontSize: '18px', color: '#FFFFFF', margin: 0 }}>More memory can mean worse context.</p>
        </div>
      </div>
    </section>
  );
}
