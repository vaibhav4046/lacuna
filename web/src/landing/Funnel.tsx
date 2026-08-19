import { MONO } from '../design/mark';

export function Funnel() {
  return (
    <section data-scene="funnel" style={{ position: 'relative', height: '280vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 'clamp(20px, 5.4vw, 84px)', top: '22%', maxWidth: '440px' }}>
          <h2 style={{ fontSize: 'clamp(32px, 3.6vw, 60px)', fontWeight: 400, lineHeight: 1.03, letterSpacing: '-0.035em', margin: 0, color: '#FFFFFF' }}>Most context should never reach the model.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.75, color: '#9A9A9A', margin: '18px 0 0', maxWidth: '38ch', textWrap: 'pretty' }}>The job is not to fit everything into the prompt. The job is to keep the useful parts.</p>
          <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A', display: 'block', marginTop: '20px' }}>ONE CONTEXT PASS</span>
        </div>
      </div>
    </section>
  );
}
