import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from '../api/session';

/**
 * Nothing behind this renders without a session.
 *
 * While the check is in flight it renders nothing at all. The page is black
 * either way, so there is no flash, and more to the point a guard that renders
 * its children optimistically has already shown them by the time it decides
 * not to. A failed check is not a signed out check: if the server did not
 * answer, this holds rather than bouncing someone who has a valid cookie.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { loaded } = useSession();

  if (loaded.state === 'loading') return null;
  if (loaded.state === 'failed') return null;
  if (!loaded.value.signedIn) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}
