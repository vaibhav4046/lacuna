import {
  MAX_VOICE_QUESTION_CHARS,
  MAX_VOICE_RESEARCH_TASK_CHARS,
  formatVoicePreview,
  voiceOperationAvailability,
  voiceOperationEffect,
  voiceOperationRequiresConfirmation,
  type VoiceEffect,
  type VoiceOperation,
  type VoiceRoute,
  type VoiceSummaryKind,
} from './operations.js';

export const MAX_VOICE_TRANSCRIPT_CHARS = 1_000;

export type VoiceScope = 'private' | 'public';
export type VoiceIntentReason =
  | 'empty_transcript'
  | 'invalid_transcript'
  | 'transcript_too_long'
  | 'unsupported_command'
  | 'unsafe_command'
  | 'ambiguous_target'
  | 'invalid_control'
  | 'public_read_only'
  | 'connector_catalogue_unavailable'
  | 'already_on_route';

export interface VoiceIntentPlan {
  readonly version: 1;
  readonly operation: VoiceOperation | null;
  readonly effect: VoiceEffect | null;
  readonly requiresConfirmation: boolean;
  readonly available: boolean;
  readonly reason: VoiceIntentReason | null;
  readonly display: string;
}

const REFUSALS: Readonly<Record<Exclude<VoiceIntentReason, 'connector_catalogue_unavailable' | 'already_on_route' | 'public_read_only'>, string>> = Object.freeze({
  empty_transcript: 'No command was heard.',
  invalid_transcript: 'That transcript cannot be used.',
  transcript_too_long: 'That command is too long.',
  unsupported_command: 'That command is not supported. Try navigation, a summary, a question, remember, or Researcher work.',
  unsafe_command: 'Voice cannot execute URLs, tools, shell commands, destructive actions, or security changes.',
  ambiguous_target: 'Name no target. Voice can act only when the application finds one eligible run or schedule.',
  invalid_control: 'Say confirm or cancel as a separate command.',
});

const ROUTE_ALIASES: Readonly<Record<string, VoiceRoute>> = Object.freeze({
  dashboard: 'dash', dash: 'dash', home: 'dash', ask: 'ask', memory: 'memory',
  timeline: 'timeline', graph: 'graph', health: 'health', 'context health': 'health',
  work: 'work', runs: 'work', agents: 'agents', tools: 'tools', voice: 'voice',
  models: 'models', mcp: 'mcp', sdk: 'sdk', api: 'sdk', 'sdk and api': 'sdk', cli: 'cli',
  connectors: 'conn', connector: 'conn', evaluations: 'evals', evaluation: 'evals',
  hydradb: 'hydra', settings: 'settings',
});

const SUMMARY_PATTERNS: readonly (readonly [VoiceSummaryKind, RegExp])[] = [
  ['summary', /^(?:give me |show |read )?(?:a |the )?(?:workspace |dashboard )?summary$/u],
  ['changes', /^(?:what changed\??|(?:show |read |summarize )?(?:the )?(?:recent )?changes(?: summary)?)$/u],
  ['conflicts', /^(?:(?:show |read |summarize )?(?:the )?(?:unresolved )?conflicts(?: summary)?)$/u],
  ['memory', /^(?:(?:show |read |summarize )?(?:the )?memory(?: summary)?|memory summary)$/u],
  ['health', /^(?:(?:show |read |summarize )?(?:the )?(?:context )?health(?: summary)?|health summary)$/u],
  ['graph', /^(?:(?:show |read |summarize )?(?:the )?graph(?: summary)?|graph summary)$/u],
  ['runs', /^(?:(?:show |read |summarize )?(?:the )?runs?(?: summary)?|runs summary)$/u],
  ['agents', /^(?:(?:show |read |summarize )?(?:the )?agents?(?: summary)?|agents summary)$/u],
  ['tools', /^(?:(?:show |read |summarize )?(?:the )?tools?(?: summary)?|tools summary)$/u],
  ['schedules', /^(?:(?:show |read |summarize )?(?:the )?schedules?(?: summary)?|schedules summary)$/u],
  ['models', /^(?:(?:show |read |summarize )?(?:the )?models?(?: summary)?|models summary)$/u],
  ['evaluations', /^(?:(?:show |read |summarize )?(?:the )?evaluations?(?: summary)?|evaluations? summary)$/u],
  ['connectors', /^(?:(?:show |read |summarize )?(?:the )?connectors?(?: status| summary)?|connectors? summary)$/u],
];

function refusal(reason: keyof typeof REFUSALS): VoiceIntentPlan {
  return {
    version: 1,
    operation: null,
    effect: null,
    requiresConfirmation: false,
    available: false,
    reason,
    display: REFUSALS[reason],
  };
}

function currentRouteKey(currentRoute: string): VoiceRoute | null {
  const withoutQuery = currentRoute.split(/[?#]/u, 1)[0] ?? '';
  const tail = withoutQuery.replace(/\/+$/u, '').split('/').pop()?.toLowerCase() ?? '';
  return ROUTE_ALIASES[tail] ?? null;
}

function planned(operation: VoiceOperation, currentRoute: string, scope: VoiceScope): VoiceIntentPlan {
  const effect = voiceOperationEffect(operation);
  const fixed = voiceOperationAvailability(operation);
  let available = fixed.available;
  let reason: VoiceIntentReason | null = fixed.reason;

  if (available && scope === 'public' && (effect === 'write' || operation.kind === 'confirm')) {
    available = false;
    reason = 'public_read_only';
  } else if (available && operation.kind === 'navigate' && currentRouteKey(currentRoute) === operation.route) {
    available = false;
    reason = 'already_on_route';
  }

  const display = reason === 'public_read_only'
    ? 'Public explore mode is read-only. This action was not planned for execution.'
    : reason === 'already_on_route'
      ? `Already here. ${formatVoicePreview(operation)}`
      : formatVoicePreview(operation);
  return {
    version: 1,
    operation,
    effect,
    requiresConfirmation: voiceOperationRequiresConfirmation(operation),
    available,
    reason,
    display,
  };
}

function unsafe(text: string): boolean {
  return /(?:https?:\/\/|www\.)/u.test(text)
    || /\b(?:curl|wget|powershell|cmd\.exe|bash|sudo|kubectl|docker|rm\s+-|git\s+push|npm\s+run|npx)\b/u.test(text)
    || /\b(?:execute|invoke|call|run)\s+(?:an?\s+|the\s+)?(?:shell|mcp|tool|command)\b/u.test(text)
    || /\b(?:delete|destroy|erase|wipe|revoke|rotate)\b/u.test(text)
    || /\b(?:sign|log)\s*out\b/u.test(text)
    || /\b(?:password|credential|permission|security setting|api key)\b/u.test(text);
}

function questionLike(text: string): boolean {
  return text.endsWith('?')
    || /^(?:who|what|when|where|why|how|which|is|are|was|were|do|does|did|can|could|would|should|will|has|have)\b/u.test(text);
}

function researchTask(text: string): string | null {
  const match = /^(?:ask the researcher to|start researcher work(?: on| to)?|research)\s+(.+)$/iu.exec(text);
  return match?.[1]?.trim() ?? null;
}

function rememberedText(text: string): string | null {
  const match = /^(?:remember|add to memory|save (?:this|to memory))(?::)?\s+(.+)$/iu.exec(text);
  return match?.[1]?.trim() ?? null;
}

/**
 * Parses by explicit precedence. No branch calls a model and no unmatched
 * imperative is converted into a question.
 */
export function planVoiceIntent(
  transcript: string,
  currentRoute: string,
  scope: VoiceScope,
): VoiceIntentPlan {
  if (transcript.length > MAX_VOICE_TRANSCRIPT_CHARS) return refusal('transcript_too_long');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(transcript)) return refusal('invalid_transcript');

  const text = transcript.trim().replace(/\s+/gu, ' ');
  if (text === '') return refusal('empty_transcript');
  const normalized = text.toLowerCase();

  if (normalized === 'confirm') return planned({ version: 1, kind: 'confirm' }, currentRoute, scope);
  if (normalized === 'cancel') return planned({ version: 1, kind: 'cancel' }, currentRoute, scope);
  if (/\bconfirm\b/u.test(normalized)) return refusal('invalid_control');
  if (unsafe(normalized)) return refusal('unsafe_command');

  const remember = rememberedText(text);
  if (remember !== null) {
    return planned({ version: 1, kind: 'remember', text: remember }, currentRoute, scope);
  }

  const researcher = researchTask(text);
  if (researcher !== null) {
    if (researcher.length > MAX_VOICE_RESEARCH_TASK_CHARS) return refusal('invalid_transcript');
    return planned({ version: 1, kind: 'start_researcher', task: researcher }, currentRoute, scope);
  }

  if (/^cancel (?:the |one )?(?:active|running|eligible) run$/u.test(normalized)) {
    return planned({ version: 1, kind: 'cancel_selected_run' }, currentRoute, scope);
  }
  if (/^retry (?:the |one )?(?:failed|cancelled|canceled|eligible) run$/u.test(normalized)) {
    return planned({ version: 1, kind: 'retry_selected_run' }, currentRoute, scope);
  }
  if (/^run (?:the |one )?(?:enabled|eligible) schedule$/u.test(normalized)) {
    return planned({ version: 1, kind: 'run_selected_schedule' }, currentRoute, scope);
  }
  if (/^(?:cancel|retry)\s+runs?\b/u.test(normalized) || /^run\s+(?:the\s+)?schedules?\b/u.test(normalized)) {
    return refusal('ambiguous_target');
  }
  if (/^cancel\b/u.test(normalized)) return refusal('invalid_control');

  if (normalized === 'open connector setup') {
    return planned({ version: 1, kind: 'open_connector_setup' }, currentRoute, scope);
  }
  if (normalized === 'open file setup' || normalized === 'open file connector setup') {
    return planned({ version: 1, kind: 'open_file_setup' }, currentRoute, scope);
  }

  if (normalized.startsWith('ask ')) {
    const question = text.slice(4).trim();
    if (question === '' || question.length > MAX_VOICE_QUESTION_CHARS) return refusal('invalid_transcript');
    return planned({ version: 1, kind: 'ask', question }, currentRoute, scope);
  }

  for (const [resource, pattern] of SUMMARY_PATTERNS) {
    if (pattern.test(normalized)) {
      return planned({ version: 1, kind: 'summarize', resource }, currentRoute, scope);
    }
  }

  const navigation = /^(?:go|open|show|take me)(?: me)?(?: to)?\s+(?:the\s+)?(.+)$/u.exec(normalized);
  const route = navigation === null ? undefined : ROUTE_ALIASES[navigation[1] ?? ''];
  if (route !== undefined) return planned({ version: 1, kind: 'navigate', route }, currentRoute, scope);

  if (questionLike(normalized)) {
    if (text.length > MAX_VOICE_QUESTION_CHARS) return refusal('invalid_transcript');
    return planned({ version: 1, kind: 'ask', question: text }, currentRoute, scope);
  }
  return refusal('unsupported_command');
}
