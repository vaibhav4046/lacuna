import { MONO } from '../design/mark';
import { CLI_SESSION } from './cli-session';

/**
 * The terminal on this page is a recording, not a drawing.
 *
 * It used to be a drawing: a workspace called acme, a model called qwen2.5, a
 * green CONNECTED dot, a trace id someone typed, a context pack count, and a
 * list of thirteen commands of which six existed. A CONCEPT PREVIEW label sat
 * underneath it, which was honest about the block being an illustration and did
 * nothing about the strings inside it being invented.
 *
 * `scripts/capture-cli.ts` now runs the CLI for real against HydraDB Cloud and
 * saves every byte to `artifacts/cli/session.txt` and to `cli-session.ts` beside
 * this file. What follows renders that text. The store, the timings, the query
 * count, the evidence quote and the abstention are the ones the run produced, so
 * the only way to change what this section says is to change what the CLI does.
 *
 * The colouring is applied here rather than recorded because the recording
 * strips the escape sequences. It keys off the shape of a line and never off a
 * particular answer, so a re-recording that returns something else still renders.
 */

const dim = { color: '#7A7A7A' } as const;
const violet = { color: '#8052FF' } as const;
const amber = { color: '#FFB829' } as const;
const white = { color: '#FFFFFF' } as const;

/** The three commands the recording ran, for the caption under the block. */
const RECORDED = 'status · ask · explain';

function Line({ text }: { text: string }) {
  if (text.startsWith('$ ')) {
    return (
      <>
        <span style={violet}>$</span>
        <span style={white}>{text.slice(1)}</span>
        {'\n'}
      </>
    );
  }

  // The mark prints as dots with one amber head. The head is the first
  // non-space character of the row it appears on, and only on that row.
  if (text.includes('●')) {
    const at = text.indexOf('●');
    return (
      <>
        {text.slice(0, at)}
        <span style={amber}>●</span>
        <span style={dim}>{text.slice(at + 1)}</span>
        {'\n'}
      </>
    );
  }

  if (/^[·\s]+$/.test(text) && text.trim() !== '') {
    return (
      <>
        <span style={dim}>{text}</span>
        {'\n'}
      </>
    );
  }

  if (text.startsWith('A  ')) {
    return (
      <>
        <span style={dim}>A</span>
        <span style={white}>{text.slice(1)}</span>
        {'\n'}
      </>
    );
  }

  if (text.startsWith('Q  ')) {
    return (
      <>
        <span style={dim}>Q</span>
        {text.slice(1)}
        {'\n'}
      </>
    );
  }

  return (
    <>
      {text}
      {'\n'}
    </>
  );
}

export function Cli() {
  const lines = CLI_SESSION.split('\n');
  return (
    <section id="cli" data-scene="off" style={{ position: 'relative', padding: '10vh 0 12vh' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 clamp(20px, 4.4vw, 72px)', display: 'flex', flexDirection: 'column', gap: '26px' }}>
        <div>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#9A9A9A' }}>CLI</span>
          <h2 style={{ fontSize: 'clamp(38px, 4.4vw, 74px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: '12px 0 0', color: '#FFFFFF' }}>Lacuna in your terminal.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.7, color: '#9A9A9A', margin: '14px 0 0', maxWidth: '46ch' }}>The same context without opening the dashboard. This is a recording of a real run, not a mock up.</p>
        </div>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#030303', marginTop: '34px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 clamp(20px, 4.4vw, 72px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' }}>
            <span style={{ color: '#9A9A9A' }}>LACUNA TERMINAL</span>
            <span>RECORDED RUN</span>
            <span>HYDRADB CLOUD</span>
          </div>
          {/* 80 columns of monospace does not fit a phone. It scrolls inside
              this box rather than widening the page, which is the difference
              between a readable transcript and a horizontal scrollbar on the
              whole document. */}
          <pre style={{ margin: 0, padding: '30px 0 26px', fontFamily: MONO, fontSize: '13px', lineHeight: 1.75, color: '#BDBDBD', whiteSpace: 'pre', overflowX: 'auto', maxWidth: '100%' }}>
            {lines.map((text, index) => (
              <Line key={index} text={text} />
            ))}
          </pre>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap', padding: '10px 12px', marginBottom: '28px', background: 'rgba(255,255,255,0.04)', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em' }}>
            <span style={{ color: '#9A9A9A' }}>RECORDED {RECORDED}</span>
            <span style={dim}>ARTIFACTS/CLI/SESSION.TXT</span>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: '1100px', margin: '22px auto 0', padding: '0 clamp(20px, 4.4vw, 72px)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.12em', color: '#7A7A84' }}>lacuna doctor · status · ask · explain · timeline · bench</span>
        <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#7A7A7A' }}>EVERY COMMAND ABOVE EXISTS · LACUNA --HELP LISTS THE SAME SIX</span>
      </div>
    </section>
  );
}
