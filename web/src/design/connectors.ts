/**
 * The connector catalogue, and what is actually true about each one today.
 *
 * The design ships this list with GitHub and Slack reading CONNECTED and
 * Notion reading SYNCING, next to a line that says STATES ARE HONEST. That
 * line is the specification: a state word has to be earned. Nothing under
 * src/ implements an OAuth connector to any of these services, so none of
 * them can claim a connection, and the honest reading of the design's own
 * vocabulary is PLANNED.
 *
 * Custom ingestion was marked AVAILABLE because the ingest pipeline genuinely
 * runs and puts real content into HydraDB. That is true of `npm run ingest` and
 * it was not true of this screen, which is a list of things a reader can
 * connect from the browser, and nothing on it connects. On a screen about
 * connectors, AVAILABLE reads as a promise about the button next to it. It is
 * PLANNED here and the pipeline is still real from the command line.
 *
 * The layout, the grouping, the coordinates, the icons and the dot treatment
 * are the design's, untouched. Only the state words moved to the truth. When
 * a connector is actually implemented, its state changes here and both the
 * landing catalogue and the app's connector list follow.
 */

/** The design's four state words plus the dot colour each one carries. */
export const DOT: Readonly<Record<string, string>> = {
  CONNECTED: '#15846E',
  SYNCING: '#FFB829',
  AVAILABLE: '#9A9A9A',
  PLANNED: '#5E5E5E',
};

export interface ConnectorItem {
  readonly n: string;
  readonly st: 'CONNECTED' | 'SYNCING' | 'AVAILABLE' | 'PLANNED';
}

export interface ConnectorGroup {
  readonly h: string;
  readonly gx: string;
  readonly gy: string;
  readonly items: readonly ConnectorItem[];
}

export const CONNECTOR_GROUPS: readonly ConnectorGroup[] = [
  { h: 'CODE', gx: '22%', gy: '40%', items: [{ n: 'GitHub', st: 'PLANNED' }, { n: 'GitLab', st: 'PLANNED' }, { n: 'Linear', st: 'PLANNED' }, { n: 'Jira', st: 'PLANNED' }] },
  { h: 'WORK', gx: '76%', gy: '38%', items: [{ n: 'Slack', st: 'PLANNED' }, { n: 'Notion', st: 'PLANNED' }, { n: 'Gmail', st: 'PLANNED' }, { n: 'Confluence', st: 'PLANNED' }] },
  { h: 'FILES', gx: '24%', gy: '74%', items: [{ n: 'PDF', st: 'PLANNED' }, { n: 'Markdown', st: 'PLANNED' }, { n: 'Text', st: 'PLANNED' }, { n: 'Documents', st: 'PLANNED' }] },
  { h: 'DATA', gx: '76%', gy: '74%', items: [{ n: 'API', st: 'PLANNED' }, { n: 'Webhook', st: 'PLANNED' }, { n: 'Database source', st: 'PLANNED' }, { n: 'Custom ingestion', st: 'PLANNED' }] },
];

export function dotFor(state: string): string {
  return DOT[state] ?? '#5E5E5E';
}
