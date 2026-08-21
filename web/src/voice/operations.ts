import {
  MAX_VOICE_RESULT_COUNT,
  VOICE_ROUTES,
  formatVoicePreview,
  formatVoiceResultSummary,
  isVoiceOperation,
  voiceOperationAvailability,
  voiceOperationEffect,
  voiceOperationRequiresConfirmation,
  type VoiceEffect,
  type VoiceOperation,
  type VoiceRoute,
} from '../../../src/voice/operations';
import type { VoiceIntentReason } from '../../../src/voice/intent';
import {
  VoiceOperationRequestError,
  browserCsrfToken,
  getVoiceOperationJson,
  postVoiceOperationJson,
  requestVoiceIntent,
  type VoiceOperationApiOptions,
  type VoiceOperationRequestFailure,
} from '../api/voice-operations';

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DISPLAY_LIMIT = 2_000;
const ANSWER_LIMIT = 5_000;
const IDENTIFIER_LIMIT = 512;

const INTENT_REASONS = new Set<VoiceIntentReason>([
  'empty_transcript',
  'invalid_transcript',
  'transcript_too_long',
  'unsupported_command',
  'unsafe_command',
  'ambiguous_target',
  'invalid_control',
  'public_read_only',
  'connector_catalogue_unavailable',
  'already_on_route',
]);

const REFUSAL_REASONS = new Set<VoiceIntentReason>([
  'empty_transcript',
  'invalid_transcript',
  'transcript_too_long',
  'unsupported_command',
  'unsafe_command',
  'ambiguous_target',
  'invalid_control',
]);

const REFUSAL_DISPLAY: Readonly<Record<
  'empty_transcript' | 'invalid_transcript' | 'transcript_too_long' | 'unsupported_command'
  | 'unsafe_command' | 'ambiguous_target' | 'invalid_control',
  string
>> = Object.freeze({
  empty_transcript: 'No command was heard.',
  invalid_transcript: 'That transcript cannot be used.',
  transcript_too_long: 'That command is too long.',
  unsupported_command: 'That command is not supported. Try navigation, a summary, a question, remember, or Researcher work.',
  unsafe_command: 'Voice cannot execute URLs, tools, shell commands, destructive actions, or security changes.',
  ambiguous_target: 'Name no target. Voice can act only when the application finds one eligible run or schedule.',
  invalid_control: 'Say confirm or cancel as a separate command.',
});

const VOICE_ROUTE_SET = new Set<string>(VOICE_ROUTES);
const PUBLIC_READ_ONLY_DISPLAY = 'Public explore mode is read-only. This action was not planned for execution.';

const ACTIVE_RUN_STATUSES = new Set(['CREATED', 'QUEUED', 'RUNNING', 'WAITING_TOOL', 'HANDOFF']);
const RETRY_RUN_STATUSES = new Set(['FAILED', 'CANCELLED']);
const RUN_STATUSES = new Set([
  'CREATED', 'QUEUED', 'RUNNING', 'WAITING_TOOL', 'HANDOFF', 'COMPLETED', 'FAILED', 'CANCELLED',
]);

export interface VoiceOperationPlan {
  readonly version: 1;
  readonly requestId: string;
  readonly operation: VoiceOperation | null;
  readonly effect: VoiceEffect | null;
  readonly requiresConfirmation: boolean;
  readonly available: boolean;
  readonly reason: VoiceIntentReason | null;
  readonly display: string;
}

export type VoiceOperationFailure =
  | VoiceOperationRequestFailure
  | 'operation_refused'
  | 'operation_unavailable'
  | 'control_operation'
  | 'target_not_unique'
  | 'invalid_response';

export interface VoiceOperationResult {
  readonly requestId: string | null;
  readonly operationKind: VoiceOperation['kind'] | null;
  readonly status: 'succeeded' | 'refused' | 'unavailable';
  readonly failure: VoiceOperationFailure | null;
  readonly summary: string;
  readonly observedCount: number;
  /** The bounded resolved answer only. Evidence and provider/run records stay out. */
  readonly answer: string | null;
  readonly answerStatus: 'ANSWERED' | 'PARTIAL' | 'CONFLICT' | 'NO_EVIDENCE' | null;
}

export interface VoiceOperationExecutorOptions {
  readonly fetchImpl?: typeof fetch;
  readonly navigate?: (path: string) => void;
  readonly randomUUID?: () => string;
  readonly csrfToken?: () => string;
}

interface VoicePlanContext {
  readonly route: VoiceRoute;
  readonly scope: 'private' | 'public';
}

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
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function planContext(currentRoute: string): VoicePlanContext | null {
  const matched = /^\/(app|explore)\/([^/]+)$/u.exec(currentRoute);
  const route = matched?.[2];
  if (route === undefined || !VOICE_ROUTE_SET.has(route)) return null;
  return { route: route as VoiceRoute, scope: matched?.[1] === 'explore' ? 'public' : 'private' };
}

function expectedOperationDisplay(operation: VoiceOperation, reason: VoiceIntentReason | null): string {
  const preview = formatVoicePreview(operation);
  return reason === 'public_read_only'
    ? PUBLIC_READ_ONLY_DISPLAY
    : reason === 'already_on_route'
      ? `Already here. ${preview}`
      : preview;
}

/** Revalidates the serialized plan as untrusted network data. */
export function readVoiceOperationPlan(
  value: unknown,
  expectedRequestId?: string,
  context?: VoicePlanContext,
): VoiceOperationPlan | null {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'requestId', 'operation', 'effect', 'requiresConfirmation',
    'available', 'reason', 'display',
  ])) return null;
  if (value['version'] !== 1
    || typeof value['requestId'] !== 'string'
    || !REQUEST_ID.test(value['requestId'])
    || (expectedRequestId !== undefined && value['requestId'] !== expectedRequestId)
    || typeof value['requiresConfirmation'] !== 'boolean'
    || typeof value['available'] !== 'boolean'
    || !boundedText(value['display'], DISPLAY_LIMIT)
    || (value['reason'] !== null
      && (typeof value['reason'] !== 'string' || !INTENT_REASONS.has(value['reason'] as VoiceIntentReason)))) return null;

  const requestId = value['requestId'];
  const reason = value['reason'] as VoiceIntentReason | null;
  const operation = value['operation'];
  if (operation === null) {
    if (value['effect'] !== null
      || value['requiresConfirmation'] !== false
      || value['available'] !== false
      || reason === null
      || !REFUSAL_REASONS.has(reason)
      || value['display'] !== REFUSAL_DISPLAY[reason as keyof typeof REFUSAL_DISPLAY]) return null;
    return {
      version: 1, requestId, operation: null, effect: null, requiresConfirmation: false,
      available: false, reason, display: value['display'],
    };
  }

  if (!isVoiceOperation(operation)) return null;
  const effect = voiceOperationEffect(operation);
  const confirmation = voiceOperationRequiresConfirmation(operation);
  if (value['effect'] !== effect || value['requiresConfirmation'] !== confirmation) return null;

  const localAvailability = voiceOperationAvailability(operation);
  if (!localAvailability.available) {
    if (value['available'] !== false || reason !== localAvailability.reason) return null;
  } else {
    const contextualReason: VoiceIntentReason | null = context?.scope === 'public'
      && (effect === 'write' || operation.kind === 'confirm')
      ? 'public_read_only'
      : context !== undefined && operation.kind === 'navigate' && context.route === operation.route
        ? 'already_on_route'
        : null;
    if (contextualReason === null) {
      if (value['available'] !== true || reason !== null) return null;
    } else if (value['available'] !== false || reason !== contextualReason) {
      return null;
    }
  }
  if (value['display'] !== expectedOperationDisplay(operation, reason)) return null;

  return {
    version: 1,
    requestId,
    operation,
    effect,
    requiresConfirmation: confirmation,
    available: value['available'],
    reason,
    display: value['display'],
  };
}

function defaultNavigate(path: string): void {
  if (typeof window === 'undefined') throw new Error('navigation unavailable');
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function result(
  plan: VoiceOperationPlan | null,
  status: VoiceOperationResult['status'],
  failure: VoiceOperationFailure | null,
  summary: string,
  observedCount = 0,
  answer: string | null = null,
  answerStatus: VoiceOperationResult['answerStatus'] = null,
): VoiceOperationResult {
  return {
    requestId: plan?.requestId ?? null,
    operationKind: plan?.operation?.kind ?? null,
    status,
    failure,
    summary,
    observedCount,
    answer,
    answerStatus,
  };
}

function refusedResult(plan: VoiceOperationPlan | null, failure: VoiceOperationFailure): VoiceOperationResult {
  const summary = failure === 'target_not_unique'
    ? 'Voice needs exactly one eligible target.'
    : failure === 'control_operation'
      ? 'No executable operation was selected.'
      : failure === 'invalid_plan'
        ? 'The voice plan was refused.'
        : 'That operation is not available.';
  return result(plan, 'refused', failure, summary);
}

function unavailableResult(
  plan: VoiceOperationPlan | null,
  failure: VoiceOperationFailure,
): VoiceOperationResult {
  const summary = failure === 'session_required'
    ? 'Sign in again to continue.'
    : failure === 'operation_unavailable'
      ? 'Connector operations are unavailable.'
      : 'The operation could not be completed.';
  return result(plan, 'unavailable', failure, summary);
}

function success(
  plan: VoiceOperationPlan,
  observedCount: number,
  answer: string | null = null,
  answerStatus: VoiceOperationResult['answerStatus'] = null,
): VoiceOperationResult {
  if (plan.operation === null) return refusedResult(plan, 'operation_refused');
  return result(
    plan,
    'succeeded',
    null,
    formatVoiceResultSummary(plan.operation, observedCount),
    observedCount,
    answer,
    answerStatus,
  );
}

function observedCount(value: unknown): number | null {
  let count: number;
  if (Array.isArray(value)) count = value.length;
  else if (isRecord(value) && Array.isArray(value['rows'])) count = value['rows'].length;
  else if (isRecord(value) && Array.isArray(value['nodes'])) count = value['nodes'].length;
  else if (isRecord(value)) count = 1;
  else return null;
  return count <= MAX_VOICE_RESULT_COUNT ? count : null;
}

interface ObservedAnswer {
  readonly answer: string | null;
  readonly status: VoiceOperationResult['answerStatus'];
  readonly count: number;
}

function readAnswer(value: unknown): ObservedAnswer | null {
  if (!isRecord(value) || !isRecord(value['answer'])) return null;
  const answer = value['answer'];
  const status = answer['status'];
  if (status !== 'ANSWERED' && status !== 'PARTIAL' && status !== 'CONFLICT' && status !== 'NO_EVIDENCE') return null;
  if (!Array.isArray(answer['evidence']) || answer['evidence'].length > MAX_VOICE_RESULT_COUNT) return null;
  const text = answer['answer'];
  if (text !== null && !boundedText(text, ANSWER_LIMIT)) return null;
  if ((status === 'ANSWERED' || status === 'PARTIAL') && typeof text !== 'string') return null;
  return { answer: text, status, count: answer['evidence'].length };
}

interface RunTarget {
  readonly id: string;
  readonly status: string;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= IDENTIFIER_LIMIT
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function readRuns(value: unknown): readonly RunTarget[] | null {
  if (!Array.isArray(value)) return null;
  const runs: RunTarget[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !validIdentifier(entry['id'])
      || typeof entry['status'] !== 'string' || !RUN_STATUSES.has(entry['status'])) return null;
    runs.push({ id: entry['id'], status: entry['status'] });
  }
  return runs;
}

interface ScheduleTarget {
  readonly id: string;
  readonly enabled: boolean;
}

function readSchedules(value: unknown): readonly ScheduleTarget[] | null {
  if (!Array.isArray(value)) return null;
  const schedules: ScheduleTarget[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !validIdentifier(entry['id']) || typeof entry['enabled'] !== 'boolean') return null;
    schedules.push({ id: entry['id'], enabled: entry['enabled'] });
  }
  return schedules;
}

function one<T>(values: readonly T[]): T | null {
  return values.length === 1 ? values[0] ?? null : null;
}

function assertNever(value: never): never {
  throw new Error(`unhandled operation: ${String(value)}`);
}

export class VoiceOperationExecutor {
  readonly #api: VoiceOperationApiOptions;
  readonly #navigate: (path: string) => void;
  readonly #randomUUID: () => string;
  readonly #inFlight = new Map<string, Promise<VoiceOperationResult>>();
  readonly #planContexts = new WeakMap<VoiceOperationPlan, VoicePlanContext>();

  constructor(options: VoiceOperationExecutorOptions = {}) {
    this.#api = {
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      csrfToken: options.csrfToken ?? browserCsrfToken,
    };
    this.#navigate = options.navigate ?? defaultNavigate;
    this.#randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  }

  async plan(transcript: string, currentRoute: string): Promise<VoiceOperationPlan> {
    const requestId = this.#randomUUID();
    const context = planContext(currentRoute);
    if (!REQUEST_ID.test(requestId) || context === null) throw new VoiceOperationRequestError('invalid_plan');
    const raw = await requestVoiceIntent({ version: 1, requestId, transcript, currentRoute }, this.#api);
    const plan = readVoiceOperationPlan(raw, requestId, context);
    if (plan === null) throw new VoiceOperationRequestError('invalid_plan');
    this.#planContexts.set(plan, context);
    return plan;
  }

  execute(untrustedPlan: unknown): Promise<VoiceOperationResult> {
    const context = isRecord(untrustedPlan)
      ? this.#planContexts.get(untrustedPlan as unknown as VoiceOperationPlan)
      : undefined;
    if (context === undefined) return Promise.resolve(refusedResult(null, 'invalid_plan'));
    const plan = readVoiceOperationPlan(untrustedPlan, undefined, context);
    if (plan === null) return Promise.resolve(refusedResult(null, 'invalid_plan'));
    const existing = this.#inFlight.get(plan.requestId);
    if (existing !== undefined) return existing;

    const pending = this.#executeSafely(plan);
    this.#inFlight.set(plan.requestId, pending);
    void pending.finally(() => {
      if (this.#inFlight.get(plan.requestId) === pending) this.#inFlight.delete(plan.requestId);
    });
    return pending;
  }

  async #executeSafely(plan: VoiceOperationPlan): Promise<VoiceOperationResult> {
    try {
      return await this.#executePlan(plan);
    } catch (error) {
      if (error instanceof VoiceOperationRequestError) return unavailableResult(plan, error.failure);
      return unavailableResult(plan, 'request_failed');
    }
  }

  async #executePlan(plan: VoiceOperationPlan): Promise<VoiceOperationResult> {
    if (!plan.available) {
      return plan.reason === 'connector_catalogue_unavailable'
        ? unavailableResult(plan, 'operation_unavailable')
        : refusedResult(plan, 'operation_refused');
    }
    const operation = plan.operation;
    if (operation === null) return refusedResult(plan, 'operation_refused');

    switch (operation.kind) {
      case 'navigate':
        this.#navigate(`/app/${operation.route}`);
        return success(plan, 0);
      case 'ask': {
        const raw = await postVoiceOperationJson('/api/workspace/query', { question: operation.question }, this.#api);
        const answer = readAnswer(raw);
        return answer === null
          ? unavailableResult(plan, 'invalid_response')
          : success(plan, answer.count, answer.answer, answer.status);
      }
      case 'summarize': {
        if (operation.resource === 'connectors') return unavailableResult(plan, 'operation_unavailable');
        const raw = await getVoiceOperationJson(`/api/workspace/${operation.resource}`, this.#api);
        const count = observedCount(raw);
        return count === null ? unavailableResult(plan, 'invalid_response') : success(plan, count);
      }
      case 'open_connector_setup':
      case 'open_file_setup':
        return unavailableResult(plan, 'operation_unavailable');
      case 'remember': {
        const raw = await postVoiceOperationJson('/api/workspace/ingest', {
          title: 'Voice memory', text: operation.text,
        }, this.#api);
        if (!isRecord(raw) || raw['ok'] !== true
          || !Number.isSafeInteger(raw['claims'])
          || (raw['claims'] as number) < 0
          || (raw['claims'] as number) > MAX_VOICE_RESULT_COUNT) {
          return unavailableResult(plan, 'invalid_response');
        }
        return success(plan, raw['claims'] as number);
      }
      case 'start_researcher': {
        const raw = await postVoiceOperationJson('/api/workspace/agent/run', {
          task: operation.task, requestId: plan.requestId,
        }, this.#api);
        return isRecord(raw) ? success(plan, 1) : unavailableResult(plan, 'invalid_response');
      }
      case 'cancel_selected_run':
        return this.#runMutation(plan, 'cancel', ACTIVE_RUN_STATUSES);
      case 'retry_selected_run':
        return this.#runMutation(plan, 'retry', RETRY_RUN_STATUSES);
      case 'run_selected_schedule':
        return this.#runSchedule(plan);
      case 'confirm':
      case 'cancel':
        return refusedResult(plan, 'control_operation');
      default:
        return assertNever(operation);
    }
  }

  async #runMutation(
    plan: VoiceOperationPlan,
    action: 'cancel' | 'retry',
    eligibleStatuses: ReadonlySet<string>,
  ): Promise<VoiceOperationResult> {
    const rawRuns = await getVoiceOperationJson('/api/workspace/runs', this.#api);
    const runs = readRuns(rawRuns);
    if (runs === null) return unavailableResult(plan, 'invalid_response');
    const target = one(runs.filter((run) => eligibleStatuses.has(run.status)));
    if (target === null) return refusedResult(plan, 'target_not_unique');
    const raw = await postVoiceOperationJson(
      `/api/workspace/agent/runs/${encodeURIComponent(target.id)}/${action}`,
      {},
      this.#api,
    );
    return isRecord(raw) ? success(plan, 1) : unavailableResult(plan, 'invalid_response');
  }

  async #runSchedule(plan: VoiceOperationPlan): Promise<VoiceOperationResult> {
    const rawSchedules = await getVoiceOperationJson('/api/workspace/schedules', this.#api);
    const schedules = readSchedules(rawSchedules);
    if (schedules === null) return unavailableResult(plan, 'invalid_response');
    const target = one(schedules.filter((schedule) => schedule.enabled));
    if (target === null) return refusedResult(plan, 'target_not_unique');
    const raw = await postVoiceOperationJson(
      `/api/workspace/schedules/${encodeURIComponent(target.id)}/run`,
      { requestId: plan.requestId },
      this.#api,
    );
    if (!isRecord(raw) || (raw['outcome'] !== 'DISPATCHED' && raw['outcome'] !== 'DUPLICATE')) {
      return unavailableResult(plan, 'invalid_response');
    }
    return success(plan, 1);
  }
}
