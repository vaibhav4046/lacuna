import { useState } from 'react';

import { useScoped } from '../../api/scope';
import { icStyle } from '../../design/icons';
import { MONO } from '../../design/mark';
import { Empty, Failed, Stage } from '../state';
import { VoiceOrb } from '../../canvas/VoiceOrb';

/**
 * The MODELS group: Models and Voice.
 *
 * Neither screen names a connected provider unless something checked. The
 * design writes a latency column and the design's own line under it says the
 * numbers appear after a real health check, so the column reads an em dash
 * until one has run.
 */

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#5E5E5E' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#5E5E5E' } as const;
const GRID = '1.2fr 0.8fr 0.8fr 0.9fr 0.7fr';

const ROUTER_MODES = ['AUTO', 'LOCAL FIRST', 'QUALITY FIRST', 'PRIVACY FIRST', 'COST FIRST', 'LATENCY FIRST', 'CUSTOM'] as const;

interface Model {
  readonly name: string;
  readonly prov: string;
  readonly where: string;
  readonly state: string;
  readonly dot: string;
  readonly lat: string;
}

export function Models() {
  const models = useScoped<readonly Model[]>('models');
  const [mode, setMode] = useState(0);
  const rows = models.state === 'ready' ? models.value : [];

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '26px' }}>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.2em', color: '#5E5E5E', marginRight: '6px' }}>ROUTER</span>
        {ROUTER_MODES.map((l, i) => (
          <button key={l} className="hv-text" onClick={() => setMode(i)} style={{ background: 'none', cursor: 'pointer', borderRadius: '7px', padding: '7px 11px', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', border: '1px solid rgba(255,255,255,0.12)', color: mode === i ? '#FFFFFF' : '#9A9A9A' }}>{l}</button>
        ))}
      </div>
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '16px', padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.14)', ...head }}>
          <span>MODEL</span><span>PROVIDER</span><span>WHERE</span><span>STATE</span><span>LATENCY</span>
        </div>
        {models.state === 'loading' ? <Stage label="CHECKING CONTEXT" /> : null}
        {models.state === 'failed' ? <Failed reason={models.reason} /> : null}
        {models.state === 'ready' && rows.length === 0 ? (
          <Empty headline="No model endpoints configured." detail="Add an endpoint and its state appears here after a health check." />
        ) : null}
        {rows.map((m) => (
          <div key={m.name} className="hv-surface3" style={{ display: 'grid', gridTemplateColumns: GRID, gap: '16px', alignItems: 'baseline', padding: '15px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)', transition: 'background 140ms ease' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={icStyle(`${m.name} ${m.prov}`, 14)}></span>
              <span style={{ fontFamily: MONO, fontSize: '13px', color: '#FFFFFF' }}>{m.name}</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#9A9A9A' }}>{m.prov}</span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#9A9A9A' }}>{m.where}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: m.dot }}></span>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.1em', color: '#BDBDBD' }}>{m.state}</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#5E5E5E' }}>{m.lat}</span>
          </div>
        ))}
      </div>
      <span style={note}>LATENCY APPEARS AFTER A REAL HEALTH CHECK · NO FAKE VALUES</span>
    </div>
  );
}

/**
 * Voice.
 *
 * The microphone is requested only when someone asks for it. Until then the
 * orb is static and the row says NOT CONFIGURED, which is true: nothing is
 * listening and no provider is wired. With the microphone live, every moving
 * part of the orb is driven by real audio, and the level and pitch readouts
 * show measured values or an em dash.
 */
export function Voice() {
  return (
    <div style={{ maxWidth: '1020px', margin: '0 auto', display: 'flex', gap: 'clamp(24px, 4vw, 56px)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <VoiceOrb />
    </div>
  );
}
