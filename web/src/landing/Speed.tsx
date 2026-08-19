import { MONO } from '../design/mark';

const k = { color: '#7A7A7A' } as const;
const v = { color: '#9A9A9A' } as const;

/**
 * The latency rails read an em dash on purpose. Nothing here has been measured
 * for the visitor's own deployment, so nothing here claims a number: the
 * design's own MEASURED AFTER CONNECTION line is the rule, not a caption.
 */
export function Speed() {
  return (
    <section data-scene="speed" style={{ position: 'relative', height: '190vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 'max(12%, 96px)', left: 0, right: 0, textAlign: 'center', padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(38px, 4.2vw, 72px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Keep the context path short.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.7, color: '#9A9A9A', margin: '16px auto 0', maxWidth: '46ch' }}>Less context to move. Less context for the model to read. The evidence stays attached.</p>
        </div>
        <div data-mhide="1" style={{ position: 'absolute', right: 'clamp(20px, 6vw, 100px)', bottom: '11%', display: 'grid', gridTemplateColumns: 'auto auto', gap: '8px 26px', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em' }}>
          <span style={k}>HYDRADB RECALL</span><span style={v}>— MS</span>
          <span style={k}>LACUNA POLICY</span><span style={v}>— MS</span>
          <span style={k}>CONTEXT COMPILE</span><span style={v}>— MS</span>
          <span style={k}>MODEL</span><span style={v}>— MS</span>
          <span style={k}>END TO END</span><span style={v}>— MS</span>
          <span style={{ gridColumn: '1 / -1', color: '#7A7A7A', marginTop: '4px' }}>MEASURED AFTER CONNECTION</span>
        </div>
      </div>
    </section>
  );
}
