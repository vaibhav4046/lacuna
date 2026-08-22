import type { VoiceEffect, VoiceOperation, VoiceRoute } from './operations-contract';

type LocalVoiceIntentReason =
  | 'empty_transcript' | 'invalid_transcript' | 'transcript_too_long'
  | 'unsupported_command' | 'unsafe_command' | 'ambiguous_target'
  | 'invalid_control' | 'public_read_only' | 'already_on_route';

export interface LocalVoiceIntentPlan {
  readonly version: 1;
  readonly operation: VoiceOperation | null;
  readonly effect: VoiceEffect | null;
  readonly requiresConfirmation: boolean;
  readonly available: boolean;
  readonly reason: LocalVoiceIntentReason | null;
  readonly display: string;
}

const ROUTES: Readonly<Record<string, VoiceRoute>> = Object.freeze({
  dashboard: 'dash', dash: 'dash', home: 'dash', ask: 'ask', memory: 'memory',
  timeline: 'timeline', graph: 'graph', health: 'health', 'context health': 'health',
  work: 'work', runs: 'work', agents: 'agents', tools: 'tools', voice: 'voice',
  models: 'models', mcp: 'mcp', sdk: 'sdk', api: 'sdk', 'sdk and api': 'sdk', cli: 'cli',
  connectors: 'conn', connector: 'conn', evaluations: 'evals', evaluation: 'evals',
  hydradb: 'hydra', settings: 'settings',
});

const SUMMARY: Readonly<Record<string, string>> = Object.freeze({
  summary: 'summary', memory: 'memory', changes: 'changes', conflicts: 'conflicts',
  health: 'health', graph: 'graph', runs: 'runs', agents: 'agents', tools: 'tools',
  schedules: 'schedules', models: 'models', evaluations: 'evaluations', connectors: 'connectors',
});

function refusal(reason: LocalVoiceIntentReason, display: string): LocalVoiceIntentPlan {
  return { version: 1, operation: null, effect: null, requiresConfirmation: false, available: false, reason, display };
}

function planned(operation: VoiceOperation, display: string): LocalVoiceIntentPlan {
  const write = operation.kind === 'remember' || operation.kind === 'start_researcher'
    || operation.kind === 'cancel_selected_run' || operation.kind === 'retry_selected_run'
    || operation.kind === 'run_selected_schedule';
  return {
    version: 1,
    operation,
    effect: write ? 'write' : operation.kind === 'navigate' ? 'navigation' : 'read',
    requiresConfirmation: write,
    available: true,
    reason: null,
    display,
  };
}

/** Browser-only emergency grammar for safe intents when the optional planner request cannot start. */
export function planLocalVoiceIntent(transcript: string): LocalVoiceIntentPlan {
  if (transcript.length > 1_000) return refusal('transcript_too_long', 'That command is too long.');
  const text = transcript.trim().replace(/\s+/gu, ' ');
  if (text === '') return refusal('empty_transcript', 'No command was heard.');
  const normalized = text.toLowerCase();
  if (/[\u0000-\u001f\u007f]/u.test(text)) return refusal('invalid_transcript', 'That transcript cannot be used.');
  if (/(?:https?:\/\/|www\.)|\b(?:curl|wget|powershell|bash|sudo|kubectl|docker|rm\s+-|git\s+push|npm\s+run|npx)\b/u.test(normalized)) {
    return refusal('unsafe_command', 'Voice cannot execute URLs, tools, shell commands, destructive actions, or security changes.');
  }
  if (normalized === 'confirm') return planned({ version: 1, kind: 'confirm' }, 'Confirm the pending action.');
  if (normalized === 'cancel') return planned({ version: 1, kind: 'cancel' }, 'Discard the pending action.');
  if (/\bconfirm\b/u.test(normalized)) return refusal('invalid_control', 'Say confirm or cancel as a separate command.');

  const remembered = /^(?:remember|add to memory|save (?:this|to memory))(?::)?\s+(.+)$/iu.exec(text)?.[1]?.trim();
  if (remembered) return planned({ version: 1, kind: 'remember', text: remembered }, `Remember this text: “${remembered}”`);
  const research = /^(?:ask the researcher to|start researcher work(?: on| to)?|research)\s+(.+)$/iu.exec(text)?.[1]?.trim();
  if (research) return planned({ version: 1, kind: 'start_researcher', task: research }, `Start Researcher work: “${research}”`);
  if (/^cancel (?:the |one )?(?:active|running|eligible) run$/u.test(normalized)) return planned({ version: 1, kind: 'cancel_selected_run' }, 'Cancel the one eligible active run.');
  if (/^retry (?:the |one )?(?:failed|cancelled|canceled|eligible) run$/u.test(normalized)) return planned({ version: 1, kind: 'retry_selected_run' }, 'Retry the one eligible failed or cancelled run.');
  if (/^run (?:the |one )?(?:enabled|eligible) schedule$/u.test(normalized)) return planned({ version: 1, kind: 'run_selected_schedule' }, 'Run the one enabled schedule.');
  if (normalized === 'open connector setup') return planned({ version: 1, kind: 'open_connector_setup' }, 'Open connector setup.');
  if (normalized === 'open file setup' || normalized === 'open file connector setup') return planned({ version: 1, kind: 'open_file_setup' }, 'Open file connector setup.');

  const navigation = /^(?:go|open|show|take me)(?: me)?(?: to)?\s+(?:the\s+)?(.+)$/u.exec(normalized);
  const route = navigation?.[1] === undefined ? undefined : ROUTES[navigation[1]];
  if (route !== undefined) return planned({ version: 1, kind: 'navigate', route }, `Open ${route}.`);
  if (normalized.startsWith('ask ')) {
    const question = text.slice(4).trim();
    return question.length > 0 && question.length <= 300
      ? planned({ version: 1, kind: 'ask', question }, `Ask: “${question}”`)
      : refusal('invalid_transcript', 'That transcript cannot be used.');
  }
  const summary = /^(?:give me |show |read )?(?:a |the )?(?:workspace |dashboard )?summary$/u.test(normalized)
    ? 'summary' : /^(?:show |read |summarize )?(?:the )?([a-z ]+?)(?: summary)?$/u.exec(normalized)?.[1]?.trim();
  const resource = summary === undefined ? undefined : SUMMARY[summary];
  if (resource !== undefined) return planned({ version: 1, kind: 'summarize', resource: resource as never }, `Read the ${resource} summary.`);
  if (text.endsWith('?') || /^(?:who|what|when|where|why|how|which|is|are|was|were|do|does|did|can|could|would|should|will|has|have)\b/u.test(normalized)) {
    return text.length <= 300 ? planned({ version: 1, kind: 'ask', question: text }, `Ask: “${text}”`) : refusal('invalid_transcript', 'That transcript cannot be used.');
  }
  return refusal('unsupported_command', 'That command is not supported. Try navigation, a summary, or a question.');
}
