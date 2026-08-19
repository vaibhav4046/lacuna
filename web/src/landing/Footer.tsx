import { useNavigate } from 'react-router-dom';
import { MONO, Mark } from '../design/mark';

const col = { display: 'flex', flexDirection: 'column', gap: '12px' } as const;
const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' } as const;
const item = { fontSize: '14px' } as const;
const account = { background: 'none', border: 'none', cursor: 'pointer', color: '#BDBDBD', fontSize: '14px', padding: 0, textAlign: 'left' } as const;

export function Footer() {
  const go = useNavigate();
  return (
    <footer data-scene="off" style={{ position: 'relative', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '60px clamp(20px, 4.4vw, 72px) 44px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '44px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '44px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '280px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Mark size={19} />
              <span style={{ fontSize: '14px', fontWeight: 500, color: '#FFFFFF' }}>Lacuna</span>
            </div>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em', color: '#7A7A7A' }}>THE AGENT CAN CHANGE. LACUNA STAYS.</span>
          </div>
          <div style={{ display: 'flex', gap: 'clamp(34px, 5vw, 80px)', flexWrap: 'wrap' }}>
            <div style={col}>
              <span style={head}>PRODUCT</span>
              <a href="#product" style={item}>Ask</a>
              <a href="#context-rot" style={item}>Memory</a>
              <a href="#how" style={item}>Agents</a>
              <a href="#voice-scene" style={item}>Voice</a>
            </div>
            <div style={col}>
              <span style={head}>DEVELOPERS</span>
              <a href="#dev" style={item}>SDK · API</a>
              <a href="#mcp" style={item}>MCP</a>
              <a href="#cli" style={item}>CLI</a>
              <a href="#conn" style={item}>Connectors</a>
            </div>
            <div style={col}>
              <span style={head}>RESOURCES</span>
              <a href="#how" style={item}>Architecture</a>
              <a href="#evals" style={item}>Evaluations</a>
              <a href="#hydra" style={item}>HydraDB</a>
              <a href="#faq" style={item}>FAQ</a>
            </div>
            <div style={col}>
              <span style={head}>ACCOUNT</span>
              <button className="hv-text" onClick={() => go('/signin')} style={account}>Sign in</button>
              <button className="hv-text" onClick={() => go('/signup')} style={account}>Create account</button>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#7A7A7A' }}>
          <span>BUILT ON HYDRADB</span>
          <span>© 2026 LACUNA</span>
        </div>
      </div>
    </footer>
  );
}
