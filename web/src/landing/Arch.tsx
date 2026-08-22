import { MONO } from '../design/mark';

const row = { display: 'flex', alignItems: 'center', gap: '8px' } as const;
const dot = { width: '5px', height: '5px', border: '1px solid #6F6F76', display: 'inline-block' } as const;

export function Arch() {
  return (
    <section id="how" data-scene="arch" style={{ position: 'relative', height: '215vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div data-reveal style={{ position: 'absolute', left: 'clamp(20px, 5.4vw, 84px)', top: 'max(10%, 92px)', maxWidth: '460px' }}>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#9A9A9A' }}>How it works</span>
          <h2 style={{ fontSize: 'clamp(32px, 3.5vw, 58px)', fontWeight: 400, lineHeight: 1.03, letterSpacing: '-0.035em', margin: '12px 0 0', color: '#FFFFFF' }}>One memory layer.<br />Every way you work.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.75, color: '#9A9A9A', margin: '16px 0 0', maxWidth: '38ch', textWrap: 'pretty' }}>HydraDB keeps the state. Lacuna decides what the next agent should see, what changed, what conflicts, and when there is not enough evidence to answer.</p>
        </div>
        <div data-mhide="1" data-shield style={{ position: 'absolute', left: 'clamp(16px, 3.4vw, 56px)', top: 'max(56%, min(480px, calc(100vh - 200px)))', display: 'flex', flexDirection: 'column', gap: '9px', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#7A7A84' }}>
          <span style={row}><span style={dot}></span>PASTED TRANSCRIPTS</span>
          <span style={row}><span style={dot}></span>JSONL CORPUS</span>
          <span style={row}><span style={dot}></span>WORKSPACE INGEST</span>
          <span style={row}><span style={dot}></span>MCP CLIENTS</span>
          <span style={row}><span style={dot}></span>CLI</span>
          <span style={row}><span style={dot}></span>HTTP API</span>
          <span style={row}><span style={dot}></span>AGENT OUTCOMES</span>
        </div>
        <div data-mhide="1" data-shield style={{ position: 'absolute', bottom: '6%', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '11px', padding: '0 24px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 20px', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A84' }}>
            <span style={{ color: '#BDBDBD' }}>LACUNA CONTEXT OS</span><span>SCOPE</span><span>EVIDENCE</span><span>CONFLICTS</span><span>ABSTENTION</span><span>HEALTH</span><span>COMPILER</span><span>ROUTER</span><span>RUNTIME</span><span>TOOL MESH</span><span>POLICY</span><span>TRACE</span>
          </div>
          <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' }}>HYDRADB · PERSISTENT GRAPH STATE · MEMORY · KNOWLEDGE · RELATIONSHIPS · HISTORY</span>
        </div>
      </div>
    </section>
  );
}
