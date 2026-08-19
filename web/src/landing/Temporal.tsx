import { useState } from 'react';
import { MONO } from '../design/mark';
import { REVS } from './copy';

const chip = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em' } as const;
const key = { color: '#7A7A7A' } as const;

export function Temporal() {
  const [hover, setHover] = useState(-1);

  return (
    <section data-scene="temporal" style={{ position: 'relative', height: '210vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', alignItems: 'center', padding: '0 clamp(20px, 4.4vw, 72px)', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: '540px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#9A9A9A' }}>Temporal resolution</span>
          <h2 style={{ fontSize: 'clamp(40px, 4.4vw, 74px)', fontWeight: 400, lineHeight: 1.0, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Old facts stay.<br />Current facts win.</h2>
          <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid rgba(255,255,255,0.10)', marginTop: '10px' }}>
            {REVS.map((r, i) => (
              <div key={r.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} style={{ borderBottom: '1px solid rgba(255,255,255,0.10)', padding: '15px 4px', cursor: 'default' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '16px' }}>
                  <span style={{ fontSize: '17px', color: '#FFFFFF' }}>{r.date}</span>
                  {r.cur ? <span style={{ ...chip, color: '#8052FF' }}>CURRENT</span> : null}
                  {r.pro ? <span style={{ ...chip, color: '#7A7A7A' }}>PROPOSAL · NEVER CURRENT</span> : null}
                  {!r.cur && !r.pro ? <span style={{ ...chip, color: '#7A7A7A' }}>HISTORICAL</span> : null}
                </div>
                {hover === i ? (
                  <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 20px', fontFamily: MONO, fontSize: '11px', letterSpacing: '0.06em', color: '#9A9A9A' }}>
                    <span style={key}>SOURCE</span><span>{r.src}</span>
                    <span style={key}>OBSERVED</span><span>{r.obs}</span>
                    <span style={key}>STANDING</span><span>{r.valid}</span>
                    <span style={key}>REPLACED BY</span><span>{r.rep}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
