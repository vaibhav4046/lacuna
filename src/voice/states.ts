/**
 * The voice interface as a finite machine, written down before any audio runs.
 *
 * A voice surface fails in more ways than it succeeds. It can be denied the
 * microphone, throttled, cut off mid sentence, handed a provider that is down,
 * or asked to work with no network at all. Most products draw the happy path
 * and let the rest emerge as bugs. This file names all fourteen situations,
 * says which events move between them, and refuses to invent any it cannot
 * reach, so the page that renders them cannot show a state the machine does
 * not have.
 *
 * Nothing here touches audio. It is a pure function over a state and an event,
 * which is what makes the whole set testable without a microphone in the room,
 * and what lets the server render any state from a URL. See DECISIONS.md D-055
 * for why this route ships no client script and how the states are reached
 * instead.
 */

import type { CapabilityState } from '../model/capability.js';

/** Every situation the voice surface can be in. */
export const VOICE_STATES = [
  'ready',
  'listening',
  'partial_transcript',
  'final_transcript',
  'retrieving',
  'reasoning',
  'generating_voice',
  'speaking',
  'interrupted',
  'permission_denied',
  'rate_limited',
  'provider_unavailable',
  'offline',
  'text_only',
] as const;

export type VoiceState = (typeof VOICE_STATES)[number];

/** Everything that can move the machine. */
export const VOICE_EVENTS = [
  'hold',
  'transcribing',
  'commit',
  'send',
  'retrieved',
  'grounded',
  'synthesised',
  'finish',
  'interrupt',
  'deny',
  'throttle',
  'providerFail',
  'disconnect',
  'reconnect',
  'useText',
  'reset',
] as const;

export type VoiceEvent = (typeof VOICE_EVENTS)[number];

type Edges = Partial<Readonly<Record<VoiceEvent, VoiceState>>>;

/**
 * Two edges that exist everywhere.
 *
 * Losing the network and giving up on speech are not things that happen only
 * at convenient moments, so they are merged into every state rather than
 * written out fourteen times and forgotten once.
 */
const ANYWHERE: Edges = {
  disconnect: 'offline',
  useText: 'text_only',
};

function edges(own: Edges): Edges {
  return Object.freeze({ ...ANYWHERE, ...own });
}

/**
 * The whole transition table.
 *
 * An event missing from a state is not an error and not a crash: the machine
 * stays where it is. A voice surface receives events it did not ask for all
 * the time, and the correct response to most of them is to do nothing.
 */
const TRANSITIONS: Readonly<Record<VoiceState, Edges>> = Object.freeze({
  ready: edges({ hold: 'listening', deny: 'permission_denied', throttle: 'rate_limited' }),
  listening: edges({
    transcribing: 'partial_transcript',
    commit: 'final_transcript',
    deny: 'permission_denied',
    throttle: 'rate_limited',
    reset: 'ready',
  }),
  partial_transcript: edges({
    transcribing: 'partial_transcript',
    commit: 'final_transcript',
    deny: 'permission_denied',
    reset: 'ready',
  }),
  final_transcript: edges({ send: 'retrieving', reset: 'ready' }),
  retrieving: edges({ retrieved: 'reasoning', reset: 'ready' }),
  reasoning: edges({ grounded: 'generating_voice', reset: 'ready' }),
  generating_voice: edges({
    synthesised: 'speaking',
    providerFail: 'provider_unavailable',
    interrupt: 'interrupted',
  }),
  speaking: edges({ finish: 'ready', interrupt: 'interrupted' }),
  interrupted: edges({ hold: 'listening', reset: 'ready' }),
  permission_denied: edges({ hold: 'listening', reset: 'ready' }),
  rate_limited: edges({ reset: 'ready' }),
  provider_unavailable: edges({ reset: 'ready' }),
  offline: edges({ reconnect: 'ready' }),
  text_only: edges({ reset: 'ready' }),
});

/**
 * Apply an event. Returns the same state when the event does not apply.
 */
export function advance(from: VoiceState, event: VoiceEvent): VoiceState {
  return TRANSITIONS[from][event] ?? from;
}

/** The events that actually do something from here, in declaration order. */
export function acceptedFrom(state: VoiceState): readonly VoiceEvent[] {
  const table = TRANSITIONS[state];
  return VOICE_EVENTS.filter((event) => {
    const next = table[event];
    return next !== undefined && next !== state;
  });
}

/** Narrow an untrusted string to a state, or nothing. */
export function readState(value: string | null | undefined): VoiceState | null {
  if (value === null || value === undefined) return null;
  const found = VOICE_STATES.find((state) => state === value);
  return found ?? null;
}

/**
 * The four stages a spoken question would pass through.
 *
 * Two of them are this product and are exercised by the test suite. Two of
 * them are audio and are not installed on the machine that renders this. The
 * rail prints that difference rather than a timing, because a timing for a
 * stage that never ran is the exact number a reader would most want to trust
 * and least be able to.
 */
export const PIPELINE_STAGES = [
  'STT',
  'HydraDB',
  'Resolver',
  'TTS',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface StageFacts {
  readonly stage: PipelineStage;
  readonly does: string;
  readonly capability: CapabilityState;
}

export const STAGE_FACTS: readonly StageFacts[] = Object.freeze([
  {
    stage: 'STT',
    does: 'Turns captured audio into a transcript.',
    capability: 'NOT_STARTED',
  },
  {
    stage: 'HydraDB',
    does: 'Reads the temporal graph over HTTP and returns the claims and the '
      + 'edges between them.',
    capability: 'VERIFIED',
  },
  {
    stage: 'Resolver',
    does: 'Decides the verdict from which edges exist. No model reads the '
      + 'stored text, so this stage is deterministic.',
    capability: 'VERIFIED',
  },
  {
    stage: 'TTS',
    does: 'Turns the answer into audio.',
    capability: 'NOT_STARTED',
  },
]);

/** Which stage a state is sitting at, or nothing when it is not in the run. */
const AT_STAGE: Readonly<Record<VoiceState, PipelineStage | null>> = Object.freeze({
  ready: null,
  listening: 'STT',
  partial_transcript: 'STT',
  final_transcript: 'STT',
  retrieving: 'HydraDB',
  reasoning: 'Resolver',
  generating_voice: 'TTS',
  speaking: 'TTS',
  interrupted: null,
  permission_denied: null,
  rate_limited: null,
  provider_unavailable: 'TTS',
  offline: null,
  text_only: null,
});

export function stageOf(state: VoiceState): PipelineStage | null {
  return AT_STAGE[state];
}

/** How the transcript stands in a given state. */
export type TranscriptStanding = 'Idle' | 'Capturing' | 'Partial' | 'Committed' | 'Unavailable';

export interface StateFacts {
  /** Short name, used on the state list. */
  readonly label: string;
  /** What the status line says. */
  readonly status: string;
  /** One sentence of what is true here. */
  readonly detail: string;
  /** Whether the surface is drawing energy from a live source. */
  readonly active: boolean;
  /** Whether this state is a failure rather than a step. */
  readonly failed: boolean;
  /** How much of the sphere is drawn: full, faded, or outline only. */
  readonly weight: 'full' | 'faded' | 'outline';
  /** Whether the sphere edge is dashed, which marks anything provisional. */
  readonly provisional: boolean;
  readonly transcript: TranscriptStanding;
}

/**
 * What is true in each state.
 *
 * The wording follows the imported design at design/reference, with one class
 * of change: every invented number is gone. The design says audio stops within
 * 120 ms and that voice resumes in 24 seconds. Neither was measured here, so
 * neither is printed here.
 */
export const STATE_FACTS: Readonly<Record<VoiceState, StateFacts>> = Object.freeze({
  ready: {
    label: 'Ready',
    status: 'Ready',
    detail: 'Nothing is captured yet. Voice would read the same graph as the '
      + 'question form, through the same resolver.',
    active: false,
    failed: false,
    weight: 'full',
    provisional: false,
    transcript: 'Idle',
  },
  listening: {
    label: 'Listening',
    status: 'Listening',
    detail: 'Audio is being captured and has not become words yet. The boundary '
      + 'would move with microphone level.',
    active: true,
    failed: false,
    weight: 'full',
    provisional: false,
    transcript: 'Capturing',
  },
  partial_transcript: {
    label: 'Partial',
    status: 'Uncommitted transcript',
    detail: 'Words have arrived and can still change. The dashed edge marks '
      + 'speech that has not been confirmed.',
    active: true,
    failed: false,
    weight: 'full',
    provisional: true,
    transcript: 'Partial',
  },
  final_transcript: {
    label: 'Final',
    status: 'Transcript committed',
    detail: 'The utterance is complete. What goes to the graph is now fixed and '
      + 'is shown in full before it is sent.',
    active: false,
    failed: false,
    weight: 'full',
    provisional: false,
    transcript: 'Committed',
  },
  retrieving: {
    label: 'Retrieving',
    status: 'Retrieving memory',
    detail: 'The transcript has become a subject and a predicate, and the graph '
      + 'is being read. This is the same read the question form makes.',
    active: true,
    failed: false,
    weight: 'full',
    provisional: false,
    transcript: 'Committed',
  },
  reasoning: {
    label: 'Resolving',
    status: 'Resolving the verdict',
    detail: 'The claims are in hand and the verdict is being decided from the '
      + 'edges between them. No model is consulted.',
    active: true,
    failed: false,
    weight: 'full',
    provisional: false,
    transcript: 'Committed',
  },
  generating_voice: {
    label: 'Generating',
    status: 'Preparing speech',
    detail: 'The answer exists as text and is being turned into audio. The '
      + 'answer does not change during this stage.',
    active: true,
    failed: false,
    weight: 'full',
    provisional: false,
    transcript: 'Committed',
  },
  speaking: {
    label: 'Speaking',
    status: 'Speaking',
    detail: 'Audio is playing. The evidence for each sentence is on screen '
      + 'while that sentence is spoken.',
    active: true,
    failed: false,
    weight: 'full',
    provisional: false,
    transcript: 'Committed',
  },
  interrupted: {
    label: 'Interrupted',
    status: 'Interrupted',
    detail: 'Playback was stopped on purpose. The transcript and the evidence '
      + 'stay on screen, because the answer was still true.',
    active: false,
    failed: false,
    weight: 'faded',
    provisional: false,
    transcript: 'Committed',
  },
  permission_denied: {
    label: 'Mic blocked',
    status: 'Microphone blocked',
    detail: 'The browser refused microphone access. Nothing is captured and '
      + 'nothing is guessed. The question form is unaffected.',
    active: false,
    failed: true,
    weight: 'outline',
    provisional: false,
    transcript: 'Unavailable',
  },
  rate_limited: {
    label: 'Rate limited',
    status: 'Rate limited',
    detail: 'Too many requests from this address. The wait is whatever the '
      + 'server says it is, and the question form is unaffected.',
    active: false,
    failed: true,
    weight: 'faded',
    provisional: false,
    transcript: 'Unavailable',
  },
  provider_unavailable: {
    label: 'Provider down',
    status: 'Speech provider unavailable',
    detail: 'Speech synthesis failed. No audio is produced and none is '
      + 'simulated. The answer is still readable as text.',
    active: false,
    failed: true,
    weight: 'outline',
    provisional: false,
    transcript: 'Committed',
  },
  offline: {
    label: 'Offline',
    status: 'Offline',
    detail: 'The graph cannot be reached. An answer needs a read, so no answer '
      + 'is offered rather than one from memory.',
    active: false,
    failed: true,
    weight: 'outline',
    provisional: false,
    transcript: 'Unavailable',
  },
  text_only: {
    label: 'Text only',
    status: 'Text only',
    detail: 'Voice is set aside and the question form does the whole job. This '
      + 'is the state this build actually runs in.',
    active: false,
    failed: false,
    weight: 'outline',
    provisional: true,
    transcript: 'Idle',
  },
});

/**
 * The state this deployment is really in.
 *
 * Named once, here, so the page does not have to decide it and cannot drift
 * from what the stage table says. Two of the four stages are not installed, so
 * the surface cannot be in any state that needs them.
 */
export const RUNNING_STATE: VoiceState = 'text_only';
