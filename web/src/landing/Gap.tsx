import { MONO } from '../design/mark';

export function Gap() {
  return (
    <section data-scene="gap" style={{ position: 'relative', height: '200vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div data-fx="gap-q" style={{ position: 'absolute', top: 'max(14%, 96px)', left: 0, right: 0, textAlign: 'center', opacity: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#9A9A9A' }}>Second query</span>
          <div style={{ fontSize: 'clamp(24px, 2.4vw, 38px)', fontWeight: 400, letterSpacing: '-0.02em', color: '#FFFFFF', marginTop: '12px' }}>What is the connection pool size?</div>
        </div>
        <div data-fx="gap-a" style={{ position: 'absolute', top: '51.5%', left: 0, right: 0, textAlign: 'center', opacity: 0 }}>
          <div style={{ fontSize: 'clamp(19px, 1.6vw, 25px)', fontWeight: 400, color: '#FFFFFF' }}>No supporting evidence.</div>
          <div style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#5E5E5E', marginTop: '12px' }}>THE MEMORY DOES NOT CONTAIN THIS VALUE</div>
        </div>
      </div>
    </section>
  );
}
