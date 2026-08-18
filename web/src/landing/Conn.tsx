import { MONO } from '../design/mark';
import { icStyle } from '../design/icons';
import { CONNECTOR_GROUPS, dotFor } from '../design/connectors';

export function Conn() {
  return (
    <section id="conn" data-scene="conn" style={{ position: 'relative', height: '200vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 'max(9%, 92px)', left: 0, right: 0, textAlign: 'center', padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(36px, 4.2vw, 70px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Bring the context you already have.</h2>
          <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.18em', color: '#5E5E5E', display: 'block', marginTop: '14px' }}>STATES ARE HONEST · CONNECTED · AVAILABLE · SYNCING · PLANNED</span>
        </div>
        {CONNECTOR_GROUPS.map((g) => (
          <div key={g.h} data-mhide="1" style={{ position: 'absolute', left: g.gx, top: g.gy, transform: 'translate(-50%,-50%)', width: '170px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontFamily: MONO, fontSize: '9.5px', fontWeight: 500, letterSpacing: '0.24em', color: '#71717A' }}>{g.h}</span>
            {g.items.map((c) => (
              <span key={c.n} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={icStyle(c.n, 13)}></span>
                <span style={{ fontSize: '13.5px', color: '#BDBDBD' }}>{c.n}</span>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: dotFor(c.st), flexShrink: 0 }}></span>
                <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.12em', color: '#5E5E5E' }}>{c.st}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
