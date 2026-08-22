/** Browser-side closed voice operation contract.
 *
 * This is intentionally a small protocol mirror rather than an import from
 * the server tree. The browser validates the same bounded wire shape before
 * an executor sends it back over HTTP, while the server remains authoritative.
 */
export const VOICE_OPERATION_VERSION = 1 as const;
export const VOICE_ROUTES = [
  'dash', 'ask', 'memory', 'timeline', 'graph', 'health', 'work', 'agents', 'tools',
  'voice', 'models', 'mcp', 'sdk', 'cli', 'conn', 'evals', 'hydra', 'settings',
] as const;
export type VoiceRoute = (typeof VOICE_ROUTES)[number];

const VOICE_SUMMARY_KINDS = [
  'summary', 'memory', 'changes', 'conflicts', 'health', 'graph', 'runs', 'agents',
  'tools', 'schedules', 'models', 'evaluations', 'connectors',
] as const;
type VoiceSummaryKind = (typeof VOICE_SUMMARY_KINDS)[number];
export const MAX_VOICE_RESULT_COUNT = 999_999;
const MAX_VOICE_QUESTION_CHARS = 300;
const MAX_VOICE_MEMORY_CHARS = 1_000;
const MAX_VOICE_RESEARCH_TASK_CHARS = 600;

export type VoiceEffect = 'navigation' | 'read' | 'write';
export type VoiceOperationKind =
  | 'navigate' | 'ask' | 'summarize' | 'open_connector_setup' | 'open_file_setup'
  | 'remember' | 'start_researcher' | 'cancel_selected_run' | 'retry_selected_run'
  | 'run_selected_schedule' | 'confirm' | 'cancel';

export type VoiceOperation =
  | { readonly version: 1; readonly kind: 'navigate'; readonly route: VoiceRoute }
  | { readonly version: 1; readonly kind: 'ask'; readonly question: string }
  | { readonly version: 1; readonly kind: 'summarize'; readonly resource: VoiceSummaryKind }
  | { readonly version: 1; readonly kind: 'open_connector_setup' }
  | { readonly version: 1; readonly kind: 'open_file_setup' }
  | { readonly version: 1; readonly kind: 'remember'; readonly text: string }
  | { readonly version: 1; readonly kind: 'start_researcher'; readonly task: string }
  | { readonly version: 1; readonly kind: 'cancel_selected_run' }
  | { readonly version: 1; readonly kind: 'retry_selected_run' }
  | { readonly version: 1; readonly kind: 'run_selected_schedule' }
  | { readonly version: 1; readonly kind: 'confirm' }
  | { readonly version: 1; readonly kind: 'cancel' };

const ROUTES = new Set<string>(VOICE_ROUTES);
const SUMMARIES = new Set<string>(VOICE_SUMMARY_KINDS);
const FACTS: Readonly<Record<VoiceOperationKind, { readonly effect: VoiceEffect; readonly confirm: boolean }>> = Object.freeze({
  navigate: { effect: 'navigation', confirm: false }, ask: { effect: 'read', confirm: false }, summarize: { effect: 'read', confirm: false },
  open_connector_setup: { effect: 'navigation', confirm: false }, open_file_setup: { effect: 'navigation', confirm: false },
  remember: { effect: 'write', confirm: true }, start_researcher: { effect: 'write', confirm: true },
  cancel_selected_run: { effect: 'write', confirm: true }, retry_selected_run: { effect: 'write', confirm: true },
  run_selected_schedule: { effect: 'write', confirm: true }, confirm: { effect: 'read', confirm: false }, cancel: { effect: 'read', confirm: false },
});

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value.trim() === value && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

export function isVoiceOperation(value: unknown): value is VoiceOperation {
  if (!record(value) || value.version !== 1 || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'navigate': return exact(value, ['version', 'kind', 'route']) && typeof value.route === 'string' && ROUTES.has(value.route);
    case 'ask': return exact(value, ['version', 'kind', 'question']) && text(value.question, MAX_VOICE_QUESTION_CHARS);
    case 'summarize': return exact(value, ['version', 'kind', 'resource']) && typeof value.resource === 'string' && SUMMARIES.has(value.resource);
    case 'remember': return exact(value, ['version', 'kind', 'text']) && text(value.text, MAX_VOICE_MEMORY_CHARS);
    case 'start_researcher': return exact(value, ['version', 'kind', 'task']) && text(value.task, MAX_VOICE_RESEARCH_TASK_CHARS);
    case 'open_connector_setup': case 'open_file_setup': case 'cancel_selected_run': case 'retry_selected_run': case 'run_selected_schedule': case 'confirm': case 'cancel':
      return exact(value, ['version', 'kind']);
    default: return false;
  }
}
export function voiceOperationEffect(operation: VoiceOperation): VoiceEffect { return FACTS[operation.kind].effect; }
export function voiceOperationRequiresConfirmation(operation: VoiceOperation): boolean { return FACTS[operation.kind].confirm; }
export function voiceOperationAvailability(_operation: VoiceOperation): { readonly available: boolean; readonly reason: 'connector_catalogue_unavailable' | null } {
  // The planner may open the authenticated connector catalogue. Runtime
  // session, CSRF, and provider capability checks remain authoritative.
  return { available: true, reason: null };
}
const ROUTE_LABELS: Readonly<Record<VoiceRoute, string>> = Object.freeze({ dash: 'Dashboard', ask: 'Ask', memory: 'Memory', timeline: 'Timeline', graph: 'Graph', health: 'Context health', work: 'Work', agents: 'Agents', tools: 'Tools', voice: 'Voice', models: 'Models', mcp: 'MCP', sdk: 'SDK and API', cli: 'CLI', conn: 'Connectors', evals: 'Evaluations', hydra: 'HydraDB', settings: 'Settings' });
const SUMMARY_LABELS: Readonly<Record<VoiceSummaryKind, string>> = Object.freeze({ summary: 'Workspace', memory: 'Memory', changes: 'Changes', conflicts: 'Conflicts', health: 'Health', graph: 'Graph', runs: 'Runs', agents: 'Agents', tools: 'Tools', schedules: 'Schedules', models: 'Models', evaluations: 'Evaluations', connectors: 'Connectors' });
export function formatVoicePreview(operation: VoiceOperation): string {
  if (!isVoiceOperation(operation)) throw new TypeError('invalid voice operation');
  switch (operation.kind) {
    case 'navigate': return `Open ${ROUTE_LABELS[operation.route]}.`; case 'ask': return `Ask: “${operation.question}”`; case 'summarize': return `Read the ${SUMMARY_LABELS[operation.resource].toLowerCase()} summary.`;
    case 'open_connector_setup': return 'Open connector setup.'; case 'open_file_setup': return 'Open file connector setup.'; case 'remember': return `Remember this text: “${operation.text}”`;
    case 'start_researcher': return `Start Researcher work: “${operation.task}”`; case 'cancel_selected_run': return 'Cancel the one eligible active run.'; case 'retry_selected_run': return 'Retry the one eligible failed or cancelled run.'; case 'run_selected_schedule': return 'Run the one enabled schedule.'; case 'confirm': return 'Confirm the pending action.'; case 'cancel': return 'Discard the pending action.';
  }
}
function count(value: number): number { if (!Number.isSafeInteger(value) || value < 0 || value > MAX_VOICE_RESULT_COUNT) throw new RangeError('observed count is outside the voice result bound'); return value; }
function counted(value: number, singular: string): string { return `${value} ${value === 1 ? singular : `${singular}s`}`; }
export function formatVoiceResultSummary(operation: VoiceOperation, observedCount = 0): string {
  if (!isVoiceOperation(operation)) throw new TypeError('invalid voice operation');
  const value = count(observedCount);
  switch (operation.kind) {
    case 'navigate': return `Opened ${ROUTE_LABELS[operation.route]}.`; case 'ask': return `Answer ready with ${counted(value, 'evidence item')}.`; case 'summarize': return `${SUMMARY_LABELS[operation.resource]} summary ready with ${counted(value, 'item')}.`; case 'open_connector_setup': return 'Connector setup is unavailable.'; case 'open_file_setup': return 'File connector setup is unavailable.'; case 'remember': return `Stored ${counted(value, 'claim')}.`; case 'start_researcher': return 'Researcher work started.'; case 'cancel_selected_run': return 'Run cancelled.'; case 'retry_selected_run': return 'Run retried.'; case 'run_selected_schedule': return 'Schedule run started.'; case 'confirm': return 'Confirmation received.'; case 'cancel': return 'Pending action discarded.';
  }
}
