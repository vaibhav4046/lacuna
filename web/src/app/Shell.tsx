import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { hydraState, modelState, useHealth } from '../api/health';
import { useSession } from '../api/session';
import { icStyle } from '../design/icons';
import { MONO, Mark } from '../design/mark';
import { DEFAULT_ROUTE, NAV_GROUPS, isRouteKey, routeTitle } from './routes';
import { RouteBody } from './RouteBody';

/**
 * The signed-in frame: a sidebar of seven groups, a header, and the route.
 *
 * Three strings on this screen are the design's and three are not. The layout,
 * the typography and the vocabulary are exactly as drawn. What changed is where
 * the words come from: HYDRADB and the model chip read a live check, and the
 * workspace, the address and the avatar letter come from the session. The
 * design draws HYDRADB CONNECTED and MODEL · QWEN2.5 · LOCAL as fixed text,
 * which is the one thing the design's own rules forbid it to be.
 *
 * The active and idle nav rows are two branches rather than a ternary because
 * that is how the design writes them, and because the idle branch renders a
 * three pixel spacer with no background so the label's left edge never moves
 * when the selection does.
 */

const groupHead = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.24em', color: '#4A4A4A', padding: '0 10px 5px' } as const;
const navLabel = { fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.18em' } as const;
const footLabel = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.22em', color: '#5E5E5E' } as const;

/** The one workspace whose numbers are the design's sample values. */
export const SAMPLE_WORKSPACE = 'acme / backend';

export default function Shell() {
  const go = useNavigate();
  const params = useParams();
  const { loaded } = useSession();
  const health = useHealth();

  const route = params['route'];
  if (!isRouteKey(route)) return <Navigate to={`/app/${DEFAULT_ROUTE}`} replace />;

  const account = loaded.state === 'ready' && loaded.value.signedIn ? loaded.value.session : null;
  const workspace = account?.workspace ?? null;
  const email = account?.email ?? null;
  const initial = email === null ? '' : (email[0] ?? '').toUpperCase();

  return (
    <div style={{ position: 'relative', zIndex: 1, display: 'flex', minHeight: '100vh', background: '#000000' }}>
      <aside style={{ width: '216px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', padding: '20px 14px', boxSizing: 'border-box', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
        <button onClick={() => go('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '9px', padding: '6px 10px', textAlign: 'left' }}>
          <Mark size={17} />
          <span style={{ fontSize: '13.5px', fontWeight: 500, color: '#FFFFFF' }}>Lacuna</span>
        </button>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '24px' }}>
          {NAV_GROUPS.map((g) => (
            <div key={g.h} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <span style={groupHead}>{g.h}</span>
              {g.items.map(([text, key]) => (
                <button
                  key={key}
                  className="hv-surface4"
                  onClick={() => go(`/app/${key}`)}
                  aria-current={route === key ? 'page' : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: '7px 10px', borderRadius: '6px', cursor: 'pointer', textAlign: 'left' }}
                >
                  {route === key ? (
                    <>
                      <span style={{ width: '3px', height: '11px', background: '#8052FF', borderRadius: '1px', flexShrink: 0 }}></span>
                      <span style={{ ...navLabel, fontWeight: 500, color: '#FFFFFF' }}>{text}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ width: '3px', height: '11px', flexShrink: 0 }}></span>
                      <span style={{ ...navLabel, fontWeight: 400, color: '#9A9A9A' }}>{text}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ flex: 1, minHeight: '20px' }}></div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '14px 10px 0', display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <span style={footLabel}>WORKSPACE</span>
          <span style={{ fontSize: '13px', color: '#FFFFFF' }}>{workspace ?? '—'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '2px' }}>
            <span style={icStyle('HydraDB', 13)}></span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#9A9A9A' }}>HYDRADB {hydraState(health)}</span>
          </div>
          {workspace === SAMPLE_WORKSPACE ? (
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#5E5E5E' }}>SAMPLE WORKSPACE</span>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginTop: '8px' }}>
            <span style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#BDBDBD' }}>{initial}</span>
            <span style={{ fontSize: '12px', color: '#BDBDBD' }}>{email ?? '—'}</span>
          </div>
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px', padding: '15px 28px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#BDBDBD' }}>{routeTitle(route, workspace)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: '5px', padding: '4px 9px', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.12em', color: '#9A9A9A' }}>⌘ K</span>
            <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.14em', color: '#5E5E5E' }}>MODEL · {modelState()}</span>
          </div>
        </div>
        <div style={{ flex: 1, padding: '40px 32px 84px' }}>
          <RouteBody route={route} />
        </div>
      </main>
    </div>
  );
}
