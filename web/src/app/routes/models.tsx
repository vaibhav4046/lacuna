
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

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#7A7A7A' } as const;
const GRID = '1.2fr 0.8fr 0.8fr 0.9fr 0.7fr';

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
  const rows = models.state === 'ready' ? models.value : [];

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '26px' }}>
      {/*
        There was a router here: seven modes, AUTO through CUSTOM, and clicking
        one moved a highlight and changed nothing. Nothing in this product routes
        between models. A control that looks like a setting and is not one is the
        most expensive kind of decoration, because a reader who finds one stops
        believing the controls that do work.
      */}
      <p style={{ fontSize: '14.5px', color: '#9A9A9A', margin: 0, maxWidth: '72ch', lineHeight: 1.7 }}>
        The models a provider serves, and whether it answered. There is no router: an agent run
        uses one model, named in its capability manifest before the run starts, and nothing here
        chooses between them.
      </p>
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '16px', padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.14)', ...head }}>
          <span>MODEL</span><span>PROVIDER</span><span>WHERE</span><span>STATE</span><span>PROVIDER PROBE</span>
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
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#7A7A7A' }}>{m.lat}</span>
          </div>
        ))}
      </div>
      {/*
        The number was labelled LATENCY and sat in a per-model row while being
        one round trip to the provider's catalogue, identical for every model
        that provider serves. Six models all reading exactly 120 ms directly
        under the words NO FAKE VALUES is worse than showing nothing.
      */}
      <span style={{ ...note, lineHeight: 2 }}>
        THE PROBE IS ONE ROUND TRIP TO THE PROVIDER&rsquo;S CATALOGUE, SO IT IS THE SAME FOR EVERY MODEL THAT PROVIDER SERVES<br />
        NO PER-MODEL LATENCY HAS BEEN MEASURED, SO NONE IS SHOWN
      </span>
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
