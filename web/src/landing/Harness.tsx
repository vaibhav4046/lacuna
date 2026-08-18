import { MONO } from '../design/mark';

export function Harness() {
  return (
    <section data-scene="harness" style={{ position: 'relative', height: '190vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 'max(11%, 96px)', left: 'clamp(20px, 5.4vw, 84px)', maxWidth: '480px' }}>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#9A9A9A' }}>The Lacuna harness</span>
          <h2 style={{ fontSize: 'clamp(32px, 3.7vw, 62px)', fontWeight: 400, lineHeight: 1.03, letterSpacing: '-0.035em', margin: '12px 0 0', color: '#FFFFFF' }}>One runtime around the context.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.75, color: '#9A9A9A', margin: '16px 0 0', maxWidth: '40ch', textWrap: 'pretty' }}>Models do the work. Lacuna keeps the state. Agents can use different models and tools without building a new memory system every time.</p>
        </div>
      </div>
    </section>
  );
}
