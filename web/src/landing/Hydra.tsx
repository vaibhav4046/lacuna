import { MONO, Mark } from '../design/mark';
import { icStyle } from '../design/icons';

const head = { display: 'flex', alignItems: 'center', gap: '9px', fontFamily: MONO, fontSize: '12px', fontWeight: 500, letterSpacing: '0.22em', color: '#FFFFFF' } as const;
const body = { fontSize: '15px', lineHeight: 1.6, color: '#9A9A9A', margin: '8px 0 10px' } as const;
const list = { fontFamily: MONO, fontSize: '11px', lineHeight: 2, letterSpacing: '0.1em', color: '#7A7A7A' } as const;

export function Hydra() {
  return (
    <section id="hydra" data-scene="hydra" style={{ position: 'relative', height: '165vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 'max(12%, 96px)', left: 'clamp(20px, 8vw, 130px)' }}>
          <h2 style={{ fontSize: 'clamp(40px, 4.6vw, 78px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>The graph<br />underneath Lacuna.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.75, color: '#9A9A9A', margin: '16px 0 0', maxWidth: '44ch' }}>HydraDB keeps memory, knowledge, relationships and history. Lacuna controls how that context reaches the next agent.</p>
        </div>
        <div style={{ position: 'absolute', left: 'clamp(20px, 8vw, 130px)', bottom: '11%', width: 'min(300px, 40vw)' }}>
          <div style={head}><span style={icStyle('HydraDB', 15)}></span>HYDRADB</div>
          <p style={body}>Stores and connects state.</p>
          <div style={list}>memory · knowledge · context graph<br />graph-enriched retrieval · temporal state · MCP</div>
        </div>
        <div style={{ position: 'absolute', right: 'clamp(20px, 7vw, 110px)', bottom: '11%', width: 'min(300px, 40vw)' }}>
          <div style={head}><Mark size={15} />LACUNA</div>
          <p style={body}>Controls how agents use it.</p>
          <div style={list}>evidence · conflicts · abstention<br />Context Packs · handoffs · routing · trace</div>
        </div>
      </div>
    </section>
  );
}
