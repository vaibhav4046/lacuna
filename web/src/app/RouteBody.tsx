import type { RouteKey } from './routes';
import { Dashboard } from './routes/Dashboard';

/**
 * One route body per key.
 *
 * The keys come from the design's own TITLES map, so this switch is exhaustive
 * by construction: adding a route means adding a case, and TypeScript says so.
 * Bodies land here as each one is ported.
 */
export function RouteBody({ route }: { route: RouteKey }) {
  switch (route) {
    case 'dash': return <Dashboard />;
    default: return null;
  }
}
