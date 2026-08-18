import { MONO } from '../design/mark';

const stage = { color: '#71717A', transition: 'color 400ms ease' } as const;

export function Hand() {
  return (
    <section data-scene="hand" style={{ position: 'relative', height: '200vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 'max(12%, 96px)', left: 0, right: 0, textAlign: 'center', padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(36px, 4.2vw, 70px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Handoff the task.<br />Not the whole chat.</h2>
          <p style={{ fontSize: '16.5px', color: '#9A9A9A', margin: '16px auto 0', maxWidth: '48ch' }}>Each agent gets the context it needs and returns only what is worth keeping.</p>
        </div>
        <div style={{ position: 'absolute', bottom: '10%', left: 0, right: 0, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'clamp(18px, 4vw, 54px)', padding: '0 16px', fontFamily: MONO, fontSize: '11px', letterSpacing: '0.2em' }}>
          <span data-ho="0" style={stage}>PLANNER</span>
          <span data-ho="1" style={stage}>CODER</span>
          <span data-ho="2" style={stage}>REVIEWER</span>
          <span data-ho="3" style={stage}>WRITEBACK</span>
        </div>
      </div>
    </section>
  );
}
