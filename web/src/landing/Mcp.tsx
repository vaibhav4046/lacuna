import { MONO } from '../design/mark';

export function Mcp() {
  return (
    <section id="mcp" data-scene="mcp" style={{ position: 'relative', height: '145vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div data-reveal style={{ position: 'absolute', top: 'max(13%, 96px)', left: 0, right: 0, textAlign: 'center', padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(34px, 4vw, 66px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Bring Lacuna into the tools you already use.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.7, color: '#9A9A9A', margin: '18px auto 0', maxWidth: '46ch' }}>An agent asks over MCP. Lacuna compiles. A smaller pack returns.</p>
        </div>
        <div style={{ position: 'absolute', bottom: '12%', left: 0, right: 0, textAlign: 'center', fontFamily: MONO, fontSize: '12px', letterSpacing: '0.14em', color: '#B0B0B8' }}>query · remember · explain · timeline · evidence · context pack · health · handoff</div>
      </div>
    </section>
  );
}
