/** Browser copy of the cross-runtime lifecycle, guarded against server drift by unit tests. */
export const WEB_VOICE_STATES = [
  'READY', 'REQUESTING_PERMISSION', 'LISTENING', 'PARTIAL_TRANSCRIPT', 'COMMITTED',
  'CHECKING_CONTEXT', 'ANSWERED', 'ABSTAINED', 'CONTRADICTED', 'SPEAKING',
  'INTERRUPTED', 'RATE_LIMITED', 'PERMISSION_DENIED', 'PROVIDER_UNAVAILABLE', 'ERROR',
] as const;

export type VoiceState = (typeof WEB_VOICE_STATES)[number];
export type AudioSignal = 'microphone' | 'playback' | null;

export const WEB_VOICE_EVENTS = [
  'request_permission', 'typed_commit', 'permission_granted', 'partial', 'commit',
  'check_context', 'answer', 'abstain', 'contradict', 'playback_started',
  'playback_finished', 'interrupt', 'deny', 'throttle', 'provider_fail', 'fail',
  'retry', 'reset',
] as const;

export type VoiceEvent = (typeof WEB_VOICE_EVENTS)[number];
type Edges = Partial<Readonly<Record<VoiceEvent, VoiceState>>>;

const TRANSITIONS: Readonly<Record<VoiceState, Edges>> = {
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
    playback_started: 'SPEAKING', throttle: 'RATE_LIMITED', provider_fail: 'PROVIDER_UNAVAILABLE',
    interrupt: 'INTERRUPTED', retry: 'READY', reset: 'READY',
  },
  ABSTAINED: {
    playback_started: 'SPEAKING', throttle: 'RATE_LIMITED', provider_fail: 'PROVIDER_UNAVAILABLE',
    interrupt: 'INTERRUPTED', retry: 'READY', reset: 'READY',
  },
  CONTRADICTED: {
    playback_started: 'SPEAKING', throttle: 'RATE_LIMITED', provider_fail: 'PROVIDER_UNAVAILABLE',
    interrupt: 'INTERRUPTED', retry: 'READY', reset: 'READY',
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
};

export function advanceVoice(from: VoiceState, event: VoiceEvent): VoiceState {
  return TRANSITIONS[from][event] ?? from;
}

export const VOICE_STATE_COPY: Readonly<Record<VoiceState, { readonly status: string; readonly detail: string }>> = {
  READY: { status: 'Ready', detail: 'No microphone track, provider session, query or audio playback is active.' },
  REQUESTING_PERMISSION: { status: 'Requesting microphone permission', detail: 'The browser permission prompt is open. Listening has not started.' },
  LISTENING: { status: 'Listening', detail: 'A live microphone track is supplying PCM to the realtime transcript session.' },
  PARTIAL_TRANSCRIPT: { status: 'Uncommitted transcript', detail: 'Scribe returned words that may still change. They have not been queried or written.' },
  COMMITTED: { status: 'Transcript committed', detail: 'Scribe committed the utterance. The microphone and transcript session are closed.' },
  CHECKING_CONTEXT: { status: 'Checking context', detail: 'The committed words are going through the same planner and context kernel as typed input.' },
  ANSWERED: { status: 'Answered', detail: 'The context kernel returned a supported answer and its evidence. Playback has not started.' },
  ABSTAINED: { status: 'No evidence', detail: 'The context kernel refused to answer because the workspace did not support one.' },
  CONTRADICTED: { status: 'Contradicted', detail: 'The context kernel found live claims that disagree and preserved their evidence.' },
  SPEAKING: { status: 'Speaking', detail: 'Real audio playback is active. Its analyser is the only signal moving the orb.' },
  INTERRUPTED: { status: 'Interrupted', detail: 'Capture, query or playback was cancelled. Partial speech was not sent to the context kernel.' },
  RATE_LIMITED: { status: 'Rate limited', detail: 'The server or speech provider refused more work. No simulated fallback is playing.' },
  PERMISSION_DENIED: { status: 'Microphone blocked', detail: 'The browser denied microphone access. Typed questions remain available.' },
  PROVIDER_UNAVAILABLE: { status: 'Speech provider unavailable', detail: 'The speech boundary failed or returned an invalid response. Provider details are hidden.' },
  ERROR: { status: 'Voice did not complete', detail: 'A local or context request failed. Typed questions remain available.' },
};
