import { useNavigate } from 'react-router-dom';
import { useSession } from '../api/session';
import { MONO, Mark } from '../design/mark';
import { landingAccountActions } from './account-actions';

/**
 * The footer, and two things it was getting wrong.
 *
 * Six of its fourteen links pointed at page anchors that stopped existing when
 * the landing was cut from twenty-seven scenes to eleven. A link to `#product`
 * on a page with no product section does nothing at all, silently, which is the
 * worst way for a link to fail. They point at the real screens now, which is
 * where somebody clicking "Ask" in a footer wanted to go anyway.
 *
 * And the canvas drew straight through it. The particle field shields itself
 * from text by measuring a list of selectors, and that list covers headings and
 * scene paragraphs but not a column of links, so the spiral ran over the words.
 * Two defences: the columns are marked `data-shield` so the field avoids them,
 * and the footer paints its own ground, because a shield depends on the field
 * being in a state where shielding applies and a background does not.
 */

const col = { display: 'flex', flexDirection: 'column', gap: '12px' } as const;
const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' } as const;
const link = {
  background: 'none', border: 'none', cursor: 'pointer', color: '#BDBDBD',
  fontSize: '14px', padding: 0, textAlign: 'left', fontFamily: 'inherit',
} as const;

export function Footer() {
  const go = useNavigate();
  const { loaded } = useSession();
  const account = landingAccountActions(loaded);

  const to = (path: string, label: string) => (
    <button key={label} className="hv-text" type="button" onClick={() => go(path)} style={link}>{label}</button>
  );

  return (
    <footer
      data-scene="off"
      style={{
        position: 'relative',
        // The field is fixed behind the page, so an opaque ground here is what
        // actually guarantees the words are readable. Not fully opaque: a
        // little of it still shows, which is the design, at a level that cannot
        // compete with 14px text.
        background: 'rgba(0,0,0,0.88)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderTop: '1px solid rgba(255,255,255,0.10)',
        padding: '60px clamp(20px, 4.4vw, 72px) 44px',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '44px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '44px', flexWrap: 'wrap' }}>
          <div data-shield style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '280px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Mark size={19} />
              <span style={{ fontSize: '14px', fontWeight: 500, color: '#FFFFFF' }}>Lacuna</span>
            </div>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em', color: '#7A7A7A' }}>THE AGENT CAN CHANGE. LACUNA STAYS.</span>
          </div>
          <div style={{ display: 'flex', gap: 'clamp(34px, 5vw, 80px)', flexWrap: 'wrap' }}>
            <div data-shield style={col}>
              <span style={head}>PRODUCT</span>
              {to('/explore/ask', 'Ask')}
              {to('/explore/memory', 'Memory')}
              {to('/explore/timeline', 'Timeline')}
              {to('/explore/agents', 'Agents')}
            </div>
            <div data-shield style={col}>
              <span style={head}>DEVELOPERS</span>
              {to('/explore/sdk', 'SDK · API')}
              {to('/explore/mcp', 'MCP')}
              {to('/explore/cli', 'CLI')}
              {to('/explore/conn', 'Connectors')}
            </div>
            <div data-shield style={col}>
              <span style={head}>PROOF</span>
              {to('/judge', 'Six questions, live')}
              {to('/explore/evals', 'Evaluations')}
              {to('/explore/hydra', 'HydraDB')}
              {to('/explore/health', 'Context health')}
            </div>
            <div data-shield style={col}>
              <span style={head}>ACCOUNT</span>
              {account.state === 'pending'
                ? <span role="status" style={{ color: '#7A7A7A', fontSize: '12px' }}>Checking session</span>
                : account.links.map((item) => to(item.path, item.label))}
            </div>
          </div>
        </div>
        <div data-shield style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#7A7A7A' }}>
          <span>BUILT ON HYDRADB</span>
          <span>© 2026 LACUNA</span>
        </div>
      </div>
    </footer>
  );
}
