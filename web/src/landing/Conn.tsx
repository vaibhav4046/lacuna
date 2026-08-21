import { MONO } from '../design/mark';
import { icStyle } from '../design/icons';
import { CONNECTOR_PRESENTATION, dotFor } from '../design/connectors';

const POSITIONS = {
  CODE: ['22%', '42%'], WORK: ['76%', '40%'], FILES: ['24%', '74%'], DATA: ['76%', '74%'],
} as const;

export function Conn() {
  return (
    <section id="conn" data-scene="conn" style={{ position: 'relative', height: '200vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 'max(9%, 92px)', left: 0, right: 0, textAlign: 'center', padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(36px, 4.2vw, 70px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Bring the context you already have.</h2>
          <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.18em', color: '#7A7A7A', display: 'block', marginTop: '14px' }}>IMPLEMENTED CAPABILITY IS NOT A RUNTIME AVAILABILITY CLAIM · PLANNED ITEMS STAY INERT</span>
        </div>
        {(Object.keys(POSITIONS) as readonly (keyof typeof POSITIONS)[]).map((group) => {
          const [left, top] = POSITIONS[group];
          return <div key={group} data-mhide="1" data-shield style={{ position: 'absolute', left, top, transform: 'translate(-50%,-50%)', width: '190px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontFamily: MONO, fontSize: '9.5px', fontWeight: 500, letterSpacing: '0.24em', color: '#7A7A84' }}>{group}</span>
            {CONNECTOR_PRESENTATION.filter((item) => item.group === group).slice(0, 4).map((item) => {
              const status = item.implementation === 'implemented' ? 'PRIVATE WORKFLOW' : 'PLANNED';
              return <span key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={icStyle(item.name, 13)} />
                <span style={{ fontSize: '13.5px', color: '#BDBDBD' }}>{item.name}</span>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: dotFor(item.implementation === 'implemented' ? 'available' : 'planned'), flexShrink: 0 }} />
                <span style={{ fontFamily: MONO, fontSize: '8.5px', letterSpacing: '0.1em', color: '#7A7A7A' }}>{status}</span>
              </span>;
            })}
          </div>;
        })}
      </div>
    </section>
  );
}
