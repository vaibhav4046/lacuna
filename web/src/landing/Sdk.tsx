import { useState } from 'react';
import { MONO } from '../design/mark';
import { DEVCODE } from './copy';

const TABS = ['TypeScript', 'REST', 'MCP'];

export function Sdk() {
  const [tab, setTab] = useState(0);

  return (
    <section id="dev" data-scene="quiet" style={{ position: 'relative', padding: '18vh clamp(20px, 4.4vw, 72px) 10vh' }}>
      <div style={{ maxWidth: '1040px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '34px' }}>
        <div>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#9A9A9A' }}>SDK · API</span>
          <h2 style={{ fontSize: 'clamp(38px, 4.4vw, 74px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: '12px 0 0', color: '#FFFFFF' }}>Build with the same context contract.</h2>
        </div>
        <div style={{ display: 'flex', gap: 'clamp(18px, 3vw, 38px)', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
          {TABS.map((l, i) => (
            <button key={l} onClick={() => setTab(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 2px 0', textAlign: 'left' }}>
              <span style={{ fontFamily: MONO, fontSize: '11.5px', fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9A9A9A' }}>{l}</span>
              <span style={{ display: 'block', height: '2px', background: tab === i ? '#8052FF' : 'transparent', marginTop: '10px' }}></span>
            </button>
          ))}
        </div>
        {/* Above the block, at the size of the block, because it is a
            statement about every line below it. This code does not run: there
            is no published package and no /v1 endpoint. It sat under the panel
            at 10px, which is where a disclaimer goes when it is meant to be
            technically present rather than read. The terminal section further
            up is the opposite of this and is a recording of a real run. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', border: '1px solid rgba(255,184,41,0.35)', borderRadius: '7px', alignSelf: 'flex-start' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#FFB829', flexShrink: 0 }}></span>
          <span style={{ fontFamily: MONO, fontSize: '11.5px', letterSpacing: '0.16em', color: '#FFB829' }}>NOT SHIPPED · DESIGN CONTRACT, NOT A RUNNING API</span>
        </div>
        <pre style={{ margin: 0, fontFamily: MONO, fontSize: '13.5px', lineHeight: 1.85, color: '#BDBDBD', whiteSpace: 'pre-wrap', maxWidth: '76ch' }}>{(DEVCODE[tab] ?? DEVCODE[0]!).code}</pre>
        <div style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#7A7A7A', lineHeight: 2 }}>ENVELOPE · status · answer · evidence · revisions · conflicts · abstain_reason · context_pack_id · trace_id · source_state<br />THE IMPLEMENTED API IS THE SOURCE OF TRUTH · THE TERMINAL SECTION ABOVE IS A RECORDED RUN</div>
      </div>
    </section>
  );
}
