import { MONO } from '../design/mark';

const transcript = { opacity: 0.14, transition: 'opacity 500ms ease' } as const;
const state = { color: '#7A7A7A', transition: 'color 400ms ease' } as const;

export function Voice() {
  return (
    <section id="voice-scene" data-scene="voice" style={{ position: 'relative', height: '210vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 'max(13%, 96px)', left: 'clamp(20px, 8vw, 130px)' }}>
          <h2 style={{ fontSize: 'clamp(40px, 4.6vw, 78px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Talk to<br />the same memory.</h2>
          <p style={{ fontSize: '15.5px', color: '#9A9A9A', margin: '16px 0 0', maxWidth: '36ch', lineHeight: 1.7 }}>Voice is another way into Lacuna. It uses the same context, evidence and memory as text.</p>
        </div>
        <div data-mhide="1" data-shield style={{ position: 'absolute', right: 'clamp(20px, 7vw, 110px)', top: '24%', width: 'min(320px, 38vw)', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div data-vt="0" style={{ ...transcript, fontSize: '17px', color: '#BDBDBD' }}>"Where does session state live now?"</div>
          <div data-vt="1" style={transcript}>
            <div style={{ fontSize: '26px', color: '#FFFFFF', letterSpacing: '-0.02em' }}>Postgres</div>
            <div style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em', color: '#9A9A9A', marginTop: '6px' }}>CURRENT · 2 SOURCES</div>
          </div>
          <div data-vt="2" style={{ ...transcript, fontFamily: MONO, fontSize: '11px', letterSpacing: '0.14em', color: '#9A9A9A' }}>NO EVIDENCE · THE CENTRE STAYS OPEN</div>
        </div>
        <div style={{ position: 'absolute', bottom: '12%', left: 0, right: 0, display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 'clamp(14px, 3vw, 40px)', fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.2em' }}>
          <span data-vs="0" style={state}>LISTENING</span>
          <span data-vs="1" style={state}>TRANSCRIBING</span>
          <span data-vs="2" style={state}>CHECKING CONTEXT</span>
          <span data-vs="3" style={state}>SPEAKING</span>
          <span data-vs="4" style={state}>NO EVIDENCE</span>
        </div>
      </div>
    </section>
  );
}
