/**
 * Every route the app can render. The sidebar is a subset: a route that opens
 * onto nothing is still reachable by URL and is not offered in the navigation.
 *
 * The design renders one shell and switches an sc-if per route, so the port
 * uses one /app/:route param route rather than eighteen siblings: the shell
 * stays mounted across a route change, exactly as it does in the oracle, and
 * an unknown key can be turned away by isRouteKey instead of by a router
 * fallthrough that would unmount everything.
 */

export const TITLES = { dash: 'Dashboard', ask: 'Ask', memory: 'Memory', timeline: 'Timeline', graph: 'Graph', health: 'Context health', work: 'Work', agents: 'Agents', tools: 'Tools', models: 'Models', voice: 'Voice', mcp: 'MCP', sdk: 'SDK · API', cli: 'CLI', conn: 'Connectors', evals: 'Evaluations', hydra: 'HydraDB', settings: 'Settings' } as const;

export type RouteKey = keyof typeof TITLES;

/** Guard for the :route param. Anything else is not a route. */
export function isRouteKey(value: string | undefined): value is RouteKey {
  return value !== undefined && Object.prototype.hasOwnProperty.call(TITLES, value);
}

export const DEFAULT_ROUTE: RouteKey = 'dash';

/**
 * The sidebar, which lists what this product does rather than what it might.
 *
 * Work, Agents and Tools were here and their endpoints return an empty array,
 * because nothing schedules a run, registers an agent or exposes a tool yet.
 * Voice was here and is not configured. Four screens that open onto nothing
 * make a working product look half built, and a reader has no way to tell an
 * empty screen from a broken one.
 *
 * The routes still resolve, so an existing link or a bookmark still lands
 * somewhere rather than on a 404. They are simply not offered, which is what
 * shipping means.
 */
export const NAV_GROUPS = [
  { h: 'OVERVIEW', items: [['DASHBOARD', 'dash'], ['ASK', 'ask']] },
  { h: 'CONTEXT', items: [['MEMORY', 'memory'], ['TIMELINE', 'timeline'], ['GRAPH', 'graph'], ['HEALTH', 'health']] },
  { h: 'MODELS', items: [['MODELS', 'models']] },
  { h: 'DEVELOPERS', items: [['MCP', 'mcp'], ['SDK · API', 'sdk'], ['CLI', 'cli'], ['CONNECTORS', 'conn']] },
  { h: 'PROOF', items: [['EVALUATIONS', 'evals'], ['HYDRADB', 'hydra']] },
  { h: 'SYSTEM', items: [['SETTINGS', 'settings']] }
] as const satisfies readonly { readonly h: string; readonly items: readonly (readonly [string, RouteKey])[] }[];

/**
 * The design writes routeTitle as the title plus ' · acme / backend'. The
 * workspace half is API-fed here, so before it arrives the title stands alone
 * rather than asserting a workspace nobody has loaded.
 */
export function routeTitle(route: RouteKey, workspace: string | null): string {
  const title = TITLES[route];
  return workspace === null ? title : title + ' · ' + workspace;
}
