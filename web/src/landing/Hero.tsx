import { useNavigate } from 'react-router-dom';

import { useSession } from '../api/session';
import { MONO } from '../design/mark';
import { landingWorkspacePath } from './account-actions';

/**
 * The field is the hero. No frame, no duplicate logo and no decorative card:
 * the persistent canvas draws the Lacuna mark, opens it and carries the same
 * particles into every scene that follows.
 */
export function Hero() {
  const go = useNavigate();
  const { loaded } = useSession();
  const workspacePath = landingWorkspacePath(loaded);

  return (
    <section id="top" data-scene="hero" style={{ position: 'relative', height: '160vh' }}>
      <div
        className="hero-v10-stage"
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          padding: '84px clamp(20px, 4.4vw, 72px) 0',
          boxSizing: 'border-box',
        }}
      >
        <div className="hero-v10-copy" data-shield style={{ maxWidth: '820px', display: 'flex', flexDirection: 'column', gap: 'clamp(14px, 1.8vh, 24px)' }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '0.26em',
              textTransform: 'uppercase',
              color: '#9A9A9A',
              animation: 'heroIn 0.42s ease 0.03s both',
            }}
          >
            Context for long-running agents
          </span>
          <h1
            className="hero-v10-title"
            style={{
              fontSize: 'clamp(48px, min(4.8vw, 9.8vh), 96px)',
              fontWeight: 400,
              lineHeight: 0.98,
              letterSpacing: '-0.045em',
              margin: 0,
              color: '#FFFFFF',
              animation: 'heroIn 0.45s ease 0.1s both',
            }}
          >
            Memory that knows<br />what changed.
          </h1>
          <p
            className="hero-v10-summary"
            style={{
              fontSize: 'clamp(16px, 1.05vw, 18px)',
              fontWeight: 400,
              lineHeight: 1.7,
              color: '#9A9A9A',
              margin: '4px 0 0',
              maxWidth: '51ch',
              textWrap: 'pretty',
              animation: 'heroIn 0.45s ease 0.3s both',
            }}
          >
            Lacuna gives every AI tool the same shared memory. It remembers what changed, shows where each answer came from, flags disagreements, and says when it does not have enough information.
          </p>
          <div
            className="hero-v10-actions"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '26px',
              marginTop: '8px',
              flexWrap: 'wrap',
              animation: 'heroIn 0.45s ease 0.44s both',
            }}
          >
            <button
              className="hv-violet"
              onClick={() => go(workspacePath)}
              style={{ background: '#8052FF', border: 'none', cursor: 'pointer', color: '#FFFFFF', fontSize: '15px', fontWeight: 500, padding: '13px 24px', borderRadius: '8px', whiteSpace: 'nowrap' }}
            >
              Open live workspace
            </button>
            <a href="#how" style={{ fontSize: '15px', color: '#BDBDBD', borderBottom: '1px solid rgba(255,255,255,0.28)', paddingBottom: '3px', whiteSpace: 'nowrap' }}>
              See how it works
            </a>
            <button
              className="hv-text"
              onClick={() => go('/judge')}
              style={{ background: 'none', border: 0, borderBottom: '1px solid rgba(255,255,255,0.18)', cursor: 'pointer', color: '#9A9A9A', fontSize: '14px', padding: '0 0 3px' }}
            >
              Judge proof
            </button>
          </div>
          <span
            style={{
              fontFamily: MONO,
              fontSize: '10px',
              fontWeight: 400,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: '#8A8A8A',
              marginTop: '14px',
              animation: 'heroIn 0.45s ease 0.56s both',
            }}
          >
            Built on HydraDB · evidence stays attached
          </span>
        </div>
      </div>
    </section>
  );
}
