import { MONO } from '../design/mark';

const ROWS = ['Vector retrieval', 'HydraDB', 'HydraDB + graph context', 'Lacuna'];

/**
 * Four rows, four NO MEASURED RUN. The page says numbers arrive when a
 * recorded run exists, and until the evaluation harness writes one this is
 * what the page is allowed to say.
 */
export function Evals() {
  return (
    <section id="evals" data-scene="quiet" style={{ position: 'relative', padding: '14vh clamp(20px, 4.4vw, 72px)' }}>
      <div style={{ maxWidth: '1040px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '30px' }}>
        <h2 style={{ fontSize: 'clamp(38px, 4.4vw, 74px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Measure the context.<br />Then make the claim.</h2>
        <p style={{ fontSize: '17px', lineHeight: 1.7, color: '#9A9A9A', margin: 0, maxWidth: '54ch', textWrap: 'pretty' }}>The framework is ready. The numbers arrive when a recorded run exists. Nothing here is allowed to look measured unless it is.</p>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', marginTop: '8px' }}>
          {ROWS.map((label) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', alignItems: 'baseline', padding: '18px 4px', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
              <span style={{ fontSize: '16px', color: '#FFFFFF' }}>{label}</span>
              <span style={{ fontFamily: MONO, fontSize: '11px', letterSpacing: '0.16em', color: '#5E5E5E' }}>NO MEASURED RUN</span>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#5E5E5E', lineHeight: 2.1 }}>CASES · UPDATES · TEMPORAL · CONFLICT · MISSING INFORMATION · MULTI-SESSION · CONTEXT TOKENS · LATENCY<br />SMALL VS LARGE MODEL COMPARISON APPEARS HERE AFTER A REAL BENCHMARK</div>
      </div>
    </section>
  );
}
