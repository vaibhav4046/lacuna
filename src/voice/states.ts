import type { CapabilityState } from '../model/capability.js';

/**
 * The complete voice lifecycle. These are product states, not animation cues.
 * LISTENING is valid only while a microphone track is live. SPEAKING is valid
 * only between the media element's playing and pause/end events.
 */
export const VOICE_STATES = [
  'READY',
  'REQUESTING_PERMISSION',
  'LISTENING',
  'PARTIAL_TRANSCRIPT',
  'COMMITTED',
  'CHECKING_CONTEXT',
  'ANSWERED',
  'ABSTAINED',
  'CONTRADICTED',
  'SPEAKING',
  'INTERRUPTED',
  'RATE_LIMITED',
  'PERMISSION_DENIED',
  'PROVIDER_UNAVAILABLE',
  'ERROR',
] as const;

export type VoiceState = (typeof VOICE_STATES)[number];

export const VOICE_EVENTS = [
  'request_permission',
  'typed_commit',
  'permission_granted',
  'partial',
  'commit',
  'check_context',
  'answer',
  'abstain',
  'contradict',
  'playback_started',
  'playback_finished',
  'interrupt',
  'deny',
  'throttle',
  'provider_fail',
  'fail',
  'retry',
  'reset',
] as const;

export type VoiceEvent = (typeof VOICE_EVENTS)[number];
type Edges = Partial<Readonly<Record<VoiceEvent, VoiceState>>>;

const TRANSITIONS: Readonly<Record<VoiceState, Edges>> = Object.freeze({
  READY: { request_permission: 'REQUESTING_PERMISSION', typed_commit: 'COMMITTED', fail: 'ERROR' },
  REQUESTING_PERMISSION: {
    permission_granted: 'LISTENING', deny: 'PERMISSION_DENIED', throttle: 'RATE_LIMITED',
    provider_fail: 'PROVIDER_UNAVAILABLE', interrupt: 'INTERRUPTED', fail: 'ERROR',
  },
  LISTENING: {
    partial: 'PARTIAL_TRANSCRIPT', commit: 'COMMITTED', throttle: 'RATE_LIMITED',
    provider_fail: 'PROVIDER_UNAVAILABLE', interrupt: 'INTERRUPTED', fail: 'ERROR',
  },
  PARTIAL_TRANSCRIPT: {
    partial: 'PARTIAL_TRANSCRIPT', commit: 'COMMITTED', throttle: 'RATE_LIMITED',
    provider_fail: 'PROVIDER_UNAVAILABLE', interrupt: 'INTERRUPTED', fail: 'ERROR',
  },
  COMMITTED: { check_context: 'CHECKING_CONTEXT', interrupt: 'INTERRUPTED', fail: 'ERROR' },
  CHECKING_CONTEXT: {
    answer: 'ANSWERED', abstain: 'ABSTAINED', contradict: 'CONTRADICTED',
    throttle: 'RATE_LIMITED', provider_fail: 'PROVIDER_UNAVAILABLE',
    interrupt: 'INTERRUPTED', fail: 'ERROR',
  },
  ANSWERED: {
    playback_started: 'SPEAKING', throttle: 'RATE_LIMITED',
    provider_fail: 'PROVIDER_UNAVAILABLE', interrupt: 'INTERRUPTED', fail: 'ERROR', retry: 'READY', reset: 'READY',
  },
  ABSTAINED: {
    playback_started: 'SPEAKING', throttle: 'RATE_LIMITED',
    provider_fail: 'PROVIDER_UNAVAILABLE', interrupt: 'INTERRUPTED', fail: 'ERROR', retry: 'READY', reset: 'READY',
  },
  CONTRADICTED: {
    playback_started: 'SPEAKING', throttle: 'RATE_LIMITED',
    provider_fail: 'PROVIDER_UNAVAILABLE', interrupt: 'INTERRUPTED', fail: 'ERROR', retry: 'READY', reset: 'READY',
  },
  SPEAKING: {
    playback_finished: 'READY', interrupt: 'INTERRUPTED', throttle: 'RATE_LIMITED',
    provider_fail: 'PROVIDER_UNAVAILABLE', fail: 'ERROR',
  },
  INTERRUPTED: { request_permission: 'REQUESTING_PERMISSION', retry: 'READY', reset: 'READY' },
  RATE_LIMITED: { retry: 'READY', reset: 'READY' },
  PERMISSION_DENIED: { retry: 'READY', reset: 'READY' },
  PROVIDER_UNAVAILABLE: { retry: 'READY', reset: 'READY' },
  ERROR: { retry: 'READY', reset: 'READY' },
});

export function advance(from: VoiceState, event: VoiceEvent): VoiceState {
  return TRANSITIONS[from][event] ?? from;
}

export function acceptedFrom(state: VoiceState): readonly VoiceEvent[] {
  return VOICE_EVENTS.filter((event) => {
    const next = TRANSITIONS[state][event];
    return next !== undefined && next !== state;
  });
}

export function readState(value: string | null | undefined): VoiceState | null {
  if (value === null || value === undefined) return null;
  return VOICE_STATES.find((state) => state === value) ?? null;
}

export const PIPELINE_STAGES = ['STT', 'HydraDB', 'Resolver', 'TTS'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface StageFacts {
  readonly stage: PipelineStage;
  readonly does: string;
  readonly capability: CapabilityState;
}

export const STAGE_FACTS: readonly StageFacts[] = Object.freeze([
  {
    stage: 'STT',
    does: 'Streams live microphone PCM to ElevenLabs Scribe with a server-issued single-use token.',
    capability: 'VERIFIED',
  },
  {
    stage: 'HydraDB',
    does: 'Reads the temporal graph through the existing question planner.',
    capability: 'VERIFIED',
  },
  {
    stage: 'Resolver',
    does: 'Returns the same answer, abstention, contradiction and evidence as typed questions.',
    capability: 'VERIFIED',
  },
  {
    stage: 'TTS',
    does: 'Streams only the spoken answer through the server to real browser playback.',
    capability: 'VERIFIED',
  },
]);

const AT_STAGE: Readonly<Record<VoiceState, PipelineStage | null>> = Object.freeze({
  READY: null,
  REQUESTING_PERMISSION: 'STT',
  LISTENING: 'STT',
  PARTIAL_TRANSCRIPT: 'STT',
  COMMITTED: null,
  CHECKING_CONTEXT: 'HydraDB',
  ANSWERED: 'Resolver',
  ABSTAINED: 'Resolver',
  CONTRADICTED: 'Resolver',
  SPEAKING: 'TTS',
  INTERRUPTED: null,
  RATE_LIMITED: null,
  PERMISSION_DENIED: null,
  PROVIDER_UNAVAILABLE: null,
  ERROR: null,
});

export function stageOf(state: VoiceState): PipelineStage | null {
  return AT_STAGE[state];
}

export type TranscriptStanding = 'Idle' | 'Capturing' | 'Partial' | 'Committed' | 'Unavailable';
export type AudioSignal = 'microphone' | 'playback' | null;

export interface StateFacts {
  readonly label: string;
  readonly status: string;
  readonly detail: string;
  readonly failed: boolean;
  readonly weight: 'full' | 'faded' | 'outline';
  readonly provisional: boolean;
  readonly transcript: TranscriptStanding;
  /** The only source that may move the orb while this state is genuinely active. */
  readonly signal: AudioSignal;
}

export const STATE_FACTS: Readonly<Record<VoiceState, StateFacts>> = Object.freeze({
  READY: {
    label: 'Ready', status: 'Ready', failed: false, weight: 'full', provisional: false,
    transcript: 'Idle', signal: null,
    detail: 'No microphone track, provider session, query or audio playback is active.',
  },
  REQUESTING_PERMISSION: {
    label: 'Permission', status: 'Preparing secure voice', failed: false,
    weight: 'outline', provisional: true, transcript: 'Unavailable', signal: null,
    detail: 'The server is checking speech access before the browser requests microphone permission. Listening has not started.',
  },
  LISTENING: {
    label: 'Listening', status: 'Listening', failed: false, weight: 'full', provisional: false,
    transcript: 'Capturing', signal: 'microphone',
    detail: 'A live microphone track is supplying PCM to the realtime transcript session.',
  },
  PARTIAL_TRANSCRIPT: {
    label: 'Partial', status: 'Uncommitted transcript', failed: false, weight: 'full',
    provisional: true, transcript: 'Partial', signal: 'microphone',
    detail: 'Scribe returned words that may still change. They have not been queried or written.',
  },
  COMMITTED: {
    label: 'Committed', status: 'Transcript committed', failed: false, weight: 'full',
    provisional: false, transcript: 'Committed', signal: null,
    detail: 'Scribe committed the utterance. The microphone and transcript session are closed.',
  },
  CHECKING_CONTEXT: {
    label: 'Checking', status: 'Checking context', failed: false, weight: 'full',
    provisional: false, transcript: 'Committed', signal: null,
    detail: 'The committed words are going through the same planner and context kernel as typed input.',
  },
  ANSWERED: {
    label: 'Answered', status: 'Answered', failed: false, weight: 'full', provisional: false,
    transcript: 'Committed', signal: null,
    detail: 'The context kernel returned a supported answer and its evidence. Playback has not started.',
  },
  ABSTAINED: {
    label: 'Abstained', status: 'No evidence', failed: false, weight: 'outline', provisional: false,
    transcript: 'Committed', signal: null,
    detail: 'The context kernel refused to answer because the workspace did not support one.',
  },
  CONTRADICTED: {
    label: 'Contradicted', status: 'Contradicted', failed: false, weight: 'faded', provisional: false,
    transcript: 'Committed', signal: null,
    detail: 'The context kernel found live claims that disagree and preserved their evidence.',
  },
  SPEAKING: {
    label: 'Speaking', status: 'Speaking', failed: false, weight: 'full', provisional: false,
    transcript: 'Committed', signal: 'playback',
    detail: 'Real audio playback is active. Its analyser is the only signal moving the orb.',
  },
  INTERRUPTED: {
    label: 'Interrupted', status: 'Interrupted', failed: false, weight: 'faded', provisional: false,
    transcript: 'Committed', signal: null,
    detail: 'Capture, query or playback was cancelled. Partial speech was not sent to the context kernel.',
  },
  RATE_LIMITED: {
    label: 'Rate limited', status: 'Rate limited', failed: true, weight: 'faded', provisional: false,
    transcript: 'Unavailable', signal: null,
    detail: 'The server or speech provider refused more work. No simulated fallback is playing.',
  },
  PERMISSION_DENIED: {
    label: 'Mic blocked', status: 'Microphone blocked', failed: true, weight: 'outline',
    provisional: false, transcript: 'Unavailable', signal: null,
    detail: 'The browser denied microphone access. Typed questions remain available.',
  },
  PROVIDER_UNAVAILABLE: {
    label: 'Provider down', status: 'Speech provider unavailable', failed: true,
    weight: 'outline', provisional: false, transcript: 'Unavailable', signal: null,
    detail: 'The speech boundary failed or returned an invalid response. Provider details are hidden.',
  },
  ERROR: {
    label: 'Error', status: 'Voice did not complete', failed: true, weight: 'outline',
    provisional: false, transcript: 'Unavailable', signal: null,
    detail: 'A local or context request failed. Typed questions remain available.',
  },
});

/** The only honest default before a person starts a real capture. */
export const RUNNING_STATE: VoiceState = 'READY';
