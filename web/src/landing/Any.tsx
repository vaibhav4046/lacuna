import { MONO } from '../design/mark';
import { icStyle } from '../design/icons';

const client = { display: 'flex', alignItems: 'center', gap: '8px', position: 'absolute', transform: 'translate(-50%, 30px)', fontFamily: MONO, fontSize: '12.5px', letterSpacing: '0.22em', color: '#7A7A84', transition: 'color 500ms ease' } as const;

export function Any() {
  return (
    <section data-scene="any" style={{ position: 'relative', height: '200vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 'max(10%, 96px)', left: 0, right: 0, textAlign: 'center', padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(40px, 4.6vw, 78px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>One context.<br />Any agent.</h2>
        </div>
        <div data-client="0" data-flexed="1" style={{ ...client, left: '16%', top: '36%' }}><span style={icStyle('claude', 12)}></span>CLAUDE</div>
        <div data-client="1" data-flexed="1" style={{ ...client, left: '84%', top: '33%' }}><span style={icStyle('codex', 12)}></span>CODEX</div>
        <div data-client="2" data-flexed="1" style={{ ...client, left: '13%', top: '70%' }}><span style={icStyle('chip', 12)}></span>LOCAL</div>
        <div data-client="3" data-flexed="1" style={{ ...client, left: '87%', top: '68%' }}><span style={icStyle('orb', 12)}></span>VOICE</div>
        <div data-client="4" data-flexed="1" style={{ ...client, left: '50%', top: '84%' }}><span style={icStyle('API', 12)}></span>CUSTOM</div>
        <div style={{ position: 'absolute', left: '50%', top: '57%', transform: 'translate(52px, -50%)', fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.2em', color: '#9A9A9A' }}>CONTEXT PACK</div>
        <div style={{ position: 'absolute', bottom: '7%', left: 0, right: 0, textAlign: 'center', fontSize: '17px', color: '#BDBDBD' }}>The agent can change. Lacuna stays.</div>
      </div>
    </section>
  );
}
