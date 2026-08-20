import { Navigate, useParams } from 'react-router-dom';

/**
 * Keeps every /demo link working after the public workspace moved to /explore.
 *
 * The old prefix is written into documents, a social card and a video frame,
 * and a link somebody else published is not ours to break. This forwards the
 * route it was given rather than dropping everyone on the front page, which is
 * what a catch-all redirect would do.
 */
export function LegacyDemo() {
  const { route } = useParams<{ route: string }>();
  return <Navigate to={`/explore/${route ?? 'dash'}`} replace />;
}
