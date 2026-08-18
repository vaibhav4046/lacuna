import { MONO } from '../design/mark';

export function Org() {
  return (
    <section data-scene="org" style={{ position: 'relative', height: '180vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 clamp(20px, 5vw, 90px)', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: '620px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#9A9A9A' }}>Context health</span>
          <h2 style={{ fontSize: 'clamp(32px, 3.7vw, 62px)', fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.035em', margin: 0, color: '#FFFFFF' }}>Lacuna keeps the history without treating all of it as current.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.75, color: '#9A9A9A', margin: 0, maxWidth: '46ch', textWrap: 'pretty' }}>Duplicates collapse into families. History forms outer bands. Open conflicts stay visibly split. Nothing is deleted to make the picture look clean.</p>
        </div>
      </div>
    </section>
  );
}
