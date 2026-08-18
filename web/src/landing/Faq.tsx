import { useState } from 'react';
import { MONO } from '../design/mark';
import { FAQ } from './copy';

export function Faq() {
  const [open, setOpen] = useState(-1);

  return (
    <section id="faq" data-scene="off" style={{ position: 'relative', padding: '14vh clamp(20px, 4.4vw, 72px)' }}>
      <div style={{ maxWidth: '880px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '40px' }}>
        <h2 style={{ fontSize: 'clamp(40px, 4.6vw, 78px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Questions,<br />answered plainly.</h2>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)' }}>
          {FAQ.map(([q, a], i) => (
            <div key={q} style={{ borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
              <button onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '20px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '24px', cursor: 'pointer' }}>
                <span style={{ fontSize: '17px', fontWeight: 400, color: '#FFFFFF' }}>{q}</span>
                <span style={{ fontFamily: MONO, fontSize: '14px', color: '#5E5E5E' }}>{open === i ? '—' : '+'}</span>
              </button>
              {open === i ? (
                <p style={{ margin: 0, padding: '0 4px 26px', fontSize: '16px', lineHeight: 1.8, color: '#9A9A9A', maxWidth: '68ch', textWrap: 'pretty' }}>{a}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
