/**
 * The voice planner emits data, not authority. Every value in this module is
 * closed and bounded so a later executor can map it exhaustively to existing
 * authenticated application behavior.
 */

export const VOICE_OPERATION_VERSION = 1 as const;

export const VOICE_ROUTES = [
  'dash', 'ask', 'memory', 'timeline', 'graph', 'health', 'work', 'agents', 'tools',
  'voice', 'models', 'mcp', 'sdk', 'cli', 'conn', 'evals', 'hydra', 'settings',
] as const;
export type VoiceRoute = (typeof VOICE_ROUTES)[number];

export const VOICE_SUMMARY_KINDS = [
  'summary', 'memory', 'changes', 'conflicts', 'health', 'graph', 'runs', 'agents',
  'tools', 'schedules', 'models', 'evaluations', 'connectors',
] as const;
export type VoiceSummaryKind = (typeof VOICE_SUMMARY_KINDS)[number];

export const VOICE_OPERATION_KINDS = [
  'navigate',
  'ask',
  'summarize',
  'open_connector_setup',
  'open_file_setup',
  'remember',
  'start_researcher',
  'cancel_selected_run',
  'retry_selected_run',
  'run_selected_schedule',
  'confirm',
  'cancel',
] as const;
export type VoiceOperationKind = (typeof VOICE_OPERATION_KINDS)[number];
export type VoiceEffect = 'navigation' | 'read' | 'write';

export const MAX_VOICE_QUESTION_CHARS = 300;
export const MAX_VOICE_MEMORY_CHARS = 1_000;
export const MAX_VOICE_RESEARCH_TASK_CHARS = 600;
export const MAX_VOICE_RESULT_COUNT = 999_999;

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

export interface VoiceOperationFacts {
  readonly effect: VoiceEffect;
  readonly requiresConfirmation: boolean;
}

export const VOICE_OPERATION_REGISTRY: Readonly<Record<VoiceOperationKind, VoiceOperationFacts>> =
  Object.freeze({
    navigate: { effect: 'navigation', requiresConfirmation: false },
    ask: { effect: 'read', requiresConfirmation: false },
    summarize: { effect: 'read', requiresConfirmation: false },
    open_connector_setup: { effect: 'navigation', requiresConfirmation: false },
    open_file_setup: { effect: 'navigation', requiresConfirmation: false },
    remember: { effect: 'write', requiresConfirmation: true },
    start_researcher: { effect: 'write', requiresConfirmation: true },
    cancel_selected_run: { effect: 'write', requiresConfirmation: true },
    retry_selected_run: { effect: 'write', requiresConfirmation: true },
    run_selected_schedule: { effect: 'write', requiresConfirmation: true },
    confirm: { effect: 'read', requiresConfirmation: false },
    cancel: { effect: 'read', requiresConfirmation: false },
  });

export interface VoiceOperationAvailability {
  readonly available: boolean;
  readonly reason: 'connector_catalogue_unavailable' | null;
}

const ROUTES = new Set<string>(VOICE_ROUTES);
const SUMMARIES = new Set<string>(VOICE_SUMMARY_KINDS);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

/** Strict network-boundary guard. Extra fields are rejected rather than ignored. */
export function isVoiceOperation(value: unknown): value is VoiceOperation {
  if (!isRecord(value) || value['version'] !== VOICE_OPERATION_VERSION || typeof value['kind'] !== 'string') {
    return false;
  }

  switch (value['kind']) {
    case 'navigate':
      return exactKeys(value, ['version', 'kind', 'route'])
        && typeof value['route'] === 'string'
        && ROUTES.has(value['route']);
    case 'ask':
      return exactKeys(value, ['version', 'kind', 'question'])
        && boundedText(value['question'], MAX_VOICE_QUESTION_CHARS);
    case 'summarize':
      return exactKeys(value, ['version', 'kind', 'resource'])
        && typeof value['resource'] === 'string'
        && SUMMARIES.has(value['resource']);
    case 'remember':
      return exactKeys(value, ['version', 'kind', 'text'])
        && boundedText(value['text'], MAX_VOICE_MEMORY_CHARS);
    case 'start_researcher':
      return exactKeys(value, ['version', 'kind', 'task'])
        && boundedText(value['task'], MAX_VOICE_RESEARCH_TASK_CHARS);
    case 'open_connector_setup':
    case 'open_file_setup':
    case 'cancel_selected_run':
    case 'retry_selected_run':
    case 'run_selected_schedule':
    case 'confirm':
    case 'cancel':
      return exactKeys(value, ['version', 'kind']);
    default:
      return false;
  }
}

export function voiceOperationEffect(operation: VoiceOperation): VoiceEffect {
  return VOICE_OPERATION_REGISTRY[operation.kind].effect;
}

export function voiceOperationRequiresConfirmation(operation: VoiceOperation): boolean {
  return VOICE_OPERATION_REGISTRY[operation.kind].requiresConfirmation;
}

export function voiceOperationAvailability(_operation: VoiceOperation): VoiceOperationAvailability {
  // Connector catalogue and setup are real authenticated workspace routes.
  // Availability here means the operation can be planned; the route still
  // enforces session, CSRF, and provider capability boundaries at execution.
  return { available: true, reason: null };
}

const ROUTE_LABELS: Readonly<Record<VoiceRoute, string>> = Object.freeze({
  dash: 'Dashboard', ask: 'Ask', memory: 'Memory', timeline: 'Timeline', graph: 'Graph',
  health: 'Context health', work: 'Work', agents: 'Agents', tools: 'Tools', voice: 'Voice',
  models: 'Models', mcp: 'MCP', sdk: 'SDK and API', cli: 'CLI', conn: 'Connectors',
  evals: 'Evaluations', hydra: 'HydraDB', settings: 'Settings',
});

const SUMMARY_LABELS: Readonly<Record<VoiceSummaryKind, string>> = Object.freeze({
  summary: 'Workspace', memory: 'Memory', changes: 'Changes', conflicts: 'Conflicts',
  health: 'Health', graph: 'Graph', runs: 'Runs', agents: 'Agents', tools: 'Tools',
  schedules: 'Schedules', models: 'Models', evaluations: 'Evaluations', connectors: 'Connectors',
});

export function formatVoicePreview(operation: VoiceOperation): string {
  if (!isVoiceOperation(operation)) throw new TypeError('invalid voice operation');
  switch (operation.kind) {
    case 'navigate': return `Open ${ROUTE_LABELS[operation.route]}.`;
    case 'ask': return `Ask: “${operation.question}”`;
    case 'summarize': return `Read the ${SUMMARY_LABELS[operation.resource].toLowerCase()} summary.`;
    case 'open_connector_setup': return 'Open connector setup.';
    case 'open_file_setup': return 'Open file connector setup.';
    case 'remember': return `Remember this text: “${operation.text}”`;
    case 'start_researcher': return `Start Researcher work: “${operation.task}”`;
    case 'cancel_selected_run': return 'Cancel the one eligible active run.';
    case 'retry_selected_run': return 'Retry the one eligible failed or cancelled run.';
    case 'run_selected_schedule': return 'Run the one enabled schedule.';
    case 'confirm': return 'Confirm the pending action.';
    case 'cancel': return 'Discard the pending action.';
  }
}

function checkedCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_VOICE_RESULT_COUNT) {
    throw new RangeError('observed count is outside the voice result bound');
  }
  return value;
}

function counted(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/** Result copy describes observed facts only. It never repeats free-form input. */
export function formatVoiceResultSummary(operation: VoiceOperation, observedCount = 0): string {
  if (!isVoiceOperation(operation)) throw new TypeError('invalid voice operation');
  const count = checkedCount(observedCount);
  switch (operation.kind) {
    case 'navigate': return `Opened ${ROUTE_LABELS[operation.route]}.`;
    case 'ask': return `Answer ready with ${counted(count, 'evidence item')}.`;
    case 'summarize': return `${SUMMARY_LABELS[operation.resource]} summary ready with ${counted(count, 'item')}.`;
    case 'open_connector_setup': return 'Opened connector setup.';
    case 'open_file_setup': return 'Opened file connector setup.';
    case 'remember': return `Stored ${counted(count, 'claim')}.`;
    case 'start_researcher': return 'Researcher work started.';
    case 'cancel_selected_run': return 'Run cancelled.';
    case 'retry_selected_run': return 'Run retried.';
    case 'run_selected_schedule': return 'Schedule run started.';
    case 'confirm': return 'Confirmation received.';
    case 'cancel': return 'Pending action discarded.';
  }
}
