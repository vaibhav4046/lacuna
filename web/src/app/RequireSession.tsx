import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from '../api/session';

/**
 * Nothing behind this renders without a session.
 *
 * While the check is in flight it renders a bounded status. A guard must not
 * render its children optimistically before the session is known, and a failed
 * check is not a signed-out check: it stays on a retryable error boundary
 * rather than bouncing someone who may still have a valid cookie.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { loaded, refresh } = useSession();

  if (loaded.state === 'loading') {
    return (
      <div role="status" style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '32px', boxSizing: 'border-box', color: '#7A7A7A', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', letterSpacing: '0.16em' }}>
        CHECKING SESSION…
      </div>
    );
  }
  if (loaded.state === 'failed') {
    return (
      <main role="alert" style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '32px', boxSizing: 'border-box', color: '#BDBDBD' }}>
        <div style={{ display: 'grid', gap: '14px', justifyItems: 'center', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '15px' }}>{loaded.reason}</p>
          <button type="button" onClick={() => { void refresh(); }} style={{ minHeight: '44px', padding: '10px 16px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.22)', background: 'transparent', color: '#FFFFFF', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (!loaded.value.signedIn) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}
