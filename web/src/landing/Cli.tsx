import { MONO } from '../design/mark';

/**
 * The terminal here is a picture of the CLI, not a reading of it. The design
 * labels it CONCEPT PREVIEW directly underneath, which is what makes the state
 * words inside it legitimate: they are part of a drawn example, the same as
 * the box-drawing characters around them. Nothing in this block is presented
 * as the visitor's own system.
 *
 * The two rules are the design's own lengths, written as repeats so the count
 * is checkable instead of being 45 characters someone has to trust.
 */
const TOP_RULE = '─'.repeat(36);
const BOTTOM_RULE = '─'.repeat(45);

const dim = { color: '#5E5E5E' } as const;
const violet = { color: '#8052FF' } as const;

export function Cli() {
  return (
    <section id="cli" data-scene="off" style={{ position: 'relative', padding: '10vh 0 12vh' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 clamp(20px, 4.4vw, 72px)', display: 'flex', flexDirection: 'column', gap: '26px' }}>
        <div>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#9A9A9A' }}>CLI</span>
          <h2 style={{ fontSize: 'clamp(38px, 4.4vw, 74px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: '12px 0 0', color: '#FFFFFF' }}>Lacuna in your terminal.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.7, color: '#9A9A9A', margin: '14px 0 0', maxWidth: '44ch' }}>Use the same context without opening the dashboard.</p>
        </div>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#030303', marginTop: '34px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 clamp(20px, 4.4vw, 72px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#5E5E5E' }}>
            <span style={{ color: '#9A9A9A' }}>LACUNA TERMINAL</span>
            <span>ACME / BACKEND</span>
            <span>⇥ COMPLETE · ? HELP · ⌃C QUIT</span>
          </div>
          <pre style={{ margin: 0, padding: '36px 0 28px', fontFamily: MONO, fontSize: '13.5px', lineHeight: 1.9, color: '#BDBDBD', whiteSpace: 'pre-wrap' }}>
            {'  '}<span style={{ color: '#FFB829' }}>·</span>{'  '}<span style={{ color: '#FFFFFF' }}>L A C U N A</span>{'  '}<span style={dim}>v0.1</span>
            {'\n  '}<span style={dim}>context for long-running agents</span><span style={dim}>{'\n\n  ┌ session ' + TOP_RULE + '┐'}</span>
            {'\n  '}<span style={dim}>│</span>{' workspace  acme         hydradb  '}<span style={{ color: '#15846E' }}>● connected</span>
            {'\n  '}<span style={dim}>│</span>{' project    backend      context  ready'}
            {'\n  '}<span style={dim}>│</span>{' model      qwen2.5 · ollama · '}<span style={{ color: '#FFFFFF' }}>local</span>
            {'\n  '}<span style={dim}>{'└' + BOTTOM_RULE + '┘'}</span><span style={violet}>{'\n\n❯'}</span>
            {' ask "where does session state live now?"'}<span style={violet}>{'\n\n  ▌'}</span>
            {' '}<span style={{ color: '#FFFFFF' }}>POSTGRES</span>
            {'\n  '}<span style={violet}>▌</span>{' current since 5 mar · 2 sources · history kept'}
            {'\n    '}<span style={dim}>evidence: pr #184 · runbook   trace 0x4e1a</span><span style={violet}>{'\n\n❯'}</span>
            {' '}<span style={{ color: '#8052FF', animation: 'lpulse 1.1s steps(2) infinite' }}>█</span>
          </pre>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap', padding: '10px 12px', marginBottom: '28px', background: 'rgba(255,255,255,0.04)', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em' }}>
            <span style={{ color: '#15846E' }}>● READY</span>
            <span style={{ color: '#9A9A9A' }}>MODEL QWEN2.5 · LOCAL</span>
            <span style={{ color: '#9A9A9A' }}>HYDRADB CONNECTED</span>
            <span style={dim}>CONTEXT 6 ITEMS · 1 PACK</span>
            <span style={dim}>⌘K COMMANDS</span>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: '1100px', margin: '22px auto 0', padding: '0 clamp(20px, 4.4vw, 72px)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.12em', color: '#71717A' }}>lacuna ask · remember · context · timeline · evidence · run · agent · models · tools · mcp · trace · eval · doctor</span>
        <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#5E5E5E' }}>CONCEPT PREVIEW · COMMAND SET FINALISED IN IMPLEMENTATION</span>
      </div>
    </section>
  );
}
