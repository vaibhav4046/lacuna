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
 * Two of them are AVAILABLE, and they earned it after this comment was first
 * written. Text and Custom ingestion were PLANNED on the correct reasoning that
 * the pipeline only ran from the command line, and that a state word on a
 * connector screen is a promise about the button beside it. That is no longer
 * where things stand: a signed-in reader pastes a transcript and it goes
 * through the same extractor, planner and HydraDB write the benchmarks use, and
 * anybody at all can run the extractor on their own text with no account.
 * Leaving them PLANNED understated something that works, which is the same
 * failure as overstating one, pointed the other way.
 *
 * AVAILABLE rather than CONNECTED: nothing is syncing from an external service.
 * The reader supplies the text.
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
  PLANNED: '#7A7A7A',
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
  { h: 'FILES', gx: '24%', gy: '74%', items: [{ n: 'PDF', st: 'PLANNED' }, { n: 'Markdown', st: 'PLANNED' }, { n: 'Text', st: 'AVAILABLE' }, { n: 'Documents', st: 'PLANNED' }] },
  { h: 'DATA', gx: '76%', gy: '74%', items: [{ n: 'API', st: 'PLANNED' }, { n: 'Webhook', st: 'PLANNED' }, { n: 'Database source', st: 'PLANNED' }, { n: 'Custom ingestion', st: 'AVAILABLE' }] },
];

export function dotFor(state: string): string {
  return DOT[state] ?? '#7A7A7A';
}
