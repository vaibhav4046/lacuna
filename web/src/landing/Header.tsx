import { useNavigate } from 'react-router-dom';
import { MONO, Mark } from '../design/mark';

const link = { fontFamily: MONO, fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9A9A9A' } as const;

/** The same five links, at a size a thumb can hit, inside the sheet. */
const sheetLink = { ...link, fontSize: '12px', padding: '15px 4px', display: 'block' } as const;

const textButton = { background: 'none', border: 'none', cursor: 'pointer', color: '#BDBDBD', fontSize: '14px', padding: '9px 14px' } as const;

/**
 * The header, and the one place the navigation differs between a desktop and a
 * phone.
 *
 * Below 940px the five section links do not fit beside three buttons, so they
 * move into a sheet behind a Menu control rather than being hidden, which is
 * what they used to be: `display:none` and no way to reach Product, How it
 * works, Developers, Benchmarks or FAQ from a phone at all.
 *
 * The sheet is a `<details>` element. It opens on tap and closes on tap, it is
 * reachable by keyboard and announced as a disclosure without a single line of
 * script, and it cannot get stuck open in a state React and the DOM disagree
 * about. Sign in and the proof board join it there so that one filled action,
 * Get started, is the only button left competing at that width.
 */
export function Header() {
  const go = useNavigate();
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', padding: '16px clamp(20px, 3.4vw, 44px)', background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(255,255,255,0.06)', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', pointerEvents: 'auto' }}>
        <Mark size={21} />
        <span style={{ fontSize: '15px', fontWeight: 500, letterSpacing: '0.01em', color: '#FFFFFF' }}>Lacuna</span>
      </div>
      <div data-navlinks="1" style={{ display: 'flex', alignItems: 'center', gap: 'clamp(18px, 2.3vw, 32px)', pointerEvents: 'auto' }}>
        <a href="#try" style={link}>Ask it</a>
        <a href="#how" style={link}>How it works</a>
        <a href="#mcp" style={link}>Developers</a>
        <a href="#evals" style={link}>Benchmarks</a>
        <a href="#hydra" style={link}>HydraDB</a>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'auto' }}>
        <button data-navwide="1" className="hv-text" onClick={() => go('/judge')} style={textButton}>See it answer</button>
        <button data-navwide="1" className="hv-text" onClick={() => go('/signin')} style={textButton}>Sign in</button>
        <button className="hv-violet" onClick={() => go('/signup')} style={{ background: '#8052FF', border: 'none', cursor: 'pointer', color: '#FFFFFF', fontSize: '14px', fontWeight: 500, padding: '9px 18px', borderRadius: '8px' }}>Get started</button>
        <details data-navmenu="1" style={{ position: 'relative' }}>
          <summary aria-label="Menu" style={{ listStyle: 'none', cursor: 'pointer', color: '#BDBDBD', fontFamily: MONO, fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '15px 10px' }}>Menu</summary>
          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: '186px', display: 'flex', flexDirection: 'column', padding: '10px 16px 14px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px' }}>
            <a href="#try" style={sheetLink}>Ask it</a>
            <a href="#how" style={sheetLink}>How it works</a>
            <a href="#mcp" style={sheetLink}>Developers</a>
            <a href="#evals" style={sheetLink}>Benchmarks</a>
            <a href="#hydra" style={sheetLink}>HydraDB</a>
            <span style={{ height: '1px', background: 'rgba(255,255,255,0.12)', margin: '8px 0' }} />
            <button className="hv-text" onClick={() => go('/judge')} style={{ ...textButton, textAlign: 'left', padding: '13px 4px' }}>See it answer</button>
            <button className="hv-text" onClick={() => go('/signin')} style={{ ...textButton, textAlign: 'left', padding: '13px 4px' }}>Sign in</button>
          </div>
        </details>
      </div>
    </div>
  );
}
