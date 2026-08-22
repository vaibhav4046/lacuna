import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { hydraState, useHealth, useModelLabel } from '../api/health';
import { useSession } from '../api/session';
import { useScope } from '../api/scope';
import { icStyle } from '../design/icons';
import { MONO, Mark } from '../design/mark';
import { VoiceAssistantProvider } from '../voice/assistant-context';
import { DEFAULT_ROUTE, NAV_GROUPS, isRouteKey, routeTitle } from './routes';
import { RouteBody } from './RouteBody';
import { VoiceDock } from './VoiceDock';

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

const groupHead = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.24em', color: '#858585', padding: '0 10px 5px' } as const;
const navLabel = { fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.18em' } as const;
const footLabel = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.22em', color: '#7A7A7A' } as const;

/** The one workspace whose numbers are the design's sample values. */
export const SAMPLE_WORKSPACE = 'acme / backend';

export default function Shell() {
  const go = useNavigate();
  const params = useParams();
  const { loaded, identity } = useSession();
  const scope = useScope();
  const health = useHealth();
  const model = useModelLabel();

  const route = params['route'];
  if (!isRouteKey(route)) return <Navigate to={`${scope.prefix}/${DEFAULT_ROUTE}`} replace />;

  const account = loaded.state === 'ready' && loaded.value.signedIn ? loaded.value.session : null;
  // The demo names its workspace because that is the one it reads. It has no
  // account, and drawing an empty address row would look like a session that
  // failed to load rather than one that was never asked for.
  const workspace = scope.demo ? SAMPLE_WORKSPACE : account?.workspace ?? null;
  const email = scope.demo ? null : account?.email ?? null;
  const initial = email === null ? '' : (email[0] ?? '').toUpperCase();

  return (
    <VoiceAssistantProvider
      base={scope.base}
      currentRoute={`${scope.prefix}/${route}`}
      scope={scope.demo ? 'public' : 'private'}
      sessionKey={account?.binding ?? null}
      workspaceKey={workspace}
    >
      <div data-shellroot="1" style={{ position: 'relative', zIndex: 1, display: 'flex', minHeight: '100vh', background: '#000000' }}>
      <aside data-shellnav="1" data-voice-background="1" style={{ width: '216px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', padding: '20px 14px', boxSizing: 'border-box', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
        <button className="shell-brand" onClick={() => go('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '9px', padding: '6px 10px', textAlign: 'left' }}>
          <Mark size={17} />
          <span style={{ fontSize: '13.5px', fontWeight: 500, color: '#FFFFFF' }}>Lacuna</span>
        </button>
        <nav data-shelllinks="1" aria-label="Workspace" style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '24px' }}>
          {NAV_GROUPS.map((g) => (
            <div data-shellgroup="1" key={g.h} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <span data-shellhead="1" style={groupHead}>{g.h}</span>
              {g.items.map(([text, key]) => (
                <button
                  key={key}
                  className="hv-surface4"
                  onClick={() => go(`${scope.prefix}/${key}`)}
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
        <div data-shellfoot="1" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '14px 10px 0', display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <span style={footLabel}>WORKSPACE</span>
          <span style={{ fontSize: '13px', color: '#FFFFFF' }}>{workspace ?? '—'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '2px' }}>
            <span style={icStyle('HydraDB', 13)}></span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#9A9A9A' }}>HYDRADB {hydraState(health)}</span>
          </div>
          {workspace === SAMPLE_WORKSPACE ? (
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#7A7A7A' }}>PUBLIC WORKSPACE</span>
          ) : null}
          {scope.demo ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '8px' }}>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#8052FF' }}>READ ONLY · NO ACCOUNT</span>
              <button onClick={() => go('/signin')} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#7A7A7A' }}>SIGN IN</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginTop: '8px' }}>
              <span style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#BDBDBD' }}>{initial}</span>
              <span style={{ fontSize: '12px', color: '#BDBDBD' }}>{email ?? '—'}</span>
            </div>
          )}
        </div>
      </aside>
      <main data-shellmain="1" data-voice-background="1" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div data-shelltop="1" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px', padding: '15px 28px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#BDBDBD' }}>{routeTitle(route, workspace)}</span>
          {/* A keyboard hint and a status label. On a phone this pair was wider
              than the space left beside the title, and it pushed every one of
              the eighteen routes sideways by 71px before the route had drawn
              anything of its own. Neither is reachable by touch anyway. */}
          <div data-mhide="1" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: '5px', padding: '4px 9px', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.12em', color: '#9A9A9A' }}>⌘ K</span>
            <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.14em', color: '#7A7A7A' }}>MODEL · {model}</span>
          </div>
        </div>
        {/* A route wider than the frame scrolls inside the frame. Without this
            a single wide table takes the whole document sideways with it, and
            the reader loses the navigation as well as the table. */}
        <div data-shellcontent="1" style={{ flex: 1, minWidth: 0, overflowX: 'auto', padding: '40px 32px 84px' }}>
          <RouteBody key={scope.demo ? 'explore' : identity ?? 'unvalidated'} route={route} />
        </div>
      </main>
        <VoiceDock />
      </div>
    </VoiceAssistantProvider>
  );
}
