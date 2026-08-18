import { MONO } from '../design/mark';
import { icStyle } from '../design/icons';

const model = { position: 'absolute', top: '74%', transform: 'translate(-50%,-50%)', display: 'flex', alignItems: 'center', gap: '7px', fontFamily: MONO, fontSize: '11.5px', letterSpacing: '0.18em', color: '#71717A', transition: 'color 500ms ease' } as const;

export function Route() {
  return (
    <section data-scene="route" style={{ position: 'relative', height: '190vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 'max(11%, 96px)', left: 0, right: 0, textAlign: 'center', padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(38px, 4.4vw, 74px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Change the model.<br />Keep the memory.</h2>
          <p style={{ fontSize: '16.5px', color: '#9A9A9A', margin: '16px auto 0', maxWidth: '50ch' }}>Better context makes every model more useful. The Context Pack stays the same when the worker changes.</p>
        </div>
        <div data-model="0" data-mhide="1" style={{ ...model, left: '26%' }}><span style={icStyle('cloud', 12)}></span>CLOUD</div>
        <div data-model="1" data-mhide="1" style={{ ...model, left: '42%' }}><span style={icStyle('chip', 12)}></span>OLLAMA · LOCAL</div>
        <div data-model="2" data-mhide="1" style={{ ...model, left: '58%' }}><span style={icStyle('chip', 12)}></span>VLLM · LOCAL</div>
        <div data-model="3" data-mhide="1" style={{ ...model, left: '74%' }}><span style={icStyle('API', 12)}></span>CUSTOM</div>
        <div style={{ position: 'absolute', bottom: '8%', left: 0, right: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em', color: '#5E5E5E' }}>AUTO · LOCAL FIRST · QUALITY FIRST · PRIVACY FIRST · COST FIRST · LATENCY FIRST · CUSTOM</span>
          <span style={{ fontSize: '15px', color: '#BDBDBD' }}>Run the worker where you want.</span>
        </div>
      </div>
    </section>
  );
}
