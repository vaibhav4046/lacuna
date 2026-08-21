import type { ConnectorId } from '../api/connectors';

/** Presentation only. Runtime availability and observations always come from the private catalogue. */
export interface ConnectorPresentation {
  readonly key: string;
  readonly name: string;
  readonly group: 'CODE' | 'FILES' | 'DATA' | 'WORK';
  readonly workflow: 'github' | 'file' | 'https' | 'webhook' | 'planned';
  readonly serverIds: readonly ConnectorId[];
  readonly implementation: 'implemented' | 'planned';
  readonly summary: string;
}

export const CONNECTOR_PRESENTATION: readonly ConnectorPresentation[] = Object.freeze([
  { key: 'github', name: 'GitHub', group: 'CODE', workflow: 'github', serverIds: ['github'], implementation: 'implemented', summary: 'Bounded public repository snapshot.' },
  { key: 'markdown', name: 'Markdown', group: 'FILES', workflow: 'file', serverIds: ['markdown'], implementation: 'implemented', summary: 'Reviewed local Markdown file.' },
  { key: 'text', name: 'Text', group: 'FILES', workflow: 'file', serverIds: ['text'], implementation: 'implemented', summary: 'Reviewed local text file.' },
  { key: 'pdf', name: 'PDF', group: 'FILES', workflow: 'file', serverIds: ['pdf'], implementation: 'implemented', summary: 'Reviewed local PDF file.' },
  { key: 'docx', name: 'DOCX', group: 'FILES', workflow: 'file', serverIds: ['docx'], implementation: 'implemented', summary: 'Reviewed local DOCX file.' },
  { key: 'https-api', name: 'HTTPS API', group: 'DATA', workflow: 'https', serverIds: ['https_api'], implementation: 'implemented', summary: 'One bounded public HTTPS JSON or text read.' },
  { key: 'webhook', name: 'Webhook', group: 'DATA', workflow: 'webhook', serverIds: ['webhook'], implementation: 'implemented', summary: 'Signed at-least-once event delivery.' },
  { key: 'gitlab', name: 'GitLab', group: 'CODE', workflow: 'planned', serverIds: [], implementation: 'planned', summary: 'Planned.' },
  { key: 'linear', name: 'Linear', group: 'WORK', workflow: 'planned', serverIds: [], implementation: 'planned', summary: 'Planned.' },
  { key: 'jira', name: 'Jira', group: 'WORK', workflow: 'planned', serverIds: [], implementation: 'planned', summary: 'Planned.' },
  { key: 'slack', name: 'Slack', group: 'WORK', workflow: 'planned', serverIds: [], implementation: 'planned', summary: 'Planned.' },
  { key: 'notion', name: 'Notion', group: 'WORK', workflow: 'planned', serverIds: [], implementation: 'planned', summary: 'Planned.' },
  { key: 'gmail', name: 'Gmail', group: 'WORK', workflow: 'planned', serverIds: [], implementation: 'planned', summary: 'Planned.' },
  { key: 'confluence', name: 'Confluence', group: 'WORK', workflow: 'planned', serverIds: [], implementation: 'planned', summary: 'Planned.' },
  { key: 'database', name: 'Database source', group: 'DATA', workflow: 'planned', serverIds: [], implementation: 'planned', summary: 'Planned.' },
]);

export const DOT: Readonly<Record<string, string>> = Object.freeze({
  connected: '#15846E', available: '#8052FF', unavailable: '#FFB829',
  failed: '#FFB829', idle: '#9A9A9A', syncing: '#FFB829', planned: '#7A7A7A',
  CONNECTED: '#15846E', AVAILABLE: '#8052FF', PLANNED: '#7A7A7A',
});

/** Legacy presentation grouping retained for copy contracts; it contains no runtime state. */
export const CONNECTOR_GROUPS = (['CODE', 'WORK', 'FILES', 'DATA'] as const).map((group) => ({
  h: group,
  items: CONNECTOR_PRESENTATION.filter((item) => item.group === group).map((item) => ({
    n: item.name,
    st: item.implementation === 'planned' ? 'PLANNED' as const : 'IMPLEMENTED' as const,
  })),
}));

export function dotFor(state: string): string {
  return DOT[state] ?? '#7A7A7A';
}
